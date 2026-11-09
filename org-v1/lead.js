// Шинэ чатын ангилагч: захиалагч ҮЙЛЧИЛГЭЭ хүсэж байна уу, зүгээр МЭДЭЭЛЭЛ хүсэж байна уу гэдгийг ялгана.
//   үйлчилгээ → «ятгах» тэмдэг (sales=1) буцаана, хариуг Make-ийн итгүүлэх бот (Opus) өгнө;
//   мэдээлэл, машин асуусан → товч мэдээлэл өгөөд орхино (handled=1);
//   тодорхойгүй ("Hi", "Үнийн мэдээлэл") → «Төсөл бичүүлэх / Зүгээр мэдээлэл» гэсэн 2 товчтой асуулт (handled=1).
// Make: POST /lead/classify {psid, text, payload, state, sales_ref, att} → {sales:"1"|"0"|"", handled:"1"|"0", tag}
// LEAD_ENABLED=1 эсвэл LEAD_TEST_PSIDS-д байгаа хүнд л ажиллана; бусдад хоосон хариу буцааж, хуучин урсгал хэвээр үлдэнэ.
// Үе шат бүрийг долоо хоногоор тоолно (админ Messenger-т «статистик» гэж бичвэл тайлан ирнэ).
const express = require("express");
const { callJSON, FAST } = require("../plan-v2/claude");
const router = express.Router();
const ADMIN = () => String(process.env.ADMIN_PSID || "");
const F = () => require("./flow");
function auth(req, res, next) { if (!process.env.API_KEY || req.get("x-api-key") !== process.env.API_KEY) return res.status(401).json({ error: "unauthorized" }); next(); }

// Туршилт: админ (ADMIN_PSID) болон LEAD_TEST_PSIDS-д байгаа хүнд л ажиллана. Бүх хүнд нээх: LEAD_ENABLED=1. Бүрэн унтраах: LEAD_ENABLED=0.
const enabled = (psid) => process.env.LEAD_ENABLED !== "0" && (process.env.LEAD_ENABLED === "1" || String(psid) === ADMIN() || String(process.env.LEAD_TEST_PSIDS || "").split(",").map((x) => x.trim()).filter(Boolean).includes(String(psid)));

// ---- хадгалалт (Redis эсвэл санах ой) ----
const mem = new Map(), TTL = 30 * 86400;
async function getL(psid) { const c = await F()._client(); const k = `lead:${psid}`; if (c) { const v = await c.get(k); return v ? JSON.parse(v) : {}; } return mem.get(k) || {}; }
async function setL(psid, L) { const c = await F()._client(); const k = `lead:${psid}`; L.at = Date.now(); if (c) await c.set(k, JSON.stringify(L), { EX: TTL }); else mem.set(k, L); }

// ---- үе шатын тоолуур (ISO долоо хоног) ----
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - (d.getUTCDay() || 7)));
  const w = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400e3 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}
const memStats = new Map();
async function count(stage, psid) {
  try {
    const wk = weekKey(), c = await F()._client();
    if (c) {
      if (psid) { const ok = await c.set(`funnel:seen:${wk}:${stage}:${psid}`, "1", { NX: true, EX: 120 * 86400 }); if (!ok) return; }
      await c.hIncrBy(`funnel:${wk}`, stage, 1); await c.expire(`funnel:${wk}`, 400 * 86400);
    } else {
      const k = `${wk}:${stage}:${psid || ""}`; if (psid && memStats.has(k)) return; memStats.set(k, 1);
      const s = memStats.get(wk) || {}; s[stage] = (s[stage] || 0) + 1; memStats.set(wk, s);
    }
  } catch (e) { console.warn("[lead] count:", e.message); }
}
async function stats(weeks = 4) {
  const c = await F()._client(), out = [];
  for (let i = 0; i < weeks; i++) { const wk = weekKey(new Date(Date.now() - i * 7 * 86400e3)); out.push([wk, c ? await c.hGetAll(`funnel:${wk}`) : memStats.get(wk) || {}]); }
  return out;
}
const STAGES = [["new", "Эхний мессеж"], ["cat_intent", "Үйлчилгээ хүссэн (ятгах)"], ["cat_info", "Мэдээлэл хүссэн"], ["cat_machine", "Машин, бараа асуусан"], ["cat_unclear", "Тодорхойгүй (асуулт тавьсан)"],
  ["btn_svc", "«Төсөл бичүүлэх» дарсан"], ["btn_info", "«Зүгээр мэдээлэл» дарсан"], ["hot", "Халуун (тодорхой төсөл)"], ["qr", "QR илгээсэн"], ["paid", "Төлсөн"]];
async function reportText() {
  const rows = await stats(4);
  return "📊 Борлуулалтын юүлүүр (долоо хоногоор, хүний тоо)\n\n" + rows.map(([wk, s]) => `${wk}\n${STAGES.map(([k, n]) => `• ${n}: ${s[k] || 0}`).join("\n")}`).join("\n\n");
}

