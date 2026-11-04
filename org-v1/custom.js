// «Бусад тайлан (удирдамжаар)» — захиалагчийн өгсөн удирдамж, сэдэв, материалаар ямар ч ажлын тайлан бэлтгэнэ.
// Дүрэм: захиалагчийн өөрийн хийсэн зүйл (үр дүн, тоо, огноо, оролцогч, мөнгөн дүн)-ийг ЗОХИОХГҮЙ — дутуу бол [Тайлагнагч нөхнө] гэж үлдээж, жагсаалтаар буцаана.
//        Ерөнхий агуулга (хууль эрх зүй, салбарын мэдээлэл, арга зүй, нэр томьёо)-г интернэт судалгаагаар, эх сурвалжтай нэмнэ.
//        Дипломын ажил, курсын ажил, эрдэм шинжилгээний өгүүлэл (өөрийн шинэ судалгаа шаарддаг) — хийхгүй.
const { extractRaw } = require("./rawtext");
const { writeAll, writeSome, writeAllMock } = require("./chapters");
const { finalize } = require("./blocks");
const { renderAll } = require("./charts");
const { buildDoc } = require("./document");
const { buildPdf } = require("./pdf");
const REV = require("./revise");
const { callJSON, WRITER } = require("../plan-v2/claude");
const { fbText, fbFile } = require("../plan-v2/util");
const { pickTheme } = require("../plan-v2/theme");
const { checkContent, blockedError } = require("../plan-v2/guard");
const MOCK = () => process.env.ORG_MOCK === "1";
const SCHOOL_NOTE = "Сургууль, их сургуульд өгөх (дадлагын г.м.) тайлан бол: бид таны материалыг цэгцэлсэн НООРОГ бэлтгэнэ. Сургуулийн дүрмээр тайланг оюутан өөрөө бичих ёстой тул ноорогийг өөрийн үгээр засаж, хянаж, баталгаажуулсны дараа л өгнө үү. Сургуулийн дүрэм, шаардлагыг мөрдөх хариуцлагыг захиалагч өөрөө хүлээнэ.";
const P = "report_custom";

const ACADEMIC_MSG = "Уучлаарай, дипломын ажил, курсын ажил, эрдэм шинжилгээний өгүүлэл зэрэг өөрийн судалгаа шаардсан бүтээлийг бид бичдэггүй. Харин таны өөрийн хийсэн ажлын тэмдэглэл, материал дээр тулгуурласан ажлын тайланг бэлтгэж өгнө. Төлбөрийн асуудлаар манай менежер тантай удахгүй холбогдоно.";

const DESIGN = `Чи Монголын байгууллага, хувь хүмүүст ажлын тайлан бэлтгэдэг туршлагатай редактор. Захиалагчийн ЯРИА, МАТЕРИАЛ-аас тайлангийн БҮТЭЦ гаргана.
Дүрэм:
- Материалд тайлангийн удирдамж, заавар, загвар, шаардлага (гарчгийн жагсаалт, бүлгийн дараалал, хуудасны хэмжээ) байвал бүтцийг ЯГ түүгээр (гарчиг, дараалал, шаардсан агуулга) гарга; guideline_found=true.
- Удирдамжгүй бол тухайн сэдэвт тохирсон ердийн ажлын тайлангийн бүтэц санал болго (жишээ нь: Оршил, Зорилго ба хамрах хүрээ, Хийсэн ажил, Үр дүн, Бэрхшээл ба сургамж, Дүгнэлт, санал) — сэдэвт тааруулж нэрлэ.
- 5–14 бүлэг. Бүлэг бүрийн "words" нь материалын хэмжээнд тохирсон (нийт ойролцоогоор 2500–9000 үг; материал бага бол бага). Удирдамжид хуудасны хэмжээ заасан бол (1 хуудас ≈ 300 үг) түүнд тааруул.
- "guide": тухайн бүлэгт юу бичих, материалын аль хэсгийг ашиглах, хүснэгт хэрэгтэй эсэх (1–3 өгүүлбэр).
- "research": тухайн бүлэгт ерөнхий агуулга (хууль эрх зүй, салбар, байгууллагын танилцуулга биш нийтийн мэдээлэл, онол, арга зүй, нэр томьёо) хэрэгтэй бол true.
- missing_info: удирдамж эсвэл тайлангийн утга шаардаж буй ч материалд ОГТ байхгүй захиалагчийн өөрийн мэдээлэл (тоо, огноо, үр дүн, оролцогч, байгууллагын нэр г.м.) — 0–12 мөр, товч.
- blocked=true зөвхөн: дипломын ажил, магистр/докторын ажил, курсын ажил, эссе, реферат, эрдэм шинжилгээний өгүүлэл гэх мэт өөрийн шинэ судалгаа, бүтээлч бичлэг шаардсан эрдэм шинжилгээний ажил захиалсан бол. Дадлагын тайлан, ажлын тайлан, төслийн тайлан, сургалт, арга хэмжээний тайлан нь blocked БИШ.
- school=true: тайланг сургууль, коллеж, их сургуульд (багш, удирдагчид, дадлагын тайлан г.м.) өгөхөөр бол.
- Хувийн нууцын мэдээлэл (регистр, утас, эрүүл мэнд)-ийг бүтцэд оруулахгүй.
ЗӨВХӨН JSON:
{"blocked":false,"block_reason":"","title":"ТАЙЛАНГИЙН НЭР","subtitle":"хэнд/хаана (байхгүй бол \\"\\")","org_name":"","unit_name":"","reporter_title":"","period":"хамрах хугацаа (байхгүй бол \\"\\")","topic":"сэдэв 1 өгүүлбэр","guideline_found":false,"school":false,"sections":[{"t":"Гарчиг","words":400,"guide":"","research":false}],"missing_info":[],"research_query":"ерөнхий агуулгын судалгааны сэдэв эсвэл \\"\\""}`;

