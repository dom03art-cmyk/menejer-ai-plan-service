// Messenger-ийн "бусад үйлчилгээ" (маркетинг, жилийн төлөвлөгөө, тайлан, багц)-ний яриаг СЕРВЕР удирдана.
// Make зөвхөн мессежийг дамжуулна:  POST /flow/message {psid, text, payload, attachments, state} → {state}
//   буцаах state-ийг Make өгөгдлийн санд (146964) хадгална: "ext" бол дараагийн мессежийг дахин энд дамжуулна, "selecting_type" бол үндсэн цэс рүү буцна.
// Админ төлбөр баталгаажуулах: POST /flow/admin {payload:"PAYOK|<psid>" | "PAYNO|<psid>"}
// Бизнес төслийн урсгал (plan-v2, Make-ийн хуучин салбарууд)-д огт хүрэхгүй.
const express = require("express");
const { callJSON, FAST, WRITER } = require("../plan-v2/claude");
const { fbText } = require("../plan-v2/util");
const { PRODUCTS, fmtMoney, priceFor } = require("./quote");
const router = express.Router();
const GRAPH = "https://graph.facebook.com/v21.0/me/messages";
const MKT_PRICE = Number(process.env.MKT_PRICE || 149900);
const ADMIN = () => process.env.ADMIN_PSID;
function auth(req, res, next) { if (req.get("x-api-key") !== process.env.API_KEY) return res.status(401).json({ error: "unauthorized" }); next(); }

// ---- төлөв хадгалах (Redis эсвэл санах ой), 30 хоног ----
let ready = null;
const mem = new Map(), TTL = 30 * 86400;
function client() {
  if (!process.env.REDIS_URL) return Promise.resolve(null);
  if (!ready) {
    const { createClient } = require("redis");
    const c = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 10000, reconnectStrategy: (n) => Math.min(n * 500, 5000) } });
    c.on("error", (e) => console.warn("[flow]", e.message));
    ready = c.connect().then(() => c).catch((e) => { console.warn("[flow] Redis алга:", e.message); ready = null; return null; });
  }
  return ready;
}
async function getF(psid) { const c = await client(); const k = `flow:${psid}`; if (c) { const v = await c.get(k); return v ? JSON.parse(v) : null; } return mem.get(k) || null; }
async function setF(psid, f) { const c = await client(); const k = `flow:${psid}`; f.at = Date.now(); if (c) await c.set(k, JSON.stringify(f), { EX: TTL }); else mem.set(k, f); }

// ---- Messenger ----
async function send(psid, text, buttons) {
  const token = process.env.FB_PAGE_TOKEN; if (!token || !psid) return;
  const msg = { text: String(text).slice(0, 1990) };
  if (buttons && buttons.length) msg.quick_replies = buttons.slice(0, 13).map(([title, payload]) => ({ content_type: "text", title: title.slice(0, 20), payload }));
  if (String(text).length > 1990 && !buttons) return fbText(psid, text);
  const r = await fetch(`${GRAPH}?access_token=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: msg }) }).catch((e) => ({ ok: false, text: async () => e.message }));
  if (!r.ok) console.warn("[flow] fb", r.status, await r.text());
}
async function sendImage(psid, url) {
  const token = process.env.FB_PAGE_TOKEN; if (!token || !psid || !url) return;
  await fetch(`${GRAPH}?access_token=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: { attachment: { type: "image", payload: { url, is_reusable: false } } } }) }).catch(() => { });
}
const MENU = [["Бизнес төсөл", "BIZ_PROJECT"], ["Маркетинг", "MKT_PLAN"], ["Жилийн төлөвлөгөө", "ORG_PLAN"], ["Тайлан", "ORG_REPORT"]];
const toMenu = async (psid, text = "Танд өөр ямар үйлчилгээ хэрэгтэй вэ? Доорх товчноос сонгоно уу.") => { await send(psid, text, MENU); return "selecting_type"; };

const NAMES = { marketing: "Маркетингийн төлөвлөгөө", report_dept: PRODUCTS.report_dept.name, report_dir: PRODUCTS.report_dir.name, plan: PRODUCTS.plan.name, bundle: PRODUCTS.bundle.name, plan_dept: PRODUCTS.plan_dept.name, bundle_dept: PRODUCTS.bundle_dept.name };
const tiers = (p) => { const q = [5, 30, 80].map((u) => priceFor(p, u)); return `20 хүртэл хуудас: ${fmtMoney(q[0].price)} · 21–50: ${fmtMoney(q[1].price)} · 51–100: ${fmtMoney(q[2].price)}`; };
const payInfo = () => process.env.PAY_INFO ? String(process.env.PAY_INFO).replace(/\\n/g, "\n") : null;

