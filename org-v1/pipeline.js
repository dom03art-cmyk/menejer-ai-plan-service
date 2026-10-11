// Жилийн төлөвлөгөө ба тайлангийн бүтэн урсгал: хамгаалалт → материал унших → оролт гаргах → тооцоо → (судалгаа) → бүлгүүд → график → Word, PDF → Excel → илгээх.
// plan-v2, marketing-v1-ийн төлөвт хүрэхгүй; зөвхөн тэдний функцийг уншиж ашиглана.
const { extractRaw } = require("./rawtext");
const { planIntake, reportIntake } = require("./intake");
const plancalc = require("./plancalc"), planfin = require("./planfin"), planxlsx = require("./planxlsx");
const kpicalc = require("./kpicalc"), kpifin = require("./kpifin"), kpixlsx = require("./kpixlsx");
const { research } = require("./research");
const { writeAll, writeAllMock } = require("./chapters");
const { finalize } = require("./blocks");
const { renderAll } = require("./charts");
const { buildDoc } = require("./document");
const { buildPdf } = require("./pdf");
const OUTLINES = require("./outlines");
const { PRODUCTS } = require("./quote");
const { fbText, fbFile } = require("../plan-v2/util");
const { pickTheme } = require("../plan-v2/theme");
const { checkContent, blockedError } = require("../plan-v2/guard");
const MOCK = () => process.env.ORG_MOCK === "1";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const TR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", ө: "u", п: "p", р: "r", с: "s", т: "t", у: "u", ү: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
const slug = (s) => [...String(s || "org").toLowerCase()].map((c) => TR[c] ?? c).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "org";
const SUFFIX = { plan: "tuluvlugu", report_dept: "tailan", report_dir: "zakhirlyn-tailan" };

function qc({ product, written, extra, warnings }) {
  const issues = [...extra];
  const empty = OUTLINES[product].filter((o) => o.group !== "static" && o.words && !(o.attach || []).length && !(written[o.id] || []).length).map((o) => o.id);
  if (empty.length) issues.push(`Хоосон хэсэг: ${empty.join(", ")}`);
  const text = JSON.stringify(written);
  for (const w of ["skill", "prompt", "JSON", "Claude", "undefined", "NaN", "[object", "digest", "facts"]) if (text.includes(w)) issues.push(`Текстэд хориотой үг: "${w}"`);
  for (const w of warnings || []) issues.push("Тооцоо: " + w);
  return issues;
}