// ---- ангилал ----
const RX = {
  sample: /(зураг|жишээ|загвар|ямар харагдах|үзүүлээч|sample)/i,
  strong: /(төсөл|тосол|tosol|төлөвлөгөө|бичүүл|захиал)/i,
  intent: /(төсөл|тосол|tosol|төлөвлөгөө|бичүүл|захиал|зээл\s*(авах|хүс)|банкинд\s*өгөх|тайлан\s*(бич|хий)|маркетинг)/i,
  machine: /(машин|тоног|төхөөрөмж|аппарат|станок|cnc|лазер|хаана\s*(зар|авах)|хаягаа|хаяг\s*хэл|зарах\s*уу|зардаг\s*уу)/i,
  chit: /^\s*(hi|hello|сайн\s*(уу|байна\s*уу)|sn\s*uu|сн\s*уу|laa|лаа|ok|ок|за|👍|❤️|сонирхож\s*байна|үнийн\s*мэдээлэл|үнэ\s*мэдээлэл|мэдээлэл\s*авах|дэлгэрэнгүй)\s*[.!?]*\s*$/i,
};
const CLS = `Чи «Менежер AI» Facebook пэйжийн чатын ангилагч. Менежер AI бол бизнес төсөл, бизнес төлөвлөгөө, маркетингийн төлөвлөгөө, тайлан бэлтгэдэг үйлчилгээ. Пэйж бизнес санааны бичлэг гаргадаг ч машин, тоног төхөөрөмж, бараа ЗАРДАГГҮЙ.
Хүний мессежийг ангил:
- "intent": төсөл, төлөвлөгөө, тайлан бичүүлэх, зээлд бэлтгэх, манай үйлчилгээний үнэ, нөхцөл, захиалгыг асууж байна.
- "machine": бичлэгт гарсан машин, тоног төхөөрөмж, барааны үнэ, хаанаас авах, зарах эсэхийг асууж байна.
- "info": бизнесийн санаа, салбарын талаар ерөнхий мэдээлэл асууж байна (үйлчилгээ захиалах дохиогүй).
- "unclear": мэндчилгээ, нэг үг, тодорхойгүй.
hot=true: зөвхөн intent бөгөөд тодорхой бизнес, төсөл нэрлэсэн бол (жишээ нь «хадаасны цехийн төсөл хэрэгтэй»).
info бол reply-д асуултад нь 1–2 өгүүлбэрээр ерөнхий, үнэн мэдээлэл өг (тоо, үнэ зохиохгүй, машин зардаггүй), төгсгөлд «Энэ бизнесийг эхлүүлэх төсөл, тооцоо хэрэгтэй бол доорх товчийг дарна уу» гэж нэм. Бусад ангилалд reply хоосон.
Монгол, кирилл, «Та» гэж. Зөвхөн JSON: {"cat":"intent|machine|info|unclear","hot":false,"reply":""}`;
async function classify(text) {
  const t = String(text || "").trim();
  if (!t) return { cat: "unclear" };
  if (RX.chit.test(t)) return { cat: "unclear" };
  const hot = /(төсөл|төлөвлөгөө).{0,25}(хэрэгтэй|бичүүл|хийлгэ|хий)|(хэрэгтэй|бичүүл|хийлгэ).{0,25}(төсөл|төлөвлөгөө)/i.test(t) && t.length > 12;
  if (RX.strong.test(t)) return { cat: "intent", hot };
  if (RX.machine.test(t)) return { cat: "machine" };
  if (RX.intent.test(t)) return { cat: "intent", hot };
  try {
    const o = await callJSON({ system: CLS, user: `Мессеж: ${t.slice(0, 800)}`, model: process.env.LEAD_MODEL || FAST, maxTokens: 400 });
    const cat = ["intent", "machine", "info", "unclear"].includes(o.cat) ? o.cat : "unclear";
    return { cat, hot: cat === "intent" && !!o.hot, reply: String(o.reply || "").slice(0, 600) };
  } catch (e) { console.warn("[lead] classify:", e.message); return RX.machine.test(t) ? { cat: "machine" } : RX.intent.test(t) ? { cat: "intent" } : { cat: "unclear" }; }
}

