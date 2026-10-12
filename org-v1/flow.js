// Messenger-ийн "бусад үйлчилгээ" (маркетинг, жилийн төлөвлөгөө, тайлан, багц)-ний яриаг СЕРВЕР удирдана.
// Make зөвхөн мессежийг дамжуулна:  POST /flow/message {psid, text, payload, attachments, state} → {state}
//   буцаах state-ийг Make өгөгдлийн санд (146964) хадгална: "ext" бол дараагийн мессежийг дахин энд дамжуулна, "selecting_type" бол үндсэн цэс рүү буцна.
// Админ төлбөр баталгаажуулах: POST /flow/admin {payload:"PAYOK|<psid>" | "PAYNO|<psid>"}
// Бизнес төслийн урсгал (plan-v2, Make-ийн хуучин салбарууд)-д огт хүрэхгүй.
const express = require("express");
const { callJSON, FAST, WRITER } = require("../plan-v2/claude");
const { fbText } = require("../plan-v2/util");
const { PRODUCTS, fmtMoney, priceFor } = require("./quote");
const PER = require("./period");
const REV = require("./revise");
const QP = require("./qpay");
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
const MENU = [["Бизнес төсөл", "BIZ_PROJECT"], ["Маркетинг", "MKT_PLAN"], ["Тайлан, төлөвлөгөө", "ORG_REPORT"]];
// Тайлан, төлөвлөгөөний цэс 2 алхамтай: эхлээд хэлтэс/байгууллага, дараа нь тайлан/төлөвлөгөө/багц
const GROUP_BTN = [["1. Хэлтэс", "FLOW_G_dept"], ["2. Байгууллага", "FLOW_G_org"], ["Цуцлах", "FLOW_CANCEL"]];
const DEPT_BTN = [["1. Тайлан", "FLOW_P_report_dept"], ["2. Төлөвлөгөө", "FLOW_P_plan_dept"], ["3. Багц", "FLOW_P_bundle_dept"], ["Цуцлах", "FLOW_CANCEL"]];
const ORG_BTN = [["1. Тайлан", "FLOW_P_report_dir"], ["2. Төлөвлөгөө", "FLOW_P_plan"], ["3. Багц", "FLOW_P_bundle"], ["Цуцлах", "FLOW_CANCEL"]];
// Хугацааны сонголт: эхлээд төрөл (жил, хагас жил, улирал, сар), дараа нь аль нь
const PER_BTN = [["1. Жил", "FLOW_T_year"], ["2. Хагас жил", "FLOW_T_half"], ["3. Улирал", "FLOW_T_quarter"], ["4. Сар", "FLOW_T_month"], ["Цуцлах", "FLOW_CANCEL"]];
const SUB_BTN = {
  half: [["1-р хагас (1–6 сар)", "FLOW_N_1"], ["2-р хагас (7–12 сар)", "FLOW_N_2"], ["Цуцлах", "FLOW_CANCEL"]],
  quarter: [...PER.ROMAN.map((r, i) => [`${r} улирал`, `FLOW_N_${i + 1}`]), ["Цуцлах", "FLOW_CANCEL"]],
  month: [...Array.from({ length: 12 }, (_, i) => [`${i + 1}-р сар`, `FLOW_N_${i + 1}`]), ["Цуцлах", "FLOW_CANCEL"]],
};
const PICK = { group: ["G:dept", "G:org"], dept: ["report_dept", "plan_dept", "bundle_dept"], org: ["report_dir", "plan", "bundle"],
  per: ["T:year", "T:half", "T:quarter", "T:month"], per_half: ["N:1", "N:2"], per_quarter: ["N:1", "N:2", "N:3", "N:4"], per_month: Array.from({ length: 12 }, (_, i) => `N:${i + 1}`) };
const BTN = { group: GROUP_BTN, dept: DEPT_BTN, org: ORG_BTN, per: PER_BTN, per_half: SUB_BTN.half, per_quarter: SUB_BTN.quarter, per_month: SUB_BTN.month };
const NUMHINT = "Товч дарах эсвэл дугаарыг нь (1, 2, 3) бичээд илгээж болно.";
const toMenu = async (psid, text = "Танд өөр ямар үйлчилгээ хэрэгтэй вэ? Доорх товчноос сонгоно уу.") => { await send(psid, `${text}\n\n👉 Товчнуудыг хажуу тийш гүйлгэвэл бүгд харагдана.`, MENU); return "selecting_type"; };

