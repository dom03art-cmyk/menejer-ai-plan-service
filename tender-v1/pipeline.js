// Тендерийн хоёр шат:
//   A (analyze) — төлбөр баталгаажсаны дараа: файл унших → ТББ задлах (A1) → нүдний жагсаалт (A2S) → оролцогчид холбоос илгээх
//   B (compose) — оролцогч хуудсанд «Материал гаргах» дарсны дараа: маягт → өгөгдөл (B1) → текст (B2) → хөдөлгүүр → хүргэх
// Бусад модулийн (plan-v2, marketing-v1, org-v1) төлөвт хүрэхгүй; зөвхөн тэдний функцийг уншиж ашиглана.
const S = require("./store");
const AI = require("./ai");
const { readAll, joinDocs } = require("./read");
const { buildPackage } = require("./engine");
const CX = require("./context");
const { send, sendFile, admin, fmtMoney } = require("./msg");
const { checkContent, blockedError } = require("../plan-v2/guard");

// Монгол цаг (+08:00) ISO
const RETRY_BTN = [["📄 Өөр тендер илгээх", "TND_NEWTENDER"], ["Цэс", "FLOW_MENU"]];
const nowMN = () => new Date(Date.now() + 8 * 3600e3).toISOString().replace(/\.\d+Z$/, "+08:00");
const TR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", ө: "u", п: "p", р: "r", с: "s", т: "t", у: "u", ү: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
const ascii = (s) => [...String(s).toLowerCase()].map((c) => TR[c] ?? c).join("").replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "");
const convText = (conv) => (conv || []).map((m) => `${m.role}: ${m.text}`).join("\n");
const deadlineText = (d) => { if (!d) return ""; const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(d); return m ? `${m[1]}.${m[2]}.${m[3]} ${m[4]}:${m[5]}` : d; };

// Оролцогчийн хариулж засах (мэдээлэл дутуу) кодууд ба Claude өөрөө засах кодууд
const BIDDER_GAP = new Set(["PRICE_MISSING", "PRICE_NONPOSITIVE", "BUDGET_MISSING", "TOTAL_MISMATCH", "FLOOR_MISSING", "FLOOR_ABOVE_START", "VALIDITY_MISSING", "VALIDITY_SHORT", "DELIVERY_MISSING", "DELIVERY_LATE", "COMPANY_NAME", "COMPANY_REG_NO", "COMPANY_ADDRESS", "SIGNATORY", "DOC_EXPIRED", "LOW_PRICE"]);
const FIX_DATA = new Set(["REQ_UNASSESSED", "REQ_BAD_STATUS", "STATUS_CONFLICT", "PRICE_UNKNOWN_ITEM", "TECH_COPIED", "TECH_DEVIATION_NO_NOTE"]);
const FIX_TEXT = new Set(["PROMISE_UNMET", "LETTER_EMPTY", "METHODOLOGY_MISSING"]);
const GAP_TEXT = { COMPANY_NAME: "Компанийн бүтэн нэр", COMPANY_REG_NO: "Компанийн регистрийн дугаар", COMPANY_ADDRESS: "Компанийн хаяг", SIGNATORY: "Тендерт гарын үсэг зурах хүний нэр, албан тушаал", VALIDITY_MISSING: "Тендер хүчинтэй байх хугацаа" };

// Claude-ийн шаардлагын төлвийг хөдөлгүүрийн хэлбэрт оруулна: тоон шалгуурын төлвийг код тооцно (Claude-ийнхыг хасна),
// ok|missing|fail-аас өөр утгыг тайлбартай нь хадгалж «missing» болгоно. Тоо, баримтыг өөрчлөхгүй.
function normalizeStatus(base) {
  const c = base.customer || {}, t = base.tender || {};
  const numeric = new Set((t.numeric_criteria || []).map((n) => n.req_id));
  const MAP = { ok: "ok", yes: "ok", pass: "ok", met: "ok", "хангана": "ok", missing: "missing", partial: "missing", unknown: "missing", pending: "missing", "дутуу": "missing", fail: "fail", no: "fail", "хангахгүй": "fail" };
  const fixed = [];
  c.requirement_status = (c.requirement_status || []).filter((x) => x && x.req_id && !numeric.has(x.req_id)).map((x) => {
    const k = String(x.status || "").trim().toLowerCase(), v = MAP[k] || "missing";
    if (v !== x.status) fixed.push(`${x.req_id}:${x.status}→${v}`);
    return { ...x, status: v };
  });
  base.customer = c;
  return fixed;
}

