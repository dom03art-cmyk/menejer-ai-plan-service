// Маркетингийн төлөвлөгөөний бүтэн урсгал: таамаглал → тооцоо → судалгаа → тойм → бүлгүүд → график → Word, PDF → шалгалт → илгээх.
// plan-v2-ийн төлөв, файл, хувьсагчид огт хүрэхгүй. Зөвхөн claude.js (API дуудлага), util.js (Messenger илгээх), theme.js (өнгө сонгох)-ийг уншиж ашиглана.
const { extract, normalize, toCalcConfig } = require("./intake");
const { calculate } = require("./calc");
const { build, monthLabel } = require("./fintables");
const { research } = require("./research");
const { writeAll, makeBlueprint } = require("./chapters");
const { finalize } = require("./blocks");
const { renderAll } = require("./charts");
const { buildDoc } = require("./document");
const { buildPdf } = require("./pdf");
const { makeModel } = require("./xlsxModel");
const OUTLINE = require("./outline");
const { fbText, fbFile } = require("../plan-v2/util");
const { pickTheme } = require("../plan-v2/theme");
const { checkContent, blockedError, CUSTOMER_MSG } = require("../plan-v2/guard");
const MOCK = () => process.env.MKT_MOCK === "1";

const TITLES = { product: "МАРКЕТИНГИЙН ТӨЛӨВЛӨГӨӨ", organization: "МАРКЕТИНГ, ХАРИЛЦААНЫ ТӨЛӨВЛӨГӨӨ", person: "ХУВИЙН БРЭНДИЙН МАРКЕТИНГИЙН ТӨЛӨВЛӨГӨӨ" };
const hex = (v) => (typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().replace("#", "").toUpperCase() : null);
function themeFor(A, conversation) {
  const c = A.brand.colors, p = c && hex(c.primary), a = c && hex(c.accent);
  if (p && a) return { name: "brand", primary: p, accent: a, light: "F4F4F1", tot: "E6E6E0" };
  return pickTheme({ company: { name: A.brand.name, industry: A.brand.industry }, project: { title: A.brand.offer } }, conversation);
}

function qc({ A, written, fin, calc, extra }) {
  const issues = [...extra];
  const empty = OUTLINE.filter(o => o.group !== "static" && o.words && !(o.attach || []).length && !(written[o.id] || []).length).map(o => o.id);
  if (empty.length) issues.push(`Хоосон хэсэг: ${empty.join(", ")}`);
  const text = JSON.stringify(written);
  for (const w of ["skill", "prompt", "JSON", "Claude", "undefined", "NaN", "[object", "100% баталгаа"]) if (text.includes(w)) issues.push(`Текстэд хориотой үг: "${w}"`);
  const cap = A.money.monthly_budget;
  if (cap > 0) for (const m of calc.realistic.months) if (m.total_cost > cap + 1000) issues.push(`${monthLabel(m.month)}-ын зардал (${m.total_cost}) төсвөөс (${cap}) хэтэрсэн`);
  for (const w of calc.warnings) issues.push("Тооцоо: " + w);
  if (!A.ad_history_used) issues.push("Сувгийн үзүүлэлт таамаглал (захиалагчийн зарын тайлан байгаагүй)");
  return issues;
}

