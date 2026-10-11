// Маркетингийн төлөвлөгөөний томьёотой Excel загвар — calc.js-ийн run()-ыг Excel томьёогоор давтана.
// Төлөвлөгөө (Word/PDF) бичих урсгалаас ТУСДАА: энд алдаа гарсан ч PDF/Word-д нөлөөлөхгүй.
//   makeModel(A, cfg, calc) → { buffer, ok, bad[], total, formulas }
//     1) томьёотой workbook үүсгэнэ  2) plan-v2/xlsxCalc.js-ээр бүх томьёог бодно
//     3) гол тоонуудыг calc.js-ийн тооцоотой тулгана — зөрвөл ok=false (файлыг захиалагчид өгөхгүй)
const { computeWorkbook } = require("../plan-v2/xlsxCalc");

const S_SUM = "Хураангуй", S_IN = "Таамаглал", S_MON = "Сар бүрээр", S_CH = "Сувгаар", S_DET = "Сар, сувгийн тооцоо", S_TRK = "Гүйцэтгэлийн хяналт", S_HELP = "Заавар";
const NAVY = "FF1B2A4A", GOLD = "FFC9A227", INPUT = "FFFFF6D6", HEAD = "FFE9ECF3", TOTAL = "FFF3F0E4";
const NUM = "#,##0;[Red]-#,##0", PCT = "0.0%", PCT2 = "0.00%", DEC = "0.00", D1 = "#,##0.0";
const MN = ["1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар", "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар"];
const col = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - 1 - m) / 26; } return s; };
const q = (sheet) => `'${sheet}'!`;
const monthText = (ym) => { const m = /^(\d{4})-(\d{2})$/.exec(String(ym || "")); return m ? `${m[1]} оны ${MN[Number(m[2]) - 1]}` : String(ym || ""); };

