// Тендерийн Messenger яриа (сервер удирдана). org-v1/flow.js-ийн handle()-ийн эхэнд 1 мөр холбоосоор дуудагдана:
//   if (tender && await tender.claims(psid, payload)) return tender.handle({ psid, text, payload, attachments });
// Төлөв tnd:st:<psid>-д (org-v1-ийн flow:<psid>-тэй огт холбогдохгүй). Буцаах утга: "ext" (дараагийн мессежийг ч энд) | "selecting_type" (үндсэн цэс).
//
// Урсгал: TENDER → ТББ илгээх холбоос → «Дууслаа» → багц асуух → төлбөр (QPay, kind "tender") → A шинжилгээ → асуулт →
//         оролцогч хариулна (+ баримт) → «Бэлэн» → B материал → хүргэлт → (1 удаа үнэгүй «Дахин гаргах»)
const S = require("./store");
const { send, sendImage, admin, fmtMoney } = require("./msg");

const PR = require("./pricing");
const PRICE = () => PR.tiers()[0].price; // хамгийн бага шат (мэдээллийн зорилгоор)
const MAX_RUNS = () => Number(process.env.TENDER_MAX_RUNS || 4);   // B шатыг нэг захиалгад хамгийн ихдээ
const RERUN_DAYS = 14;
const BASE = () => process.env.PUBLIC_URL || "https://menejer-ai-plan-service.onrender.com";
const MENU = [["Бизнес төсөл", "BIZ_PROJECT"], ["Маркетинг", "MKT_PLAN"], ["Тайлан, төлөвлөгөө", "ORG_REPORT"], ["Тендерийн материал", "TENDER"]];
const MAIN = new Set(["BIZ_PROJECT", "MKT_PLAN", "ORG_REPORT", "ORG_PLAN", "FLOW_MENU", "FLOW_REV"]);
const BUSY = new Set(["tnd_analyzing", "tnd_composing"]);
// tnd_terms — үйлчилгээний нөхцөл зөвшөөрөх (төлбөрөөс өмнө); tnd_slots — хуудсанд материалаа бүрдүүлж байна
const CANCEL_BTN = ["Цуцлах", "TND_CANCEL"];
const CANCEL = /^(цуцла|болих|буцах|cancel|stop)/i;