// ---- Маркетингийн ярилцлага ----
const INTERVIEW = `Чи «Менежер AI»-ийн маркетингийн төлөвлөгөө боловсруулах үйлчилгээний туслах. Захиалагчаас төлөвлөгөөнд хэрэгтэй мэдээллийг монгол хэлээр, найрсаг, товч асуултаар цуглуулна. Нэг удаад 1–2 асуулт асуу, жагсаалтаар олон асуулт бүү нурш.
Цуглуулах мэдээлэл: (1) юуг сурталчлах вэ — бүтээгдэхүүн/үйлчилгээ, байгууллага эсвэл хувь хүн (хувийн брэнд); брэнд, компанийн нэр; (2) санал болгож буй зүйл, үнэ (бүтээгдэхүүн бол өртөг); (3) байршил, борлуулах суваг; (4) зорилтот хэрэглэгч; (5) одоогийн байдал — хуудас, дагагчийн тоо, өмнөх зар сурталчилгааны үр дүн; (6) сарын маркетингийн төсөв; (7) хугацаа, хэдэн сараас эхлэх; (8) гол зорилго (тоогоор бол илүү); (9) өрсөлдөгч (мэдэх бол); (10) маркетинг хариуцах хүн, баг.
Дүрэм:
- Захиалагч мэдэхгүй гэвэл шахахгүй, дараагийн асуулт руу шилж. Хэлсэн нэр, тоог өөрчлөхгүй.
- Сонгууль, улс төрийн сурталчилгааг ХЭЗЭЭ Ч өөрөө санал болгож, асуухгүй. Захиалагч өөрөө дурдвал зүгээр л тэмдэглэ.
- Хууль бус үйл ажиллагаа (мансууруулах бодис, зэвсэг, садар самуун, залилан, хууль бус наймаа) бол тусалж болохгүй гэж эелдгээр хэлээд ready=false, blocked=true.
- Захиалагч "бизнес төсөл дотор маркетингийн хэсэг байдаггүй юу" гэж асуувал л: бизнес төслийн 3.2 маркетингийн хэсэг 3–4 хуудас товч, харин энэ бие даасан маркетингийн төлөвлөгөө 40–75 хуудас, хэрэгжүүлэх хөтөч (зарын бэлэн текст, календарь, төсөв, KPI) гэж тайлбарла. Өөрөөр бүү дурд.
- Үнэ асуувал: ${fmtMoney(MKT_PRICE)}, бизнес төсөлтэй багцаар 249 900₮.
- Хангалттай мэдээлэл (1, 2, 4, 6, 7 заавал; бусад нь боломжтой бол) цугларсан эсвэл захиалагч "болсон, эхлүүл" гэвэл ready=true; reply-д цуглуулсан гол мэдээллийг 3–6 мөрөөр товч давтаж бич (үнэ, төлбөрийн мэдээллийг бичихгүй, код нэмнэ).
Зөвхөн JSON: {"reply":"захиалагчид илгээх текст","ready":false,"blocked":false}`;

async function interview(f, text) {
  f.conv = f.conv || [];
  f.conv.push({ role: "Захиалагч", text: String(text || "").slice(0, 3000) });
  const convText = f.conv.map((m) => `${m.role}: ${m.text}`).join("\n");
  let out;
  try { out = await callJSON({ system: INTERVIEW, user: `ЯРИА:\n${convText}\n\nДараагийн хариугаа JSON-оор бич.${f.conv.filter((m) => m.role === "Захиалагч").length >= 12 ? " Асуулт хангалттай олон боллоо — ready=true болго." : ""}`, model: process.env.FLOW_MODEL || WRITER, maxTokens: 1500 }); }
  catch (e) { console.warn("[flow] interview:", e.message); out = { reply: "Уучлаарай, түр саатал гарлаа. Хариугаа дахин бичнэ үү.", ready: false }; }
  const reply = String(out.reply || "").trim() || "Ойлголоо. Үргэлжлүүлээд бичнэ үү.";
  f.conv.push({ role: "Менежер AI", text: reply });
  return { reply, ready: !!out.ready, blocked: !!out.blocked };
}

