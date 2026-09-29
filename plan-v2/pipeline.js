// Бүтэн урсгал: таамаглал → санхүүгийн загвар → судалгаа → бүлгүүд → Word → шалгалт → илгээх
const { extract, normalize } = require("./intake");
const { analyse } = require("./model");
const { build } = require("./fintables");
const { research } = require("./research");
const { writeAll } = require("./chapters");
const { renderAll } = require("./charts");
const { buildDoc, setTheme: setDocTheme } = require("./document");
const { pickTheme } = require("./theme");
let renderChain = Promise.resolve(); // өнгө нь модулийн түвшинд тул зураг/баримтыг нэг нэгээр нь угсарна
const { buildPdf, setTheme: setPdfTheme } = require("./pdf");
const { hasSoffice, findPages, qc, fbText, fbFile } = require("./util");
const { usage } = require("./claude");
const { review } = require("./feasibility");
const { checkRevisionScope } = require("./scope");


const REV_MARK = "Засварын хүсэлт";
const { loadPlan, savePlan } = require("./store");
const { writeSection } = require("./chapters");
const { callJSON } = require("./claude");
const OUTLINE = require("./outline");

function makeFin(an, rv, res) {
  const fin = build(an);
  fin.facts.feasibility = { viable: rv.viable, changes: rv.changes, reason: rv.reason || "" };
  fin.sources = [...new Set([...(res.macro || []), ...(res.market || [])].map(x => `${x.source}${x.date ? ", " + x.date : ""}`))].slice(0, 40);
  if (!fin.sources.length) fin.sources = ["Захиалагчийн өгсөн мэдээлэл", "Төслийн санхүүгийн загвар"];
  return fin;
}

// Шинэ төсөл: таамаглал → судалгаа → санхүү → бүх хэсэг
async function runFull(job, step, log) {
  step("1/7 таамаглал гаргаж байна");
  const A0 = job.assumptions ? normalize(job.assumptions) : await extract(job.conversation);
  step("2/7 судалгаа");
  let res = { macro: [], market: [] };
  try { res = await research(A0); } catch (e) { log(`[${job.id}] судалгаа амжилтгүй, судалгаагүй үргэлжилнэ: ${e.message}`); }
  step("3/7 санхүүгийн загвар ба боломжийн шалгалт");
  const rv = await review(A0, analyse(A0), res, job.conversation, (m) => log(`[${job.id}] ${m}`));
  const fin = makeFin(rv.an, rv, res);
  step("4/7 бүлгүүдийг бичиж байна");
  const written = await writeAll({ A: rv.A, facts: fin.facts, research: res, conversation: job.conversation }, undefined, (g) => log(`[${job.id}]   ✓ ${g}`));
  return { A: rv.A, an: rv.an, rv, res, written };
}

// Санхүүгийн тоо иш татдаг хэсгүүд — таамаглал өөрчлөгдвөл эдгээрийг заавал шинэчилнэ
const FIN_DEPENDENT = ["1.1", "1.1.1", "1.2", "1.4", "2.3", "3.3", "3.5", "4.1", "4.2.1", "4.2.2", "4.2.3", "4.2.4", "4.2.5", "4.3", "4.4", "4.5", "5.2", "5.3", "B1", "B2"];
const WRITABLE = OUTLINE.filter(o => o.group !== "static" && (o.words || o.guide));

const PLANNER = `Чи бизнес төслийн засварын төлөвлөгч. Захиалагчийн засварын хүсэлтийг уншаад:
1) Санхүүгийн загварын таамаглалд (үнэ, тоо хэмжээ, зардал, ажилтан, хөрөнгө оруулалт, зээлийн нөхцөл г.м.) өөрчлөлт хэрэгтэй бол ЗӨВХӨН өөрчлөх дээд түвшний талбаруудыг patch-д бүтнээр нь бич (жишээ нь "loan": {...}, "products": [...бүтэн жагсаалт]). Хэрэггүй бол patch = null.
2) Текстийг нь дахин бичих шаардлагатай хэсгүүдийн id-г sections-д жагсаа (зөвхөн өгөгдсөн жагсаалтаас). Хүсэлт тодорхой хэсэгт хамаарахгүй, ерөнхий бол хамгийн их хамааралтай хэсгүүдийг сонго.
3) Хүсэлт бүхэлд нь шинэчлэх (өөр бизнес, бүх бүлгийг дахин бич) шаардлагатай бол full_rewrite = true.
Захиалагчийн тодорхой хэлсэн тоог яг тэр чигээр нь ашигла. Зөвхөн JSON:
{"patch": {...}|null, "sections": ["2.4", "3.2"], "full_rewrite": false, "note": "Монгол хэлээр 1 өгүүлбэр — юу өөрчлөхийг"}`;