const RSYS = `Чи судлаач. web_search хэрэгслээр хайлт хийж, зөвхөн эх сурвалжтай, огноотой баримтыг цуглуул. Ишлэл хуулахгүй, өөрийн үгээр товч бич. Эх сурвалжгүй тоо бүү зохио. Монголын эх сурвалжийг (хууль, яам, ҮСХ, байгууллагын албан сайт) тэргүүнд.
Зөвхөн JSON: {"facts":[{"topic":"law|sector|method|term|other","fact":"Монгол хэлээр","source":"байгууллага/сайт","date":"он-сар"}]}. 8–20 баримт.`;

function buildOutline(d) {
  const secs = (Array.isArray(d.sections) ? d.sections : []).filter((s) => s && s.t).slice(0, 14);
  if (secs.length < 3) throw new Error("Тайлангийн бүтэц гаргаж чадсангүй");
  const out = [];
  secs.forEach((s, i) => {
    const id = String(i + 1);
    const t = String(s.t).replace(/^\s*[\dIVXLC]+[.)]\s*/, "").trim();
    out.push({ id, lvl: 1, t: `${id}. ${t}`, group: "body", words: Math.max(120, Math.min(2000, Number(s.words) || 300)),
      guide: `${String(s.guide || "").slice(0, 600)}${d.guideline_found ? " Удирдамжийн энэ хэсэгт шаардсан агуулгыг бүрэн хамруул." : ""}`, research: !!s.research });
  });
  // Сүүлийн бүлэг дүгнэлт бол хураангуй шиг хамгийн сүүлд бичнэ
  const last = out[out.length - 1]; if (/дүгнэлт|санал|хураангуй|төгсгөл/i.test(last.t)) last.group = "summary";
  if ((d._research || []).length) out.push({ id: "SRC", lvl: 1, t: "АШИГЛАСАН ЭХ СУРВАЛЖ", group: "static", attach: ["sources"] });
  if ((d.missing_info || []).length) out.push({ id: "A1", lvl: 1, t: "ХАВСРАЛТ. НӨХӨХ МЭДЭЭЛЭЛ", group: "static", attach: ["missing"] });
  return out;
}

