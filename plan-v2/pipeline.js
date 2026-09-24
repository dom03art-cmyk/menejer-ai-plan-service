// Бүтэн урсгал: таамаглал → санхүүгийн загвар → судалгаа → бүлгүүд → Word → шалгалт → илгээх
const { extract, normalize } = require("./intake");
const { analyse } = require("./model");
const { build } = require("./fintables");
const { research } = require("./research");
const { writeAll } = require("./chapters");
const { renderAll } = require("./charts");
const { buildDoc } = require("./document");
const { buildPdf } = require("./pdf");
const { hasSoffice, findPages, qc, fbText, fbFile } = require("./util");
const { usage } = require("./claude");
const { review } = require("./feasibility");

async function runPipeline(job, log = console.log) {
  const t0 = Date.now(); const step = (s) => { job.step = s; log(`[${job.id}] ${s} (${Math.round((Date.now() - t0) / 1000)}с)`); };
  step("1/7 таамаглал гаргаж байна");
  const A0 = job.assumptions ? normalize(job.assumptions) : await extract(job.conversation);
  step("2/7 судалгаа");
  let res = { macro: [], market: [] };
  try { res = await research(A0); } catch (e) { log(`[${job.id}] судалгаа амжилтгүй, судалгаагүй үргэлжилнэ: ${e.message}`); }
  step("3/7 санхүүгийн загвар ба боломжийн шалгалт");
  const rv = await review(A0, analyse(A0), res, job.conversation, (m) => log(`[${job.id}] ${m}`));
  const A = rv.A, an = rv.an;
  const fin = build(an);
  fin.facts.feasibility = { viable: rv.viable, changes: rv.changes, reason: rv.reason || "" };
  job.feasibility = fin.facts.feasibility;
  fin.sources = [...new Set([...res.macro, ...res.market].map(x => `${x.source}${x.date ? ", " + x.date : ""}`))].slice(0, 40);
  if (!fin.sources.length) fin.sources = ["Захиалагчийн өгсөн мэдээлэл", "Төслийн санхүүгийн загвар"];
  step("4/7 бүлгүүдийг бичиж байна");
  const written = await writeAll({ A, facts: fin.facts, research: res, conversation: job.conversation }, undefined, (g) => log(`[${job.id}]   ✓ ${g}`));
  if (!rv.viable) (written["1.1"] = written["1.1"] || []).unshift({ type: "box", title: "⚠️ Анхааруулга: төслийн санхүүгийн үзүүлэлт шаардлага хангахгүй байна", text: `Одоогийн таамаглалаар төсөл банкны шаардлагыг (DSCR ≥ 1.2, NPV > 0) хангахгүй байна. ${rv.reason || ""}\nБанкинд өгөхөөс өмнө борлуулалтын үнэ, хэмжээ, зардал, зээлийн дүн, хугацааг бодит мэдээллээр шинэчилж, төслийг дахин боловсруулах шаардлагатай.` });
  if (rv.changes.length) (written["4.1"] = written["4.1"] || []).push({ type: "box", title: "Боломжийн шалгалтаар шинэчилсэн таамаглал", text: rv.changes.map((c, i) => `${i + 1}. ${c}`).join("\n") });
  step("5/7 график");
  // AI-ийн судалгааны тоогоор үүсгэсэн графикууд (макро, микро орчин г.м.)
  const llmSpecs = {}; let nChart = 0;
  for (const id of Object.keys(written)) for (const b of written[id] || []) {
    if (b.type !== "chart") continue;
    const labels = Array.isArray(b.labels) ? b.labels.map(String) : [];
    const series = (Array.isArray(b.series) ? b.series : []).map(s => [String(s.name || ""), (s.values || []).map(Number)]).filter(s => s[1].length === labels.length && s[1].every(isFinite));
    if (!labels.length || !series.length) { b.type = "skip"; continue; }
    b.key = "llm" + (nChart++);
    llmSpecs[b.key] = { type: ["bar", "line", "pie"].includes(b.chart_type) ? b.chart_type : "bar", title: String(b.title || ""), labels, series: b.chart_type === "pie" ? series.slice(0, 1) : series };
  }
  const charts = await renderAll({ ...fin.charts, ...llmSpecs });
  step("6/7 Word угсарч байна");
  let doc = await buildDoc({ A, written, fin, charts, pages: [] });
  let text = null, nPages = null;
  if (hasSoffice()) {
    const fp = findPages(doc.buffer, doc.heads);
    doc = await buildDoc({ A, written, fin, charts, pages: fp.pages });
    text = fp.allText; nPages = fp.nPages;
  } else {
    doc = await buildDoc({ A, written, fin, charts, pages: null }); // Word "Update Field" гарчиг
  }
  job.qc = qc({ an, text, heads: doc.heads, written });
  // Утсан дээр уншихад зориулсан PDF (гарчиг бодит хуудасны дугаартай)
  try {
    const pdf = await buildPdf({ A, written, fin, charts });
    job.pdf = pdf.buffer;
    nPages = nPages || (pdf.buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  } catch (e) { log(`[${job.id}] PDF үүсгэж чадсангүй: ${e.message}`); job.qc.push("PDF үүсгэж чадсангүй"); }
  job.result = { pages: nPages, tables: doc.tables, headings: doc.heads.length, npv: Math.round(an.npv), irr: +(an.irr * 100).toFixed(1), dscr: an.R.dscr.slice(0, 3), usage: { ...usage }, seconds: Math.round((Date.now() - t0) / 1000), missing_info: A.missing_info || [], assumed: A.assumed_fields || [] };
  job.buffer = doc.buffer;
  step("7/7 илгээж байна");
  const TR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", ө: "u", п: "p", р: "r", с: "s", т: "t", у: "u", ү: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
  const slug = [...(A.company.name || "plan").toLowerCase()].map(c => TR[c] ?? c).join("").replace(/\b(khkhk|llc)\b/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "plan";
  const fname = `${slug}-biznes-tusul-${new Date().toISOString().slice(0, 10)}.docx`;
  job.filename = fname;
  if (job.psid && process.env.PLAN_MOCK !== "1") {
    if (job.pdf) await fbFile(job.psid, job.pdf, fname.replace(/\.docx$/, ".pdf"), "application/pdf");
    await fbFile(job.psid, doc.buffer, fname);
    const adj = rv.changes.length ? `\n\n🔧 Санхүүгийн тооцоог бодит зах зээлийн түвшинд тааруулахын тулд дараах таамаглалыг өөрчилсөн (4.1-р хэсэгт дэлгэрэнгүй):\n${rv.changes.slice(0, 6).map((c, i) => `${i + 1}. ${c}`).join("\n")}` : "";
    const warn = rv.viable ? "" : `\n\n❗ Анхааруулга: Таны өгсөн мэдээллээр төсөл банкны шаардлагыг (зээл төлөх чадвар, ашигт ажиллагаа) хангахгүй гарсан. ${rv.reason || ""} Үнэ, борлуулалтын хэмжээ, зардал, зээлийн нөхцөлөө бодитоор шалгаад «засвар хийлгэх» сонголтоор дахин боловсруулуулна уу.`;
    const missing = (A.missing_info || []).length ? `\n\n📝 Дутуу мэдээлэл — дараах зүйлсийг өөрөө нөхөж бичнэ үү: ${A.missing_info.join(", ")}.` : "";
    await fbText(job.psid, `✅ Таны бизнес төсөл бэлэн боллоо! PDF файлыг утсан дээрээ уншихад, Word файлыг засварлахад ашиглана уу.

⚠️ Чухал сануулга: Энэ төслийг таны өгсөн мэдээлэл болон нээлттэй эх сурвалжийн судалгаанд үндэслэн хиймэл оюун ухаан боловсруулсан. Банк, санхүүжүүлэгчид өгөхөөс өмнө заавал сайтар уншиж, хянаж засварлана уу:
1. Бүх тоо (үнэ, өртөг, цалин, түрээс, зээлийн хүү, хөрөнгө оруулалт) таны бодит мэдээлэлтэй таарч байгаа эсэхийг шалгах.
2. «[Захиалагч бөглөнө]» гэж тэмдэглэсэн хэсгүүдийг (регистр, хаяг, барьцаа хөрөнгө г.м.) нөхөж бичих.
3. 4-р бүлгийн «Таамаглалын хуудас»-нд «Таамаглал» гэж тэмдэглэсэн тоонуудыг өөрийн бодит тоогоор солих.${missing}

Таны өгсөн мэдээлэл хэдий чинээ дэлгэрэнгүй, бодит байна төдий чинээ төсөл үнэн зөв гарна.${adj}${warn}`);
  }
  if (process.env.MAKE_DONE_WEBHOOK && process.env.PLAN_MOCK !== "1") {
    await fetch(process.env.MAKE_DONE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, psid: job.psid, status: "done", ...job.result, qc: job.qc }) }).catch(e => log("webhook алдаа " + e.message));
  }
  step("дууслаа");
  return job;
}
module.exports = { runPipeline };
