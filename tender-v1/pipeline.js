// Тендерийн хоёр шат:
//   A (analyze) — төлбөр баталгаажсаны дараа: файл унших → ТББ задлах (A1) → асуулт (A2) → оролцогчид товч + асуулт илгээх
//   B (compose) — оролцогч хариулж «Бэлэн» дарсны дараа: өгөгдөл (B1) → текст (B2) → хөдөлгүүр → (засах оролдлого) → хүргэх
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

  step("A3/4 асуулт бэлтгэж байна");
  const q = await AI.questions(text, base.tender, convText(st.conv));
  const qs = (q.questions || []).slice(0, 16);
  await S.patchCase(psid, { base, q });

  step("A4/4 оролцогчид илгээж байна");
  const link = job.uploadUrl || st.url || "";
  const known = (q.known || []).length ? `\n\n📌 Илгээсэн баримтаас мэдсэн:\n${q.known.map((x) => "• " + x).join("\n")}` : "";
  await send(psid, `📄 ${a.brief || tender.name}${skipped.length ? `\n\n⚠️ Уншиж чадаагүй файл: ${skipped.map((f) => `${f.name} (${f.note})`).join("; ")}` : ""}${q.warning ? `\n\n❗ ${q.warning}` : ""}${known}`);
  await send(psid, `✍️ Материал бэлтгэхэд дараах мэдээлэл хэрэгтэй. Хариугаа энд бичнэ үү (хэд хэдэн мессежээр ч болно):\n\n${qs.join("\n")}`);
  const docsAsk = (q.docs || []).length ? `📎 Дараах баримтуудыг энэ холбоосоор илгээнэ үү (зураг, PDF, Word):\n${q.docs.map((x) => "• " + x).join("\n")}\n\n${link}\n\n` : `📎 Баримт (гэрчилгээ, санхүүгийн тайлан, гэрээ, каталог) байвал энэ холбоосоор илгээнэ үү:\n${link}\n\n`;
  await send(psid, `${docsAsk}Бүх хариу, баримтаа илгээсний дараа «✅ Бэлэн» товчийг дарна уу. Мэдэхгүй зүйлээ «мэдэхгүй» гэж бичиж болно — материалд [ДУТУУ] гэж тэмдэглээд, дараа нь нөхөх жагсаалтад оруулна.`, [["✅ Бэлэн", "TND_READY"], ["Цуцлах", "TND_CANCEL"]]);
  await S.setState(psid, { ...st, s: "tnd_interview", conv: [...(st.conv || []), { role: "Менежер AI", text: `Асуулт:\n${qs.join("\n")}` }], asked: 0 });
  job.outcome = "questions"; return job;
}