async function runCustom(job, log = console.log) {
  const t0 = Date.now(), step = (s) => { job.step = s; log(`[org ${job.id}] ${s} (${Math.round((Date.now() - t0) / 1000)}с)`); };
  const guard = async (text) => { const g = await checkContent(text); if (!g.allowed) { log(`[org ${job.id}] ХААВ: ${g.category} — ${g.reason}`); throw blockedError(g); } };
  if (job.conversation) await guard(job.conversation);
  let snap = null, rp = null;
  if (job.revision) {
    await guard(job.revision);
    snap = job.psid ? await REV.loadSnap(job.psid, P) : null;
    if (!snap) throw Object.assign(new Error("Өмнө хүргэсэн баримтын мэдээлэл олдсонгүй."), { status: "revision_rejected", code: "snapshot_missing" });
  }

  step("1/6 материал уншиж байна");
  const raw = snap ? { docs: [], text: snap.raw || "", files: snap.files || [] } : job.raw || (job.psid ? await extractRaw(job.psid, log) : { docs: [], text: "", files: [] });
  if (!snap) {
    if (raw.text) await guard(raw.text.slice(0, 15000));
    if (!String(raw.text || "").trim() && String(job.conversation || "").trim().length < 200) throw new Error("Уншиж болох материал алга (файл уншигдсангүй)");
  }

  step("2/6 бүтэц гаргаж байна");
  let d;
  if (snap) d = snap.d;
  else if (MOCK()) d = job.mockDesign || { title: "ТУРШИЛТЫН ТАЙЛАН", org_name: "Туршилт", sections: [{ t: "Оршил", words: 150 }, { t: "Хийсэн ажил", words: 300 }, { t: "Дүгнэлт", words: 150 }], missing_info: ["Огноо"] };
  else d = await callJSON({ system: DESIGN, model: WRITER, maxTokens: 8000, user: `ЗАХИАЛАГЧИЙН ЯРИА:\n${String(job.conversation || "").slice(0, 8000)}\n\nМАТЕРИАЛ:\n${String(raw.text || "").slice(0, 60000)}\n\nБүтцийг JSON-оор гарга.` });
  if (!snap && d && (d.blocked === true || d.blocked === "true")) {
    log(`[org ${job.id}] академик ажил — хийхгүй: ${d.block_reason || ""}`);
    throw Object.assign(blockedError({ category: "academic", reason: d.block_reason || "эрдэм шинжилгээний ажил" }), { customerMsg: ACADEMIC_MSG });
  }

  step("3/6 судалгаа");
  if (!snap) {
    d._research = [];
    const q = String(d.research_query || "").trim();
    if (q && !MOCK() && (d.sections || []).some((s) => s && s.research)) {
      try { d._research = (await callJSON({ system: RSYS, user: `Монгол Улсын нөхцөлд: ${q}. Тайлангийн сэдэв: ${d.topic || d.title}`, webSearch: true, maxSearches: 6, maxTokens: 12000, model: WRITER })).facts || []; }
      catch (e) { if (/credit balance/i.test(e.message || "")) throw e; log(`[org ${job.id}] судалгаа амжилтгүй: ${e.message}`); }
    }
  }
  const outline = buildOutline(d);
  const A = { org_name: d.org_name || d.unit_name || "Тайлан", unit_name: d.unit_name || "", reporter_title: d.reporter_title || "", year: "", brand: { name: d.org_name || "", slogan: "" },
    missing_info: (d.missing_info || []).slice(0, 12), assumed_fields: [] };
  if (snap && snap.A) Object.assign(A, snap.A);

  if (snap) {
    step("3/6 засварын төлөвлөгөө");
    rp = MOCK() ? { actionable: true, inScope: true, sections: [outline[0].id], patch: null, note: "туршилт" } : await REV.plan({ request: job.revision, outline, A, m: {}, cfg: null, product: P });
    if (!rp.actionable) throw Object.assign(new Error("Таны мессежид ямар засвар хийхийг заагаагүй байна."), { status: "revision_rejected", code: "not_actionable" });
    if (!rp.inScope) throw Object.assign(new Error("Энэ засвар өмнө хүргэсэн тайлангийн хүрээнээс гадуур байна."), { status: "revision_rejected", code: "out_of_scope" });
    if (rp.patch && rp.patch.A) for (const k of ["org_name", "unit_name", "reporter_title"]) if (rp.patch.A[k]) A[k] = String(rp.patch.A[k]);
    if (!rp.sections.length) rp.sections = outline.filter((o) => o.group !== "static").map((o) => o.id);
  }

  step("4/6 бүлгүүдийг бичиж байна");
  const facts = { report_title: d.title, topic: d.topic, period: d.period || "", guideline_found: !!d.guideline_found, missing_info: A.missing_info };
  const ctx = { product: P, A, facts, digest: null, research: { general: d._research || [] }, conversation: job.conversation || "", raw: raw.text || "", outline };
  let written0;
  if (snap) {
    const fresh = MOCK() ? Object.fromEntries(Object.entries(writeAllMock(ctx)).filter(([k]) => rp.sections.includes(k))) : await writeSome({ ...ctx, revision: { request: job.revision, previous: snap.written || {} } }, rp.sections, (g) => log(`[org ${job.id}]   ✓ ${g}`));
    written0 = { ...(snap.written || {}), ...fresh };
  } else written0 = MOCK() ? writeAllMock(ctx) : await writeAll(ctx, undefined, (g) => log(`[org ${job.id}]   ✓ ${g}`));
  const fz = finalize(JSON.parse(JSON.stringify(written0)), A);

  step("5/6 Word, PDF угсарч байна");
  const th = pickTheme({ company: { name: A.org_name } }, job.conversation);
  const charts = await renderAll({ ...fz.specs }, th);
  const fin = { facts, charts: {}, sources: [...new Set((d._research || []).map((x) => `${x.source}${x.date ? ", " + x.date : ""}`))].slice(0, 30),
    blocks: { missing: A.missing_info.length ? [{ type: "table", caption: "Тайлагнагч нөхөх мэдээлэл", headers: ["№", "Нөхөх мэдээлэл"], rows: A.missing_info.map((x, i) => [String(i + 1), x]), widths: [10, 90] }] : [] } };
  fin.sources.push(...raw.files.filter((f) => f.ok).map((f) => `Захиалагчийн материал: ${f.name}`));
  const meta = { title: String(d.title || "АЖЛЫН ТАЙЛАН").toUpperCase().slice(0, 120), subtitle: d.subtitle || A.unit_name || "", period: d.period || "", periodLabel: d.period ? "Хамрах хугацаа: " : "",
    header: `${A.org_name}${d.title ? " · " + d.title : ""}`.slice(0, 90), city: "Улаанбаатар хот", year: `${new Date().getFullYear()} он` };
  const args = { A, written: fz.written, fin, charts, th, meta, outline };
  const doc = await buildDoc(args);
  let pdf = null;
  try { pdf = await buildPdf(args); } catch (e) { log(`[org ${job.id}] PDF үүсгэж чадсангүй: ${e.message}`); fz.issues.push("PDF үүсгэж чадсангүй"); }
  const empty = outline.filter((o) => o.group !== "static" && !(fz.written[o.id] || []).length).map((o) => o.id);
  job.qc = [...fz.issues, ...(empty.length ? [`Хоосон хэсэг: ${empty.join(", ")}`] : [])];
  job.buffer = doc.buffer; job.pdf = pdf ? pdf.buffer : null; job.xlsx = null;
  const slug = String(A.org_name || "tailan").toLowerCase().replace(/[^a-zа-яөүё0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 30) || "tailan";
  job.filename = `${slug}-tailan-${new Date().toISOString().slice(0, 10)}.docx`;
  job.result = { product: P, pages: pdf ? pdf.pages : null, tables: doc.tables, sections: outline.length, guideline_found: !!d.guideline_found, research: (d._research || []).length,
    files_read: raw.files.filter((f) => f.ok).length, files_skipped: raw.files.filter((f) => !f.ok).map((f) => `${f.name}: ${f.note}`), missing_info: A.missing_info, seconds: Math.round((Date.now() - t0) / 1000), usage: { ...(job.usage || {}) } };

  step("6/6 илгээж байна");
  if (job.psid && !MOCK()) {
    if (job.pdf) await fbFile(job.psid, job.pdf, job.filename.replace(/\.docx$/, ".pdf"), "application/pdf");
    await fbFile(job.psid, doc.buffer, job.filename);
    const skipped = job.result.files_skipped.length ? `\n\n📎 Уншиж чадаагүй файл: ${job.result.files_skipped.slice(0, 6).join("; ")}.` : "";
    const missing = A.missing_info.length ? `\n\n📝 Дутуу мэдээлэл (тайланд «[Тайлагнагч нөхнө]» гэж үлдээсэн, хавсралтад жагсаасан): ${A.missing_info.join("; ")}.` : "";
    if (job.revision) await fbText(job.psid, `✅ Засвар хийгдлээ: «${d.title || "Тайлан"}»${rp && rp.note ? `\n\n✏️ ${rp.note}` : ""}\n\nДээрх файлууд нь засварласан хувилбар.${missing}`);
    else await fbText(job.psid, `✅ Таны тайлан бэлэн боллоо: «${d.title || "Тайлан"}». PDF-ийг уншихад, Word-ыг засварлахад ашиглана уу.${d.guideline_found ? " Бүтцийг таны илгээсэн удирдамжийн дагуу гаргасан." : ""}

⚠️ Чухал: Тайланг таны материалд үндэслэн бэлтгэсэн. Таны хийсэн ажлын тоо, огноо, үр дүнг бид зохиогоогүй — материалд байхгүй бол «[Тайлагнагч нөхнө]» гэж үлдээсэн. Хүлээлгэн өгөхөөсөө өмнө тоо, нэр, огноог шалгаж, тэр хэсгүүдийг нөхөөрэй.${d.school === true || d.school === "true" ? "\n\n🎓 " + SCHOOL_NOTE : ""}${missing}${skipped}`);
  }
  if (job.psid) await REV.saveSnap(job.psid, P, { product: P, A, d, raw: String(raw.text || "").slice(0, Number(process.env.ORG_RAW_CTX || 80000)), files: (raw.files || []).map((f) => ({ name: f.name, ok: f.ok, note: f.note })), written: written0, conversation: job.conversation || "" });
  if (rp) job.result.revision_note = rp.note;
  if (process.env.ORG_DONE_WEBHOOK && !MOCK()) await fetch(process.env.ORG_DONE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, psid: job.psid, status: "done", ...job.result, qc: job.qc }), signal: AbortSignal.timeout(8000) }).catch((e) => log("[org] webhook алдаа " + e.message));
  step("дууслаа");
  return job;
}
module.exports = { runCustom, buildOutline, DESIGN, ACADEMIC_MSG, SCHOOL_NOTE };