const from = (p) => fmtMoney(priceFor(p, 5).price);
async function showMenu(psid, menu) {
  const T = {
    group: `📑 Тайлан, төлөвлөгөө — таны материалаас тоо зохиохгүйгээр бэлтгэнэ (Word, PDF, Excel).\n\nХэнд зориулсан бэ?\n\n1️⃣ Хэлтэс, албан тушаал — нэг хэлтсийн ажлын тайлан, ажлын төлөвлөгөө (${from("report_dept")}-өөс).\n\n2️⃣ Байгууллага бүхэлдээ — гүйцэтгэх захирлын ТУЗ-д тавих тайлан, байгууллагын төлөвлөгөө, төсөв (${from("report_dir")}-өөс).\n\nХугацааг (жил, хагас жил, улирал, сар) дараа нь сонгоно.\n\nТовч дарах эсвэл дугаарыг нь (1 эсвэл 2) бичээд илгээж болно.`,
    dept: `🗂 Хэлтэс, албан тушаал:\n\n1️⃣ Ажлын тайлан — хийсэн ажил, KPI, бэрхшээл, дараагийн хугацааны санал (10–20 хуудас). Удирдлагад тавина.\n${tiers("report_dept")}\n\n2️⃣ Ажлын төлөвлөгөө — зорилт, KPI, ажлууд, хуваарь, нөөц; Excel KPI хяналттай.\n${tiers("plan_dept")}\n\n3️⃣ Багц: тайлан + төлөвлөгөө (хямдралтай)\n${tiers("bundle_dept")}\n\n${NUMHINT}`,
    org: `🏢 Байгууллага бүхэлдээ:\n\n1️⃣ Гүйцэтгэх захирлын (ТУЗ-д) тайлан — санхүүгийн үр дүн, ТУЗ-ийн шийдвэрийн биелэлт, бүх хэлтсийн нэгтгэл, төсөл, эрсдэл, ТУЗ-өөр шийдүүлэх асуудал (20–35 хуудас).\n${tiers("report_dir")}\n\n2️⃣ Үйл ажиллагааны төлөвлөгөө, төсөв — 60–80 хуудас Word, PDF, томьёотой Excel төсөв.\n${tiers("plan")}\n\n3️⃣ Багц: захирлын тайлан + төлөвлөгөө (хямдралтай)\n${tiers("bundle")}\n\n${NUMHINT}`,
  };
  if (!T[menu]) menu = "group";
  await setF(psid, { s: "choose", menu }); await send(psid, T[menu], BTN[menu]); return "ext";
}
const kindOf = (product) => (PRODUCTS[product] && PRODUCTS[product].parts ? "bundle" : /^plan/.test(product) ? "plan" : "report");
async function askPeriod(psid, product) {
  const k = kindOf(product);
  const q = k === "plan" ? "📅 Төлөвлөгөө ямар хугацаанд зориулагдсан бэ?" : k === "bundle" ? "📅 Тайлангийн хугацааг сонгоно уу. Төлөвлөгөө нь дараагийн ижил хугацаанд гарна (жишээ нь III улирлын тайлан → IV улирлын төлөвлөгөө, жилийн тайлан → ирэх жилийн төлөвлөгөө)." : "📅 Тайлан ямар хугацааных вэ?";
  await setF(psid, { s: "choose", menu: "per", product });
  await send(psid, `${NAMES[product]}\n\n${q}\n\n1️⃣ Жил\n2️⃣ Хагас жил\n3️⃣ Улирал\n4️⃣ Сар\n\nТовч дарах эсвэл дугаарыг нь (1–4) бичээд илгээж болно.`, PER_BTN); return "ext";
}
async function pickType(psid, f, type) {
  if (type === "year") { f.period = { type: "year" }; f.periodYear = undefined; await startOrg(psid, f, f.product); await setF(psid, f); return "ext"; }
  if (!SUB_BTN[type]) return askPeriod(psid, f.product);
  const q = { half: "Аль хагас жил вэ?", quarter: "Аль улирал вэ?", month: "Аль сар вэ?" }[type];
  const hint = { half: "1 эсвэл 2", quarter: "1–4", month: "1–12" }[type];
  await setF(psid, { s: "choose", menu: "per_" + type, product: f.product, ptype: type });
  await send(psid, `📅 ${q}\n\nТовч дарах эсвэл дугаарыг нь (${hint}) бичээд илгээж болно.`, SUB_BTN[type]); return "ext";
}
async function pickN(psid, f, n) {
  const p = { type: f.ptype, n };
  if (!PER.valid(p)) return pickType(psid, f, f.ptype);
  f.period = PER.clean(p); f.periodYear = kindOf(f.product) === "plan" ? PER.planYear(f.period) : undefined; await startOrg(psid, f, f.product); await setF(psid, f); return "ext";
}
// Messenger-т харуулах хугацаа
function periodLine(product, period) {
  const p = PER.clean(period); if (!p) return "";
  const k = kindOf(product);
  if (p.type === "year") return k === "plan" ? "📅 Хугацаа: жилийн төлөвлөгөө" : k === "bundle" ? "📅 Хугацаа: жилийн тайлан + ирэх жилийн төлөвлөгөө" : "📅 Хугацаа: жилийн тайлан";
  if (k === "plan") return `📅 Хугацаа: ${PER.make(p, PER.planYear(p)).full}`; // pickN-д хадгалсан онтой ижил
  const nx = PER.next(p, 2000);
  return k === "bundle" ? `📅 Хугацаа: ${PER.names(p).gen} тайлан + ${PER.names(nx).gen} төлөвлөгөө (он нь материалаас тогтоогдоно)` : `📅 Хугацаа: ${PER.names(p).label} (он нь материалаас тогтоогдоно)`;
}
// ---- Засвар ----
const REV_DAYS = 30, REV_BTN = [["✏️ Засвар хийлгэх", "FLOW_REV"], ["Үндсэн цэс", "FLOW_MENU"]];
const partName = (p) => (/^report/.test(p) ? "Тайлан" : "Төлөвлөгөө");
async function revAllowed(psid) {
  const last = await REV.getLast(psid);
  if (!last || !last.parts || Date.now() - (last.at || 0) > REV_DAYS * 86400e3) return null;
  return last;
}
// Ажил дууссаны дараа (index.js): засварын эрхийг бүртгэж, засвар хийлгэх товч илгээнэ
async function onDone(job) {
  const psid = job.psid; if (!psid) return;
  let last = await REV.getLast(psid);
  if (job.revision) {
    if (!last || !last.allow) last = { product: job.product, parts: [job.product], allow: { [job.product]: 1 }, at: Date.now() };
    last.allow[job.product] = Math.max(0, (last.allow[job.product] ?? 1) - 1); last.at = Date.now();
  } else {
    const parts = (PRODUCTS[job.product] && PRODUCTS[job.product].parts) || [job.product];
    last = { product: job.product, parts, allow: Object.fromEntries(parts.map((x) => [x, 1])), at: Date.now() };
  }
  await REV.setLast(psid, last);
  const f = (await getF(psid)) || {};
  if (f.s === "processing") await setF(psid, { s: "done" });
  const left = last.parts.filter((x) => last.allow[x] > 0);
  const txt = left.length && left.length < last.parts.length ? `✏️ Дахин засвар хэрэгтэй бол доорх товчийг дарна уу. Үнэгүй засвартай: ${left.map((x) => NAMES[x]).join(", ")}. Бусад нь нэмэлт засвар (${fmtMoney(REV.REV_PRICE[last.parts.find((x) => !left.includes(x))] || 29900)}).`
    : left.length ? `✏️ Засвар хэрэгтэй бол доорх товчийг дарна уу. ${last.parts.length > 1 ? "Баримт бүрд" : "Танд"} 1 удаа үнэгүй засвар хийх эрхтэй (${REV_DAYS} хоногийн дотор).`
    : `✏️ Дахин засвар хэрэгтэй бол доорх товчийг дарна уу (нэмэлт засвар ${fmtMoney(REV.REV_PRICE[last.parts[0]] || 29900)}).`;
  await send(psid, txt, REV_BTN);
}
async function onRevReject(job, msg) {
  const psid = job.psid; if (!psid) return;
  await setF(psid, { s: "done" });
  await send(psid, `${msg}\n\nЗасварын эрх тань хасагдаагүй. Засвар хийлгэх бол доорх товчийг дараад юуг өөрчлөхөө тодорхой бичнэ үү. Жишээ нь: "3.1-р хэсэгт сургалтын ажлыг нэм", "Борлуулалтын 5-р сарын дүн 12 сая байх ёстой".`, REV_BTN);
}
async function revStart(psid, part) {
  const last = await revAllowed(psid);
  if (!last || !last.parts.includes(part)) { await setF(psid, { s: "left" }); return toMenu(psid, "Засвар хийх боломжтой захиалга олдсонгүй (засварыг хүргэснээс хойш 30 хоногийн дотор хийнэ)."); }
  if ((last.allow[part] || 0) > 0) {
    await setF(psid, { s: "rev_request", part, product: part });
    await send(psid, `✏️ «${NAMES[part]}»-д ямар засвар хийлгэх вэ?\n\nНэг мессежинд дэлгэрэнгүй бичнэ үү: аль хэсгийг (жишээ нь 3.1) юу болгож өөрчлөх, ямар тоо буруу, зөв нь хэд, юу нэмэх, хасах. Засвар нь энэ баримтын хүрээнд хийгдэнэ.`, [["Цуцлах", "FLOW_CANCEL"]]);
    return "ext";
  }
  const price = REV.REV_PRICE[part] || 29900, pi = payInfo();
  const rf = { s: "awaiting_payment", rev: { part }, product: part, price };
  await setF(psid, rf);
  if (await offerQpay(psid, rf, `Нэмэлт засвар — ${NAMES[part]}`, `Энэ баримтын үнэгүй засварын эрх ашиглагдсан байна.\n✏️ Нэмэлт засвар: ${fmtMoney(price)}`)) return "ext";
  await send(psid, `Энэ баримтын үнэгүй засварын эрх ашиглагдсан байна.\n\n✏️ Нэмэлт засвар: ${fmtMoney(price)}\n\n${pi ? pi + "\n\n" : ""}Гүйлгээний утга дээр утасны дугаар + засвар гэж бичнэ үү. Төлбөр шилжүүлсний дараа баримтын зургийг энд илгээнэ үү. Баталгаажмагц засварын хүсэлтээ бичнэ.`, [["Цуцлах", "FLOW_CANCEL"]]);
  if (!pi && ADMIN()) await send(ADMIN(), `⚠️ PAY_INFO тохируулаагүй — ${psid}-д дансны мэдээллийг гараар илгээнэ үү.`);
  return "ext";
}
async function revMenu(psid) {
  const last = await revAllowed(psid);
  if (!last) { await setF(psid, { s: "left" }); return toMenu(psid, "Засвар хийх боломжтой захиалга олдсонгүй (засварыг хүргэснээс хойш 30 хоногийн дотор хийнэ)."); }
  if (last.parts.length === 1) return revStart(psid, last.parts[0]);
  await setF(psid, { s: "choose", menu: "revp", parts: last.parts });
  await send(psid, `Аль баримтад засвар хийлгэх вэ?\n\n${last.parts.map((x, i) => `${i + 1}️⃣ ${NAMES[x]}${(last.allow[x] || 0) > 0 ? " (үнэгүй засвартай)" : ""}`).join("\n")}`,
    [...last.parts.map((x, i) => [`${i + 1}. ${partName(x)}`, `FLOW_REVP_${x}`]), ["Цуцлах", "FLOW_CANCEL"]]);
  return "ext";
}
async function startRevJob(psid, f, text) {
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`, headers = { "Content-Type": "application/json", "x-api-key": process.env.API_KEY || "" };
  const r = await fetch(base + "/org/jobs", { method: "POST", headers, body: JSON.stringify({ psid, product: f.part, revision: text }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  await setF(psid, { s: "processing", job: j.job_id, jobKind: "org", product: f.part, rev: { part: f.part }, startedAt: Date.now() });
}

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
  await M.setMeta(psid, { product, period: PER.clean(f.period) || null }).catch(() => { });
  const url = `${process.env.PUBLIC_URL || "https://menejer-ai-plan-service.onrender.com"}/u/org/${tokenFor(psid, product)}`;
  Object.assign(f, { s: "uploading", product, url, price: null });
  const extra = product === "bundle_dept" ? `\nТусад нь авахаас ${fmtMoney(priceFor("bundle_dept", 5).saving)}-өөс дээш хямд. Нэг материалаар эхлээд ажлын тайлан, дараа нь дараагийн хугацааны ажлын төлөвлөгөө гарна.` : product === "bundle" ? `\nТусад нь авахаас ${fmtMoney(priceFor("bundle", 5).saving)}-өөс дээш хямд. Нэг материалаар эхлээд захирлын тайлан, дараа нь дараагийн хугацааны төлөвлөгөө гарна.` : "";
  const what = product === "plan_dept" ? "Өмнөх хугацааны ажлын төлөвлөгөө, тайлан, гүйцэтгэлийн хүснэгт (KPI), хэлтсийн чиг үүрэг, удирдлагаас өгсөн чиглэл зэрэг материалаа илгээнэ үү." : product === "plan" ? "Өмнөх үеийн төлөвлөгөө, тайлан, орлого зарлагын задаргаа, орон тоо, цалингийн мэдээлэл зэрэг байгаа материалаа илгээнэ үү (бүгд заавал биш)." : "Тайлангийн хугацаанд хийсэн ажлаа харуулах материалаа (төлөвлөгөө, сарын тайлан, Excel хүснэгт, KPI, хурлын тэмдэглэл, санхүүгийн тайлан г.м.) илгээнэ үү.";
  const pl = periodLine(product, f.period);
  await send(psid, `📋 ${NAMES[product]}${pl ? "\n" + pl : ""}\n\nҮнэ нь таны илгээх материалын хэмжээгээр бодогдоно:\n${tiers(product)}${extra}\n\n${what} Материалын агуулгыг төлбөр баталгаажсаны дараа л уншина.\n\n👉 Материал илгээх холбоос:\n${url}\n\nБүх файлаа илгээгээд хуудасны доод талын «Дууслаа» товчийг дарвал үнийн санал энд ирнэ.`, [["Цуцлах", "FLOW_CANCEL"]]);
}

// upload.js-ийн «Дууслаа» → үнийн санал гарсны дараа дуудагдана
async function onQuote(psid, product, quote) {
  const f = (await getF(psid)) || {};
  Object.assign(f, { s: "awaiting_payment", product, price: quote.price, units: quote.units });
  await setF(psid, f);
  const pi = payInfo();
  if (await offerQpay(psid, f, NAMES[product] || "Менежер AI")) return;
  await send(psid, `💳 Төлбөр: ${fmtMoney(quote.price)}\n\n${pi ? pi + "\n\n" : ""}Гүйлгээний утга дээр утасны дугаараа бичнэ үү. Төлбөр шилжүүлсний дараа гүйлгээний баримтын зургийг (screenshot) энд илгээнэ үү. Баталгаажмагц боловсруулж эхэлнэ.${pi ? "" : "\n\nДансны мэдээллийг манай ажилтан удахгүй илгээнэ."}`, [["Материал нэмэх", "FLOW_MORE"], ["Цуцлах", "FLOW_CANCEL"]]);
  if (!pi && ADMIN()) await send(ADMIN(), `⚠️ PAY_INFO (дансны мэдээлэл) тохируулаагүй тул ${psid}-д дансны мэдээллийг гараар илгээнэ үү. Render → Environment-д PAY_INFO нэмнэ үү.`);
}

// ---- QPay: нэхэмжлэх (QR + банкны апп-ын холбоос) илгээх. QPay тохируулаагүй эсвэл алдаа гарвал false → хуучин (дансаар) урсгал ----
async function offerQpay(psid, f, desc, head) {
  if (!QP.allowedFor(psid) || !(f.price > 0)) return false;
  try {
    if (f.qpay && f.qpay.no) await QP.cancelInvoice(f.qpay.no).catch(() => { });
    const inv = await QP.createInvoice({ psid, amount: f.price, description: `Менежер AI: ${desc}`, kind: "flow" });
    f.qpay = { no: inv.no, amount: inv.amount, short: inv.short || null }; await setF(psid, f);
    if (inv.qrUrl) await sendImage(psid, inv.qrUrl);
    await send(psid, `${head ? head + "\n\n" : ""}💳 Төлбөр: ${fmtMoney(inv.amount)}\n\n📲 QPay-ээр төлөх: утсаараа доорх холбоосыг нээгээд банкны аппаа сонгоно уу (эсвэл дээрх QR кодыг уншуулна):\n${inv.short || ""}\n\nТөлбөр орж ирмэгц автоматаар баталгаажиж, боловсруулалт эхэлнэ.`,
      [["✅ Төлсөн, шалгах", "FLOW_QPCHECK"], ...(f.url ? [["Материал нэмэх", "FLOW_MORE"]] : []), ["Цуцлах", "FLOW_CANCEL"]]);
    return true;
  } catch (e) {
    console.warn("[flow] QPay нэхэмжлэх:", e.message);
    if (ADMIN()) await send(ADMIN(), `⚠️ QPay нэхэмжлэх үүсгэж чадсангүй (${psid}): ${String(e.message).slice(0, 200)}. Захиалагчид дансны мэдээлэл илгээгдлээ.`);
    return false;
  }
}
const qpWait = new Map(); // захиалагч «Шалгах»-ыг хэт олон дарахаас сэргийлнэ (15 сек)
async function qpCheck(psid, f) {
  const last = qpWait.get(psid) || 0;
  if (Date.now() - last < 15000) { await send(psid, "Түр хүлээгээд дахин шалгана уу ⏳"); return "ext"; }
  qpWait.set(psid, Date.now());
  let r; try { r = await QP.settle(f.qpay.no, "check"); } catch (e) { console.warn("[flow] QPay шалгах:", e.message); r = "error"; }
  if (r === "paid" || r === "done") return "ext"; // баталгаажуулах мессежийг handler илгээнэ
  if (r === "busy") { await send(psid, "Төлбөрийг шалгаж байна ⏳"); return "ext"; }
  await send(psid, r === "error" ? "Төлбөр шалгахад түр саатал гарлаа. Хэдэн минутын дараа дахин шалгана уу." : `Төлбөр хараахан орж ирээгүй байна. QPay-ээр төлсний дараа «Төлсөн, шалгах» товчийг дахин дарна уу.${f.qpay.short ? "\n\nТөлөх холбоос:\n" + f.qpay.short : ""}`,
    [["✅ Төлсөн, шалгах", "FLOW_QPCHECK"], ...(f.url ? [["Материал нэмэх", "FLOW_MORE"]] : []), ["Цуцлах", "FLOW_CANCEL"]]);
  return "ext";
}

async function askPayment(psid, f) {
  f.s = "awaiting_payment"; f.price = f.product === "marketing" ? MKT_PRICE : f.price;
  const pi = payInfo();
  if (await offerQpay(psid, f, NAMES[f.product] || "Менежер AI")) return;
  await send(psid, `💳 Төлбөр: ${fmtMoney(f.price)}\n\n${pi ? pi + "\n\n" : ""}Гүйлгээний утга дээр утасны дугаараа бичнэ үү. Төлбөр шилжүүлсний дараа гүйлгээний баримтын зургийг (screenshot) энд илгээнэ үү.${pi ? "" : "\n\nДансны мэдээллийг манай ажилтан удахгүй илгээнэ."}`, [["Цуцлах", "FLOW_CANCEL"]]);
  if (!pi && ADMIN()) await send(ADMIN(), `⚠️ PAY_INFO тохируулаагүй — ${psid}-д дансны мэдээллийг гараар илгээнэ үү.`);
}

async function startJob(psid, f) {
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`, headers = { "Content-Type": "application/json", "x-api-key": process.env.API_KEY || "" };
  const mkt = f.product === "marketing";
  const body = mkt ? { psid, conversation: (f.conv || []).map((m) => `${m.role}: ${m.text}`).join("\n") } : { psid, product: f.product, period: PER.clean(f.period) || undefined, periodYear: f.periodYear || undefined, conversation: (f.conv || []).map((m) => `${m.role}: ${m.text}`).join("\n") };
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
  if ((["MKT_PLAN", "ORG_PLAN", "ORG_REPORT"].includes(payload) || payload === "FLOW_G_dept" || payload === "FLOW_G_org") && f.s !== "processing" && f.s !== "payment_review") {
    if (payload === "MKT_PLAN") {
      f = { s: "mkt_interview", product: "marketing", conv: [] };
      const hello = `📣 Маркетингийн төлөвлөгөө — ${fmtMoney(MKT_PRICE)}\n\n40–75 хуудас, алхам алхмаар хэрэгжүүлэх хөтөч: зах зээл, өрсөлдөгчийн шинжилгээ, маркетингийн стратеги, зарын бэлэн текст, 30 хоногийн контент календарь, сар бүрийн төсөв, үр дүнгийн тооцоо (PDF, Word, Excel).\n\nЭхлээд хэдэн асуулт асууя. Юуг сурталчлах вэ — бүтээгдэхүүн/үйлчилгээ, байгууллага эсвэл өөрийгөө (хувийн брэнд)? Нэр, юу санал болгодгоо товч бичнэ үү.`;
      f.conv.push({ role: "Менежер AI", text: hello });
      await setF(psid, f); await send(psid, hello, [["Цуцлах", "FLOW_CANCEL"]]); return "ext";
    }
    if (payload === "ORG_PLAN" || payload === "ORG_REPORT") return showMenu(psid, "group");
    if (payload.startsWith("FLOW_G_")) return showMenu(psid, payload.slice(7));
  }
  if (payload === "FLOW_MENU") { await setF(psid, { s: "left" }); return toMenu(psid); }
  if ((payload === "FLOW_REV" || payload.startsWith("FLOW_REVP_")) && !["processing", "payment_review"].includes(f.s)) return payload === "FLOW_REV" ? revMenu(psid) : revStart(psid, payload.slice(10));
  if (payload === "FLOW_CANCEL" || (CANCEL.test(text) && !["processing", "payment_review"].includes(f.s))) { const hadQr = !!(f.qpay && f.qpay.no && f.s === "awaiting_payment"); if (hadQr) await QP.cancelInvoice(f.qpay.no).catch(() => { }); await setF(psid, { s: "left" }); return toMenu(psid, hadQr ? `Цуцаллаа.\n\n${QP_VOID.replace(" Дахин захиалах бол доорх товчийг дарна уу.", "")}\n\nӨөр үйлчилгээ хэрэгтэй бол доорх товчноос сонгоно уу.` : "Цуцаллаа. Өөр үйлчилгээ хэрэгтэй бол доорх товчноос сонгоно уу."); }
  if (payload.startsWith("FLOW_P_") && PRODUCTS[payload.slice(7)]) return askPeriod(psid, payload.slice(7));
  if (payload.startsWith("FLOW_T_") && f.s === "choose" && f.product) return pickType(psid, f, payload.slice(7));
  if (payload.startsWith("FLOW_N_") && f.s === "choose" && f.product && f.ptype) return pickN(psid, f, Number(payload.slice(7)));

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
      if (payload === "FLOW_QPCHECK" && f.qpay) return qpCheck(psid, f);
      if (payload === "FLOW_MORE" && f.url) { f.s = "uploading"; await setF(psid, f); await send(psid, `Нэмэлт материалаа энэ холбоосоор илгээгээд «Дууслаа» дарна уу, үнэ дахин бодогдоно:\n${f.url}`); return "ext"; }
      const img = atts.find(isImage);
      if (img) {
        f.s = "payment_review"; f.receipt = img.payload && img.payload.url; await setF(psid, f);
        await send(psid, "Баярлалаа! Төлбөрийн баримтыг хүлээн авлаа ✅ Шалгаад баталгаажмагц боловсруулж эхэлнэ.");
        if (ADMIN()) { await sendImage(ADMIN(), f.receipt);
          await send(ADMIN(), `💳 Төлбөрийн баримт ирлээ\nҮйлчилгээ: ${f.rev ? "✏️ Нэмэлт засвар — " : ""}${NAMES[f.product]}${PER.clean(f.period) ? ` (${PER.shortText(f.period)})` : ""}\nДүн: ${fmtMoney(f.price || 0)}${f.units ? ` (${f.units} хуудас)` : ""}\nЗахиалагч: ${psid}\n\nДанс руугаа орж шалгаад сонгоно уу.`, [["✅ Батлах", `PAYOK|${psid}`], ["❌ Татгалзах", `PAYNO|${psid}`]]); }
        return "ext";
      }
      if (atts.length) { await send(psid, "Төлбөрийн баримтыг зураг (screenshot) хэлбэрээр илгээнэ үү."); return "ext"; }
      if (f.qpay) { await send(psid, `Төлбөр ${fmtMoney(f.price || 0)}. QPay-ээр төлөх холбоос:\n${f.qpay.short || ""}\n\nТөлсний дараа «Төлсөн, шалгах» товчийг дарна уу.`, [["✅ Төлсөн, шалгах", "FLOW_QPCHECK"], ...(f.url ? [["Материал нэмэх", "FLOW_MORE"]] : []), ["Цуцлах", "FLOW_CANCEL"]]); return "ext"; }
      await send(psid, `Төлбөр ${fmtMoney(f.price || 0)}. Шилжүүлсний дараа гүйлгээний баримтын зургийг энд илгээнэ үү.${payInfo() ? "\n\n" + payInfo() : ""}`, f.url ? [["Материал нэмэх", "FLOW_MORE"], ["Цуцлах", "FLOW_CANCEL"]] : [["Цуцлах", "FLOW_CANCEL"]]); return "ext";
    }
    case "rev_request": {
      if (atts.length && !text) { await send(psid, "Засварын хүсэлтээ текстээр бичнэ үү 🙏 (зураг, файлыг энэ шатанд уншихгүй).", [["Цуцлах", "FLOW_CANCEL"]]); return "ext"; }
      if (text.length < 8) { await send(psid, "Юуг өөрчлөхөө арай дэлгэрэнгүй бичнэ үү (аль хэсэг, юу болгох).", [["Цуцлах", "FLOW_CANCEL"]]); return "ext"; }
      try { await startRevJob(psid, f, text); }
      catch (e) { await send(psid, "Засвар эхлүүлэхэд түр саатал гарлаа. Манай ажилтан тантай холбогдоно."); if (ADMIN()) await send(ADMIN(), `⚠️ ${psid}: засвар эхлүүлж чадсангүй — ${e.message}`); await setF(psid, { s: "done" }); }
      return "ext";
    }
    case "done":
      await setF(psid, { s: "left" }); return toMenu(psid);
    case "payment_review":
      if (payload === "FLOW_QPCHECK" && f.qpay) return qpCheck(psid, f);
      await send(psid, "Таны төлбөрийг шалгаж байна. Баталгаажмагц мэдэгдэнэ 🙏"); return "ext";
    case "processing": {
      const st = await jobStatus(f);
      if (st === "done" || st === "gone" || st === "failed" || st === "blocked" || st === "revision_rejected") { await setF(psid, { s: "left" }); return toMenu(psid, st === "done" || st === "gone" ? "Таны захиалга бэлэн болж, файлууд дээр илгээгдсэн байгаа 📄 Өөр үйлчилгээ хэрэгтэй бол доорх товчноос сонгоно уу." : "Танай захиалгын талаар манай ажилтан тантай холбогдоно. Өөр үйлчилгээ хэрэгтэй бол доорх товчноос сонгоно уу."); }
      await send(psid, "Таны захиалгыг боловсруулж байна ⏳ Бэлэн болмогц файлаар илгээнэ. Материалын хэмжээнээс хамаарч 30–90 минут болно."); return "ext";
    }
    case "choose": {
      const R = { i: 1, ii: 2, iii: 3, iv: 4 };
      const mm = text.match(/^\s*(\d{1,2}|iv|iii|ii|i)\s*([.)]|-?р)?\s*(сар|улирал|хагас(\s*жил)?)?\s*$/i);
      const n = mm ? (R[mm[1].toLowerCase()] || Number(mm[1])) : null;
      const pick = n && PICK[f.menu] && PICK[f.menu][n - 1];
      if (pick && pick.startsWith("G:")) return showMenu(psid, pick.slice(2));
      if (pick && pick.startsWith("T:") && f.product) return pickType(psid, f, pick.slice(2));
      if (pick && pick.startsWith("N:") && f.product && f.ptype) return pickN(psid, f, Number(pick.slice(2)));
      if (f.menu === "revp" && Array.isArray(f.parts) && n && f.parts[n - 1]) return revStart(psid, f.parts[n - 1]);
      if (f.menu === "revp") { await send(psid, "Доорх товчноос сонгоно уу.", [...f.parts.map((x, i) => [`${i + 1}. ${partName(x)}`, `FLOW_REVP_${x}`]), ["Цуцлах", "FLOW_CANCEL"]]); return "ext"; }
      if (pick && PRODUCTS[pick]) return askPeriod(psid, pick);
      if (!PICK[f.menu] || (/^per/.test(f.menu) && !f.product)) return showMenu(psid, "group");
      await send(psid, `Доорх товчноос сонгох эсвэл дугаарыг нь бичээд илгээнэ үү.`, BTN[f.menu]); return "ext"; }
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
  return approve(psid, f, "admin");
}