// ---- Үйлчилгээ эхлүүлэх ----
async function startOrg(psid, f, product) {
  const { tokenFor } = require("./upload");
  const M = require("./materials");
  await M.clear(psid).catch(() => { });
  await M.setMeta(psid, { product }).catch(() => { });
  const url = `${process.env.PUBLIC_URL || "https://menejer-ai-plan-service.onrender.com"}/u/org/${tokenFor(psid, product)}`;
  Object.assign(f, { s: "uploading", product, url, price: null });
  const extra = product === "bundle_dept" ? `\nТусад нь авахаас ~17% хямд. Нэг материалаар эхлээд ажлын тайлан, дараа нь ирэх оны ажлын төлөвлөгөө гарна.` : product === "bundle" ? `\nТусад нь авахаас 15% хямд. Нэг материалаар эхлээд захирлын тайлан, дараа нь ирэх жилийн төлөвлөгөө гарна.` : "";
  const what = product === "plan_dept" ? "Өнгөрсөн оны ажлын төлөвлөгөө, тайлан, гүйцэтгэлийн хүснэгт (KPI), хэлтсийн чиг үүрэг, удирдлагаас өгсөн чиглэл зэрэг материалаа илгээнэ үү." : product === "plan" ? "Өмнөх жилийн төлөвлөгөө, тайлан, орлого зарлагын задаргаа, орон тоо, цалингийн мэдээлэл зэрэг байгаа материалаа илгээнэ үү (бүгд заавал биш)." : "Тайлангийн хугацаанд хийсэн ажлаа харуулах материалаа (төлөвлөгөө, сарын тайлан, Excel хүснэгт, KPI, хурлын тэмдэглэл, санхүүгийн тайлан г.м.) илгээнэ үү.";
  await send(psid, `📋 ${NAMES[product]}\n\nҮнэ нь таны илгээх материалын хэмжээгээр бодогдоно:\n${tiers(product)}${extra}\n\n${what} Материалын агуулгыг төлбөр баталгаажсаны дараа л уншина.\n\n👉 Материал илгээх холбоос:\n${url}\n\nБүх файлаа илгээгээд хуудасны доод талын «Дууслаа» товчийг дарвал үнийн санал энд ирнэ.`, [["Цуцлах", "FLOW_CANCEL"]]);
}

// upload.js-ийн «Дууслаа» → үнийн санал гарсны дараа дуудагдана
async function onQuote(psid, product, quote) {
  const f = (await getF(psid)) || {};
  Object.assign(f, { s: "awaiting_payment", product, price: quote.price, units: quote.units });
  await setF(psid, f);
  const pi = payInfo();
  await send(psid, `💳 Төлбөр: ${fmtMoney(quote.price)}\n\n${pi ? pi + "\n\n" : ""}Гүйлгээний утга дээр утасны дугаараа бичнэ үү. Төлбөр шилжүүлсний дараа гүйлгээний баримтын зургийг (screenshot) энд илгээнэ үү. Баталгаажмагц боловсруулж эхэлнэ.${pi ? "" : "\n\nДансны мэдээллийг манай ажилтан удахгүй илгээнэ."}`, [["Материал нэмэх", "FLOW_MORE"], ["Цуцлах", "FLOW_CANCEL"]]);
  if (!pi && ADMIN()) await send(ADMIN(), `⚠️ PAY_INFO (дансны мэдээлэл) тохируулаагүй тул ${psid}-д дансны мэдээллийг гараар илгээнэ үү. Render → Environment-д PAY_INFO нэмнэ үү.`);
}

async function askPayment(psid, f) {
  f.s = "awaiting_payment"; f.price = f.product === "marketing" ? MKT_PRICE : f.price;
  const pi = payInfo();
  await send(psid, `💳 Төлбөр: ${fmtMoney(f.price)}\n\n${pi ? pi + "\n\n" : ""}Гүйлгээний утга дээр утасны дугаараа бичнэ үү. Төлбөр шилжүүлсний дараа гүйлгээний баримтын зургийг (screenshot) энд илгээнэ үү.${pi ? "" : "\n\nДансны мэдээллийг манай ажилтан удахгүй илгээнэ."}`, [["Цуцлах", "FLOW_CANCEL"]]);
  if (!pi && ADMIN()) await send(ADMIN(), `⚠️ PAY_INFO тохируулаагүй — ${psid}-д дансны мэдээллийг гараар илгээнэ үү.`);
}