async function guard(text) { if (process.env.TENDER_MOCK === "1") return; const g = await checkContent(String(text || "").slice(0, 15000)); if (!g.allowed) throw blockedError(g); }

// ===================== A =====================
async function runAnalyze(job, log = console.log) {
  const { psid } = job, step = (s) => { job.step = s; log(`[tender ${job.id}] ${s}`); };
  const st = (await S.getState(psid)) || {};
  step("A1/4 файл уншиж байна");
  const { docs, files } = await readAll(psid, { log, mock: job.mockRead });
  if (!docs.length) throw new Error("Уншиж болох файл алга");
  // ТББ нь төрийн байгууллагын баримт (харуул хамгаалалт, зэвсэглэл г.м. үг байж болно) — шалгалтыг зөвхөн оролцогчийн яриа дээр хийнэ
  if ((st.conv || []).length) await guard(convText(st.conv));
  const fit = CX.fitDocs(docs);
  if (fit.removed.length) log(`[tender ${job.id}] стандарт хэсэг хассан: ${fit.removed.map((x) => `${x.file}: ${x.name} (${x.chars})`).join("; ")}`);
  const wins = CX.windows(joinDocs(fit.docs)), text = wins[0];

  step(`A2/4 ТББ задалж байна${wins.length > 1 ? ` (${wins.length} хэсэг)` : ""}`);
  const a = await AI.analyzeTender(text, st.lot || job.lot);
  let tender = a.tender || {};
  if (tender.name && a.lot_found !== false) for (let i = 1; i < wins.length; i++) {
    const add = await AI.analyzeMore(wins[i], tender, i + 1, wins.length);
    tender = CX.mergeTender(tender, add); if (add && add.contract) tender.contract = { ...(tender.contract || {}), ...add.contract };
  }
  a.tender = tender;
  const lots = Array.isArray(a.lots) ? a.lots : [];
  const skipped = files.filter((f) => !f.ok);
  await S.patchCase(psid, { a1: a, files, removed: fit.removed, windows: wins.length, analyzedAt: Date.now() });

  // Олон багцтай, сонгосон багц олдсонгүй → багц сонгуулна (нэмэлт төлбөргүй)
  // Хугацаа дууссан бол багц сонгуулахгүй — шууд мэдэгдэнэ (дахин шинжилгээний зардал гаргахгүй)
  const dl0 = tender.deadline || a.deadline;
  if (dl0 && new Date(dl0) < new Date() && a.lot_found === false) {
    await send(psid, `«${a.name || tender.name || "Тендер"}»\n\n⏰ Энэ тендерийн хүлээн авах хугацаа (${deadlineText(dl0)}) дууссан байна. Тиймээс материал бэлтгэх боломжгүй.\n\nТа төлбөрөө ашиглан өөр (хугацаа нь дуусаагүй) тендер илгээж болно.`, RETRY_BTN);
    await admin(`ℹ️ Тендер (${psid}): хугацаа дууссан тендер илгээсэн — өөр тендер илгээх эрх өгөв.`);
    await S.setState(psid, { ...st, s: "tnd_done", final: true, retry: !st.retried });
    job.outcome = "deadline_passed"; return job;
  }
  if (a.lot_found === false && lots.length > 1) {
    await S.setState(psid, { ...st, s: "tnd_lot", lots });
    await send(psid, `Энэ тендер ${lots.length} багцтай байна. Аль багцад оролцохыг сонгоно уу:\n\n${lots.map((l, i) => `${i + 1}️⃣ Багц ${l.no}: ${l.name}${l.budget ? ` — ${fmtMoney(l.budget)}` : ""}`).join("\n")}\n\nТовч дарах эсвэл дугаарыг бичнэ үү.`, lots.slice(0, 10).map((l, i) => [`${i + 1}. Багц ${l.no}`, `TND_LOT_${i}`]));
    job.outcome = "lot_choice"; return job;
  }
  if (!tender.name || !(tender.requirements || []).length) {
    await admin(`⚠️ Тендер: ТББ задалж чадсангүй (${psid}). Файлууд: ${files.map((f) => f.name).join(", ")}`);
    await send(psid, "Илгээсэн файлаас тендер шалгаруулалтын баримт бичгийг (ТББ) таньж чадсангүй. tender.gov.mn-ээс татсан ТББ-ийн PDF (эсвэл Word) файлыг бүтнээр нь илгээнэ үү. Манай ажилтан тантай холбогдоно.");
    await S.setState(psid, { ...st, s: "tnd_upload_more" });
    job.outcome = "unreadable"; return job;
  }

  const now = nowMN();
  const base = { meta: { type: a.meta && a.meta.type || (a.type === "goods" ? "goods" : "services"), standard_version: a.meta && a.meta.standard_version, source_files: (a.meta && a.meta.source_files) || docs.map((d) => d.name) }, now, tender: { ...tender, ...(a.works_like ? { works_like: true } : {}) }, customer: {} };

  // Хугацаа дууссан / барилгын шинжтэй → зөвхөн шалгах жагсаалт
  const passed = tender.deadline && new Date(tender.deadline) < new Date();
  if (passed || a.works_like || a.type === "works") {
    step("A3/4 зөвхөн шалгах жагсаалт");
    base.customer = { company: {}, signatory: {} };
    const r = await buildPackage(base);
    const why = passed ? `⏰ Энэ тендерийн хүлээн авах хугацаа (${deadlineText(tender.deadline)}) дууссан байна. Тиймээс оролцох материал бэлтгэх боломжгүй.`
      : `🏗 Энэ тендер нэр нь «үйлчилгээ» байсан ч агуулгаараа барилга угсралтын ажил (${a.works_reason || "барилгын тусгай зөвшөөрөл, ажлын зураг, төсөв шаардсан"}). Ийм тендерийн ажлын төсвийг барилгын мэргэжлийн төсөвчин гаргадаг тул бид зөвхөн шалгах жагсаалтыг бэлтгэлээ.`;
    const canRetry = !st.retried;
    await send(psid, `«${tender.name}»\n\n${why}\n\nШалгах жагсаалтыг (ТББ-ийн бүх шаардлага) файлаар илгээлээ.${canRetry ? " Та төлбөрөө ашиглан өөр тендер илгээж болно." : " Төлбөрийн асуудлаар манай ажилтан тантай холбогдоно."}`);
    await sendFile(psid, r.files[0].buf, "01-shalgakh-jagsaalt.docx", r.files[0].mime);
    await admin(`⚠️ Тендер (${psid}): ${passed ? "хугацаа дууссан" : "барилгын шинжтэй"} — зөвхөн шалгах жагсаалт илгээв. Төлбөр буцаах эсэхийг шийднэ үү.`);
    await S.patchCase(psid, { base, outcome: passed ? "deadline_passed" : "works_like" });
    if (canRetry) await send(psid, "Өөр тендерийн ТББ илгээх бол доорх товчийг дарна уу.", RETRY_BTN);
    await S.setState(psid, { ...st, s: "tnd_done", final: true, retry: canRetry });
    job.outcome = passed ? "deadline_passed" : "works_like"; return job;
  }

  step("A3/4 бүрдүүлэх материалын жагсаалт");
  const plan = await AI.slotPlan(text, base.tender);
  const SL = require("./slots");
  const slots = SL.buildSlots(base, plan.file_slots || [], plan.extra_fields || []);
  await S.patchCase(psid, { base, plan, slots, values: (kaseValues(await S.getCase(psid))) });

  step("A4/4 оролцогчид мэдэгдэж байна");
  const link = st.url || job.uploadUrl || "";
  const brief = (plan.brief_items || []).length ? plan.brief_items.map((x) => "• " + x).join("\n") : (a.brief || tender.name);
  await send(psid, `📄 ТББ-г уншиж дууслаа:\n${brief}${skipped.length ? `\n\n⚠️ Уншиж чадаагүй файл: ${skipped.map((f) => `${f.name} (${f.note})`).join("; ")}` : ""}${plan.warning ? `\n\n❗ ${plan.warning}` : ""}

✍️ Одоо энэ холбоосыг нээгээд тендерт шаардсан баримт, мэдээллээ нүд бүрт оруулна уу (${slots.filter((x) => x.kind === "file").length} баримт, ${slots.filter((x) => x.kind !== "file").length} мэдээлэл):
${link}

🔴 улаан — дутуу эсвэл буруу, 🟡 шар — анхаарах, 🟢 ногоон — бэлэн. Бүрдээгүй баримтаа хожим өөрөө хавсаргах бол улаан нүдтэй байхад ч «Материал гаргах» товчийг дарж болно.`);
  await S.setState(psid, { ...st, s: "tnd_slots" });
  job.outcome = "slots"; return job;
}
// Өмнө оруулсан утгыг (дахин шинжилгээнд) хадгална
function kaseValues(k) { return (k && k.values) || {}; }