// Туршилтын үед зөвхөн жагсаалтад байгаа psid (админ) ашиглана
function allowed(psid) {
  const list = String(process.env.TENDER_ALLOW_PSIDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return !list.length || list.includes(String(psid)) || testers.has(String(psid));
}
// Туршигч: TENDER_ALLOW_PSIDS-д байгаа эсвэл туршилтын нууц үгийг (TENDER_TEST_CODE) бичсэн psid
const testers = new Set(); let testersLoaded = false;
async function loadTesters() { if (testersLoaded) return; testersLoaded = true; try { for (const p of (await S.getMisc("testers")) || []) testers.add(String(p)); } catch (_) { } }
function isTester(psid) {
  const list = String(process.env.TENDER_ALLOW_PSIDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(String(psid)) || testers.has(String(psid));
}
async function addTester(psid) { testers.add(String(psid)); await S.setMisc("testers", [...testers]).catch(() => { }); }
const enabled = () => process.env.TENDER_ENABLED === "1";

// Энэ мессежийг тендерийн урсгал хүлээж авах уу
async function claims(psid, payload, text) {
  payload = String(payload || "");
  await loadTesters();
  const code = String(process.env.TENDER_TEST_CODE || "").trim().toLowerCase();
  if (!payload && code && String(text || "").trim().toLowerCase() === code) {
    if (!isTester(psid)) { await addTester(psid); console.log(`[tender] шинэ туршигч нэмэгдлээ: ${psid}`); await admin(`🧪 Тендерийн туршилтын эрх нээгдлээ: ${psid}`); }
    return true;
  }
  if (isTester(psid)) {
    const st0 = await S.getState(psid).catch((e) => ({ err: e.message }));
    console.log(`[tender] claims psid=${psid} payload=${JSON.stringify(payload)} text=${JSON.stringify(String(text || "").slice(0, 40))} enabled=${enabled()} state=${st0 && (st0.s || st0.err) || "-"}`);
  }
  // Туршилт: «тендер-хуудас» — ТББ уншилт, төлбөргүйгээр жишээ тендерийн хуудсыг шууд нээнэ
  if (!payload && isTester(psid) && require("./demo").KEYWORD.test(String(text || ""))) return true;
  // Туршилт: зөвшөөрөгдсөн psid «тендер» гэж бичвэл эхэлнэ (Make-д товч нэмэхээс өмнө)
  if (!payload && /^\s*тендер\s*$/i.test(String(text || "")) && isTester(psid)) {
    const cur = await S.getState(psid).catch(() => null);
    if (!cur || !cur.s || cur.s === "tnd_left" || cur.s === "tnd_done") return true;
  }
  if (payload === "TENDER" || payload.startsWith("TND_")) return enabled() || isTester(psid);
  const st = await S.getState(psid).catch(() => null);
  if (!st || !st.s || !st.s.startsWith("tnd_") || st.s === "tnd_left") return false;
  if (MAIN.has(payload)) { if (!BUSY.has(st.s)) await S.setState(psid, { ...st, s: "tnd_left" }); return false; } // өөр үйлчилгээ сонгосон
  if (st.s === "tnd_done" && !payload) return false; // дууссаны дараах энгийн мессеж → үндсэн урсгал
  return true;
}

const uploadUrl = (psid) => `${BASE()}/u/tnd/${require("./upload").tokenFor(psid)}`;
async function toMenu(psid, text = "Танд өөр ямар үйлчилгээ хэрэгтэй вэ? Доорх товчноос сонгоно уу.") {
  await send(psid, `${text}\n\n👉 Товчнуудыг хажуу тийш гүйлгэвэл бүгд харагдана.`, MENU); return "selecting_type";
}
async function enqueue(psid, kind, extra = {}) {
  const r = require("./index").enqueue({ psid, kind, ...extra });
  if (!r.ok) throw new Error(r.error);
  return r;
}

async function start(psid) {
  if (!enabled() && !isTester(psid)) { await send(psid, "Тендерийн материал бэлтгэх үйлчилгээ тун удахгүй нээгдэнэ 🙏"); return toMenu(psid); }
  await S.clear(psid).catch(() => { });
  const url = uploadUrl(psid);
  await S.setState(psid, { s: "tnd_upload", url, conv: [] });
  await send(psid, `📑 Тендерийн материал (нэг багц)

Үнэ — таны илгээх ТББ-ийн хуудсаар:
${PR.tierLines()}

tender.gov.mn-ийн БАРАА, ҮЙЛЧИЛГЭЭНИЙ тендерт оролцох материалыг бэлтгэнэ:
• Шалгах жагсаалт — ТББ-ийн шаардлага бүр, танд юу дутуу байгаа
• Маягтууд (тендер илгээх маягт, үнийн санал, туршлага, хүний нөөц г.м.), албан бичиг
• Техникийн санал эсвэл ажлын аргачлал, хуваарь
• Үнийн задаргаа (Excel, томьёотой)
• Шаардлагатай бол байгууллагын танилцуулга, хүүхэд хамгааллын бодлогын төсөл

Бид гэрчилгээ, тодорхойлолт, санхүүгийн тайлан зэрэг бусад байгууллагын баримтыг зохиохгүй — тэдгээрийг та бүрдүүлнэ. Тендерийг tender.gov.mn-д та өөрөө илгээнэ. Барилга угсралтын (ажил гүйцэтгэх) тендерт энэ үйлчилгээ тохирохгүй.

👉 Эхлээд тендер шалгаруулалтын баримт бичгээ (ТББ — tender.gov.mn-ээс татсан PDF/Word, техникийн тодорхойлолт, нэмэлт өөрчлөлт) энэ холбоосоор илгээнэ үү:
${url}

Илгээж дуусаад «Дууслаа» товчийг дарна уу.`, [CANCEL_BTN]);
  return "ext";
}

// upload.js-ийн «Дууслаа»
async function onUploaded(psid) {
  const st = (await S.getState(psid)) || {};
  if (st.s === "tnd_upload_more") { await S.setState(psid, { ...st, s: "tnd_analyzing" }); await send(psid, "Файлуудыг хүлээн авлаа. Дахин шинжилж байна ⏳"); await enqueue(psid, "analyze"); return; }
  if (st.s === "tnd_interview") { await send(psid, "Баримтуудыг хүлээн авлаа ✅ Бүх хариугаа бичиж дуусаад «✅ Бэлэн» товчийг дарна уу.", [["✅ Бэлэн", "TND_READY"], CANCEL_BTN]); return; }
  if (st.s !== "tnd_upload") return;
  const files = await S.listFiles(psid), q = PR.quote(PR.sumPages(files, "tbb"));
  if (q.over) { await send(psid, `ТББ-ийн нийт хэмжээ ${q.pages} хуудас байна — ${PR.maxPages()} хуудас хүртэл хүлээж авна. Шаардлагагүй хавсралтаа (зураг төсөл, каталог г.м.) холбоосоос хасаад «Дууслаа»-г дахин дарна уу:\n${st.url}`, [CANCEL_BTN]); return; }
  await S.setState(psid, { ...st, s: "tnd_lotask", pages: q.pages, price: st.paidRetry ? st.price : q.price });
  await send(psid, `Файлуудыг хүлээн авлаа ✅\n\n${files.filter((f) => f.phase === "tbb").map((f, i) => `${i + 1}. ${f.name} — ${f.pages || 1} хуудас`).join("\n")}\n\nНийт ${q.pages} хуудас${st.paidRetry ? " (төлбөр төлөгдсөн)" : ` (${q.tierText}) → үнэ ${fmtMoney(q.price)}`}\n\nТендер хэд хэдэн багцтай бол аль багцад оролцохоо бичнэ үү (багцын дугаар эсвэл нэр). Нэг төлбөр = нэг багц.`, [["Ганц багцтай", "TND_ONELOT"], ["Файл нэмэх", "TND_MOREFILES"], CANCEL_BTN]);
}

async function offerPayment(psid, st) {
  st.s = "tnd_pay"; st.price = st.price || PR.quote(PR.sumPages(await S.listFiles(psid), "tbb")).price || PRICE();
  const QP = require("../org-v1/qpay");
  if (QP.allowedFor(psid)) {
    try {
      if (st.qpay && st.qpay.no) await QP.cancelInvoice(st.qpay.no).catch(() => { });
      const inv = await QP.createInvoice({ psid, amount: st.price, kind: "tender", description: "Менежер AI: тендерийн материал" });
      st.qpay = { no: inv.no, amount: inv.amount, short: inv.short || null }; await S.setState(psid, st);
      if (inv.qrUrl) await sendImage(psid, inv.qrUrl);
      await send(psid, `💳 Төлбөр: ${fmtMoney(inv.amount)}\n\n📲 QPay-ээр төлөх: утсаараа доорх холбоосыг нээгээд банкны аппаа сонгоно уу (эсвэл QR кодыг уншуулна):\n${inv.short || ""}\n\nТөлбөр орж ирмэгц ТББ-г шинжилж эхэлнэ (15–30 минут). Дараа нь баримт, мэдээллээ оруулах нүднүүд таны хуудсанд гарна.`, [["✅ Төлсөн, шалгах", "TND_QPCHECK"], CANCEL_BTN]);
      return "ext";
    } catch (e) { console.warn("[tender] QPay:", e.message); await admin(`⚠️ Тендер: QPay нэхэмжлэх үүсгэж чадсангүй (${psid}): ${String(e.message).slice(0, 200)}`); }
  }
  await S.setState(psid, st);
  const pi = process.env.PAY_INFO ? String(process.env.PAY_INFO).replace(/\\n/g, "\n") : "";
  await send(psid, `💳 Төлбөр: ${fmtMoney(st.price)}\n\n${pi ? pi + "\n\n" : ""}Гүйлгээний утга дээр утасны дугаар + тендер гэж бичнэ үү. Шилжүүлсний дараа баримтын зургийг энд илгээнэ үү.`, [CANCEL_BTN]);
  return "ext";
}

async function paid(psid, via) {
  const st = (await S.getState(psid)) || {};
  if (!["tnd_pay", "tnd_payreview"].includes(st.s)) return false;
  if (via === "admin" && st.qpay && st.qpay.no) await require("../org-v1/qpay").cancelInvoice(st.qpay.no).catch(() => { });
  await S.setState(psid, { ...st, s: "tnd_analyzing", paidAt: Date.now(), paidVia: via });
  await send(psid, `${via === "qpay" ? "QPay төлбөр амжилттай орлоо" : "Төлбөр баталгаажлаа"} ✅ ТББ-г уншиж, шаардлагуудыг задалж байна ⏳ 15–30 минут болно. Дуусмагц бүрдүүлэх материалын нүднүүд таны хуудсанд гарч, энд мэдэгдэнэ.`);
  try { await enqueue(psid, "analyze"); await admin(`💳 Тендер: төлбөр ${via === "qpay" ? "QPay-ээр орлоо" : "баталгаажлаа"} ${fmtMoney(st.price || PRICE())} — шинжилгээ эхэллээ (${psid})`); }
  catch (e) { await admin(`⚠️ Тендер ${psid}: шинжилгээ эхлүүлж чадсангүй — ${e.message}`); await send(psid, "Төлбөр баталгаажлаа ✅ Боловсруулалт эхлэхэд түр саатал гарлаа, манай ажилтан удахгүй эхлүүлнэ."); }
  return true;
}

// Messenger-ийн хавсралтыг (зураг, файл) оролцогчийн баримт болгон хадгална
async function saveAttachments(psid, atts) {
  let n = 0; const errs = [];
  const st = await S.getState(psid).catch(() => null);
  const phase = st && ["tnd_upload", "tnd_upload_more", "tnd_lotask"].includes(st.s) ? "tbb" : "bidder";
  for (const a of atts) {
    const url = a && a.payload && a.payload.url; if (!url) continue;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer()), mime = r.headers.get("content-type") || "";
      const name = decodeURIComponent((url.split("?")[0].split("/").pop() || "файл")).slice(0, 120);
      const pc = await PR.pagesOf({ buf, name, mime }); if (pc.error) { errs.push(`${name}: ${pc.error}`); continue; }
      const before = PR.sumPages(await S.listFiles(psid), phase), cap = phase === "tbb" ? PR.maxPages() : PR.bidderMax();
      if (before + pc.pages > cap) { errs.push(`${name}: нийт ${cap} хуудаснаас хэтэрнэ`); continue; }
      const res = await S.addFile(psid, { name, mime, buf, phase, pages: pc.pages }); if (res.ok) n++; else errs.push(`${name}: ${res.error}`);
    } catch (e) { console.warn("[tender] хавсралт:", e.message); }
  }
  if (errs.length) await send(psid, `⚠️ Хүлээж аваагүй: ${errs.join("; ")}`);
  return n;
}