async function runOrg(job, log = console.log) {
  const t0 = Date.now(), P = job.product, step = (s) => { job.step = s; log(`[org ${job.id}] ${s} (${Math.round((Date.now() - t0) / 1000)}с)`); };
  if (!OUTLINES[P]) throw new Error(`Тодорхойгүй бүтээгдэхүүн: ${P}`);
  const guard = async (text) => { const g = await checkContent(text); if (!g.allowed) { log(`[org ${job.id}] ХААВ: ${g.category} — ${g.reason}`); throw blockedError(g); } };
  if (job.conversation) await guard(job.conversation);

  step("1/8 материал уншиж байна");
  const raw = job.raw || (job.psid && !job.input ? await extractRaw(job.psid, log) : { docs: [], text: "", files: [] });
  job.raw = raw; // багцад дараагийн хэсэг дахин уншихгүй
  if (raw.text) await guard(raw.text.slice(0, 15000));
  if (!job.input && !raw.docs.length && String(job.conversation || "").trim().length < 200) throw new Error("Уншиж болох материал алга (файл уншигдсангүй)");

  step("2/8 мэдээлэл задлан шинжилж байна");
  const plan = P === "plan";
  let A, cfg, m, digest = null, res, fin;
  if (plan) {
    if (job.input) { cfg = job.input; A = { org_name: cfg.org_name, org_type: cfg.org_type, brand: { name: cfg.org_name, slogan: "" }, missing_info: [], assumed_fields: [], ...(job.A || {}) }; }
    else ({ A, cfg } = await planIntake({ conversation: job.conversation, docs: raw.docs, year: job.year }, log));
    res = plancalc.calculate(cfg); fin = planfin.build(A, cfg, res);
  } else {
    if (job.input) { m = job.input; A = { org_name: m.org_name, unit_name: m.unit_name, year: m.year, brand: { name: m.org_name, slogan: "" }, missing_info: [], assumed_fields: [] }; digest = job.digest || {}; }
    else ({ A, m, digest } = await reportIntake({ conversation: job.conversation, docs: raw.docs, product: P }, log));
    res = kpicalc.calculate(m); fin = kpifin.build(A, m, res);
  }

  step("3/8 судалгаа");
  let rs = null;
  if (plan && !MOCK()) { try { rs = await research(A, res.year || cfg.year); } catch (e) { if (/credit balance/i.test(e.message || "")) throw e; log(`[org ${job.id}] судалгаа амжилтгүй: ${e.message}`); } }
  fin.sources = [...new Set([...(rs ? [...rs.macro, ...rs.law, ...rs.sector] : [])].map((x) => `${x.source}${x.date ? ", " + x.date : ""}`))].slice(0, 40);
  fin.sources.push(...raw.files.filter((f) => f.ok).map((f) => `Байгууллагын материал: ${f.name}`), "Захиалагчийн өгсөн мэдээлэл", "Төсвийн тооцоо (кодоор тооцсон)");

  step("4/8 бүлгүүдийг бичиж байна");
  const ctx = { product: P, A, facts: fin.facts, digest, research: rs, conversation: job.conversation || "", raw: raw.text || "" };
  const written0 = MOCK() ? writeAllMock(ctx) : await writeAll(ctx, undefined, (g) => log(`[org ${job.id}]   ✓ ${g}`));
  const fz = finalize(written0, A);

  step("5/8 график");
  const th = pickTheme({ company: { name: A.org_name, industry: A.industry } }, job.conversation);
  const charts = await renderAll({ ...fin.charts, ...fz.specs }, th);

  const Y = plan ? plancalc.normalizeCfg(cfg).year : res.year;
  const meta = plan
    ? { title: `${Y} ОНЫ ҮЙЛ АЖИЛЛАГААНЫ ТӨЛӨВЛӨГӨӨ, ТӨСӨВ`, subtitle: "", period: `${Y} оны 1-р сар – 12-р сар`, header: `${A.org_name} · ${Y} оны төлөвлөгөө` }
    : P === "report_dir"
      ? { title: "ГҮЙЦЭТГЭХ ЗАХИРЛЫН ТАЙЛАН", subtitle: "Төлөөлөн удирдах зөвлөлд", period: res.period, periodLabel: "Тайлант хугацаа: ", header: `${A.org_name} · Гүйцэтгэх захирлын тайлан` }
      : { title: "АЖЛЫН ТАЙЛАН", subtitle: A.unit_name || A.reporter_title || "", period: res.period, periodLabel: "Тайлант хугацаа: ", header: `${A.org_name}${A.unit_name ? " · " + A.unit_name : ""} · Ажлын тайлан` };
  Object.assign(meta, { city: A.location && A.location.length < 40 ? A.location : "Улаанбаатар хот", year: `${new Date().getFullYear()} он` });

  step("6/8 Word, PDF угсарч байна");
  const outline = OUTLINES[P], args = { A, written: fz.written, fin, charts, th, meta, outline };
  const doc = await buildDoc(args);
  let pdf = null;
  try { pdf = await buildPdf(args); } catch (e) { log(`[org ${job.id}] PDF үүсгэж чадсангүй: ${e.message}`); fz.issues.push("PDF үүсгэж чадсангүй"); }

  step("7/8 Excel");
  job.xlsx = null;
  try {
    const x = plan ? await planxlsx.makeModel(A, cfg, res) : await kpixlsx.makeModel(A, m, res);
    if (x.ok) job.xlsx = x.buffer; else { fz.issues.push(`Excel тулгалт зөрсөн (${x.bad.length}/${x.total}) — Excel илгээгээгүй`); log(`[org ${job.id}] Excel зөрүү: ${JSON.stringify(x.bad.slice(0, 5))}`); }
  } catch (e) { fz.issues.push("Excel үүсгэж чадсангүй"); log(`[org ${job.id}] Excel алдаа: ${e.message}`); }

  job.qc = qc({ product: P, written: fz.written, extra: fz.issues, warnings: res.warnings });
  job.result = { product: P, pages: pdf ? pdf.pages : null, tables: doc.tables, figures: doc.figures, charts_ok: Object.values(charts).filter(Boolean).length, charts_total: Object.keys(charts).length,
    xlsx: !!job.xlsx, files_read: raw.files.filter((f) => f.ok).length, files_skipped: raw.files.filter((f) => !f.ok).map((f) => `${f.name}: ${f.note}`),
    indicators: plan ? undefined : res.indicators.length, total_income: plan ? res.totals.income : undefined, result: plan ? res.totals.net : undefined,
    usage: { ...(job.usage || {}) }, seconds: Math.round((Date.now() - t0) / 1000), missing_info: A.missing_info, assumed: A.assumed_fields, theme: th.name };
  job.buffer = doc.buffer; job.pdf = pdf ? pdf.buffer : null;
  job.filename = `${slug(A.org_name)}-${SUFFIX[P]}-${new Date().toISOString().slice(0, 10)}.docx`;

  step("8/8 илгээж байна");
  if (job.psid && !MOCK()) {
    if (job.pdf) await fbFile(job.psid, job.pdf, job.filename.replace(/\.docx$/, ".pdf"), "application/pdf");
    await fbFile(job.psid, doc.buffer, job.filename);
    let xlsxSent = false;
    if (job.xlsx) { try { await fbFile(job.psid, job.xlsx, job.filename.replace(/\.docx$/, ".xlsx"), XLSX_MIME); xlsxSent = true; } catch (e) { log(`[org ${job.id}] Excel илгээж чадсангүй: ${e.message}`); } }
    const name0 = PRODUCTS[P] ? PRODUCTS[P].name : "баримт бичиг", name = name0.charAt(0).toLowerCase() + name0.slice(1);
    const skipped = job.result.files_skipped.length ? `\n\n📎 Уншиж чадаагүй файл: ${job.result.files_skipped.slice(0, 6).join("; ")}.` : "";
    const missing = (A.missing_info || []).length ? `\n\n📝 Дутуу мэдээлэл — дараах зүйлсийг өөрөө нөхөж бичнэ үү: ${A.missing_info.join(", ")}.` : "";
    const xl = xlsxSent ? (plan ? " Excel файлын шар нүднүүдэд тоогоо өөрчлөхөд төсөв автоматаар дахин тооцогдоно; «Гүйцэтгэл» хуудсанд сар бүрийн бодит дүнгээ бичээрэй." : " Excel файлд үзүүлэлт бүрийн сарын тоо, биелэлтийн тооцоо томьёотойгоор байгаа.") : "";
    const where = plan ? "Эхлэх газар: 1.2 «Ирэх жилийн гол чиглэл, зорилт» ба 1.4 «Эхний 30 хоногт хийх 5 ажил»." : "Эхлэх газар: 1-р бүлэг (товч дүгнэлт) ба хавсралтын «Баталгаажуулах, нөхөх зүйлс» хүснэгт.";
    await fbText(job.psid, `✅ Таны захиалсан «${name0}» бэлэн боллоо! PDF файлыг утсан дээрээ уншихад, Word файлыг засварлахад ашиглана уу.${xl} Word файлыг нээхэд гарчгийн хуудасны дугаарыг шинэчлэх эсэхийг асуувал «Тийм» гэж дарна уу.

⚠️ Чухал сануулга: Энэ баримтыг таны илгээсэн материал${plan ? " болон нээлттэй эх сурвалжийн судалгаа" : ""}нд үндэслэн хиймэл оюун ухаан боловсруулсан. Батлуулах, хүргүүлэхээс өмнө заавал уншиж шалгана уу:
1. Тоо, нэр, огноо материалтай таарч байгаа эсэх.
2. «[${plan ? "Байгууллага бөглөнө" : "Тайлагнагч нөхнө"}]» гэж тэмдэглэсэн хэсгүүдийг нөхөх.
3. ${plan ? "Таамаглалын жагсаалтыг (хавсралт) удирдлагаар баталгаажуулах." : "Материалд зөрүүтэй байсан тоог (хавсралт) тулгаж засах."}

${where}${skipped}${missing}`);
  }
  if (process.env.ORG_DONE_WEBHOOK && !MOCK()) await fetch(process.env.ORG_DONE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, psid: job.psid, status: "done", ...job.result, qc: job.qc }), signal: AbortSignal.timeout(8000) }).catch((e) => log("[org] webhook алдаа " + e.message));
  step("дууслаа");
  return job;
}
module.exports = { runOrg };