async function startJob(psid, f) {
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`, headers = { "Content-Type": "application/json", "x-api-key": process.env.API_KEY || "" };
  const mkt = f.product === "marketing";
  const body = mkt ? { psid, conversation: (f.conv || []).map((m) => `${m.role}: ${m.text}`).join("\n") } : { psid, product: f.product, conversation: (f.conv || []).map((m) => `${m.role}: ${m.text}`).join("\n") };
  const r = await fetch(base + (mkt ? "/mkt/jobs" : "/org/jobs"), { method: "POST", headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  Object.assign(f, { s: "processing", job: j.job_id, jobKind: mkt ? "mkt" : "org", startedAt: Date.now() });
}
async function jobStatus(f) {
  if (!f.job) return null;
  try { const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/${f.jobKind}/jobs/${f.job}`, { headers: { "x-api-key": process.env.API_KEY || "" } }); if (r.status === 404) return "gone"; return (await r.json()).status; } catch (_) { return null; }
}

// ---- Гол логик ----
const isImage = (a) => a && (a.type === "image" || /\.(jpe?g|png|webp)/i.test(String(a.payload && a.payload.url || "")));
const CANCEL = /^(цуцла|болих|буцах|cancel|stop)/i;

async function handle({ psid, text, payload, attachments }) {
  text = String(text || "").trim(); payload = String(payload || "");
  const atts = Array.isArray(attachments) ? attachments.filter((a) => a && !(a.payload && a.payload.sticker_id)) : [];
  let f = (await getF(psid)) || { s: "new" };

  // Үндсэн цэсний сонголтууд (аль ч төлөвөөс, боловсруулж байгаагаас бусад)
  if (payload === "BIZ_PROJECT") { if (f.s === "processing") return "ext"; await setF(psid, { s: "left" }); await send(psid, "Бизнес төсөл сонголоо. Үргэлжлүүлэхийн тулд доорх товчийг дахин дарна уу.", [["Бизнес төсөл", "BIZ_PROJECT"]]); return "selecting_type"; }
  if (["MKT_PLAN", "ORG_PLAN", "ORG_REPORT"].includes(payload) && f.s !== "processing" && f.s !== "payment_review") {
    if (payload === "MKT_PLAN") {
      f = { s: "mkt_interview", product: "marketing", conv: [] };
      const hello = `📣 Маркетингийн төлөвлөгөө — ${fmtMoney(MKT_PRICE)}\n\n40–75 хуудас, алхам алхмаар хэрэгжүүлэх хөтөч: зах зээл, өрсөлдөгчийн шинжилгээ, маркетингийн стратеги, зарын бэлэн текст, 30 хоногийн контент календарь, сар бүрийн төсөв, үр дүнгийн тооцоо (PDF, Word, Excel).\n\nЭхлээд хэдэн асуулт асууя. Юуг сурталчлах вэ — бүтээгдэхүүн/үйлчилгээ, байгууллага эсвэл өөрийгөө (хувийн брэнд)? Нэр, юу санал болгодгоо товч бичнэ үү.`;
      f.conv.push({ role: "Менежер AI", text: hello });
      await setF(psid, f); await send(psid, hello, [["Цуцлах", "FLOW_CANCEL"]]); return "ext";
    }
    if (payload === "ORG_PLAN") { f = { s: "choose", menu: "plan" }; await setF(psid, f);
      await send(psid, `📊 Байгууллагын ирэх жилийн үйл ажиллагааны төлөвлөгөө, төсөв: 60–80 хуудас Word, PDF, томьёотой Excel төсөв.\n\nҮнэ (материалын хэмжээгээр): ${tiers("plan")}\n\nӨнгөрсөн жилийн гүйцэтгэх захирлын тайлантай багцаар авбал 15% хямд (${tiers("bundle")}).\n\n🗂 Хэлтсийн ирэх оны ажлын төлөвлөгөө (зорилт, KPI, ажлууд, хуваарь, нөөц; Excel KPI хяналттай): ${tiers("plan_dept")}`, [["Байгууллагын төлөвл", "FLOW_P_plan"], ["Багц: тайлан+төлөвл", "FLOW_P_bundle"], ["Хэлтсийн төлөвлөгөө", "FLOW_P_plan_dept"], ["Цуцлах", "FLOW_CANCEL"]]); return "ext"; }
    if (payload === "ORG_REPORT") { f = { s: "choose", menu: "report" }; await setF(psid, f);
      await send(psid, `📑 Тайлангийн үйлчилгээ — таны материалаас тоо зохиохгүйгээр бэлтгэнэ (Word, PDF, Excel):\n\n• Хэлтэс, албан тушаалын ажлын тайлан — нэг хэлтэс, албан тушаалын жилийн ажил, KPI, бэрхшээл, ирэх жилийн санал (10–20 хуудас). Удирдлагад тавина.\n${tiers("report_dept")}\n\n• Хэлтэс: тайлан + ирэх оны ажлын төлөвлөгөө (багц, ~17% хямд):\n${tiers("bundle_dept")}\n\n• Гүйцэтгэх захирлын (ТУЗ-д) тайлан — байгууллага бүхэлдээ: санхүүгийн үр дүн, ТУЗ-ийн шийдвэрийн биелэлт, бүх хэлтсийн нэгтгэл, төсөл, эрсдэл, ТУЗ-өөр шийдүүлэх асуудал (20–35 хуудас).\n${tiers("report_dir")}\n\n• Захирал: тайлан + байгууллагын ирэх жилийн төлөвлөгөө (багц, 15% хямд):\n${tiers("bundle")}\n\nАль нь вэ?`, [["Хэлтсийн тайлан", "FLOW_P_report_dept"], ["Хэлтэс: тайлан+төлөв", "FLOW_P_bundle_dept"], ["Захирлын тайлан", "FLOW_P_report_dir"], ["Захирал тайлан+төлөв", "FLOW_P_bundle"], ["Цуцлах", "FLOW_CANCEL"]]); return "ext"; }
  }
  if (payload === "FLOW_CANCEL" || (CANCEL.test(text) && !["processing", "payment_review"].includes(f.s))) { await setF(psid, { s: "left" }); return toMenu(psid, "Цуцаллаа. Өөр үйлчилгээ хэрэгтэй бол доорх товчноос сонгоно уу."); }
  if (payload.startsWith("FLOW_P_") && PRODUCTS[payload.slice(7)]) { await startOrg(psid, f, payload.slice(7)); await setF(psid, f); return "ext"; }

  switch (f.s) {
    case "mkt_interview": {
      if (atts.length && !text) { await send(psid, "Зураг, файлыг энэ шатанд уншихгүй. Мэдээллээ текстээр бичнэ үү 🙏"); return "ext"; }
      if (!text) return "ext";
      const r = await interview(f, text);
      if (r.blocked) { await setF(psid, { s: "left" }); await send(psid, r.reply); return "selecting_type"; }
      if (r.ready) { await send(psid, r.reply); await askPayment(psid, f); await setF(psid, f); return "ext"; }
      await setF(psid, f); await send(psid, r.reply, [["Цуцлах", "FLOW_CANCEL"]]); return "ext";
    }
    case "uploading":
      await send(psid, `Материалаа энэ холбоосоор илгээгээд «Дууслаа» товчийг дарна уу:\n${f.url}`, [["Цуцлах", "FLOW_CANCEL"]]); return "ext";
    case "awaiting_payment": {
      if (payload === "FLOW_MORE" && f.url) { f.s = "uploading"; await setF(psid, f); await send(psid, `Нэмэлт материалаа энэ холбоосоор илгээгээд «Дууслаа» дарна уу, үнэ дахин бодогдоно:\n${f.url}`); return "ext"; }
      const img = atts.find(isImage);
      if (img) {
        f.s = "payment_review"; f.receipt = img.payload && img.payload.url; await setF(psid, f);
        await send(psid, "Баярлалаа! Төлбөрийн баримтыг хүлээн авлаа ✅ Шалгаад баталгаажмагц боловсруулж эхэлнэ.");
        if (ADMIN()) { await sendImage(ADMIN(), f.receipt);
          await send(ADMIN(), `💳 Төлбөрийн баримт ирлээ\nҮйлчилгээ: ${NAMES[f.product]}\nДүн: ${fmtMoney(f.price || 0)}${f.units ? ` (${f.units} хуудас)` : ""}\nЗахиалагч: ${psid}\n\nДанс руугаа орж шалгаад сонгоно уу.`, [["✅ Батлах", `PAYOK|${psid}`], ["❌ Татгалзах", `PAYNO|${psid}`]]); }
        return "ext";
      }
      if (atts.length) { await send(psid, "Төлбөрийн баримтыг зураг (screenshot) хэлбэрээр илгээнэ үү."); return "ext"; }
      await send(psid, `Төлбөр ${fmtMoney(f.price || 0)}. Шилжүүлсний дараа гүйлгээний баримтын зургийг энд илгээнэ үү.${payInfo() ? "\n\n" + payInfo() : ""}`, f.url ? [["Материал нэмэх", "FLOW_MORE"], ["Цуцлах", "FLOW_CANCEL"]] : [["Цуцлах", "FLOW_CANCEL"]]); return "ext";
    }
    case "payment_review":
      await send(psid, "Таны төлбөрийг шалгаж байна. Баталгаажмагц мэдэгдэнэ 🙏"); return "ext";
    case "processing": {
      const st = await jobStatus(f);
      if (st === "done" || st === "gone" || st === "failed" || st === "blocked") { await setF(psid, { s: "left" }); return toMenu(psid, st === "done" || st === "gone" ? "Таны захиалга бэлэн болж, файлууд дээр илгээгдсэн байгаа 📄 Өөр үйлчилгээ хэрэгтэй бол доорх товчноос сонгоно уу." : "Танай захиалгын талаар манай ажилтан тантай холбогдоно. Өөр үйлчилгээ хэрэгтэй бол доорх товчноос сонгоно уу."); }
      await send(psid, "Таны захиалгыг боловсруулж байна ⏳ Бэлэн болмогц файлаар илгээнэ. Материалын хэмжээнээс хамаарч 30–90 минут болно."); return "ext";
    }
    case "choose":
      await send(psid, "Доорх товчноос сонгоно уу.", f.menu === "plan" ? [["Байгууллагын төлөвл", "FLOW_P_plan"], ["Багц: тайлан+төлөвл", "FLOW_P_bundle"], ["Хэлтсийн төлөвлөгөө", "FLOW_P_plan_dept"], ["Цуцлах", "FLOW_CANCEL"]] : [["Хэлтсийн тайлан", "FLOW_P_report_dept"], ["Хэлтэс: тайлан+төлөв", "FLOW_P_bundle_dept"], ["Захирлын тайлан", "FLOW_P_report_dir"], ["Захирал тайлан+төлөв", "FLOW_P_bundle"], ["Цуцлах", "FLOW_CANCEL"]]); return "ext";
    default:
      await setF(psid, { s: "left" }); return toMenu(psid);
  }
}

