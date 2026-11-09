// Шинэ чатын ангилагч: захиалагч ҮЙЛЧИЛГЭЭ хүсэж байна уу, зүгээр МЭДЭЭЛЭЛ хүсэж байна уу гэдгийг ялгана.
//   үйлчилгээ → «ятгах» тэмдэг (sales=1) буцаана, хариуг Make-ийн итгүүлэх бот (Opus) өгнө;
//   мэдээлэл, машин асуусан → товч мэдээлэл өгөөд орхино (handled=1);
//   тодорхойгүй ("Hi", "Үнийн мэдээлэл") → «Төсөл бичүүлэх / Зүгээр мэдээлэл» гэсэн 2 товчтой асуулт (handled=1).
//   сэдэв тодорхой (рийлийн түлхүүр үг «ЯС», эсвэл «лазер машин хэд вэ») → «{сэдэв} бизнес сонирхож байна уу? Өөрийн хөрөнгөөр үү, зээлээр үү?»
//   → хариулбал жишээ хуудсууд + бүтэн төсөл юу шийдэхийг 2 өгүүлбэрээр + «✅ Төсөл захиалах» товч. QR зөвхөн захиалах дарсны дараа (Make).
//   Үнэгүй тооцоо амлахгүй.
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
  ["kw", "Рийлийн түлхүүр үг бичсэн"], ["topic_q", "Сэдвээр санхүүжилт асуусан"], ["fund_own", "→ Өөрийн хөрөнгөөр"], ["fund_loan", "→ Зээлээр"], ["fund_research", "→ Судалж байна"], ["offer", "Жишээ + санал илгээсэн"],
  ["btn_svc", "«Төсөл бичүүлэх» дарсан"], ["btn_info", "«Зүгээр мэдээлэл» дарсан"], ["hot", "Халуун (тодорхой төсөл)"], ["qr", "QR илгээсэн"], ["paid", "Төлсөн"]];
async function reportText() {
  const rows = await stats(4);
  return "📊 Борлуулалтын юүлүүр (долоо хоногоор, хүний тоо)\n\n" + rows.map(([wk, s]) => `${wk}\n${STAGES.map(([k, n]) => `• ${n}: ${s[k] || 0}`).join("\n")}`).join("\n\n");
}