const SVC_BTN = [["📄 Төсөл бичүүлэх", "LEAD_SVC"], ["💡 Зүгээр мэдээлэл", "LEAD_INFO"]];
const MACHINE_MSG = "Сайн байна уу! Бид бизнес санааны бичлэгүүдээ хөдөлмөр эрхлэлтийг дэмжих зорилгоор хуваалцдаг бөгөөд бичлэгт гарсан машин, тоног төхөөрөмж зардаггүй 🙏\n\nХарин энэ бизнесийг эхлүүлэх бол хөрөнгө оруулалт, зардал, ашгийг тооцсон бизнес төслийг бэлтгэж өгдөг. Хэрэгтэй бол доорх товчийг дарна уу.";
const INFO_MSG = "Менежер AI бол бизнес төсөл, бизнес төлөвлөгөө, маркетингийн төлөвлөгөө, тайлан бэлтгэдэг үйлчилгээ. Бизнес санааны бичлэгүүдээ хөдөлмөр эрхлэлтийг дэмжих зорилгоор хуваалцдаг, машин, тоног төхөөрөмж зардаггүй.\n\nТөсөл, төлөвлөгөө хэрэгтэй болвол хэзээ ч бичээрэй 🙂";
const ASK_MSG = "Сайн байна уу! 👋 Менежер AI — бизнес төсөл, төлөвлөгөө, тайлан бэлтгэдэг үйлчилгээ.\n\nТанд юу хэрэгтэй вэ?";
const sampleUrls = () => String(process.env.SAMPLE_IMAGES || "").split(",").map((x) => x.trim()).filter(Boolean);
async function sendSamples(psid) {
  const urls = sampleUrls(); if (!urls.length) return false;
  for (const u of urls.slice(0, 5)) await F()._sendImage(psid, u);
  await F()._send(psid, "📄 Дээрх нь бэлэн бизнес төслийн жишээ хуудсууд (нууц мэдээлэлгүй). Бүтэн төсөл 50–75 хуудас, PDF + Word + томьёотой Excel-ээр ирнэ.");
  return true;
}
async function notifyHot(psid, text, L) {
  if (L.hotSent || !ADMIN()) return;
  L.hotSent = Date.now(); await count("hot", psid);
  await F()._send(ADMIN(), `🔥 Халуун хэрэглэгч (psid ${psid}): «${String(text).slice(0, 300)}»\nИтгүүлэх бот ярилцаж байна.`).catch(() => { });
}

// Гол логик. state: Make өгөгдлийн сангийн төлөв ("" = шинэ хүн)
async function handle({ psid, text, payload, state, sales_ref, att }) {
  psid = String(psid || ""); text = String(text || "").trim(); payload = String(payload || ""); state = String(state || "");
  const base = { sales: "", handled: "0", tag: "" };
  if (!psid || !enabled(psid)) return base;
  if (psid === ADMIN() && /^(статистик|воронк|юүлүүр)$/i.test(text)) { await F()._send(psid, await reportText()); return { ...base, handled: "1" }; }
  const L = await getL(psid);
  const yat = String(sales_ref || "") === "yatgah";
  const out = (handled) => ({ sales: L.tag === "intent" || yat ? "1" : "0", handled: handled ? "1" : "0", tag: L.tag || "" });
  const fresh = !state || state === "selecting_type";
  if (!state) await count("new", psid);

  // QR илгээсний дараа ч жишээ зураг асуувал илгээнэ
  if (!payload && text && RX.sample.test(text) && ["", "selecting_type", "awaiting_payment"].includes(state) && text.length < 80) {
    if (await sendSamples(psid)) { await setL(psid, L); return out(true); }
  }
  if (!fresh) return out(false);

  if (payload === "LEAD_SVC" || payload === "BIZ_PROJECT") {
    if (L.tag !== "intent") { L.tag = "intent"; if (payload === "LEAD_SVC") await count("btn_svc", psid); await count("cat_intent", psid); }
    await setL(psid, L); return out(false);
  }
  if (payload === "LEAD_INFO") {
    await count("btn_info", psid); if (L.tag !== "intent") L.tag = "info";
    await setL(psid, L); await F()._send(psid, INFO_MSG); return out(true);
  }
  if (payload || !text || L.tag === "intent" || yat) { await setL(psid, L); return out(false); }

  const c = await classify(text);
  if (c.cat === "intent") {
    L.tag = "intent"; await count("cat_intent", psid);
    if (c.hot) await notifyHot(psid, text, L);
    await setL(psid, L); return out(false);
  }
  if (c.cat === "machine") {
    await count("cat_machine", psid); L.tag = "info";
    await setL(psid, L); await F()._send(psid, MACHINE_MSG, [SVC_BTN[0]]); return out(true);
  }
  if (c.cat === "info" && c.reply) {
    await count("cat_info", psid); L.tag = "info";
    await setL(psid, L); await F()._send(psid, c.reply, [SVC_BTN[0]]); return out(true);
  }
  await count("cat_unclear", psid);
  await setL(psid, L); await F()._send(psid, ASK_MSG, SVC_BTN); return out(true);
}

router.post("/lead/classify", express.json(), auth, async (req, res) => {
  try { res.json(await handle(req.body || {})); }
  catch (e) { console.warn("[lead]", e.message); res.json({ sales: "", handled: "0", tag: "" }); }
});
module.exports = router;
module.exports.handle = handle;
module.exports.count = count;
module.exports.classify = classify;
module.exports.reportText = reportText;
module.exports.enabled = enabled;
module.exports._weekKey = weekKey;
