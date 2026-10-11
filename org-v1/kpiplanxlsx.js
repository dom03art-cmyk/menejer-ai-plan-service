// Хэлтсийн ирэх жилийн төлөвлөгөөний KPI хяналтын Excel: суурь түвшин (өмнөх оны бодит дүн, кодоор), зорилт ба сар бүрийн гүйцэтгэлийг хэрэглэгч бөглөнө,
// гүйцэтгэл ба биелэлт томьёогоор автоматаар бодогдоно.
//   makeModel(meta, m, res) → { buffer, ok, bad, total }
const NAVY = "FF2E3B4E", GOLD = "FFD9822B", YEL = "FFFFF2CC", HEAD = "FFF2F2F2";
const MN = ["1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар", "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар"];
const col = (n) => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const AGGT = { sum: "Нийлбэр", avg: "Дундаж", last: "Сүүлийн сарын утга" };

function buildXlsx(meta, m, res) {
  const ExcelJS = require("exceljs");
  const org = meta.org_name || res.org_name, unit = meta.unit_name || res.unit_name || "", Y = res.year, NY = Y + 1;
  const wb = new ExcelJS.Workbook(); wb.creator = "Менежер AI"; wb.created = new Date(); wb.calcProperties = { fullCalcOnLoad: true };
  const font = (o = {}) => ({ name: "Times New Roman", size: 11, ...o });
  const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const thin = { style: "thin", color: { argb: "FFBFBFBF" } }, B = { left: thin, right: thin, top: thin, bottom: thin };
  const ws = wb.addWorksheet("KPI хяналт", { views: [{ state: "frozen", xSplit: 2, ySplit: 4, showGridLines: false }] });
  ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  [34, 9, 16, 13, 13, ...Array(12).fill(10), 13, 11].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.getCell("A1").value = `${org}${unit ? " — " + unit : ""}: ${NY} оны KPI хяналтын хүснэгт`; ws.getCell("A1").font = font({ size: 14, bold: true, color: { argb: NAVY } });
  ws.getCell("A2").value = `Шар нүдэнд ${NY} оны зорилт ба сар бүрийн гүйцэтгэлээ бичнэ үү. «Гүйцэтгэл», «Биелэлт» автоматаар бодогдоно. Суурь түвшин — ${res.period}-ын бодит дүн.`;
  ws.getCell("A2").font = font({ italic: true, size: 10, color: { argb: "FF595959" } });
  const H = ["Үзүүлэлт", "Нэгж", "Тооцох арга", `Суурь (${Y})`, `Зорилт ${NY}`, ...MN, "Гүйцэтгэл", "Биелэлт"];
  H.forEach((t, i) => { const c = ws.getCell(4, i + 1); c.value = t; c.font = font({ bold: true, color: { argb: "FFFFFFFF" } }); c.fill = fill(NAVY); c.border = B; c.alignment = { horizontal: i ? "center" : "left", vertical: "middle", wrapText: true }; });
  ws.getRow(4).height = 32;
  const checks = []; let r = 5;
  for (const x of res.indicators) {
    const agg = x.agg || "sum", fmt = x.unit === "%" ? "0.0" : (Number.isInteger(x.total) || x.total === null ? "#,##0" : "#,##0.0");
    const F = col(6), Q = col(17), rng = `${F}${r}:${Q}${r}`;
    ws.getCell(r, 1).value = x.name; ws.getCell(r, 2).value = x.unit || ""; ws.getCell(r, 3).value = AGGT[agg] || AGGT.sum + (x.better === "low" ? " (бага нь сайн)" : "");
    if (x.better === "low") ws.getCell(r, 3).value = `${AGGT[agg] || AGGT.sum} · бага нь сайн`;
    ws.getCell(r, 4).value = Number.isFinite(x.total) ? x.total : null; ws.getCell(r, 4).numFmt = fmt;
    for (let c = 5; c <= 17; c++) { ws.getCell(r, c).fill = fill(YEL); ws.getCell(r, c).numFmt = fmt; }
    let perf;
    if (agg === "avg") perf = `IF(COUNT(${rng})=0,"",SUM(${rng})/COUNT(${rng}))`;
    else if (agg === "last") { perf = '""'; for (let c = 6; c <= 17; c++) perf = `IF(${col(c)}${r}<>"",${col(c)}${r},${perf})`; }
    else perf = `IF(COUNT(${rng})=0,"",SUM(${rng}))`;
    ws.getCell(r, 18).value = { formula: perf }; ws.getCell(r, 18).numFmt = fmt;
    const E = `E${r}`, R = `R${r}`;
    ws.getCell(r, 19).value = { formula: x.better === "low" ? `IFERROR(IF(OR(${E}="",${R}=""),"",${E}/${R}),"")` : `IFERROR(IF(OR(${E}="",${R}=""),"",${R}/${E}),"")` };
    ws.getCell(r, 19).numFmt = "0.0%";
    for (let c = 1; c <= 19; c++) { ws.getCell(r, c).border = B; if (!ws.getCell(r, c).font || c < 5 || c > 17) ws.getCell(r, c).font = font(); }
    checks.push({ r, base: x.total });
    r++;
  }
  ws.getCell(r + 1, 1).value = "Биелэлт: их нь сайн үзүүлэлтэд гүйцэтгэл ÷ зорилт, бага нь сайн үзүүлэлтэд зорилт ÷ гүйцэтгэл. Нийлбэр үзүүлэлтэд жилийн зорилт, дундаж ба сүүлийн сарын үзүүлэлтэд түвшний зорилт бичнэ.";
  ws.getCell(r + 1, 1).font = font({ italic: true, size: 9, color: { argb: "FF595959" } });
  return { wb, checks };
}

async function makeModel(meta, m, res) {
  const { wb, checks } = buildXlsx(meta || {}, m, res);
  const bad = [];
  for (const c of checks) { const v = wb.getWorksheet("KPI хяналт").getCell(c.r, 4).value; if (c.base !== null && c.base !== undefined && Number.isFinite(c.base) && v !== c.base) bad.push({ row: c.r, want: c.base, got: v }); }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, ok: bad.length === 0 && checks.length > 0, bad, total: checks.length };
}
module.exports = { makeModel, buildXlsx };
