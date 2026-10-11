// Жилийн төсвийн тооцоо → хүснэгт → томьёотой Excel-ийн локал туршилт:  node org-v1/test/plan-test.js
// LibreOffice (soffice) байвал Excel-ийг бие даан дахин бодуулж, бүх томьёоны үр дүнг дотоод тооцоологчтой тулгана.
const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");
const ExcelJS = require("exceljs");
const { calculate } = require("../plancalc");
const { build } = require("../planfin");
const { makeModel, buildXlsx, toBuffer } = require("../planxlsx");

function recalcLO(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orgx-"));
  try {
    const src = path.join(dir, "in.xlsx"), out = path.join(dir, "out"); fs.writeFileSync(src, buffer); fs.mkdirSync(out);
    execFileSync("soffice", [`-env:UserInstallation=file://${path.join(dir, "profile")}`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", out, src], { stdio: "ignore", timeout: 180000 });
    return fs.readFileSync(path.join(out, "in.xlsx"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const norm = (v) => {
  if (v && typeof v === "object") { if ("result" in v) v = v.result; else if ("error" in v) return "ERR:" + v.error; else if ("formula" in v || "sharedFormula" in v) v = 0; }
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
};
// buffer — дотоод тооцоологчийн үр дүнтэй файл; raw — кэшлэсэн үр дүнгүй (LibreOffice заавал өөрөө бодно)
async function compareLO(buffer, raw) {
  const a = new ExcelJS.Workbook(); await a.xlsx.load(buffer);
  const b = new ExcelJS.Workbook(); await b.xlsx.load(recalcLO(raw));
  const diffs = []; let n = 0;
  for (const ws of a.worksheets) {
    const wl = b.getWorksheet(ws.name); if (!wl) { diffs.push(`хуудас алга: ${ws.name}`); continue; }
    ws.eachRow((row, r) => row.eachCell((cell, c) => {
      if (!(cell.value && typeof cell.value === "object" && "formula" in cell.value)) return;
      n++;
      const x = norm(cell.value), y = norm(wl.getCell(r, c).value);
      const same = typeof x === "number" && typeof y === "number" ? Math.abs(x - y) <= Math.max(1e-3, Math.abs(x) * 1e-9) : String(x) === String(y);
      if (!same) diffs.push(`${ws.name}!${cell.address}: дотоод ${JSON.stringify(x)} ≠ LibreOffice ${JSON.stringify(y)}  [${cell.value.formula}]`);
    }));
  }
  return { n, diffs };
}

const NGO = {
  org_name: "Ногоон Ирээдүй ТББ", org_type: "ngo", year: 2027, opening_cash: 42000000, min_wage: 792000,
  income: [
    { name: "Олон улсын байгууллагын тэтгэлэг", kind: "amount", monthly: [0, 0, 60000000, 0, 0, 60000000, 0, 0, 60000000, 0, 0, 0], dept: "Хөтөлбөр", source: "Гэрээ байгуулсан" },
    { name: "Хандив", kind: "amount", annual: 18000000, dept: "Захиргаа", source: "Төлөвлөж буй" },
  ],
  staff: [{ title: "Гүйцэтгэх захирал", dept: "Захиргаа", count: 1, gross: 3000000 }, { title: "Хөтөлбөрийн менежер", dept: "Хөтөлбөр", count: 2, gross: 2200000 },
    { title: "Сайн дурын зохицуулагч", dept: "Хөтөлбөр", count: 1, gross: 600000, start: 4, end: 9 }],
  expenses: [{ name: "Оффисын түрээс", dept: "Захиргаа", group: "Байр, ашиглалт", monthly: 1200000 }, { name: "Хөтөлбөрийн арга хэмжээ", dept: "Хөтөлбөр", group: "Хөтөлбөрийн үйл ажиллагаа", pct_of_income: 0.35 }],
  initiatives: [{ name: "Хөдөө орон нутгийн сургалт", dept: "Хөтөлбөр", owner: "Хөтөлбөрийн менежер", start: 5, end: 8, budget: 16000000, kpi: "6 аймаг, 300 оролцогч" }],
};
const NEG = JSON.parse(fs.readFileSync(path.join(__dirname, "plan-sample.json"), "utf8"));
NEG.org_name = "Мөнгөний дутагдалтай ХХК"; NEG.opening_cash = 5000000; NEG.income[0].units_annual = 380000; delete NEG.prior;
NEG.capex[0].month = 2; NEG.seasonality = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]; NEG.staff[0].start = 9; NEG.staff[0].end = 3;

(async () => {
  const cases = [["Үндсэн жишээ (компани)", JSON.parse(fs.readFileSync(path.join(__dirname, "plan-sample.json"), "utf8")), "/tmp/org-plan-test.xlsx"],
    ["ТББ (борлуулалтгүй, татваргүй)", NGO, "/tmp/org-plan-ngo.xlsx"], ["Сөрөг мөнгөтэй", NEG, "/tmp/org-plan-neg.xlsx"]];
  let allOk = true;
  for (const [name, cfg, out] of cases) {
    const res = calculate(cfg);
    const fin = build({}, cfg, res);
    const m = await makeModel({}, cfg, res);
    fs.writeFileSync(out, m.buffer);
    const t = res.totals;
    console.log(`\n=== ${name} ===`);
    console.log(`Орлого ${Math.round(t.income).toLocaleString()} | Зардал ${Math.round(t.total_cost).toLocaleString()} | Үр дүн ${Math.round(t.net).toLocaleString()} | Эцсийн мөнгө ${Math.round(t.closing_cash).toLocaleString()} | Хамгийн бага ${Math.round(t.min_cash).toLocaleString()}`);
    console.log("blocks:", Object.keys(fin.blocks).join(", "), "| charts:", Object.keys(fin.charts).join(", "), "| facts:", JSON.stringify(fin.facts).length, "тэмдэгт");
    for (const [k, arr] of Object.entries(fin.blocks)) for (const tb of arr) for (const row of tb.rows) if (row.length !== tb.headers.length) { console.log("БАГАНЫ ТОО ЗӨРҮҮ:", k, tb.caption, row); allOk = false; }
    res.warnings.forEach((w) => console.log("АНХААР:", w));
    console.log(`Excel: ok=${m.ok}, шалгалт ${m.total}, томьёо ${m.formulas}, зөрүү ${m.bad.length} → ${out}`);
    m.bad.slice(0, 10).forEach((b) => console.log("  ЗӨРҮҮ:", b.sheet, b.addr, b.label, "хүлээсэн", b.expected, "гарсан", b.got));
    if (!m.ok) allOk = false;
    let lo = null; try { lo = await compareLO(m.buffer, await toBuffer(buildXlsx({}, cfg, res).wb)); } catch (e) { console.log("LibreOffice ажиллуулж чадсангүй:", e.message); }
    if (lo) {
      console.log(`LibreOffice: ${lo.n} томьёо тулгав, зөрүү ${lo.diffs.length}`);
      lo.diffs.slice(0, 10).forEach((d) => console.log("  LO:", d));
      if (lo.diffs.length) allOk = false;
    }
  }
  console.log(allOk ? "\nБҮГД АМЖИЛТТАЙ" : "\nАЛДАА БАЙНА"); process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