// Төлбөр баталгаажсан: админ «Батлах» дарсан эсвэл QPay төлбөр орж ирсэн
async function approve(psid, f, via) {
  const tag = via === "qpay" ? `💳 QPay төлбөр орлоо ${fmtMoney((f.qpay && f.qpay.amount) || f.price || 0)} — ` : "";
  if (via === "admin" && f.qpay && f.qpay.no) await QP.cancelInvoice(f.qpay.no).catch(() => { }); // давхар төлөхөөс сэргийлнэ
  if (f.rev) {
    const last = (await REV.getLast(psid)) || { product: f.rev.part, parts: [f.rev.part], allow: {}, at: Date.now() };
    last.allow = last.allow || {}; last.allow[f.rev.part] = (last.allow[f.rev.part] || 0) + 1; last.at = Date.now(); await REV.setLast(psid, last);
    await setF(psid, { s: "rev_request", part: f.rev.part, product: f.rev.part });
    await send(psid, `${via === "qpay" ? "QPay төлбөр амжилттай орлоо. " : ""}Нэмэлт засварын төлбөр баталгаажлаа ✅\n\nЯмар засвар хийлгэхээ нэг мессежинд дэлгэрэнгүй бичнэ үү: аль хэсэг, юу болгох, зөв тоо.`, [["Цуцлах", "FLOW_CANCEL"]]);
    if (ADMIN()) await send(ADMIN(), `${tag}✅ Нэмэлт засварын төлбөр баталгаажлаа: ${NAMES[f.rev.part]} (${psid})`); return { ok: true };
  }
  if (via === "qpay") await send(psid, "QPay төлбөр амжилттай орлоо ✅ Таны захиалгыг боловсруулж эхэлж байна.");
  try { await startJob(psid, f); await setF(psid, f); if (ADMIN()) await send(ADMIN(), `${tag}✅ ${via === "qpay" ? "Автоматаар баталгаажиж" : "Баталлаа,"} боловсруулж эхэллээ: ${NAMES[f.product]} (${psid})`); }
  catch (e) { if (ADMIN()) await send(ADMIN(), `⚠️ ${psid}: ажил эхлүүлж чадсангүй — ${e.message}`); await send(psid, "Төлбөр баталгаажлаа ✅ Боловсруулалт эхлэхэд түр саатал гарлаа, манай ажилтан удахгүй эхлүүлнэ."); }
  return { ok: true };
}