// ===================== B =====================
async function runCompose(job, log = console.log) {
  const { psid } = job, step = (s) => { job.step = s; log(`[tender ${job.id}] ${s}`); };
  const st = (await S.getState(psid)) || {}, kase = await S.getCase(psid);
  if (!kase || !kase.base) throw new Error("Шинжилгээний үр дүн алга (хугацаа дууссан байж магадгүй)");
  const conv = convText(st.conv);
  await guard(conv);
  step("B1/5 файл уншиж байна");
  const { docs, files } = await readAll(psid, { log, mock: job.mockRead });
  const text = CX.composeContext(CX.fitDocs(docs).docs, joinDocs);
  const base = JSON.parse(JSON.stringify(kase.base));
  base.now = nowMN();

  step("B2/5 оролцогчийн мэдээлэл");
  let c = await AI.customerData(text, base, conv);
  base.customer = (c && c.customer) || {};
  step("B3/5 текст бичиж байна");
  let t = await AI.texts(text, base, conv);
  Object.assign(base, { sections: t.sections || {}, letters: t.letters || [], drafts: t.drafts || [], attachments: t.attachments || [] });

  step("B4/5 хөдөлгүүр, шалгалт");
  let r = await buildPackage(base);
  for (let i = 0; i < 2 && r.qc.blocked; i++) {
    const blocks = r.qc.issues.filter((x) => x.level === "block");
    const dataFix = blocks.filter((x) => FIX_DATA.has(x.code)), textFix = blocks.filter((x) => FIX_TEXT.has(x.code));
    if (!dataFix.length && !textFix.length) break;
    log(`[tender ${job.id}] засах оролдлого ${i + 1}: ${[...dataFix, ...textFix].map((x) => x.code).join(", ")}`);
    if (dataFix.length) { c = await AI.customerData(text, base, conv, dataFix.map((x) => `${x.code}: ${x.msg}`).join("\n")); base.customer = (c && c.customer) || base.customer; }
    if (textFix.length || dataFix.length) { t = await AI.texts(text, base, conv, textFix.map((x) => `${x.code}: ${x.msg}`).join("\n")); Object.assign(base, { sections: t.sections || base.sections, letters: t.letters || base.letters, drafts: t.drafts || base.drafts, attachments: t.attachments || base.attachments }); }
    r = await buildPackage(base);
  }
  await S.patchCase(psid, { data: base, report: r.report, composedAt: Date.now() });
  job.report = r.report;

  step("B5/5 илгээж байна");
  const T = base.tender, dl = deadlineText(T.deadline);
  if (r.report.excel_bad) {
    await admin(`⚠️ Тендер (${psid}): Excel тулгалт зөрсөн — ${r.report.reason}`);
    throw new Error(r.report.reason);
  }
  const checklist = r.files[0];
  if (r.qc.decision === "nogo") {
    await send(psid, r.chat);
    await sendFile(psid, checklist.buf, "01-shalgakh-jagsaalt.docx", checklist.mime);
    await send(psid, "Шалгах жагсаалтад шаардлага бүрийн төлөв, хууль ёсны боломжит арга бий. Мэдээлэл буруу байсан бол засаж бичээд «🔄 Дахин шалгах» товчийг дарна уу.", [["🔄 Дахин шалгах", "TND_READY"], ["Цэс", "FLOW_MENU"]]);
    await S.setState(psid, { ...st, s: "tnd_interview", runs: (st.runs || 0) + 1 });
    job.outcome = "nogo"; return job;
  }
  if (!r.report.delivered) {
    const blocks = r.qc.issues.filter((x) => x.level === "block");
    const gaps = blocks.filter((x) => BIDDER_GAP.has(x.code) || x.code.startsWith("COMPANY_") || x.code === "DEADLINE_PASSED");
    const other = blocks.filter((x) => !gaps.includes(x));
    if (other.length) await admin(`⚠️ Тендер (${psid}): засагдаагүй алдаа — ${other.map((x) => `${x.code}: ${x.msg}`).join(" | ").slice(0, 900)}`);
    if (!gaps.length) throw new Error("Материал шалгалтад тэнцээгүй: " + other.map((x) => x.code).join(", "));
    await send(psid, `Материалыг дуусгахад дараах мэдээлэл дутуу байна:\n\n${gaps.map((x, i) => `${i + 1}. ${GAP_TEXT[x.code] || x.msg}`).join("\n")}\n\nЭнд бичээд «✅ Бэлэн» товчийг дахин дарна уу.`, [["✅ Бэлэн", "TND_READY"], ["Цуцлах", "TND_CANCEL"]]);
    await S.setState(psid, { ...st, s: "tnd_interview", runs: (st.runs || 0) + 1 });
    job.outcome = "gaps"; return job;
  }
  // Хүргэлт
  await send(psid, r.chat);
  const names = { "01": "01-shalgakh-jagsaalt", "02": "02-tenderiin-material", "03": "03-unii-zadargaa" };
  for (const f of r.files) {
    const pre = f.name.slice(0, 2), ext = f.name.split(".").pop();
    const fn = names[pre] ? `${names[pre]}.${ext}` : `${pre}-${ascii(f.name.slice(3).replace(/\.\w+$/, ""))}.${ext}`;
    try { await sendFile(psid, f.buf, fn, f.mime); } catch (e) { log(`[tender ${job.id}] файл илгээж чадсангүй ${fn}: ${e.message}`); }
  }
  await send(psid, `✅ Тендерийн материал бэлэн боллоо.\n\n• 01 — Шалгах жагсаалт (танд зориулсан, тендерт хавсаргахгүй)\n• 02 — Тендерийн материал: маягтууд, албан бичиг${base.meta.type === "services" ? ", ажлын аргачлал" : ", техникийн санал"} (Word — засаж болно)\n• 03 — Үнийн задаргаа (Excel, томьёотой)${r.files.length > 3 ? "\n• 04 — Таны батлах баримтын ТӨСӨЛ" : ""}\n\n⚠️ Анхаарах:\n1. [ДУТУУ] гэсэн хэсгийг нөхөж, бүх тоо, нэрийг шалгана уу. Тендер илгээх маягтаар мэдээллийн үнэнийг та хариуцна.\n2. Тендерийг tender.gov.mn-д та өөрөө тоон гарын үсгээр илгээнэ. Эцсийн хугацаа: ${dl || "ТББ-ийг харна уу"} — сүүлийн мөчид бүү үлдээгээрэй.\n3. Бид тендер ялна гэж баталгаа өгөхгүй.\n\nМэдээлэл нэмж, засуулах бол бичээд «🔄 Дахин гаргах» товчийг дарна уу (1 удаа үнэгүй).`, [["🔄 Дахин гаргах", "TND_RERUN"], ["Цэс", "FLOW_MENU"]]);
  await S.setState(psid, { ...st, s: "tnd_done", runs: (st.runs || 0) + 1, delivered: (st.delivered || 0) + 1, deliveredAt: Date.now() });
  job.outcome = "delivered"; return job;
}

module.exports = { runAnalyze, runCompose, nowMN, convText };