function buildXlsx(A, cfg, calc) {
  const ExcelJS = require("exceljs");
  const R = calc.realistic, S = R.summary, n = Number(cfg.period_months), chs = cfg.channels || [], fxs = cfg.fixed_costs || [];
  const pad = (a) => [...(a || []), ...Array(n).fill(1)].slice(0, n);
  const season = pad(cfg.seasonality), ramp = pad(cfg.efficiency_ramp);
  const brand = (A.brand && A.brand.name) || "";
  const wb = new ExcelJS.Workbook();
  wb.creator = "Менежер AI"; wb.created = new Date(); wb.calcProperties = { fullCalcOnLoad: true };
  const checks = [];
  const chk = (sheet, r, c, expected, label, tol) => { if (expected === null || expected === undefined || typeof expected !== "number") return; checks.push({ sheet, addr: `${col(c)}${r}`, expected, label, tol }); };

  const mk = (name, widths) => {
    const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = Math.round(w * 1.12); });
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
    ws.headerFooter = { oddFooter: `&L&8${brand.replace(/&/g, "&&")} — маркетингийн тооцоо&C&8${name}&R&8&P / &N` };
    return ws;
  };
  const font = (o = {}) => ({ name: "Times New Roman", size: 11, ...o });
  const title = (ws, text, sub) => {
    ws.getCell("A1").value = text; ws.getCell("A1").font = font({ size: 14, bold: true, color: { argb: NAVY } });
    if (sub) { ws.getCell("A2").value = sub; ws.getCell("A2").font = font({ italic: true, color: { argb: "FF666666" } }); }
  };
  const head = (ws, r, labels, from = 1) => labels.forEach((t, i) => {
    const c = ws.getCell(r, from + i); c.value = t; c.font = font({ bold: true, color: { argb: "FFFFFFFF" } });
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle", wrapText: true };
  });
  const section = (ws, r, text, span = 6) => {
    const c = ws.getCell(r, 1); c.value = text; c.font = font({ bold: true, color: { argb: NAVY } });
    for (let i = 1; i <= span; i++) { ws.getCell(r, i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } }; ws.getCell(r, i).border = { bottom: { style: "thin", color: { argb: GOLD } } }; }
  };
  const put = (ws, r, c, v, fmt, o = {}) => {
    const cell = ws.getCell(r, c); cell.value = v; cell.font = font(o.bold ? { bold: true } : {});
    if (fmt) cell.numFmt = fmt;
    if (o.input) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
    if (o.total) { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL } }; cell.border = { top: { style: "thin", color: { argb: "FF999999" } } }; }
    if (o.wrap) cell.alignment = { wrapText: true, vertical: "top" };
    return cell;
  };
  const f = (ws, r, c, formula, fmt = NUM, o = {}) => { const cell = put(ws, r, c, { formula }, fmt, o); cell.alignment = { horizontal: "right" }; return cell; };
  const A$ = (sheet, r, c) => `${q(sheet)}$${col(c)}$${r}`;
  const rng = (sheet, c, r1, r2) => `${q(sheet)}$${col(c)}$${r1}:$${col(c)}$${r2}`;

  const w0 = mk(S_SUM, [50, 20, 20, 20, 30]); // эхний хуудас — төгсгөлд бөглөнө
  const wi = mk(S_IN, [40, 16, 12, 14, 12, 14, 14, 14, 14, 14]);
  const wm = mk(S_MON, [20, 15, 14, 15, 14, 12, 12, 12, 13, 15, 15, 16, 17, 10]);
  const wc = mk(S_CH, [34, 15, 10, 14, 12, 12, 12, 14, 13, 15, 15, 10]);
  const wd = mk(S_DET, [8, 18, 8, 34, 14, 14, 12, 12, 12, 13, 15]);
  const wt = mk(S_TRK, [20, 15, 15, 14, 14, 14, 12, 15, 15, 14, 15]);
  const wh = mk(S_HELP, [100]);

  // ───────────── 1. ТААМАГЛАЛ ─────────────
  
  title(wi, "Маркетингийн тооцоо — Таамаглал", `${brand}${A.brand && A.brand.offer ? " · " + String(A.brand.offer).slice(0, 90) : ""}`);
  wi.getCell("A3").value = "Шар нүднүүд оролт. Тэдгээрийг өөрчлөхөд бусад бүх хуудас автоматаар дахин тооцогдоно.";
  wi.getCell("A3").font = font({ italic: true });
  section(wi, 5, "Ерөнхий таамаглал", 3); head(wi, 6, ["Үзүүлэлт", "Утга", ""]);
  const P = {};
  const params = [
    ["n", "Төлөвлөгөөний хугацаа (сар) — мэдээлэл", n, "0", false],
    ["aov", "Нэг худалдан авалтын дундаж үнэ (₮)", Number(cfg.avg_order_value || 0), NUM, true],
    ["gm", "Нийт ашгийн хувь (үнээс)", Number(cfg.gross_margin_pct || 0), PCT, true],
    ["ppy", "Нэг үйлчлүүлэгчийн жилд худалдан авах тоо", Number(cfg.purchases_per_customer_per_year || 1), DEC, true],
    ["ret", "Үйлчлүүлэгч хадгалагдах хугацаа (жил)", Number(cfg.retention_years || 1), DEC, true],
    ["base", "Маркетингаас гадуурх сарын орлого (₮)", Number(cfg.baseline_monthly_revenue || 0), NUM, true],
    ["mult", "Идэвхтэй хувилбарын коэффициент (бодит = 1)", 1, DEC, true],
    ["pess", "Болгоомжтой хувилбарын коэффициент", Number((cfg.scenarios || {}).pessimistic ?? 0.7), DEC, true],
    ["opt", "Өөдрөг хувилбарын коэффициент", Number((cfg.scenarios || {}).optimistic ?? 1.25), DEC, true],
  ];
  let r = 7;
  for (const [k, lbl, v, fmt, inp] of params) { put(wi, r, 1, lbl); put(wi, r, 2, v, fmt, { input: inp }); P[k] = A$(S_IN, r, 2); r++; }
  put(wi, r, 1, "Хувилбарын коэффициент нь зарын хөрвүүлэлт (худалдан авалт, дагагч)-ыг үржүүлнэ; зардал өөрчлөгдөхгүй.", null).font = font({ italic: true, size: 9, color: { argb: "FF666666" } });

  r += 2; section(wi, r, "Сурталчилгааны сувгууд", 10); r++;
  head(wi, r, ["Суваг", "Сарын төсөв (₮)", "Үнийн төрөл", "Үнэ (CPM/CPC ₮)", "Товшилтын хувь", "Замнал", "Товшилт→ лавлагаа", "Лавлагаа→ худалдан авалт", "Товшилт→ худалдан авалт", "Товшилт→ дагагч"]);
  wi.getRow(r).height = 44; r++;
  const CH0 = r;
  chs.forEach((c) => {
    const cpc = c.cpc !== undefined, direct = c.click_to_sale_pct !== undefined;
    put(wi, r, 1, c.name, null, { input: true });
    put(wi, r, 2, Number(c.monthly_budget || 0), NUM, { input: true });
    put(wi, r, 3, cpc ? "CPC" : "CPM", null, { input: true });
    put(wi, r, 4, Number((cpc ? c.cpc : c.cpm) || 0), NUM, { input: true });
    put(wi, r, 5, Number(c.ctr_pct || 0), PCT2, { input: true });
    put(wi, r, 6, direct ? "Шууд" : "Лавлагаа", null, { input: true });
    put(wi, r, 7, Number(c.click_to_lead_pct || 0), PCT2, { input: true });
    put(wi, r, 8, Number(c.lead_to_sale_pct || 0), PCT2, { input: true });
    put(wi, r, 9, Number(c.click_to_sale_pct || 0), PCT2, { input: true });
    put(wi, r, 10, Number(c.click_to_follower_pct || 0), PCT2, { input: true });
    r++;
  });
  const chRow = (j) => CH0 + j;
  put(wi, r, 1, "Үнийн төрөл: CPM = 1000 харагдалтын үнэ, CPC = нэг товшилтын үнэ. Замнал: «Лавлагаа» = товшилт → чат/лавлагаа → худалдан авалт, «Шууд» = товшилтоос шууд худалдан авалт.").font = font({ italic: true, size: 9, color: { argb: "FF666666" } });

  r += 2; section(wi, r, "Тогтмол зардал (агуулга, хэрэгсэл, хэвлэмэл г.м.)", 4); r++;
  head(wi, r, ["Зардал", "Сар бүр (₮)", "Нэг удаа (₮)", "Нэг удаагийн сар (№)"]); r++;
  const FX0 = r;
  fxs.forEach((x) => {
    put(wi, r, 1, x.name, null, { input: true });
    put(wi, r, 2, Number(x.monthly || 0), NUM, { input: true });
    put(wi, r, 3, Number(x.one_time || 0), NUM, { input: true });
    put(wi, r, 4, Number(x.month || 1), "0", { input: true });
    r++;
  });
  if (!fxs.length) { put(wi, r, 1, "—", null, { input: true }); put(wi, r, 2, 0, NUM, { input: true }); put(wi, r, 3, 0, NUM, { input: true }); put(wi, r, 4, 1, "0", { input: true }); r++; }
  const FX1 = r - 1;

  r += 1; section(wi, r, "Сар бүрийн коэффициент", 4); r++;
  head(wi, r, ["Сар", "№", "Улирлын коэф. (төсөв)", "Үр ашгийн коэф. (хөрвүүлэлт)"]); wi.getRow(r).height = 30; r++;
  const M0 = r;
  R.months.forEach((m, i) => {
    put(wi, r, 1, monthText(m.month)); put(wi, r, 2, i + 1, "0");
    put(wi, r, 3, Number(season[i]), DEC, { input: true }); put(wi, r, 4, Number(ramp[i]), DEC, { input: true });
    r++;
  });
  const mRow = (i) => M0 + i;
  put(wi, r, 1, "Үр ашгийн коэф.: эхний саруудад зар «суралцах» тул хөрвүүлэлт бага (жишээ нь 0.6 → 1.0).").font = font({ italic: true, size: 9, color: { argb: "FF666666" } });

  // ───────────── 2. САР, СУВГИЙН ДЭЛГЭРЭНГҮЙ ТООЦОО ─────────────
  
  title(wd, "Сар, суваг тус бүрийн тооцоо", "Бүх нүд томьёо — «Таамаглал» хуудаснаас тооцогдоно");
  head(wd, 4, ["Сар №", "Сар", "Суваг №", "Суваг", "Төсөв (₮)", "Харагдалт", "Товшилт", "Лавлагаа", "Дагагч", "Худалдан авалт", "Орлого (₮)"]);
  wd.getRow(4).height = 30;
  let dr = 5; const D0 = dr;
  R.months.forEach((m, i) => {
    const mr = mRow(i);
    chs.forEach((c, j) => {
      const cr = chRow(j), I = (cc) => A$(S_IN, cr, cc), M = (cc) => A$(S_IN, mr, cc), x = (cc) => `${col(cc)}${dr}`;
      put(wd, dr, 1, i + 1, "0"); f(wd, dr, 2, `${q(S_IN)}$A$${mr}`, null); put(wd, dr, 3, j + 1, "0"); f(wd, dr, 4, `${I(1)}`, null);
      wd.getCell(dr, 2).alignment = { horizontal: "left" }; wd.getCell(dr, 4).alignment = { horizontal: "left" };
      f(wd, dr, 5, `${I(2)}*${M(3)}`);
      const impCPM = `IF(${I(4)}=0,0,${x(5)}/${I(4)}*1000)`;
      f(wd, dr, 7, `IF(${I(3)}="CPC",IF(${I(4)}=0,0,${x(5)}/${I(4)}),${impCPM}*${I(5)})`);
      f(wd, dr, 6, `IF(${I(3)}="CPC",IF(${I(5)}=0,0,${x(7)}/${I(5)}),${impCPM})`);
      f(wd, dr, 8, `IF(${I(6)}="Шууд",0,${x(7)}*${I(7)})`);
      f(wd, dr, 9, `${x(7)}*${I(10)}*${M(4)}*${P.mult}`);
      f(wd, dr, 10, `IF(${I(6)}="Шууд",${x(7)}*${I(9)},${x(8)}*${I(8)})*${M(4)}*${P.mult}`, D1);
      f(wd, dr, 11, `${x(10)}*${P.aov}`);
      const e = m.channels[j];
      chk(S_DET, dr, 5, e.budget, `${m.month} ${c.name} төсөв`, 1);
      chk(S_DET, dr, 7, e.clicks, `${m.month} ${c.name} товшилт`, 1);
      chk(S_DET, dr, 10, e.sales, `${m.month} ${c.name} худалдан авалт`, 0.051);
      dr++;
    });
  });
  const D1r = dr - 1;
  const dR = (c) => rng(S_DET, c, D0, D1r);

  // ───────────── 3. САР БҮРЭЭР ─────────────
  
  title(wm, "Сар бүрийн төсөв ба үр дүн", "Зардал, юүлүүр, орлого, хуримтлагдсан цэвэр хувь нэмэр");
  head(wm, 4, ["Сар", "Зарын зардал", "Тогтмол зардал", "Нийт зардал", "Харагдалт", "Товшилт", "Лавлагаа", "Дагагч", "Шинэ худалдан авагч", "Орлого (маркетинг)", "Нийт ашиг", "Цэвэр хувь нэмэр", "Хуримтлагдсан", "Нөхөгдөх сар"]);
  wm.getRow(4).height = 44;
  let mrow = 5; const MM0 = mrow;
  R.months.forEach((m, i) => {
    const rr = mrow, x = (cc) => `${col(cc)}${rr}`;
    f(wm, rr, 1, `${q(S_IN)}$A$${mRow(i)}`, null); wm.getCell(rr, 1).alignment = { horizontal: "left" };
    const idx = `${q(S_IN)}$B$${mRow(i)}`;
    f(wm, rr, 2, `SUMIF(${dR(1)},${idx},${dR(5)})`);
    f(wm, rr, 3, `SUM(${rng(S_IN, 2, FX0, FX1)})+SUMIF(${rng(S_IN, 4, FX0, FX1)},${idx},${rng(S_IN, 3, FX0, FX1)})`);
    f(wm, rr, 4, `${x(2)}+${x(3)}`);
    f(wm, rr, 5, `SUMIF(${dR(1)},${idx},${dR(6)})`);
    f(wm, rr, 6, `SUMIF(${dR(1)},${idx},${dR(7)})`);
    f(wm, rr, 7, `SUMIF(${dR(1)},${idx},${dR(8)})`);
    f(wm, rr, 8, `SUMIF(${dR(1)},${idx},${dR(9)})`);
    f(wm, rr, 9, `SUMIF(${dR(1)},${idx},${dR(10)})`, D1);
    f(wm, rr, 10, `${x(9)}*${P.aov}`);
    f(wm, rr, 11, `${x(10)}*${P.gm}`);
    f(wm, rr, 12, `${x(11)}-${x(4)}`);
    f(wm, rr, 13, i === 0 ? `${x(12)}` : `M${rr - 1}+${x(12)}`);
    f(wm, rr, 14, i === 0 ? `IF(AND(${P.aov}>0,${x(13)}>=0),${idx},0)` : `IF(AND(${P.aov}>0,${x(13)}>=0,SUM(N$${MM0}:N${rr - 1})=0),${idx},0)`, "0");
    chk(S_MON, rr, 4, m.total_cost, `${m.month} нийт зардал`, 1);
    chk(S_MON, rr, 9, m.new_sales, `${m.month} шинэ худалдан авагч`, 0.051 * chs.length);
    chk(S_MON, rr, 10, m.marketing_revenue, `${m.month} орлого`, Math.max(1, 0.06 * chs.length * Number(cfg.avg_order_value || 0)));
    mrow++;
  });
  const MM1 = mrow - 1, T = mrow;
  put(wm, T, 1, "Нийт", null, { bold: true, total: true });
  for (let c = 2; c <= 12; c++) f(wm, T, c, `SUM(${col(c)}${MM0}:${col(c)}${MM1})`, c === 9 ? D1 : NUM, { bold: true, total: true });
  f(wm, T, 13, `M${MM1}`, NUM, { bold: true, total: true });
  f(wm, T, 14, `SUM(N${MM0}:N${MM1})`, "0", { bold: true, total: true });
  const MT = (c) => `${q(S_MON)}$${col(c)}$${T}`;
  put(wm, T + 2, 1, "«Нөхөгдөх сар» багана: хуримтлагдсан цэвэр хувь нэмэр анх 0-ээс давсан сарын дугаар (эхний худалдан авалтаар).").font = font({ italic: true, size: 9, color: { argb: "FF666666" } });
  chk(S_MON, T, 2, S.total_ad_spend, "нийт зарын зардал", n);
  chk(S_MON, T, 3, S.total_fixed_cost, "нийт тогтмол зардал", n);
  chk(S_MON, T, 4, S.total_marketing_cost, "нийт маркетингийн зардал", n);
  chk(S_MON, T, 7, S.total_leads, "нийт лавлагаа", n * chs.length);
  chk(S_MON, T, 8, S.new_followers, "нийт дагагч", n * chs.length);

  // ───────────── 4. СУВГААР ─────────────
  
  title(wc, "Суваг тус бүрийн үр дүн", "Хугацааны нийт дүн");
  head(wc, 4, ["Суваг", "Төсөв (₮)", "Хувь", "Харагдалт", "Товшилт", "Лавлагаа", "Дагагч", "Нэг лавлагааны өртөг", "Худалдан авалт", "Орлого (₮)", "Нэг худалдан авагчийн зарын өртөг", "ROAS"]);
  wc.getRow(4).height = 44;
  let cr2 = 5; const C0 = cr2;
  chs.forEach((c, j) => {
    const rr = cr2, x = (cc) => `${col(cc)}${rr}`, id = j + 1;
    f(wc, rr, 1, `${q(S_IN)}$A$${chRow(j)}`, null); wc.getCell(rr, 1).alignment = { horizontal: "left" };
    f(wc, rr, 2, `SUMIF(${dR(3)},${id},${dR(5)})`);
    f(wc, rr, 3, `IF(${MT(2)}=0,0,${x(2)}/${MT(2)})`, PCT);
    f(wc, rr, 4, `SUMIF(${dR(3)},${id},${dR(6)})`);
    f(wc, rr, 5, `SUMIF(${dR(3)},${id},${dR(7)})`);
    f(wc, rr, 6, `SUMIF(${dR(3)},${id},${dR(8)})`);
    f(wc, rr, 7, `SUMIF(${dR(3)},${id},${dR(9)})`);
    f(wc, rr, 8, `IF(${x(6)}=0,"—",${x(2)}/${x(6)})`);
    f(wc, rr, 9, `SUMIF(${dR(3)},${id},${dR(10)})`, D1);
    f(wc, rr, 10, `SUMIF(${dR(3)},${id},${dR(11)})`);
    f(wc, rr, 11, `IF(${x(9)}=0,"—",${x(2)}/${x(9)})`);
    f(wc, rr, 12, `IF(${x(2)}=0,"—",${x(10)}/${x(2)})`, DEC);
    const e = R.channels[j];
    chk(S_CH, rr, 2, e.budget, `${c.name} төсөв`, n);
    chk(S_CH, rr, 5, e.clicks, `${c.name} товшилт`, n);
    chk(S_CH, rr, 9, e.sales, `${c.name} худалдан авалт`, 0.051);
    chk(S_CH, rr, 10, e.revenue, `${c.name} орлого`, n);
    if (e.roas !== null) chk(S_CH, rr, 12, e.roas, `${c.name} ROAS`, 0.006);
    cr2++;
  });
  const C1 = cr2 - 1;
  put(wc, cr2, 1, "Нийт", null, { bold: true, total: true });
  for (const c of [2, 4, 5, 6, 7, 9, 10]) f(wc, cr2, c, `SUM(${col(c)}${C0}:${col(c)}${C1})`, c === 9 ? D1 : NUM, { bold: true, total: true });
  f(wc, cr2, 3, `IF(B${cr2}=0,0,1)`, PCT, { bold: true, total: true });
  f(wc, cr2, 8, `IF(F${cr2}=0,"—",B${cr2}/F${cr2})`, NUM, { bold: true, total: true });
  f(wc, cr2, 11, `IF(I${cr2}=0,"—",B${cr2}/I${cr2})`, NUM, { bold: true, total: true });
  f(wc, cr2, 12, `IF(B${cr2}=0,"—",J${cr2}/B${cr2})`, DEC, { bold: true, total: true });
  put(wc, cr2 + 2, 1, "ROAS = орлого ÷ зарын зардал. «Нэг худалдан авагчийн зарын өртөг»-д тогтмол зардал ороогүй.").font = font({ italic: true, size: 9, color: { argb: "FF666666" } });

  // ───────────── 5. ГҮЙЦЭТГЭЛИЙН ХЯНАЛТ ─────────────
  
  title(wt, "Төлөвлөгөө ба бодит гүйцэтгэл", "Сар бүрийн эцэст шар нүдэнд бодит дүнг оруулна — зөрүү автоматаар гарна");
  head(wt, 4, ["Сар", "Төлөвлөсөн зардал", "Бодит зардал", "Зөрүү", "Төлөвлөсөн худалдан авагч", "Бодит худалдан авагч", "Зөрүү", "Төлөвлөсөн орлого", "Бодит орлого", "Зөрүү", "Бодит CAC"]);
  wt.getRow(4).height = 44;
  R.months.forEach((m, i) => {
    const rr = 5 + i, mr = MM0 + i, x = (cc) => `${col(cc)}${rr}`, mm = (cc) => `${q(S_MON)}$${col(cc)}$${mr}`;
    f(wt, rr, 1, mm(1), null); wt.getCell(rr, 1).alignment = { horizontal: "left" };
    f(wt, rr, 2, mm(4)); put(wt, rr, 3, null, NUM, { input: true }); f(wt, rr, 4, `IF(${x(3)}="","",${x(3)}-${x(2)})`);
    f(wt, rr, 5, mm(9), D1); put(wt, rr, 6, null, "0", { input: true }); f(wt, rr, 7, `IF(${x(6)}="","",${x(6)}-${x(5)})`, D1);
    f(wt, rr, 8, mm(10)); put(wt, rr, 9, null, NUM, { input: true }); f(wt, rr, 10, `IF(${x(9)}="","",${x(9)}-${x(8)})`);
    f(wt, rr, 11, `IF(OR(${x(3)}="",${x(6)}=""),"",IF(${x(6)}=0,"—",${x(3)}/${x(6)}))`);
  });
  put(wt, 6 + n, 1, "Бодит зардал бодит худалдан авагчаас хамаарч төлөвлөсөн CAC-аас 30%-иас их зөрвөл сувгийн төсвөө дахин хуваарилна.").font = font({ italic: true, size: 9, color: { argb: "FF666666" } });

  // ───────────── 6. ХУРААНГУЙ ─────────────
  title(w0, "Маркетингийн тооцооны хураангуй", `${brand} · ${monthText(R.months[0].month)} – ${monthText(R.months[n - 1].month)} (${n} сар)`);
  section(w0, 4, "Гол үзүүлэлт", 3); head(w0, 5, ["Үзүүлэлт", "Утга", "Тайлбар"]);
  // calc.js сар бүрийн худалдан авалтыг 0.1-ээр бөөрөнхийлдөг тул харьцааны үзүүлэлтэд бөөрөнхийллийн зөрүүг зөвшөөрнө
  const relTol = (sales) => 0.012 + 0.06 * n * Math.max(1, chs.length) / Math.max(Number(sales) || 0, 0.1);
  const K = {}; let kr = 6;
  const kpi = (key, lbl, formula, fmt, note, exp, tol) => { put(w0, kr, 1, lbl); f(w0, kr, 2, formula, fmt); put(w0, kr, 3, note || "").font = font({ size: 9, color: { argb: "FF666666" } }); K[key] = `$B$${kr}`; if (exp !== undefined) chk(S_SUM, kr, 2, exp, lbl, tol); kr++; };
  kpi("cost", "Маркетингийн нийт зардал (₮)", MT(4), NUM, "зар + тогтмол", S.total_marketing_cost, n);
  kpi("ad", "Үүнээс зарын зардал (₮)", MT(2), NUM, "", S.total_ad_spend, n);
  kpi("avg", "Сарын дундаж зардал (₮)", `${K.cost}/${n}`, NUM, "", S.avg_monthly_cost, 1);
  kpi("imp", "Нийт харагдалт", MT(5), NUM, "", S.total_impressions, n * chs.length);
  kpi("clk", "Нийт товшилт", MT(6), NUM, "", S.total_clicks, n * chs.length);
  kpi("lead", "Нийт лавлагаа (чат, асуулт)", MT(7), NUM, "", S.total_leads, n * chs.length);
  kpi("fol", "Шинэ дагагч", MT(8), NUM, "", S.new_followers, n * chs.length);
  kpi("cpl", "Нэг лавлагааны өртөг (₮)", `IF(${K.lead}=0,"—",${K.cost}/${K.lead})`, NUM, "нийт зардал ÷ лавлагаа", S.cost_per_lead, Math.max(1, (S.cost_per_lead || 0) * 0.01));
  kpi("sales", "Шинэ худалдан авагч", MT(9), D1, "", S.new_customers, 0.051 * n * chs.length);
  kpi("rev", "Маркетингаас орох орлого (₮)", MT(10), NUM, "", S.marketing_revenue, Math.max(n, 0.06 * n * chs.length * Number(cfg.avg_order_value || 0)));
  kpi("gp", "Үүнээс нийт ашиг (₮)", MT(11), NUM, "орлого × ашгийн хувь");
  kpi("net", "Цэвэр хувь нэмэр — эхний худалдан авалт (₮)", MT(12), NUM, "нийт ашиг − маркетингийн зардал", S.net_contribution_first_purchase, Math.max(n, 0.06 * n * chs.length * Number(cfg.avg_order_value || 0)));
  kpi("cac", "Нэг шинэ худалдан авагчийн өртөг — CAC (₮)", `IF(${K.sales}=0,"—",${K.cost}/${K.sales})`, NUM, "нийт зардал ÷ шинэ худалдан авагч", S.cac, Math.max(1, (S.cac || 0) * relTol(S.new_customers)));
  kpi("roas", "Зардлын өгөөж — ROAS (нийт зардлаар)", `IF(OR(${K.cost}=0,${P.aov}=0),"—",${K.rev}/${K.cost})`, DEC, "орлого ÷ нийт зардал", S.roas_total_cost, 0.01 + (S.roas_total_cost || 0) * relTol(S.new_customers));
  kpi("be", "Алдагдалгүй байх ROAS", `IF(${P.gm}=0,"—",1/${P.gm})`, DEC, "1 ÷ ашгийн хувь — ROAS үүнээс их байх ёстой", S.break_even_roas, 0.006);
  kpi("ltv", "Нэг үйлчлүүлэгчийн насан туршийн ашиг — LTV (₮)", `${P.aov}*${P.gm}*${P.ppy}*${P.ret}`, NUM, "үнэ × ашгийн хувь × жилд авах тоо × жил", S.ltv_gross_profit, 1);
  kpi("lc", "LTV / CAC", `IF(OR(${K.sales}=0,${K.cost}=0),"—",${K.ltv}/${K.cac})`, DEC, "3.0-аас дээш бол эрүүл", S.ltv_cac_ratio, 0.01 + (S.ltv_cac_ratio || 0) * relTol(S.new_customers));
  kpi("pb", "Зардал нөхөгдөх сар (эхний худалдан авалтаар)", `IF(${MT(14)}=0,"Хугацаандаа нөхөгдөхгүй",${MT(14)})`, "0", "хуримтлагдсан цэвэр хувь нэмэр 0-ээс давах сар", S.payback_month_first_purchase ?? undefined, 0.001);
  kpi("pct", "Маркетингийн зардал нийт орлогод эзлэх хувь", `IF((${K.rev}+${P.base}*${n})=0,"—",${K.cost}/(${K.rev}+${P.base}*${n}))`, PCT, "ердийн хүрээ 5–15%, шинэ бизнест 20% хүртэл",
    S.marketing_cost_pct_of_total_revenue === null ? undefined : S.marketing_cost_pct_of_total_revenue / 100, 0.0006 + (S.marketing_cost_pct_of_total_revenue || 0) / 100 * 0.01);

  kr += 1; section(w0, kr, "Гурван хувилбар", 4); kr++;
  head(w0, kr, ["Үзүүлэлт", "Болгоомжтой", "Бодит", "Өөдрөг"]); kr++;
  const SC = [[2, P.pess, "pessimistic"], [3, "1", "realistic"], [4, P.opt, "optimistic"]];
  put(w0, kr, 1, "Хөрвүүлэлтийн коэффициент"); SC.forEach(([c, m]) => f(w0, kr, c, m, DEC)); const scM = kr; kr++;
  const scRows = {};
  const scRow = (key, lbl, mkF, fmt, expKey, tolFn) => {
    put(w0, kr, 1, lbl); scRows[key] = kr;
    SC.forEach(([c, , sk]) => { f(w0, kr, c, mkF(col(c)), fmt); const ex = calc.scenarios[sk][expKey]; if (expKey && ex !== null && ex !== undefined) chk(S_SUM, kr, c, ex, `${sk} ${lbl}`, tolFn(ex, calc.scenarios[sk].new_customers)); });
    kr++;
  };
  const moneyTol = () => Math.max(n, 0.06 * n * chs.length * Number(cfg.avg_order_value || 0) * 1.3);
  scRow("cost", "Маркетингийн нийт зардал (₮)", () => K.cost, NUM, "total_marketing_cost", () => n);
  scRow("sales", "Шинэ худалдан авагч", (c) => `${K.sales}*${c}${scM}/${P.mult}`, D1, "new_customers", () => 0.051 * n * chs.length * 1.3);
  scRow("rev", "Орлого (₮)", (c) => `${c}${scRows.sales}*${P.aov}`, NUM, "marketing_revenue", moneyTol);
  scRow("net", "Цэвэр хувь нэмэр (₮)", (c) => `${c}${scRows.rev}*${P.gm}-${c}${scRows.cost}`, NUM, "net_contribution_first_purchase", moneyTol);
  scRow("cac", "CAC (₮)", (c) => `IF(${c}${scRows.sales}=0,"—",${c}${scRows.cost}/${c}${scRows.sales})`, NUM, "cac", (ex, sc) => Math.max(1, ex * relTol(sc)));
  scRow("roas", "ROAS (нийт зардлаар)", (c) => `IF(OR(${c}${scRows.cost}=0,${P.aov}=0),"—",${c}${scRows.rev}/${c}${scRows.cost})`, DEC, "roas_total_cost", (ex, sc) => 0.01 + ex * relTol(sc));
  scRow("lc", "LTV / CAC", (c) => `IF(${c}${scRows.sales}=0,"—",${K.ltv}*${c}${scRows.sales}/${c}${scRows.cost})`, DEC, "ltv_cac_ratio", (ex, sc) => 0.01 + ex * relTol(sc));
  put(w0, kr, 1, "Хувилбаруудад зардал ижил, зөвхөн хөрвүүлэлт (худалдан авалт) өөрчлөгдөнө.").font = font({ italic: true, size: 9, color: { argb: "FF666666" } }); kr += 2;

  if ((calc.warnings || []).length) {
    section(w0, kr, "Анхааруулга (тооцооны үед)", 4); kr++;
    for (const w of calc.warnings) { const c = put(w0, kr, 1, "• " + w, null, { wrap: true }); w0.mergeCells(kr, 1, kr, 4); w0.getRow(kr).height = 30; c.font = font({ size: 10 }); kr++; }
    kr++;
  }
  if (!A.ad_history_used) { const c = put(w0, kr, 1, "Сувгийн үзүүлэлтүүд (CPM, товшилт, хөрвүүлэлт) нь таамаглал. Эхний 2 долоо хоногийн бодит дүнгээр «Таамаглал» хуудсыг шинэчилнэ үү.", null, { wrap: true }); w0.mergeCells(kr, 1, kr, 4); w0.getRow(kr).height = 30; c.font = font({ italic: true, size: 10 }); }

  // ───────────── 7. ЗААВАР ─────────────
  
  title(wh, "Энэ файлыг хэрхэн ашиглах вэ");
  [
    "1. «Таамаглал» хуудасны ШАР нүднүүдийг өөрийн бодит тоогоор солино (үнэ, ашгийн хувь, сувгийн төсөв, CPM, хөрвүүлэлт).",
    "2. Бусад бүх хуудас (Сар бүрээр, Сувгаар, Хураангуй) томьёогоор автоматаар дахин тооцогдоно — тэдгээрийг гараар бүү засаарай.",
    "3. Шинэ суваг нэмэх бол одоо байгаа сувгийн мөрийг өөрчилж ашиглана (мөр нэмэхэд томьёо хамрахгүй).",
    `4. Хугацаа ${n} сараар тооцогдсон. Сарын тоог өөрчлөх шаардлагатай бол бидэнд хандана уу.`,
    "5. Сар бүрийн эцэст «Гүйцэтгэлийн хяналт» хуудсанд бодит зардал, худалдан авагч, орлогоо оруулбал зөрүү автоматаар гарна.",
    "6. «Идэвхтэй хувилбарын коэффициент»-ийг 0.7 болговол болгоомжтой хувилбараар бүх хуудас дахин тооцогдоно.",
    "Тайлбар: CPM — 1000 харагдалтын үнэ; CTR — товшилтын хувь; CAC — нэг шинэ худалдан авагчийн өртөг; ROAS — зардлын өгөөж; LTV — нэг үйлчлүүлэгчийн насан туршийн ашиг.",
  ].forEach((t, i) => { const c = put(wh, 3 + i, 1, t, null, { wrap: true }); wh.getRow(3 + i).height = 30; c.font = font(); });

  return { wb, checks };
}