// QPay төлбөр орж ирэхэд (callback эсвэл «Шалгах»)
QP.onPaid("flow", async (rec) => {
  const f = await getF(rec.psid);
  if (!f || !["awaiting_payment", "payment_review"].includes(f.s) || !f.qpay || f.qpay.no !== rec.no) {
    if (ADMIN()) await send(ADMIN(), `⚠️ QPay төлбөр ${fmtMoney(rec.paid || rec.amount)} орсон боловч захиалга төлбөр хүлээх төлөвт алга (${rec.psid}, ${f ? f.s : "мэдээлэлгүй"}, нэхэмжлэх ${rec.no}). Гараар шалгана уу.`);
    return;
  }
  await approve(rec.psid, f, "qpay");
});
// Бизнес төсөл (Make урсгал): төлбөр орвол Make-ийн «QPay төлбөр орсон» сценари (MAKE_PAID_WEBHOOK)-оор
// захиалагчийн төлвийг шилжүүлж (админы «Батлах»-тай адил), мессежийг сервер илгээнэ. Амжилтгүй бол админд «Батлах» товч.
const BIZ_OK = (url) => `✅ Таны QPay төлбөр баталгаажлаа. Баярлалаа!\n\nОдоо бизнесийнхээ тухай аль болох дэлгэрэнгүй бичнэ үү: бизнесийн чиглэл, байршил, борлуулах үнэ, зээлийн дүн болон зориулалт. Хэд хэдэн мессежээр бичсэн ч болно.\n\n📎 ФАЙЛ ИЛГЭЭХ ЗААВАР: Үнийн санал, хүснэгт, өмнөх төсөл, зураг (Word, Excel, PDF, зураг) байвал төсөлд тусгана.\n• Файлаа чирж оруулах боломжгүй. Текст бичих хэсгийн зүүн талд байрлах «+» товчийг (утсанд 🖼 эсвэл «+») дарж файлаа сонгоно уу. Нэг дор олон зураг сонгож болно.\n• Хэрэв илгээж чадахгүй бол энэ холбоосоор илгээнэ үү:\n${url}`;
const BIZREV_OK = "✅ Нэмэлт засварын QPay төлбөр баталгаажлаа. Баярлалаа!\n\nЯмар засвар хийлгэхийг хүсч байгаагаа нэг мессежинд дэлгэрэнгүй бичнэ үү. Шинэ файл байвал эхлээд «+» товчоор илгээгээд, дараа нь засварын хүсэлтээ бичнэ үү. Засвар нь анхны төслийн сэдвийн хүрээнд хийгдэнэ (30–45 минут).";
async function markMakePaid(rec) {
  const url = process.env.MAKE_PAID_WEBHOOK, k = process.env.MAKE_PAID_KEY;
  if (!url || !k) throw new Error("MAKE_PAID_WEBHOOK тохируулаагүй");
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ psid: rec.psid, kind: rec.kind, amount: rec.paid || rec.amount, no: rec.no, k }), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Make webhook HTTP ${r.status}`);
}
const bizPaid = async (rec) => {
  const rev = rec.kind === "bizrev";
  try {
    await markMakePaid(rec);
    if (rev) await send(rec.psid, BIZREV_OK);
    else { const { tokenFor } = require("../plan-v2/upload"); await send(rec.psid, BIZ_OK(`${process.env.PUBLIC_URL || "https://menejer-ai-plan-service.onrender.com"}/u/${tokenFor(rec.psid)}`)); }
    if (ADMIN()) await send(ADMIN(), `💳 QPay төлбөр орлоо ${fmtMoney(rec.paid || rec.amount)} — автоматаар баталгаажлаа: ${rev ? "бизнес төслийн нэмэлт засвар" : "бизнес төсөл (ярилцлага эхэллээ)"} (${rec.psid})`);
  } catch (e) {
    console.warn("[qpay] biz автомат баталгаажуулалт:", e.message);
    await send(rec.psid, "QPay төлбөр амжилттай орлоо ✅ Хэдхэн минутын дотор үргэлжлүүлнэ.");
    if (ADMIN()) await send(ADMIN(), `💳 QPay төлбөр орлоо (банкаар баталгаажсан): ${fmtMoney(rec.paid || rec.amount)}\n${rev ? "Бизнес төслийн нэмэлт засвар" : "Бизнес төсөл"}\nЗахиалагч: ${rec.psid}\n⚠️ Автомат шилжүүлэлт амжилтгүй (${String(e.message).slice(0, 80)}).\n\nДоорх товчийг дарж үргэлжлүүлнэ үү.`, [["✅ Батлах", `${rev ? "APPROVEREV|" : "APPROVE|"}${rec.psid}`]]);
  }
};
QP.onPaid("biz", bizPaid); QP.onPaid("bizrev", bizPaid);
const QP_VOID = "⚠️ Дээрх QPay QR код болон төлбөрийн холбоос хүчингүй боллоо. Түүгээр төлбөр бүү хийгээрэй. Дахин захиалах бол доорх товчийг дарна уу.";
// Make дуудна (бизнес төсөл цуцлахад): POST /qpay/cancel {psid} → нээлттэй нэхэмжлэхийг цуцална
router.post("/qpay/cancel", express.json(), auth, async (req, res) => {
  const psid = String((req.body || {}).psid || ""); if (!psid) return res.status(400).json({ ok: false });
  try {
    const c = await QP.cancelOpen(psid, ["biz", "bizrev"]);
    if (c.length) {
      console.log(`[qpay] ${psid}: ${c.length} нэхэмжлэх цуцлагдлаа`);
      await send(psid, QP_VOID, [["Бизнес төсөл", "BIZ_PROJECT"], ["Маркетинг", "MKT_PLAN"], ["Тайлан, төлөвлөгөө", "ORG_REPORT"]]);
    }
    res.json({ ok: true, cancelled: c.length });
  }
  catch (e) { console.warn("[qpay] cancel:", e.message); res.json({ ok: false }); }
});
// Make дуудна: POST /qpay/invoice {psid, amount, kind: "biz"|"bizrev"} → захиалагчид QR ба холбоос илгээнэ
router.post("/qpay/invoice", express.json(), auth, async (req, res) => {
  const { psid, amount, kind = "biz" } = req.body || {};
  if (!psid || !(Number(amount) > 0) || !["biz", "bizrev"].includes(kind)) return res.status(400).json({ ok: false, error: "psid, amount, kind" });
  if (!QP.allowedFor(psid)) return res.json({ ok: false, error: "disabled" });
  try {
    const inv = await QP.createInvoice({ psid, amount, kind, description: kind === "bizrev" ? "Менежер AI: бизнес төслийн нэмэлт засвар" : "Менежер AI: бизнес төсөл" });
    res.json({ ok: true, no: inv.no });
    // Make-ийн үнийн мессеж эхэлж очих тул QR-ыг хэдэн секундийн дараа илгээнэ
    setTimeout(async () => {
      try {
        if (inv.qrUrl) await sendImage(String(psid), inv.qrUrl);
        await send(String(psid), `📲 QPay-ээр төлөх: ${fmtMoney(inv.amount)}\nУтсаараа доорх холбоосыг нээгээд банкны аппаа сонгоно уу (эсвэл дээрх QR кодыг уншуулна):\n${inv.short || ""}\n\nТөлбөр орж ирмэгц автоматаар баталгаажиж, энд мэдэгдэнэ.`,
          kind === "bizrev" ? [["Цуцлах", "BIZ_CANCEL"]] : [["Цуцлах", "BIZ_CANCEL"], ["Маркетинг", "MKT_PLAN"], ["Тайлан, төлөвлөгөө", "ORG_REPORT"]]);
      } catch (e) { console.warn("[qpay] biz QR илгээх:", e.message); }
    }, Number(process.env.QPAY_BIZ_DELAY_MS || 4000));
  } catch (e) { console.warn("[qpay] biz нэхэмжлэх:", e.message); res.json({ ok: false, error: String(e.message).slice(0, 200) }); }
});

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
module.exports.onDone = onDone;
module.exports.onRevReject = onRevReject;
module.exports.handleMessage = handle;
module.exports.adminAction = admin;
module.exports._getF = getF;