const TERMS = (price) => `📋 Үйлчилгээний нөхцөл${price ? ` — ${fmtMoney(price)}` : ""}

• Бид ТББ-ийн шаардлагыг шалгаж, танд юу дутуу, юуг хангахгүйг шударгаар хэлнэ. Маягт, үнийн санал, аргачлал, албан бичгийг бэлтгэнэ.
• Танай байгууллага шаардлага хангахгүй гэж гарсан ч шалгах жагсаалт, материал бэлтгэх ажил хийгдсэн тул төлбөр буцаагдахгүй.
• Тендерт тэнцэх, ялахыг бид баталгаажуулахгүй. Гэрчилгээ, тодорхойлолт зэрэг бусдын баримтыг зохиохгүй.
• Тендерийг tender.gov.mn-д та өөрөө илгээнэ. 1 удаа үнэгүй дахин гаргах эрхтэй.

Зөвшөөрч байвал доорх товчийг дарна уу.`;

// Хуудасны «Материал гаргах» товч (upload.js) → B шат
async function startCompose(psid, { reds } = {}) {
  const st = (await S.getState(psid)) || {};
  if (BUSY.has(st.s)) throw new Error("Материалыг бэлтгэж байна");
  if ((st.runs || 0) >= MAX_RUNS()) { await admin(`ℹ️ Тендер ${psid}: дахин боловсруулах хязгаарт хүрлээ (${st.runs}).`); throw new Error("Энэ захиалгын боловсруулах эрх дууслаа. Манай ажилтан тантай холбогдоно."); }
  await S.setState(psid, { ...st, s: "tnd_composing", forcedReds: reds || null, composeAt: Date.now() });
  await enqueue(psid, "compose");
  const n = reds ? reds.attach.length + reds.data.length + reds.fail.length : 0;
  await send(psid, `Материалыг бэлтгэж эхэллээ ⏳ 20–40 минут болно. Бэлэн болмогц файлаар илгээнэ.${n ? ` (${n} зүйл дутуу байгааг мэдэж байж гаргахыг сонгосон.)` : ""}\n\nСанамсаргүй дарсан бол «⏹ Зогсоох».`, [STOP_BTN]);
}