async function runMarketing(job, log = console.log) {
  const t0 = Date.now(); const step = (s) => { job.step = s; log(`[mkt ${job.id}] ${s} (${Math.round((Date.now() - t0) / 1000)}с)`); };
  if (job.conversation) {
    const g = await checkContent(job.conversation);
    if (!g.allowed) { log(`[mkt ${job.id}] ХААВ: ${g.category} — ${g.reason}`); throw blockedError(g); }
  }
  step("1/7 таамаглал, тооцоо");
  const A = job.assumptions ? normalize(job.assumptions) : await extract(job.conversation);
  const cfg = toCalcConfig(A), calc = calculate(cfg), fin = build(A, cfg, calc);
  step("2/7 судалгаа");
  let res = { market: [], competitors: [] };
  if (!MOCK()) { try { res = await research(A); } catch (e) { if (/credit balance/i.test(e.message || "")) throw e; log(`[mkt ${job.id}] судалгаа амжилтгүй, судалгаагүй үргэлжилнэ: ${e.message}`); } }
  fin.sources = [...new Set([...res.market, ...res.competitors].map(x => `${x.source}${x.date ? ", " + x.date : ""}`))].slice(0, 40);
  fin.sources.push("Захиалагчийн өгсөн мэдээлэл", "Маркетингийн төсвийн тооцоо (кодоор тооцсон)");
  const ctx = { A, facts: fin.facts, research: res, conversation: job.conversation || "" };
  step("3/7 стратегийн тойм");
  if (!MOCK()) { try { ctx.blueprint = await makeBlueprint(ctx); } catch (e) { if (/credit balance/i.test(e.message || "")) throw e; log(`[mkt ${job.id}] тойм гарсангүй, тоймгүй үргэлжилнэ: ${e.message}`); ctx.blueprint = {}; } }
  step("4/7 бүлгүүдийг бичиж байна");
  const raw = MOCK() ? require("./mock").writeAllMock(ctx) : await writeAll(ctx, undefined, (g) => log(`[mkt ${job.id}]   ✓ ${g}`));
  const fz = finalize(raw, A);
  step("5/7 график");
  const th = themeFor(A, job.conversation);
  const charts = await renderAll({ ...fin.charts, ...fz.specs }, th);
  const months = calc.realistic.months.map(m => m.month), y0 = months[0].slice(0, 4), y1 = months[months.length - 1].slice(0, 4);
  const period = `${y0} оны ${monthLabel(months[0])}${y0 !== y1 ? " – " + y1 + " оны " : " – "}${monthLabel(months[months.length - 1])}`;
  const meta = { title: TITLES[A.subject_type], subtitle: A.brand.offer ? String(A.brand.offer).slice(0, 110) : "", period, city: A.location && A.location.length < 40 ? A.location : "Улаанбаатар хот", year: `${new Date().getFullYear()} он`, header: `${A.brand.name} · Маркетингийн төлөвлөгөө` };
  step("6/7 Word, PDF угсарч байна");
  const doc = await buildDoc({ A, written: fz.written, fin, charts, th, meta });
  let pdf = null;
  try { pdf = await buildPdf({ A, written: fz.written, fin, charts, th, meta }); } catch (e) { log(`[mkt ${job.id}] PDF үүсгэж чадсангүй: ${e.message}`); fz.issues.push("PDF үүсгэж чадсангүй"); }
  // Томьёотой Excel тооцоо — тусдаа; алдаа гарвал эсвэл тоо зөрвөл файлыг өгөхгүй, төлөвлөгөөнд нөлөөлөхгүй
  job.xlsx = null;
  try { const m = await makeModel(A, cfg, calc); if (m.ok) job.xlsx = m.buffer; else { fz.issues.push(`Excel тулгалт зөрсөн (${m.bad.length}/${m.total}) — Excel илгээгээгүй`); log(`[mkt ${job.id}] Excel зөрүү: ${JSON.stringify(m.bad.slice(0, 5))}`); } }
  catch (e) { fz.issues.push("Excel үүсгэж чадсангүй"); log(`[mkt ${job.id}] Excel алдаа: ${e.message}`); }
  job.qc = qc({ A, written: fz.written, fin, calc, extra: fz.issues });
  const S = calc.realistic.summary;
  job.result = { pages: pdf ? pdf.pages : null, tables: doc.tables, figures: doc.figures, charts_ok: Object.values(charts).filter(Boolean).length, charts_total: Object.keys(charts).length,
    total_cost: S.total_marketing_cost, xlsx: !!job.xlsx, new_customers: S.new_customers, cac: S.cac, roas: S.roas_total_cost, usage: { ...(job.usage || {}) }, seconds: Math.round((Date.now() - t0) / 1000), missing_info: A.missing_info, assumed: A.assumed_fields, theme: th.name };
  job.buffer = doc.buffer; job.pdf = pdf ? pdf.buffer : null;
  const TR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", ө: "u", п: "p", р: "r", с: "s", т: "t", у: "u", ү: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
  const slug = [...String(A.brand.name || "plan").toLowerCase()].map(c => TR[c] ?? c).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "plan";
  job.filename = `${slug}-marketing-${new Date().toISOString().slice(0, 10)}.docx`;
  step("7/7 илгээж байна");
  if (job.psid && !MOCK()) {
    if (job.pdf) await fbFile(job.psid, job.pdf, job.filename.replace(/\.docx$/, ".pdf"), "application/pdf");
    await fbFile(job.psid, doc.buffer, job.filename);
    let xlsxSent = false;
    if (job.xlsx) { try { await fbFile(job.psid, job.xlsx, job.filename.replace(/\.docx$/, ".xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); xlsxSent = true; } catch (e) { log(`[mkt ${job.id}] Excel илгээж чадсангүй: ${e.message}`); } }
    const assumed = A.ad_history_used ? "" : "\n3. Зарын үзүүлэлтүүд (харуулалтын үнэ, товшилт, чатаас захиалга болох хувь) таамаглал. Эхний 2 долоо хоногийн бодит үр дүнгээр 9-р бүлгийн тооцоог нягтлаарай.";
    const election = A.election ? "\n\n🗳 Сонгуулийн сануулга: Сонгуулийн сурталчилгааг зөвхөн хуулиар тогтоосон хугацаанд явуулж, ашиглах цахим хуудсаа сонгуулийн хороонд бүртгүүлнэ. Зардал, хугацааны шаардлагыг сонгуулийн хороо эсвэл хуульчтай заавал тулгаж шалгаарай." : "";
    const missing = (A.missing_info || []).length ? `\n\n📝 Дутуу мэдээлэл — дараах зүйлсийг өөрөө нөхөж бичнэ үү: ${A.missing_info.join(", ")}.` : "";
    await fbText(job.psid, `✅ Таны маркетингийн төлөвлөгөө бэлэн боллоо! PDF файлыг утсан дээрээ уншихад, Word файлыг засварлахад ашиглана уу.${xlsxSent ? " Excel файлын шар нүднүүдэд өөрийн тоог оруулахад төсөв, үр дүн автоматаар дахин тооцогдоно; «Гүйцэтгэлийн хяналт» хуудсанд сар бүрийн бодит дүнгээ бичээрэй." : ""} Word файлыг нээхэд гарчгийн хуудасны дугаарыг шинэчлэх эсэхийг асуувал «Тийм» гэж дарна уу.

⚠️ Чухал сануулга: Энэ төлөвлөгөөг таны өгсөн мэдээлэл болон нээлттэй эх сурвалжийн судалгаанд үндэслэн хиймэл оюун ухаан боловсруулсан. Хэрэгжүүлэхээс өмнө заавал уншиж шалгана уу:
1. Үнэ, нөхцөл, брэндийн мэдээлэл таны бодит байдалтай таарч байгаа эсэх.
2. «[Захиалагч бөглөнө]» гэж тэмдэглэсэн хэсгүүдийг нөхөх.${assumed}

Эхлэх газар: 1.4 «Эхний 30 хоногт хийх 5 ажил» ба 8.3 «Эхний 30 хоногийн календарь».${election}${missing}`);
  }
  if (process.env.MKT_DONE_WEBHOOK && !MOCK()) await fetch(process.env.MKT_DONE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, psid: job.psid, product: "marketing", status: "done", ...job.result, qc: job.qc }) }).catch(e => log("[mkt] webhook алдаа " + e.message));
  step("дууслаа");
  return job;
}
module.exports = { runMarketing };