async function toBuffer(wb) { return Buffer.from(await wb.xlsx.writeBuffer()); }
const addrRC = (addr) => { const m = /^([A-Z]+)(\d+)$/.exec(addr); let c = 0; for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64); return [Number(m[2]), c]; };

async function makeModel(A, cfg, calc) {
  const { wb, checks } = buildXlsx(A, cfg, calc);
  const res = computeWorkbook(wb);
  const bad = res.errors.map((e) => ({ sheet: e.sheet, addr: e.addr, label: "томьёоны алдаа", got: e.error }));
  let nonzero = 0;
  for (const c of checks) {
    let v; try { v = res.value(c.sheet, ...addrRC(c.addr)); } catch (e) { v = e.message; }
    if (v === null || v === undefined) v = 0;
    const tol = Math.max(c.tol ?? 1, Math.abs(c.expected) * 1e-6);
    if (!(typeof v === "number" && Math.abs(v - c.expected) <= tol)) bad.push({ ...c, got: v }); else if (Math.abs(c.expected) > 1) nonzero++;
  }
  const buffer = await toBuffer(wb);
  return { buffer, ok: bad.length === 0 && nonzero >= 8, bad, total: checks.length, formulas: res.count };
}

module.exports = { buildXlsx, makeModel, toBuffer };