async function runRevision(job, prev, step, log) {
  const conv = job.conversation;
  const last = conv.lastIndexOf(REV_MARK);
  const request = conv.slice(last).slice(0, 4000);
  // Өмнөх төслөөс хойш нэмэгдсэн мэдээлэл (шинэ файл, зураг г.м.)
  const base = prev.conversation || "";
  const newInfo = conv.startsWith(base) ? conv.slice(base.length, last).slice(-8000) : "";
  step("1/5 засварын төлөвлөгөө");
  const plan = await callJSON({ system: PLANNER, maxTokens: 16000,
    user: `ЗАСВАРЫН ХҮСЭЛТ:\n${request}\n\n${newInfo ? "ШИНЭЭР ИЛГЭЭСЭН МЭДЭЭЛЭЛ:\n" + newInfo + "\n\n" : ""}ОДООГИЙН ТААМАГЛАЛ:\n${JSON.stringify(prev.A)}\n\nХЭСГҮҮДИЙН ЖАГСААЛТ:\n${WRITABLE.map(o => `${o.id} — ${o.t}`).join("\n")}` });
  if (plan.full_rewrite) throw new Error("төлөвлөгч бүтэн шинэчлэл санал болгов");
  const valid = new Set(WRITABLE.map(o => o.id));
  let ids = (plan.sections || []).map(String).filter(id => valid.has(id));
  let A = prev.A, rv = { A, an: analyse(A), changes: prev.rv?.changes || [], viable: prev.rv?.viable, reason: prev.rv?.reason };
  if (plan.patch && typeof plan.patch === "object" && Object.keys(plan.patch).length) {
    step("2/5 санхүүгийн загварыг шинэчилж байна");
    const A1 = normalize({ ...A, ...plan.patch, loan: { ...A.loan, ...(plan.patch.loan || {}) } });
    rv = await review(A1, analyse(A1), prev.res || { macro: [], market: [] }, conv, (m) => log(`[${job.id}] ${m}`));
    A = rv.A;
    ids = [...new Set([...ids, ...FIN_DEPENDENT])];
  }
  if (!ids.length) throw new Error("дахин бичих хэсэг тодорхойлогдсонгүй");
  log(`[${job.id}] засвар: ${plan.note || ""} | хэсгүүд: ${ids.join(", ")}${plan.patch ? " | таамаглал өөрчлөгдсөн" : ""}`);
  const fin = makeFin(rv.an, rv, prev.res || { macro: [], market: [] });
  step(`3/5 ${ids.length} хэсгийг засаж байна`);
  const written = { ...prev.written };
  const items = WRITABLE.filter(o => ids.includes(o.id));
  const ctx = { A, facts: fin.facts, research: prev.res || { macro: [], market: [] }, conversation: conv };
  let k = 0;
  async function worker() {
    while (k < items.length) {
      const item = items[k++];
      try {
        const blocks = await writeSection(item, { ...ctx, revision: { request, previous: prev.written[item.id] || [] } });
        if (blocks.length) written[item.id] = blocks;
        log(`[${job.id}]   ✓ ${item.id} засагдлаа`);
      } catch (e) { if (/credit balance/i.test(e.message || "")) throw e; log(`[${job.id}]   ✗ ${item.id} засаж чадсангүй, өмнөхөөр үлдээв: ${e.message}`); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
  return { A, an: rv.an, rv, res: prev.res || { macro: [], market: [] }, written };
}

async function runPipeline(job, log = console.log) {
  const t0 = Date.now(); const step = (s) => { job.step = s; log(`[${job.id}] ${s} (${Math.round((Date.now() - t0) / 1000)}с)`); };
  // Засварын хүсэлт анхны сэдвийн хүрээнд эсэхийг шалгах
  if (job.conversation) {
    let sc = { inScope: true };
    try { sc = await checkRevisionScope(job.conversation); } catch (e) { log(`[${job.id}] scope шалгалт алгасав: ${e.message}`); }
    if (sc.isRevision && sc.inScope && sc.isChange === false) {
      // "баярлалаа", "за" гэх мэт өөрчлөлт заагаагүй мессежээр бүтэн төслийг дахин бичихгүй (зардал хэмнэнэ)
      log(`[${job.id}] засварын хүсэлтэд өөрчлөлт заагаагүй — дахин бичихгүй`);
      if (job.psid && process.env.PLAN_MOCK !== "1") await fbText(job.psid, `Таны мессежид ямар засвар хийхийг заагаагүй байна 🙂 Засварын эрх тань хасагдаагүй.\n\nЗасвар хийлгэх бол «Засвар хүсэх» сонголтыг дахин дараад, юуг өөрчлөхөө нэг мессежинд тодорхой бичнэ үү. Жишээ нь: "Зээлийн дүнг 50 сая болгож, хугацааг 3 жил болго", "3.2-р хэсэгт Instagram сурталчилгаа нэм".`).catch(() => { });
      const err = new Error("revision_not_actionable"); err.status = "revision_rejected"; err.cleanedHistory = sc.cleanedHistory; throw err;
    }
    if (!sc.inScope) {
      log(`[${job.id}] засвар хүрээнээс гадуур: ${sc.original_topic} → ${sc.requested_topic}`);
      if (job.psid && process.env.PLAN_MOCK !== "1") await fbText(job.psid, `Уучлаарай, үнэгүй засвар нь зөвхөн анхны төслийн (${sc.original_topic || "таны бизнес"}) хүрээнд хийгдэнэ. Таны хүсэлт өөр бизнесийн шинэ төсөл (${sc.requested_topic || "өөр сэдэв"}) болж байна.\n\nЗасварын эрх тань хасагдаагүй. Анхны төслийнхөө тоо, мэдээллийг өөрчлөх засвар хүсвэл дахин бичнэ үү. Шинэ сэдвээр төсөл хэрэгтэй бол «шинэ төсөл захиалах» сонголтыг ашиглана уу.`).catch(() => { });
      const err = new Error("revision_out_of_scope"); err.status = "revision_rejected"; err.cleanedHistory = sc.cleanedHistory; throw err;
    }
  }
  // Засвар бол өмнөх төслийн төлөвийг ачаалж, зөвхөн хамааралтай хэсгүүдийг дахин бичнэ (бүтэн төсөл дахин бичихгүй)
  let core = null;
  if (job.conversation && job.psid && job.conversation.includes(REV_MARK) && process.env.PLAN_FULL_REVISION !== "1") {
    const prev = await loadPlan(job.psid);
    if (prev) {
      try { core = await runRevision(job, prev, step, log); }
      catch (e) { if (/credit balance/i.test(e.message || "")) throw e; log(`[${job.id}] хэсэгчилсэн засвар амжилтгүй, бүтэн төслөөр үргэлжилнэ: ${e.message}`); core = null; }
    } else log(`[${job.id}] өмнөх төслийн төлөв олдсонгүй — бүтэн төслөөр засна`);
  }
  if (!core) core = await runFull(job, step, log);
  const { A, an, rv, res } = core;
  const written = { ...core.written };
  const fin = makeFin(an, rv, res);
  job.feasibility = fin.facts.feasibility;
  // Дараагийн засварт ашиглах төлөвийг хадгална (4.1-ийн анхааруулгын хайрцаггүйгээр)
  if (job.psid && process.env.PLAN_MOCK !== "1") await savePlan(job.psid, { A, res, written, rv: { viable: rv.viable, changes: rv.changes, reason: rv.reason || "" }, conversation: job.conversation || "", savedAt: new Date().toISOString() });
  if (rv.changes.length) written["4.1"] = [...(written["4.1"] || [])];
  // Анхааруулгыг баримт бичигт биш, зөвхөн захиалагчийн мессежид өгнө (банкинд очих баримтад дотоод анхааруулга үлдээхгүй)
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
  const theme = pickTheme(A, job.conversation);
  log(`[${job.id}] өнгөний загвар: ${theme.name}`);
  let charts, doc, text = null, nPages = null;
  const render = async () => {
    setDocTheme(theme); setPdfTheme(theme); require("./charts").setTheme(theme);
    charts = await renderAll({ ...fin.charts, ...llmSpecs });
    step("6/7 Word угсарч байна");
    doc = await buildDoc({ A, written, fin, charts, pages: [] });
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

  };
  const run = renderChain.then(render); renderChain = run.catch(() => { }); await run;
  job.result = { pages: nPages, tables: doc.tables, headings: doc.heads.length, npv: Math.round(an.npv), irr: +(an.irr * 100).toFixed(1), dscr: an.R.dscr.slice(0, 3), usage: { ...(job.usage || usage) }, seconds: Math.round((Date.now() - t0) / 1000), missing_info: A.missing_info || [], assumed: A.assumed_fields || [] };
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
    let advice = "";
    try {
      const own = (an.R.inkindTotal || 0) + (A.cash_equity || 0), L = A.loan.amount || 0;
      const share = L > 0 ? L / (L + own) : 0;
      if (share > 0.8) advice += `\n\n📌 Зээлийн хувь төслийн нийт өртгийн ${Math.round(share * 100)}% байна. Банкууд ихэвчлэн 20-30%-ийг өөрийн хөрөнгөөр (мөнгө, эд хөрөнгө) оролцуулахыг шаарддаг. Нэмэлт өөрийн оролцоо, барьцаа хөрөнгөө банктайгаа урьдчилан ярилцаарай.`;
      if (an.irr > 0.40 || (an.pb !== null && an.pb < 2.5)) advice += `\n\n📌 Санхүүгийн үр дүн өндөр гарсан (IRR ${(an.irr * 100).toFixed(0)}%, хөрөнгө оруулалт ${an.pb ? an.pb.toFixed(1) : "—"} жилд нөхөгдөнө). Банк үүнийг сайтар шалгана — барилга, тоног төхөөрөмжийн өртөг, борлуулалтын тоо, үнээ бодит эсэхийг дахин нягтална уу.`;
    } catch (e) { advice = ""; }
    const missing = (A.missing_info || []).length ? `\n\n📝 Дутуу мэдээлэл — дараах зүйлсийг өөрөө нөхөж бичнэ үү: ${A.missing_info.join(", ")}.` : "";
    await fbText(job.psid, `✅ Таны бизнес төсөл бэлэн боллоо! PDF файлыг утсан дээрээ уншихад, Word файлыг засварлахад ашиглана уу.

⚠️ Чухал сануулга: Энэ төслийг таны өгсөн мэдээлэл болон нээлттэй эх сурвалжийн судалгаанд үндэслэн хиймэл оюун ухаан боловсруулсан. Банк, санхүүжүүлэгчид өгөхөөс өмнө заавал сайтар уншиж, хянаж засварлана уу:
1. Бүх тоо (үнэ, өртөг, цалин, түрээс, зээлийн хүү, хөрөнгө оруулалт) таны бодит мэдээлэлтэй таарч байгаа эсэхийг шалгах.
2. «[Захиалагч бөглөнө]» гэж тэмдэглэсэн хэсгүүдийг (регистр, хаяг, барьцаа хөрөнгө г.м.) нөхөж бичих.
3. 4-р бүлгийн «Таамаглалын хуудас»-нд «Таамаглал» гэж тэмдэглэсэн тоонуудыг өөрийн бодит тоогоор солих.${missing}

Таны өгсөн мэдээлэл хэдий чинээ дэлгэрэнгүй, бодит байна төдий чинээ төсөл үнэн зөв гарна.${adj}${warn}${advice}`);
  }
  if (process.env.MAKE_DONE_WEBHOOK && process.env.PLAN_MOCK !== "1") {
    await fetch(process.env.MAKE_DONE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, psid: job.psid, status: "done", ...job.result, qc: job.qc }) }).catch(e => log("webhook алдаа " + e.message));
  }
  step("дууслаа");
  return job;
}
module.exports = { runPipeline };