async function admin(payload) {
  const m = String(payload || "").match(/^(PAYOK|PAYNO)\|(.+)$/); if (!m) return { ok: false };
  const [, act, psid] = m, f = await getF(psid);
  if (!f || f.s !== "payment_review") { await send(ADMIN(), `ℹ️ ${psid}: энэ захиалга төлбөр хүлээж буй төлөвт алга (${f ? f.s : "мэдээлэлгүй"}).`); return { ok: false }; }
  if (act === "PAYNO") {
    f.s = "awaiting_payment"; await setF(psid, f);
    await send(psid, "Уучлаарай, таны төлбөр баталгаажсангүй. Дүн, гүйлгээгээ шалгаад баримтаа дахин илгээнэ үү. Асуудал байвал манай ажилтан тантай холбогдоно.");
    await send(ADMIN(), `❌ Татгалзлаа: ${psid}`); return { ok: true };
  }
  try { await startJob(psid, f); await setF(psid, f); await send(ADMIN(), `✅ Баталлаа, боловсруулж эхэллээ: ${NAMES[f.product]} (${psid})`); }
  catch (e) { await send(ADMIN(), `⚠️ ${psid}: ажил эхлүүлж чадсангүй — ${e.message}`); await send(psid, "Төлбөр баталгаажлаа ✅ Боловсруулалт эхлэхэд түр саатал гарлаа, манай ажилтан удахгүй эхлүүлнэ."); }
  return { ok: true };
}

const parseAtt = (a) => { if (typeof a === "string") { try { return JSON.parse(a); } catch (_) { return []; } } return Array.isArray(a) ? a : []; };
router.post("/flow/message", express.json({ limit: "1mb" }), auth, async (req, res) => {
  const b = req.body || {};
  if (!b.psid) return res.status(400).json({ error: "psid" });
  try { const state = await handle({ psid: String(b.psid), text: b.text, payload: b.payload, attachments: parseAtt(b.attachments) }); res.json({ state }); }
  catch (e) { console.error("[flow] алдаа", e); res.json({ state: "ext", error: e.message }); }
});
router.post("/flow/admin", express.json(), auth, async (req, res) => {
  try { res.json(await admin((req.body || {}).payload)); } catch (e) { console.error("[flow] admin", e); res.json({ ok: false, error: e.message }); }
});
router.get("/flow/state/:psid", auth, async (req, res) => res.json(await getF(req.params.psid)));

module.exports = router;
module.exports.onQuote = onQuote;
module.exports.handleMessage = handle;
module.exports.adminAction = admin;