// Явж буй боловсруулалтыг зогсоох: ажлыг цуцалж, нүдний хуудас руу буцаана (эрх хасагдахгүй)
async function stopJob(psid, st) {
  require("./index").cancel(psid);
  const back = st.s === "tnd_composing" ? "tnd_slots" : "tnd_left";
  await S.setState(psid, { ...st, s: back });
  console.log(`[tender] ${psid}: оролцогч ${st.s} зогсоов`);
  if (back === "tnd_slots") await send(psid, `⏹ Материал бэлтгэхийг зогсоолоо. Таны оруулсан мэдээлэл хадгалагдсан, гаргах эрх хасагдаагүй.\nХэрэгтэй үедээ хуудаснаасаа «Материал гаргах» дарна уу:\n${st.url || uploadUrl(psid)}`, [CANCEL_BTN]);
  else { await send(psid, "⏹ Зогсоолоо."); await admin(`ℹ️ Тендер ${psid}: шинжилгээг оролцогч зогсоов.`); }
  return "ext";
}
const STOP_BTN = ["⏹ Зогсоох", "TND_STOP"];

const READY_BTN = [["✅ Бэлэн", "TND_READY"], CANCEL_BTN];

async function handle({ psid, text, payload, attachments }) {
  text = String(text || "").trim(); payload = String(payload || "");
  const atts = Array.isArray(attachments) ? attachments.filter((a) => a && !(a.payload && a.payload.sticker_id)) : [];
  let st = (await S.getState(psid)) || { s: "new" };

  const tcode = String(process.env.TENDER_TEST_CODE || "").trim().toLowerCase();
  if (!payload && tcode && text.toLowerCase() === tcode && !BUSY.has(st.s)) payload = "TENDER";
  if (!payload && /^\s*тендер\s*$/i.test(text) && (!st.s || st.s === "new" || st.s === "tnd_left" || st.s === "tnd_done")) payload = "TENDER";
  if (!payload && isTester(psid) && require("./demo").KEYWORD.test(text)) {
    if (BUSY.has(st.s)) { await send(psid, "Өмнөх ажил дуусахыг хүлээнэ үү ⏳"); return "ext"; }
    await send(psid, await require("./demo").openDemo(psid, text, uploadUrl(psid)), [CANCEL_BTN]); return "ext";
  }
  if (payload === "TENDER") { if (BUSY.has(st.s)) { await send(psid, "Таны тендерийн захиалгыг боловсруулж байна ⏳ Бэлэн болмогц мэдэгдэнэ."); return "ext"; } return start(psid); }
  if (payload === "TND_CANCEL" || (CANCEL.test(text) && !BUSY.has(st.s) && !["tnd_interview", "tnd_done"].includes(st.s))) {
    if (st.qpay && st.qpay.no && st.s === "tnd_pay") await require("../org-v1/qpay").cancelInvoice(st.qpay.no).catch(() => { });
    const paidAlready = !!st.paidAt;
    await S.setState(psid, { ...st, s: "tnd_left" });
    if (paidAlready) await admin(`ℹ️ Тендер: төлбөр төлсөн захиалагч цуцаллаа (${psid}).`);
    return toMenu(psid, paidAlready ? "Цуцаллаа. Таны мэдээлэл 30 хоног хадгалагдана — «Тендерийн материал» товчоор дахин эхэлж болно. Өөр үйлчилгээ хэрэгтэй бол доороос сонгоно уу." : "Цуцаллаа. Өөр үйлчилгээ хэрэгтэй бол доорх товчноос сонгоно уу.");
  }

  switch (st.s) {
    case "tnd_upload":
    case "tnd_upload_more":
      if (atts.length) { const n = await saveAttachments(psid, atts); if (n) { await send(psid, `${n} файл хүлээн авлаа. Бүгдийг илгээсэн бол «Дууслаа» товчийг дарна уу.`, [["Дууслаа", "TND_UPLOADED"], CANCEL_BTN]); return "ext"; } }
      if (payload === "TND_UPLOADED") { const files = await S.listFiles(psid); if (!files.length) { await send(psid, `Файл ирээгүй байна. ТББ-гээ энэ холбоосоор илгээнэ үү:\n${st.url}`, [CANCEL_BTN]); return "ext"; } await onUploaded(psid); return "ext"; }
      await send(psid, `ТББ-гээ энэ холбоосоор илгээгээд «Дууслаа» товчийг дарна уу:\n${st.url || uploadUrl(psid)}`, [CANCEL_BTN]); return "ext";

    case "tnd_lotask": {
      if (payload === "TND_MOREFILES") { await S.setState(psid, { ...st, s: "tnd_upload" }); await send(psid, `Нэмэлт файлаа холбоосоор илгээгээд «Дууслаа» дарна уу, үнэ дахин бодогдоно:\n${st.url}`, [CANCEL_BTN]); return "ext"; }
      const lot = payload === "TND_ONELOT" ? null : text.slice(0, 200);
      if (!lot && payload !== "TND_ONELOT") { await send(psid, "Багцын дугаар эсвэл нэрийг бичнэ үү.", [["Ганц багцтай", "TND_ONELOT"], CANCEL_BTN]); return "ext"; }
      st.lot = lot;
      if (!st.paidRetry) { await S.setState(psid, { ...st, s: "tnd_terms" }); await send(psid, TERMS(st.price), [["✅ Зөвшөөрч, төлөх", "TND_AGREE"], CANCEL_BTN]); return "ext"; }
      if (st.paidRetry) { await S.setState(psid, { ...st, s: "tnd_analyzing" }); await send(psid, "Хүлээн авлаа ✅ ТББ-г шинжилж байна ⏳ 10–25 минут болно."); await enqueue(psid, "analyze"); return "ext"; }
      return offerPayment(psid, st);
    }

    case "tnd_terms":
      if (payload === "TND_AGREE") { st.termsAt = Date.now(); return offerPayment(psid, st); }
      await send(psid, TERMS(st.price), [["✅ Зөвшөөрч, төлөх", "TND_AGREE"], CANCEL_BTN]); return "ext";

    case "tnd_pay": {
      if (payload === "TND_QPCHECK" && st.qpay) {
        let r; try { r = await require("../org-v1/qpay").settle(st.qpay.no, "check"); } catch (e) { r = "error"; }
        if (r === "paid" || r === "done") return "ext";
        await send(psid, r === "error" ? "Төлбөр шалгахад түр саатал гарлаа. Хэдэн минутын дараа дахин шалгана уу." : `Төлбөр хараахан орж ирээгүй байна.${st.qpay.short ? "\n\nТөлөх холбоос:\n" + st.qpay.short : ""}`, [["✅ Төлсөн, шалгах", "TND_QPCHECK"], CANCEL_BTN]); return "ext";
      }
      const img = atts.find((a) => a.type === "image");
      if (img) {
        await S.setState(psid, { ...st, s: "tnd_payreview", receipt: img.payload && img.payload.url });
        await send(psid, "Төлбөрийн баримтыг хүлээн авлаа ✅ Шалгаад баталгаажмагц эхэлнэ.");
        if (process.env.ADMIN_PSID) { await sendImage(process.env.ADMIN_PSID, img.payload && img.payload.url); await admin(`💳 Тендерийн төлбөрийн баримт: ${fmtMoney(st.price || PRICE())}\nЗахиалагч: ${psid}`, [["✅ Батлах", `PAYOK|TND|${psid}`], ["❌ Татгалзах", `PAYNO|TND|${psid}`]]); }
        return "ext";
      }
      await send(psid, `Төлбөр ${fmtMoney(st.price || PRICE())}.${st.qpay && st.qpay.short ? " QPay-ээр төлөх холбоос:\n" + st.qpay.short : ""}`, st.qpay ? [["✅ Төлсөн, шалгах", "TND_QPCHECK"], CANCEL_BTN] : [CANCEL_BTN]); return "ext";
    }
    case "tnd_payreview":
      await send(psid, "Таны төлбөрийг шалгаж байна. Баталгаажмагц мэдэгдэнэ 🙏"); return "ext";

    case "tnd_lot": {
      const lots = st.lots || [];
      const n = payload.startsWith("TND_LOT_") ? Number(payload.slice(8)) : (/^\s*(\d{1,2})\s*$/.test(text) ? Number(text) - 1 : -1);
      const l = lots[n];
      if (!l) { await send(psid, "Доорх товчноос багцаа сонгоно уу.", lots.slice(0, 10).map((x, i) => [`${i + 1}. Багц ${x.no}`, `TND_LOT_${i}`])); return "ext"; }
      await S.setState(psid, { ...st, s: "tnd_analyzing", lot: `Багц ${l.no}: ${l.name}` });
      await send(psid, `Багц ${l.no} — «${l.name}» сонголоо ✅ Шаардлагуудыг задалж байна ⏳`);
      await enqueue(psid, "analyze"); return "ext";
    }

    case "tnd_analyzing":
    case "tnd_composing":
      if (payload === "TND_STOP" || payload === "TND_CANCEL" || /зогсоо|цуцл|болиул|stop/i.test(text)) return stopJob(psid, st);
      // Ажил энэ процесст явахгүй байвал (сервер дахин ассан г.м.) дахин эхлүүлнэ
      if (!require("./index").isActive(psid)) { try { await enqueue(psid, st.s === "tnd_analyzing" ? "analyze" : "compose"); } catch (e) { console.warn("[tender] сэргээх:", e.message); } }
      if (atts.length) { const n = await saveAttachments(psid, atts); if (n) { await send(psid, `${n} файл хүлээн авлаа ✅ Боловсруулалт дууссаны дараа ашиглана.`); return "ext"; } }
      if (text) { st.conv = [...(st.conv || []), { role: "Оролцогч", text: text.slice(0, 3000) }]; await S.setState(psid, st); }
      await send(psid, st.s === "tnd_analyzing" ? "ТББ-г шинжилж байна ⏳ Дуусмагц бүрдүүлэх материалын нүднүүд хуудсанд гарна." : "Материалыг бэлтгэж байна ⏳ 20–40 минут болно. Бэлэн болмогц файлаар илгээнэ."); return "ext";

    case "tnd_slots":
    case "tnd_interview":
      if (atts.length) { await send(psid, `Баримтаа энэ хуудасны тохирох нүдэнд оруулна уу — нүд бүр автоматаар шалгагдаж, улаан/шар/ногооноор харагдана:\n${st.url || uploadUrl(psid)}`, [CANCEL_BTN]); return "ext"; }
      await send(psid, `Бүрдүүлэх материалаа энэ хуудсанд оруулаад «📄 Материал гаргах» товчийг дарна уу:\n${st.url || uploadUrl(psid)}`, [CANCEL_BTN]); return "ext";

    case "tnd_done": {
      if (payload === "TND_NEWTENDER") {
        if (!st.retry) { await S.setState(psid, { ...st, s: "tnd_left" }); return toMenu(psid, "Өөр тендер илгээх эрх ашиглагдсан байна. Шинэ тендерт «Тендерийн материал»-аар захиална уу."); }
        await S.clear(psid).catch(() => { });
        const url = uploadUrl(psid);
        await S.setState(psid, { s: "tnd_upload", url, conv: [], paidRetry: true, retried: true, price: st.price, paidAt: st.paidAt });
        await send(psid, `📄 Шинэ тендерийн ТББ-гээ (tender.gov.mn-ээс татсан PDF/Word) энэ холбоосоор илгээгээд «Дууслаа» дарна уу. Дахин төлөх шаардлагагүй.\n\n⚠️ Эцсийн хугацаа нь дор хаяж 3–5 ажлын өдрийн дараа байгаа тендер сонгоорой.\n\n${url}`, [CANCEL_BTN]);
        return "ext";
      }
      await S.setState(psid, { ...st, s: "tnd_left" }); return toMenu(psid);
    }
    default:
      await S.setState(psid, { ...st, s: "tnd_left" }); return toMenu(psid);
  }
}

