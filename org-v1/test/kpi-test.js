// Хэлтсийн үзүүлэлтийн тооцоо → хүснэгт → томьёотой Excel-ийн локал туршилт:  node org-v1/test/kpi-test.js
// LibreOffice (soffice) байвал кэшлэсэн үр дүнгүй файлыг бие даан дахин бодуулж, бүх томьёоны үр дүнг дотоод тооцоологчтой тулгана.
const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");
const ExcelJS = require("exceljs");
const { calculate } = require("../kpicalc");
const { build } = require("../kpifin");
const { makeModel, buildXlsx, toBuffer } = require("../kpixlsx");

function recalcLO(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orgk-"));
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
      const same = typeof x === "number" && typeof y === "number" ? Math.abs(x - y) <= Math.max(1e-6, Math.abs(x) * 1e-9) : String(x) === String(y);
      if (!same) diffs.push(`${ws.name}!${cell.address}: дотоод ${JSON.stringify(x)} ≠ LibreOffice ${JSON.stringify(y)}  [${cell.value.formula}]`);
    }));
  }
  return { n, diffs };
}

const SAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, "kpi-sample.json"), "utf8"));
// Бүтэн жил, эмх цэгцгүй оролт (тоо текстээр, 11 утгатай массив, буруу agg, зорилтгүй, мэдээлэлгүй үзүүлэлт)
const MESSY = {
  org_name: "Туршилт ХХК", unit_name: "Үйлдвэрийн цех", year: 2025,
  indicators: [
    { name: "Үйлдвэрлэсэн блок", unit: "ширхэг", agg: "SUM", monthly: ["12 000", "11 500", 13000, 0, 14000, 15000, 15500, 16000, 14000, 13000, 12500, 11000], target_monthly: [12000, 12000, 13000, 13000, 14000, 14000, 15000, 15000, 14000, 13000, 12000, 11000], source: "Цехийн журнал" },
    { name: "Гологдлын хувь", unit: "%", agg: "mean", better: "low", target_type: "level", target: 2, monthly: [2.1, 1.8, 1.9, null, 2.0, 1.7, 2.4, 1.6, 1.5, 1.9, 2.0], source: "ЧХ-ийн бүртгэл" },
    { name: "Ажилчдын тоо", unit: "хүн", agg: "last", monthly: [20, 20, 21, 21, 22, 22, 22, 23, 23, 23, 24, null], source: "Цалин" },
    { name: "Зогсолтын цаг", unit: "цаг", agg: "median", monthly: Array(12).fill(null), target: 40, better: "low", source: "Механик" },
    { name: "Цахилгааны зардал", unit: "₮", agg: "sum", monthly: [4.2e6, 4.5e6, 4.1e6, 3.9e6, 3.6e6, 3.2e6, 3.0e6, 3.1e6, 3.5e6, 3.9e6, 4.4e6, 4.8e6], target: 45e6, better: "low", prev: 43e6, source: "Нэхэмжлэх" },
    { name: "Зорилт тэгтэй (их нь сайн)", unit: "", value: 3, target: 0, source: "Тэмдэглэл" },
  ],
};

(async () => {
  const cases = [["Хүний нөөцийн алба (10 сар)", SAMPLE, "/tmp/org-kpi-test.xlsx"], ["Эмх цэгцгүй оролт (12 сар)", MESSY, "/tmp/org-kpi-messy.xlsx"]];
  let allOk = true;
  for (const [name, m, out] of cases) {
    const res = calculate(m);
    const fin = build({}, m, res);
    const model = await makeModel({}, m, res);
    fs.writeFileSync(out, model.buffer);
    console.log(`\n=== ${name} === ${res.period}`);
    for (const x of res.indicators) console.log(`  ${x.name}: ${x.total ?? "—"} / ${x.target ?? "—"} → ${x.achievement === null ? "—" : (x.achievement * 100).toFixed(1) + "%"} ${x.status}${x.months_met ? ` (${x.months_met.met}/${x.months_met.of})` : ""}${x.achievement_reason ? " — " + x.achievement_reason : ""}`);
    console.log("  counts:", JSON.stringify(res.counts));
    console.log("  blocks:", Object.keys(fin.blocks).join(", "), "| charts:", Object.keys(fin.charts).join(", "), "| facts:", JSON.stringify(fin.facts).length, "тэмдэгт");
    for (const [k, arr] of Object.entries(fin.blocks)) for (const tb of arr) {
      if (tb.widths.length !== tb.headers.length) { console.log("  ӨРГӨНИЙ ТОО ЗӨРҮҮ:", k); allOk = false; }
      for (const row of tb.rows) if (row.length !== tb.headers.length) { console.log("  БАГАНЫ ТОО ЗӨРҮҮ:", k, tb.caption, row); allOk = false; }
    }
    for (const [k, ch] of Object.entries(fin.charts)) for (const [, v] of ch.series) if (v.length !== ch.labels.length) { console.log("  ГРАФИК ЗӨРҮҮ:", k); allOk = false; }
    res.warnings.forEach((w) => console.log("  АНХААР:", w));
    console.log(`  Excel: ok=${model.ok}, шалгалт ${model.total}, томьёо ${model.formulas}, зөрүү ${model.bad.length} → ${out}`);
    model.bad.slice(0, 10).forEach((b) => console.log("    ЗӨРҮҮ:", b.sheet, b.addr, b.label, "хүлээсэн", b.expected, "гарсан", b.got));
    if (!model.ok) allOk = false;
    let lo = null; try { lo = await compareLO(model.buffer, await toBuffer(buildXlsx({}, m, res).wb)); } catch (e) { console.log("  LibreOffice ажиллуулж чадсангүй:", e.message); allOk = false; }
    if (lo) {
      console.log(`  LibreOffice: ${lo.n} томьёо тулгав, зөрүү ${lo.diffs.length}`);
      lo.diffs.slice(0, 10).forEach((d) => console.log("    LO:", d));
      if (lo.diffs.length || !lo.n) allOk = false;
    }
  }
  console.log(allOk ? "\nБҮГД АМЖИЛТТАЙ" : "\nАЛДАА БАЙНА"); process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