// ===================== B =====================
async function runCompose(job, log = console.log) {
  const { psid } = job, step = (s) => { job.step = s; log(`[tender ${job.id}] ${s}`); };
  const st = (await S.getState(psid)) || {}, kase = await S.getCase(psid);
  if (!kase || !kase.base || !kase.slots) throw new Error("Шинжилгээний үр дүн алга (хугацаа дууссан байж магадгүй)");
  const SL = require("./slots");
  const ev = SL.evaluate(kase.slots, kase.values || {}, { tender: kase.base.tender, deadline: kase.base.tender.deadline });
  const form = SL.formText(kase.slots, kase.values || {}, ev.status);
  await guard(form);
  const base = JSON.parse(JSON.stringify(kase.base));
  base.now = nowMN();

  step("B1/4 оролцогчийн мэдээлэл");
  let c = await AI.customerData(form, base, form);
  base.customer = (c && c.customer) || {};
  step("B2/4 текст бичиж байна");
  let t = await AI.texts(form, base, form);
  Object.assign(base, { sections: t.sections || {}, letters: t.letters || [], drafts: t.drafts || [], attachments: t.attachments || [] });

  step("B3/4 хөдөлгүүр, шалгалт");
  { const fx = normalizeStatus(base); if (fx.length) log(`[tender ${job.id}] төлөв хэвшүүлэв: ${fx.slice(0, 10).join(", ")}`); }
  let r = await buildPackage(base);
  // Claude-ийн өөрийн алдааг (оролцогчийн дутуу мэдээлэл биш) 1 удаа засуулна
  { const blocks = r.qc.issues.filter((x) => x.level === "block");
    const dataFix = blocks.filter((x) => FIX_DATA.has(x.code)), textFix = blocks.filter((x) => FIX_TEXT.has(x.code));
    if (dataFix.length || textFix.length) {
      log(`[tender ${job.id}] засах оролдлого: ${[...dataFix, ...textFix].map((x) => x.code).join(", ")}`);
      if (dataFix.length) { c = await AI.customerData(form, base, form, dataFix.map((x) => `${x.code}: ${x.msg}`).join("\n")); base.customer = (c && c.customer) || base.customer; }
      if (textFix.length) { t = await AI.texts(form, base, form, textFix.map((x) => `${x.code}: ${x.msg}`).join("\n")); Object.assign(base, { sections: t.sections || base.sections, letters: t.letters || base.letters, drafts: t.drafts || base.drafts, attachments: t.attachments || base.attachments }); }
      normalizeStatus(base);
    } }
  // Оролцогч хуудсанд улаан нүдийг мэдсээр байж «Материал гаргах» дарсан тул дутуу/хангахгүй байсан ч гаргана
  r = await buildPackage(base, { force: true });
  await S.patchCase(psid, { data: base, report: r.report, composedAt: Date.now() });
  job.report = r.report;

  step("B4/4 илгээж байна");
  const T = base.tender, dl = deadlineText(T.deadline);
  if (r.report.excel_bad) { await admin(`⚠️ Тендер (${psid}): Excel тулгалт зөрсөн — ${r.report.reason}`); throw new Error(r.report.reason); }
  await send(psid, r.chat);
  const names = { "01": "01-shalgakh-jagsaalt", "02": "02-tenderiin-material", "03": "03-unii-zadargaa" };
  for (const f of r.files) {
    const pre = f.name.slice(0, 2), ext = f.name.split(".").pop();
    const fn = names[pre] ? `${names[pre]}.${ext}` : `${pre}-${ascii(f.name.slice(3).replace(/\.\w+$/, ""))}.${ext}`;
    try { await sendFile(psid, f.buf, fn, f.mime); } catch (e) { log(`[tender ${job.id}] файл илгээж чадсангүй ${fn}: ${e.message}`); }
  }
  const R = SL.reds(kase.slots, ev.status);
  const warnFail = r.qc.decision === "nogo" || R.fail.length ? `\n\n❗ Танай байгууллага зарим шаардлагыг хангахгүй байна (шалгах жагсаалтыг үзнэ үү). Ийм тохиолдолд тендерээс хасагдах эрсдэл өндөр.` : "";
  const warnAttach = R.attach.length ? `\n\n📎 Та өөрөө хавсаргах: ${R.attach.map((x) => x.label).join("; ")}.` : "";
  const warnData = R.data.length ? `\n\n✏️ Маягтад [ДУТУУ] үлдсэн: ${R.data.map((x) => x.label).join("; ")}.` : "";
  await send(psid, `✅ Тендерийн материал бэлэн боллоо.\n\n• 01 — Шалгах жагсаалт (танд зориулсан, тендерт хавсаргахгүй)\n• 02 — Тендерийн материал: маягтууд, албан бичиг${base.meta.type === "services" ? ", ажлын аргачлал" : ", техникийн санал"} (Word — засаж болно)${r.files.some((f) => /\.xlsx$/.test(f.name)) ? "\n• 03 — Үнийн задаргаа (Excel, томьёотой)" : "\n• Үнийн задаргааны Excel — үнэ дутуу тул гаргаагүй"}${r.files.some((f) => /ТӨСӨЛ/.test(f.name)) ? "\n• 04 — Таны батлах баримтын ТӨСӨЛ" : ""}${warnFail}${warnAttach}${warnData}\n\n⚠️ Анхаарах:\n1. Бүх тоо, нэрийг шалгана уу. Тендер илгээх маягтаар мэдээллийн үнэнийг та хариуцна.\n2. Тендерийг tender.gov.mn-д та өөрөө тоон гарын үсгээр илгээнэ. Эцсийн хугацаа: ${dl || "ТББ-ийг харна уу"} — сүүлийн мөчид бүү үлдээгээрэй.\n3. Бид тендерт тэнцэх, ялахыг баталгаажуулахгүй.\n\nНүднүүдээ засаж, баримт нэмээд дахин гаргах бол холбоосоо нээнэ үү (1 удаа үнэгүй):\n${st.url || ""}`, [["Цэс", "FLOW_MENU"]]);
  await S.setState(psid, { ...st, s: "tnd_done", runs: (st.runs || 0) + 1, delivered: (st.delivered || 0) + 1, deliveredAt: Date.now() });
  job.outcome = r.report.forced ? "delivered_forced" : "delivered"; return job;
}

module.exports = { normalizeStatus, runAnalyze, runCompose, nowMN, convText };