// Админы товч "PAYOK|TND|<psid>" / "PAYNO|TND|<psid>" (Make-ийн одоогийн «PAYOK|» шүүлтүүрээр /flow/admin руу ирнэ;
// org-v1/flow.js-ийн admin() TND-тэйг энд дамжуулна)
const isAdminPayload = (p) => /^PAY(OK|NO)\|TND\|/.test(String(p || ""));
async function adminAction(p) {
  const m = String(p || "").match(/^PAY(OK|NO)\|TND\|(.+)$/); if (!m) return { ok: false };
  const [, act, psid] = m, st = await S.getState(psid);
  if (!st || st.s !== "tnd_payreview") { await admin(`ℹ️ Тендер ${psid}: төлбөр хүлээх төлөвт алга (${st ? st.s : "мэдээлэлгүй"}).`); return { ok: false }; }
  if (act === "NO") { await S.setState(psid, { ...st, s: "tnd_pay" }); await send(psid, "Уучлаарай, таны төлбөр баталгаажсангүй. Дүн, гүйлгээгээ шалгаад баримтаа дахин илгээнэ үү."); return { ok: true }; }
  return { ok: await paid(psid, "admin") };
}

// QPay: төлбөр орвол
try {
  require("../org-v1/qpay").onPaid("tender", async (rec) => {
    const st = await S.getState(rec.psid);
    if (!st || !["tnd_pay", "tnd_payreview"].includes(st.s) || !st.qpay || st.qpay.no !== rec.no) { await admin(`⚠️ Тендер: QPay төлбөр ${fmtMoney(rec.paid || rec.amount)} орсон боловч захиалга төлбөр хүлээх төлөвт алга (${rec.psid}, ${st ? st.s : "-"}). Гараар шалгана уу.`); return; }
    await paid(rec.psid, "qpay");
  });
} catch (e) { console.warn("[tender] QPay холбогдсонгүй:", e.message); }

// Шинжилгээ / материал дууссаны дараа (index.js дуудна) — алдаа гарвал
async function onFailed(job, e) {
  const st = (await S.getState(job.psid)) || {};
  if (e.code === "cancelled") return; // stopJob өөрөө төлөв, мессежийг шийднэ
  const back = job.kind === "compose" ? "tnd_slots" : st.s;
  await S.setState(job.psid, { ...st, s: back });
  if (e.status === "blocked") { await send(job.psid, require("../plan-v2/guard").CUSTOMER_MSG); await admin(`⛔ Тендер захиалгыг хаалаа (${job.psid}): ${String(e.message).slice(0, 300)}`); return; }
  await send(job.psid, "Уучлаарай, боловсруулахад техникийн саатал гарлаа. Манай ажилтан тантай удахгүй холбогдоно.");
  await admin(/credit balance/i.test(e.message || "") ? "⚠️ Anthropic API кредит дууссан! Тендерийн захиалагч хүлээж байна." : `⚠️ Тендер ${job.kind} алдаа (${job.psid}): ${String(e.message).slice(0, 300)}`);
}

module.exports = { startCompose, TERMS, isTester, claims, handle, adminAction, isAdminPayload, onUploaded, onFailed, paid, allowed, MENU };