// ---- рийлийн түлхүүр үг (админ Messenger-ээс засна) ----
// «түлхүүр ЯС = Ясны шөлний нунтгийн» — нэмэх/солих (сэдвийг харьяалахаар: «...-ийн/-ны»)
// «түлхүүрүүд» — жагсаалт; «түлхүүр устга ЯС» — устгах
const memKw = new Map();
const normKw = (x) => String(x || "").toUpperCase().replace(/[^0-9A-ZА-ЯЁӨҮ\s]/g, " ").replace(/\s+/g, " ").trim();
async function kwAll() { const c = await F()._client(); return c ? await c.hGetAll("lead:kw") : Object.fromEntries(memKw); }
async function kwSet(k, v) { const c = await F()._client(); if (c) await c.hSet("lead:kw", k, v); else memKw.set(k, v); }
async function kwDel(k) { const c = await F()._client(); if (c) return await c.hDel("lead:kw", k); return memKw.delete(k) ? 1 : 0; }
async function kwMatch(text) {
  const n = normKw(text); if (!n || n.length > 60) return "";
  const all = await kwAll(); if (all[n]) return all[n];
  const first = n.split(" ")[0]; return n.split(" ").length <= 4 && all[first] ? all[first] : "";
}
async function kwAdmin(text) {
  let m = text.match(/^түлхүүр\s+устга\s+(.+)$/i);
  if (m) { const k = normKw(m[1]); return (await kwDel(k)) ? `🗑 «${k}» устгалаа.` : `«${k}» олдсонгүй.`; }
  m = text.match(/^түлхүүр\s+([^=\n]+?)\s*=\s*([\s\S]+)$/i);
  if (m) {
    const k = normKw(m[1]); if (!k) return "Түлхүүр хоосон байна.";
    const { topic, detail } = splitKw(m[2]); if (!topic) return "Сэдвийн нэр хоосон байна.";
    await kwSet(k, detail ? `${topic} | ${detail}` : topic);
    const info = await kwInfo(topic, detail, true);
    return `✅ «${k}» нэмэгдлээ${detail ? " (нарийвчилсан сэдэвтэй)" : ""}. «${k}» гэж бичсэн хүнд дараах хариу очно:\n\n${kwMsg(topic, info)}\n\nӨөрчлөх бол дахин «түлхүүр ${k} = …» гэж бичнэ.`;
  }
  if (/^түлхүүрүүд$/i.test(text)) { const a = Object.entries(await kwAll()); return a.length ? "🔑 Түлхүүр үгс:\n" + a.map(([k, v]) => `• ${k} = ${v.length > 120 ? v.slice(0, 120) + "…" : v}`).join("\n") : "Түлхүүр үг алга. Нэмэх: «түлхүүр ЯС = Ясны шөлний нунтгийн» эсвэл нарийвчилбал «түлхүүр ЯС = Ясны шөлний нунтгийн | юуг онцлох тайлбар»"; }
  return null;
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
topic: мессежид тодорхой бизнес, бүтээгдэхүүн, машин нэрлэсэн бол тэр бизнесийн нэрийг ХАРЬЯАЛАХ тийн ялгалаар, том үсгээр эхэлж бич (жишээ: «Ясны шөлний нунтгийн», «Лазер зүсэлтийн», «Хадаасны үйлдвэрлэлийн», «Кофе шопын»). «бизнес» гэдэг үгийг бүү нэм. Тодорхой сэдэвгүй бол "".
hot=true: зөвхөн intent бөгөөд тодорхой бизнес, төсөл нэрлэсэн бол (жишээ нь «хадаасны цехийн төсөл хэрэгтэй»).
info бол reply-д асуултад нь 1–2 өгүүлбэрээр ерөнхий, үнэн мэдээлэл өг (тоо, үнэ зохиохгүй, машин зардаггүй), төгсгөлд «Энэ бизнесийг эхлүүлэх төсөл, тооцоо хэрэгтэй бол доорх товчийг дарна уу» гэж нэм. Бусад ангилалд reply хоосон.
Монгол, кирилл, «Та» гэж. Зөвхөн JSON: {"cat":"intent|machine|info|unclear","hot":false,"topic":"","reply":""}`;
const cleanTopic = (x) => String(x || "").replace(/["«»]/g, "").replace(/\s*бизнес(ийн)?\s*$/i, "").trim().slice(0, 60);
async function classify(text) {
  const t = String(text || "").trim();
  if (!t) return { cat: "unclear" };
  if (RX.chit.test(t)) return { cat: "unclear" };
  const hot = /(төсөл|төлөвлөгөө).{0,25}(хэрэгтэй|бичүүл|хийлгэ|хий)|(хэрэгтэй|бичүүл|хийлгэ).{0,25}(төсөл|төлөвлөгөө)/i.test(t) && t.length > 12;
  const rx = RX.strong.test(t) ? "intent" : RX.machine.test(t) ? "machine" : RX.intent.test(t) ? "intent" : "";
  try {
    const o = await callJSON({ system: CLS, user: `Мессеж: ${t.slice(0, 800)}`, model: process.env.LEAD_MODEL || FAST, maxTokens: 400 });
    const cat = rx || (["intent", "machine", "info", "unclear"].includes(o.cat) ? o.cat : "unclear");
    return { cat, hot: cat === "intent" && (hot || !!o.hot), topic: cleanTopic(o.topic), reply: String(o.reply || "").slice(0, 600) };
  } catch (e) { console.warn("[lead] classify:", e.message); return rx ? { cat: rx, hot: rx === "intent" && hot } : { cat: "unclear" }; }
}

// Итгүүлэх (Opus) чат: LEAD_SALES=1 үед л ангилагч «sales=1» өгнө. Үгүй бол зөвхөн ятгах рийлийн (ref=yatgah) хүмүүст.
const SALES_ON = () => process.env.LEAD_SALES === "1";
// «Төсөл бичүүлэх» товч: BIZ_PROJECT — Make-ийн ердийн бизнес төслийн урсгал (эсвэл SALES_ON үед итгүүлэх бот) хүлээж авна
const SVC_BTN = [["📄 Төсөл бичүүлэх", "BIZ_PROJECT"], ["💡 Зүгээр мэдээлэл", "LEAD_INFO"]];
// Рийлийн түлхүүр үгэнд: тухайн бизнесийн товч мэдээлэл (тоо, үнэ зохиохгүй) + төслийн товч. Түлхүүр бүрээр нэг удаа үүсгээд хадгална.
const KWI = `Чи «Менежер AI» Facebook пэйжийн туслах. Пэйж бизнес санааны бичлэг гаргадаг, бичлэгт гарсан машин, бараа ЗАРДАГГҮЙ; бизнес төсөл бэлтгэдэг.
Хүн бичлэг үзээд тухайн бизнесийн нэрийг бичжээ. Тэр бизнесийн талаар 2–3 өгүүлбэрээр ерөнхий, үнэн мэдээлэл өг: юу хийдэг бизнес, хэнд зарагддаг, эхлэхэд юуг анхаарах вэ. Тоо, үнэ, ашгийн хувь, хаанаас авах зэргийг ЗОХИОХГҮЙ, дурдахгүй. Эрүүл мэндэд тустай, эмчилдэг, «сайтай» гэх мэт шалгагдаагүй ашиг тусыг БҮҮ бич (зар сурталчилгааны хуулийн эрсдэлтэй) — зөвхөн бүтээгдэхүүн юу болох, хэн худалдаж авдгийг бич. Энгийн, ойлгомжтой, зөв монгол хэлээр, нэг үгийг давтахгүй, богино өгүүлбэрээр. Кирилл, «Та» гэж. Төгсгөлд нэг өгүүлбэр бүү нэм — товчийг код нэмнэ.
Зөвхөн JSON: {"text":""}`;
// Түлхүүрийн утга: «Сэдэв» эсвэл «Сэдэв | нарийвчилсан чиглэл» (эзний заасан, AI үүнийг баримтална)
function splitKw(v) {
  const s = String(v || ""), i = s.indexOf("|");
  const topic = (i < 0 ? s : s.slice(0, i)).trim().replace(/\s*бизнес(ийн)?$/i, "").slice(0, 80);
  return { topic, detail: i < 0 ? "" : s.slice(i + 1).trim().slice(0, 1500) };
}
const kwInfoMem = new Map();
async function kwInfo(topic, detail = "", fresh = false) {
  const c = await F()._client(), k = `lead:kwinfo:${normKw(topic)}:${require("crypto").createHash("md5").update(detail).digest("hex").slice(0, 8)}`;
  if (!fresh) try { const v = c ? await c.get(k) : kwInfoMem.get(k); if (v) return v; } catch (_) { }
  let t = "";
  const user = `Бизнес: ${topic} бизнес` + (detail ? `\nПэйжийн эзний заасан нарийвчилсан сэдэв, чиглэл (үүнийг баримтал, үүнээс гадуур бүү зохио):\n${detail}` : "");
  try { const o = await callJSON({ system: KWI, user, model: process.env.LEAD_MODEL || FAST, maxTokens: 600 }); t = String(o.text || "").trim().slice(0, 900); } catch (e) { console.warn("[lead] kwinfo:", e.message); }
  if (t) try { if (c) await c.set(k, t); else kwInfoMem.set(k, t); } catch (_) { }
  return t;
}
const kwMsg = (topic, info) => `Сайн байна уу! 👋 ${topic} бизнесийн бичлэгийг үзсэнд баярлалаа.\n\n${info ? info + "\n\n" : ""}Бид бичлэгт гарсан тоног төхөөрөмж, бараа зардаггүй. Харин энэ бизнесийг эхлүүлэх хөрөнгө оруулалт, зардал, ашгийг тооцсон бизнес төслийг бэлтгэж өгдөг. Хэрэгтэй бол доорх товчийг дарна уу.`;
const MACHINE_MSG = "Сайн байна уу! Бид бизнес санааны бичлэгүүдээ хөдөлмөр эрхлэлтийг дэмжих зорилгоор хуваалцдаг бөгөөд бичлэгт гарсан машин, тоног төхөөрөмж зардаггүй 🙏\n\nХарин энэ бизнесийг эхлүүлэх бол хөрөнгө оруулалт, зардал, ашгийг тооцсон бизнес төслийг бэлтгэж өгдөг. Хэрэгтэй бол доорх товчийг дарна уу.";
const INFO_MSG = "Менежер AI бол бизнес төсөл, бизнес төлөвлөгөө, маркетингийн төлөвлөгөө, тайлан бэлтгэдэг үйлчилгээ. Бизнес санааны бичлэгүүдээ хөдөлмөр эрхлэлтийг дэмжих зорилгоор хуваалцдаг, машин, тоног төхөөрөмж зардаггүй.\n\nТөсөл, төлөвлөгөө хэрэгтэй болвол хэзээ ч бичээрэй 🙂";
const ASK_MSG = "Сайн байна уу! 👋 Менежер AI — бизнес төсөл, төлөвлөгөө, тайлан бэлтгэдэг үйлчилгээ.\n\nТанд юу хэрэгтэй вэ?";
const FUND_BTN = [["💰 Өөрийн хөрөнгөөр", "LEAD_F_OWN"], ["🏦 Зээл авна", "LEAD_F_LOAN"], ["🔎 Судалж байна", "LEAD_F_RESEARCH"]];
const ORDER_BTN_ALL = [["✅ Төсөл захиалах", "BIZ_ORDER"], ["❓ Асуулт байна", "LEAD_Q"]];
const orderBtn = () => SALES_ON() ? ORDER_BTN_ALL : [ORDER_BTN_ALL[0]];
const topicQ = (topic, machine) => (machine ? "Сайн байна уу! Бид бичлэгт гарсан машин, тоног төхөөрөмж зардаггүй 🙏 Харин энэ бизнесийг эхлүүлэх төслийг бэлтгэж өгдөг.\n\n" : "Сайн байна уу! ")
  + `${topic} бизнес сонирхож байна уу? 🙂 Та үүнийг өөрийн хөрөнгөөр эхлүүлэх үү, зээл авах уу?`;
const fundOf = (payload, text) => payload === "LEAD_F_LOAN" ? "loan" : payload === "LEAD_F_OWN" ? "own" : payload === "LEAD_F_RESEARCH" ? "research"
  : /(зээл|банк|санхүүжилт|хөрөнгө\s*оруулагч)/i.test(text) ? "loan" : /(өөрийн|өөрөө|хадгаламж|бэлэн\s*мөнгө|хөрөнгөөр)/i.test(text) ? "own" : /(судал|мэдэх|сонирх|бодож|харж)/i.test(text) ? "research" : "other";
function explain(fund, topic) {
  const b = topic ? `${topic} бизнесийн` : "энэ бизнесийн";
  if (fund === "loan") return `Банк зээл олгохдоо хөрөнгө оруулалт, борлуулалт, ашиг, зээлийн эргэн төлөлт бодитой тооцоологдсон эсэхийг төслөөс нь шалгадаг. Бүтэн төсөл ${b} зах зээл, зардал, ашиг, сар бүрийн мөнгөн урсгал, зээлийн эргэн төлөлтийн хуваарийг банкны бүтэцтэйгээр гаргаж өгнө.`;
  if (fund === "research") return `Судалж байх үед хамгийн чухал нь энэ бизнес ашигтай эсэх, хэдий хэмжээний хөрөнгө шаардахыг мөнгө зарахаас өмнө мэдэх. Бүтэн төсөл ${b} зах зээл, өрсөлдөгч, зардал, ашгийг тооцож, эхлэх эсэхээ тоо баримтаар шийдэхэд тусална.`;
  if (fund === "other") return `Бизнес эхлүүлэхэд хамгийн том эрсдэл бол хэдэн төгрөг хэрэгтэй, хэзээ ашигтай ажиллахыг мэдэлгүй эхлэх явдал. Бүтэн төсөл ${b} зах зээл, эхлэлийн зардал, сар бүрийн ашиг, хөрөнгө нөхөгдөх хугацааг тооцож, өөрийн хөрөнгөөр ч, зээлээр ч эхлэхэд тань тоон үндэслэл болно.`;
  return `Өөрийн мөнгөөр эхлэхэд хамгийн том эрсдэл бол хэдэн төгрөг хэрэгтэй, хэзээ өртгөө нөхөхийг мэдэлгүй зарцуулах явдал. Бүтэн төсөл ${b} эхлэлийн зардал, үнэ, сар бүрийн ашиг, хөрөнгө нөхөгдөх хугацааг тооцож, мөнгөө хаана, хэдийг зарцуулахаа төлөвлөхөд тусална.`;
}
const OFFER_MSG = "📄 Бүтэн бизнес төсөл — 149,900₮\n• 50–75 хуудас, PDF + Word + томьёотой Excel\n• Таны өгсөн мэдээллээр, ихэвчлэн 30–90 минутад бэлэн болно\n• 1 удаагийн засвар багтсан\n\nЗахиалах бол доорх товчийг дарна уу.";
// Жишээ хуудсууд: org-v1/samples/sample-1..3.jpg (/guide-samples/N.jpg-ээр нээлттэй). SAMPLE_IMAGES=url,url — өөр зураг; SAMPLE_IMAGES=off — унтраах.
const BASE_URL = () => String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "https://menejer-ai-plan-service.onrender.com").replace(/\/$/, "");
const sampleUrls = (kind) => {
  const v = String(process.env.SAMPLE_IMAGES || "").trim();
  if (v === "off") return [];
  if (kind === "report") return [1, 2, 3].map((n) => `${BASE_URL()}/guide-samples/r${n}.jpg?v=1`);
  if (v) return v.split(",").map((x) => x.trim()).filter(Boolean);
  return [1, 2, 3].map((n) => `${BASE_URL()}/guide-samples/${n}.jpg?v=2`);
};
const REPORT_CAP = "📄 Дээрх нь Менежер AI-ийн бэлтгэсэн тайлангийн жишээ хуудсууд (байгууллага, нэр, тоог далдалсан). Таны өгсөн Excel, баримт, тэмдэглэлээс ийм хүснэгт, графиктай тайлан гарна.";
const SAMPLE_CAP = "📄 Дээрх нь Менежер AI-ийн бэлтгэсэн бизнес төслийн жишээ хуудсууд (тоо, нууц мэдээллийг далдалсан). Таны төсөл ч ийм бүтэц, хүснэгт, графиктай, 50–75 хуудсаар PDF + Word + Excel-ээр гарна.";
async function sendSamples(psid, kind) {
  const urls = sampleUrls(kind); if (!urls.length) return false;
  for (const u of urls.slice(0, 5)) await F()._sendImage(psid, u);
  await F()._send(psid, kind === "report" ? REPORT_CAP : SAMPLE_CAP);
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
  if (psid === ADMIN() && /^түлхүүр/i.test(text)) { const r = await kwAdmin(text); if (r) { await F()._send(psid, r); return { ...base, handled: "1" }; } }
  const L = await getL(psid);
  const yat = String(sales_ref || "") === "yatgah";
  const out = (handled) => ({ sales: (SALES_ON() && L.tag === "intent") || yat ? "1" : "0", handled: handled ? "1" : "0", tag: L.tag || "" });
  const fresh = !state || state === "selecting_type";
  if (!state) await count("new", psid);

  // QR илгээсний дараа ч жишээ зураг асуувал илгээнэ
  if (!payload && text && RX.sample.test(text) && ["", "selecting_type", "awaiting_payment"].includes(state) && text.length < 80) {
    if (await sendSamples(psid, /тайлан/i.test(text) ? "report" : "")) { await setL(psid, L); return out(true); }
  }
  if (!fresh) return out(false);

  // 4-р алхам: санхүүжилтийн хариу → жишээ хуудсууд + 2 өгүүлбэр + захиалах товч
  if (L.stage === "asked_funding" && (/^LEAD_F_/.test(payload) || (!payload && text))) {
    const fund = fundOf(payload, text);
    if (fund !== "other") await count("fund_" + fund, psid);
    L.stage = "offered"; L.fund = fund; L.tag = "intent"; await setL(psid, L);
    await sendSamples(psid).catch((e) => console.warn("[lead] samples:", e.message));
    await F()._send(psid, explain(fund, L.topic));
    await F()._send(psid, OFFER_MSG, orderBtn());
    await count("offer", psid);
    return out(true);
  }
  if (payload === "LEAD_Q") {
    L.tag = "intent"; L.stage = "q"; await setL(psid, L);
    await F()._send(psid, "Асуултаа бичнэ үү 🙂"); return out(true);
  }
  if (/^LEAD_F_/.test(payload)) { L.tag = "intent"; await setL(psid, L); await F()._send(psid, OFFER_MSG, orderBtn()); return out(true); }
  if (payload === "LEAD_SVC" && !SALES_ON()) { // хуучин товч: Make-д чиглэл байхгүй тул ердийн бизнес төслийн товч руу шилжүүлнэ
    await count("btn_svc", psid); await setL(psid, L);
    await F()._send(psid, "Бизнес төслийн дэлгэрэнгүй мэдээлэл, захиалгыг доорх товчоор үзнэ үү 🙂", [SVC_BTN[0]]); return out(true);
  }
  if (payload === "LEAD_SVC" || payload === "BIZ_PROJECT") {
    if (L.tag !== "intent") { L.tag = "intent"; if (payload === "LEAD_SVC") await count("btn_svc", psid); await count("cat_intent", psid); }
    await setL(psid, L); return out(false);
  }
  if (payload === "LEAD_INFO") {
    await count("btn_info", psid); if (L.tag !== "intent") L.tag = "info";
    await setL(psid, L); await F()._send(psid, INFO_MSG); return out(true);
  }
  if (payload || !text || L.tag === "intent" || yat) { await setL(psid, L); return out(false); }

  const askTopic = async (topic, machine) => {
    L.stage = "asked_funding"; L.topic = topic; await count("topic_q", psid);
    await setL(psid, L); await F()._send(psid, topicQ(topic, machine), FUND_BTN); return out(true);
  };
  const kw = await kwMatch(text);
  if (kw) {
    const { topic, detail } = splitKw(kw);
    await count("kw", psid); L.tag = "info"; L.topic = topic; await setL(psid, L);
    await F()._send(psid, kwMsg(topic, await kwInfo(topic, detail)), [SVC_BTN[0]]); return out(true);
  }

  const c = await classify(text);
  if (c.cat === "intent" && c.topic) {
    L.tag = "intent"; await count("cat_intent", psid);
    if (c.hot) await notifyHot(psid, text, L);
    return askTopic(c.topic, false);
  }
  if (c.cat === "machine" && c.topic) { await count("cat_machine", psid); L.tag = "intent"; return askTopic(c.topic, true); }
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

router.get("/guide-samples/:n.jpg", (req, res) => {
  const m = String(req.params.n).match(/^(r?)([123])$/); if (!m) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=86400").sendFile(require("path").join(__dirname, "samples", `${m[1] ? "report" : "sample"}-${m[2]}.jpg`));
});
router.post("/lead/classify", express.json(), auth, async (req, res) => {
  try { res.json(await handle(req.body || {})); }
  catch (e) { console.warn("[lead]", e.message); res.json({ sales: "", handled: "0", tag: "" }); }
});
module.exports = router;
module.exports.handleLead = handle; // «handle» нэр нь express router-ийн дотоод функцтэй давхцдаг тул өөр нэр
module.exports.count = count;
module.exports.classify = classify;
module.exports.reportText = reportText;
module.exports.enabled = enabled;
module.exports._weekKey = weekKey;
