// QPay Merchant V2 холболт: нэхэмжлэх (QR) үүсгэх, төлбөрийн callback хүлээн авах, төлбөр шалгах.
// Нууц мэдээллийг ЗӨВХӨН Render Environment-д оруулна (кодонд, чатад бичихгүй):
//   QPAY_CLIENT_ID, QPAY_CLIENT_SECRET, QPAY_INVOICE_CODE — гурвуулаа байвал QPay асна. Байхгүй бол хуучин (дансаар шилжүүлэх) урсгал хэвээр.
//   QPAY_ENV = "sandbox" (туршилт) | "production" (анхдагч)
//   PUBLIC_URL — callback-ийн үндсэн хаяг (анхдагч https://menejer-ai-plan-service.onrender.com)
// QPay-ийн дүрэм: төлбөрийг cron-оор байнга шалгахыг хориглоно — зөвхөн callback ирэхэд эсвэл захиалагч «Шалгах» дарахад шалгана.
const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const BASE = () => (process.env.QPAY_ENV === "sandbox" ? "https://merchant-sandbox.qpay.mn" : "https://merchant.qpay.mn");
const PUBLIC = () => (process.env.PUBLIC_URL || "https://menejer-ai-plan-service.onrender.com").replace(/\/$/, "");
const enabled = () => !!(process.env.QPAY_CLIENT_ID && process.env.QPAY_CLIENT_SECRET && process.env.QPAY_INVOICE_CODE);
// Туршилтын (sandbox) горимд бодит захиалагчид QPay санал болгохгүй (sandbox QR-ыг бодит банкаар төлөх боломжгүй) —
// зөвхөн админ болон QPAY_TEST_PSIDS (таслалаар) дахь хүмүүст. Production горимд бүх захиалагчид.
const allowedFor = (psid) => enabled() && (process.env.QPAY_ENV !== "sandbox" || [process.env.ADMIN_PSID, ...String(process.env.QPAY_TEST_PSIDS || "").split(",")].map((x) => String(x || "").trim()).filter(Boolean).includes(String(psid)));
let fetchImpl = (...a) => fetch(...a);

// ---- хадгалалт (Redis эсвэл санах ой) ----
let ready = null; const mem = new Map();
function client() {
  if (!process.env.REDIS_URL) return Promise.resolve(null);
  if (!ready) {
    const { createClient } = require("redis");
    const c = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 10000, reconnectStrategy: (n) => Math.min(n * 500, 5000) } });
    c.on("error", (e) => console.warn("[qpay]", e.message));
    ready = c.connect().then(() => c).catch((e) => { console.warn("[qpay] Redis алга:", e.message); ready = null; return null; });
  }
  return ready;
}
const TTL = 7 * 86400;
async function put(k, v) { const c = await client(); const s = JSON.stringify(v); if (c) await c.set(k, s, { EX: TTL }); else mem.set(k, s); }
async function get(k) { const c = await client(); const s = c ? await c.get(k) : mem.get(k); return s ? JSON.parse(s) : null; }
async function lock(k, sec = 60) { const c = await client(); if (c) return (await c.set(k, "1", { NX: true, EX: sec })) === "OK"; if (mem.has(k)) return false; mem.set(k, "1"); setTimeout(() => mem.delete(k), sec * 1000).unref?.(); return true; }
async function unlock(k) { const c = await client(); if (c) await c.del(k); else mem.delete(k); }
const getInv = (no) => get(`qpinv:${no}`);
const saveInv = (rec) => put(`qpinv:${rec.no}`, rec);

// ---- token (хугацаа дуусахаас өмнө дахин авахгүй) ----
let tok = null; // { access, refresh, exp, rexp } (мс)
const toMs = (v, fallbackSec) => { const n = Number(v); if (!n) return Date.now() + fallbackSec * 1000; return n > 1e12 ? n : n > 1e9 ? n * 1000 : Date.now() + n * 1000; };
async function token() {
  if (tok && tok.exp - 60e3 > Date.now()) return tok.access;
  let r = null;
  if (tok && tok.refresh && tok.rexp - 60e3 > Date.now()) {
    r = await fetchImpl(`${BASE()}/v2/auth/refresh`, { method: "POST", headers: { Authorization: `Bearer ${tok.refresh}` } }).catch(() => null);
    if (r && !r.ok) r = null;
  }
  if (!r) {
    const basic = Buffer.from(`${process.env.QPAY_CLIENT_ID}:${process.env.QPAY_CLIENT_SECRET}`).toString("base64");
    r = await fetchImpl(`${BASE()}/v2/auth/token`, { method: "POST", headers: { Authorization: `Basic ${basic}` } });
    if (!r.ok) throw new Error(`QPay token HTTP ${r.status}`);
  }
  const j = await r.json();
  if (!j.access_token) throw new Error("QPay token хариу буруу");
  tok = { access: j.access_token, refresh: j.refresh_token, exp: toMs(j.expires_in, 3600), rexp: toMs(j.refresh_expires_in, 86400) };
  return tok.access;
}
async function api(method, path, body) {
  const t = await token();
  const r = await fetchImpl(`${BASE()}${path}`, { method, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : {}; } catch (_) { j = { raw: text }; }
  if (r.status === 401) tok = null;
  if (!r.ok) { const e = new Error(`QPay ${path} HTTP ${r.status}: ${String(j && (j.message || j.error) || text).slice(0, 200)}`); e.status = r.status; throw e; }
  return j;
}

// Callback URL-д захиалагч, төрөл, дүнг гарын үсэгтэй хадгална: Redis-ийн мэдээлэл устсан ч (сервер дахин ассан г.м.)
// төлбөр орсныг таньж, админд мэдэгдэх эсвэл бизнес төслийг автоматаар үргэлжлүүлэх боломжтой.
const cbSecret = () => process.env.QPAY_CB_SECRET || process.env.API_KEY || "dev";
const cbSig = (no, psid, kind, amount) => crypto.createHmac("sha256", cbSecret()).update(`${no}|${psid}|${kind}|${amount}`).digest("hex").slice(0, 24);
const cbQuery = ({ no, psid, kind, amount }) => new URLSearchParams({ no, p: psid, k: kind, a: String(amount), s: cbSig(no, psid, kind, amount) }).toString();
function cbRecover(q) {
  const no = String(q.no || ""), psid = String(q.p || ""), kind = String(q.k || ""), amount = Number(q.a || 0), s = String(q.s || "");
  if (!psid || !kind || !(amount > 0) || s.length !== 24) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(s), Buffer.from(cbSig(no, psid, kind, amount)));
  return ok ? { no, psid, kind, amount } : null;
}

// ---- нэхэмжлэх үүсгэх ----
// kind: "flow" (маркетинг/тайлан/төлөвлөгөө — сервер өөрөө баталгаажуулна) | "biz" | "bizrev" (бизнес төсөл, Make)
async function createInvoice({ psid, amount, description, kind = "flow", meta = {} }) {
  if (!enabled()) throw new Error("QPay тохируулаагүй");
  amount = Math.round(Number(amount));
  if (!(amount > 0)) throw new Error("QPay дүн буруу");
  const no = `MA${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`.toUpperCase(); // давтагдашгүй
  const body = {
    invoice_code: process.env.QPAY_INVOICE_CODE, sender_invoice_no: no, invoice_receiver_code: "terminal",
    invoice_description: String(description || "Менежер AI үйлчилгээ").slice(0, 200), amount,
    callback_url: `${PUBLIC()}/qpay/callback?${cbQuery({ no, psid: String(psid), kind, amount })}`,
  };
  const j = await api("POST", "/v2/invoice", body);
  if (!j.invoice_id) throw new Error("QPay invoice_id ирсэнгүй");
  const rec = { no, id: j.invoice_id, psid: String(psid), amount, kind, meta, status: "open", at: Date.now(), short: j.qPay_shortUrl || null };
  await saveInv(rec);
  if (j.qr_image) await put(`qpqr:${no}`, { png: j.qr_image });
  return { ...rec, qrUrl: j.qr_image ? `${PUBLIC()}/qpay/qr/${no}.png` : null, urls: Array.isArray(j.urls) ? j.urls : [] };
}
async function cancelInvoice(no) {
  const rec = await getInv(no); if (!rec || rec.status !== "open") return;
  rec.status = "cancelled"; await saveInv(rec);
  await api("DELETE", `/v2/invoice/${encodeURIComponent(rec.id)}`).catch((e) => console.warn("[qpay] цуцлах:", e.message));
}
// Төлөгдсөн дүн (зөвхөн PAID гүйлгээ)
async function paidAmount(rec) {
  const j = await api("POST", "/v2/payment/check", { object_type: "INVOICE", object_id: rec.id, offset: { page_number: 1, page_limit: 100 } });
  const rows = Array.isArray(j.rows) ? j.rows : [];
  const paid = rows.filter((x) => String(x.payment_status || "").toUpperCase() === "PAID");
  return { paid: paid.reduce((a, x) => a + Number(x.payment_amount || 0), 0), payment_id: paid[0] && paid[0].payment_id };
}

// ---- төлөгдсөн үед дуудагдах функцууд (төрөл бүрээр) ----
const handlers = {};
const onPaid = (kind, fn) => { handlers[kind] = fn; };
// Нэхэмжлэхийг шалгаад төлөгдсөн бол нэг л удаа handler дуудна. Буцаах: "paid" | "unpaid" | "done" | "busy" | "missing"
async function settle(no, via = "callback") {
  const rec = await getInv(no); if (!rec) return "missing";
  if (rec.status === "paid") return "done";
  if (rec.status !== "open") return "missing";
  if (!(await lock(`qplock:${no}`))) return "busy";
  try {
    const { paid, payment_id } = await paidAmount(rec);
    if (paid + 0.5 < rec.amount) { console.log(`[qpay] ${no} төлөгдөөгүй (${paid}/${rec.amount}, ${via})`); return "unpaid"; }
    rec.status = "paid"; rec.paidAt = Date.now(); rec.payment_id = payment_id; rec.paid = paid; await saveInv(rec);
    console.log(`[qpay] ${no} төлөгдлөө ${paid}₮ (${rec.kind}, ${via})`);
    const h = handlers[rec.kind];
    if (h) await h(rec).catch((e) => console.error("[qpay] handler алдаа", e));
    return "paid";
  } finally { await unlock(`qplock:${no}`); }
}

// QPay callback (GET эсвэл POST). Хурдан 200 буцааж, шалгалтыг араас хийнэ. Хуурамч дуудлага ирсэн ч payment/check-ээр шалгадаг тул аюулгүй.
async function callback(req, res) {
  const no = String(req.query.no || "").slice(0, 60);
  res.status(200).send("SUCCESS");
  if (!/^[A-Z0-9]{6,60}$/.test(no) || !enabled()) return;
  try {
    const r = await settle(no, "callback");
    if (r === "missing") await lostRecord(req.query, { ...(req.body || {}) });
  } catch (e) { console.warn("[qpay] callback шалгалт:", e.message); }
}
// Нэхэмжлэхийн мэдээлэл алга (Redis устсан): payment_id ирсэн бол QPay-аас шалгаж үргэлжлүүлнэ, үгүй бол админд мэдэгдэнэ
const lostSeen = new Set();
async function lostRecord(q, body) {
  const info = cbRecover(q);
  if (!info || lostSeen.has(info.no)) return;
  lostSeen.add(info.no);
  console.warn(`[qpay] ${info.no}: нэхэмжлэхийн мэдээлэл алга — сэргээж байна (${info.kind}, ${info.psid})`);
  const pid = q.payment_id || q.qpay_payment_id || body.payment_id || body.qpay_payment_id;
  let paid = 0;
  if (pid) { try { const p = await api("GET", `/v2/payment/${encodeURIComponent(String(pid))}`); if (String(p.payment_status || "").toUpperCase() === "PAID") paid = Number(p.payment_amount || 0); } catch (e) { console.warn("[qpay] payment шалгалт:", e.message); } }
  const rec = { ...info, id: null, status: "paid", paid: paid || info.amount, at: Date.now(), recovered: true };
  if (paid + 0.5 >= info.amount && (info.kind === "biz" || info.kind === "bizrev") && handlers[info.kind]) { await saveInv(rec); return handlers[info.kind](rec).catch((e) => console.error("[qpay] handler", e)); }
  try {
    const { fbText } = require("../plan-v2/util");
    if (process.env.ADMIN_PSID) await fbText(process.env.ADMIN_PSID, `⚠️ QPay-ээс төлбөрийн мэдэгдэл ирсэн боловч захиалгын мэдээлэл серверт алга (сервер дахин ассан байж магадгүй).\nЗахиалагч: ${info.psid}\nТөрөл: ${info.kind}\nДүн: ${info.amount}₮\nНэхэмжлэх: ${info.no}\n\nbusiness.qpay.mn-ээс гүйлгээг шалгаад захиалагчтай холбогдож гараар үргэлжлүүлнэ үү.`);
  } catch (_) { }
}
router.get("/qpay/callback", callback);
router.post("/qpay/callback", express.json({ limit: "100kb" }), callback);
// Messenger-т илгээх QR зураг
router.get("/qpay/qr/:no.png", async (req, res) => {
  const q = await get(`qpqr:${String(req.params.no).slice(0, 60)}`).catch(() => null);
  if (!q || !q.png) return res.status(404).end();
  res.set({ "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" }).send(Buffer.from(q.png, "base64"));
});
// ?check=1 — QPay-д нэвтэрч чадаж байгаа эсэх (token). Нууц мэдээлэл буцаахгүй; минутад 1 удаа.
let lastCheck = { at: 0, out: null };
router.get("/qpay/status", async (req, res) => {
  const out = { enabled: enabled(), env: process.env.QPAY_ENV === "sandbox" ? "sandbox" : "production" };
  if (req.query.check && enabled()) {
    if (Date.now() - lastCheck.at < 60e3 && lastCheck.out) out.auth = lastCheck.out;
    else { try { await token(); out.auth = "ok"; } catch (e) { out.auth = `алдаа: ${String(e.message).replace(/[^\w\s:а-яөүё.-]/gi, "").slice(0, 80)}`; } lastCheck = { at: Date.now(), out: out.auth }; }
  }
  res.json(out);
});

// ---- 100₮-ийн туршилтын хуудас: /qpay/test (хоногт 10 хүртэл, минутад 1) ----
const testLog = []; const testOk = () => { const now = Date.now(); while (testLog.length && now - testLog[0] > 86400e3) testLog.shift(); return testLog.length < 10 && (!testLog.length || now - testLog[testLog.length - 1] > 60e3); };
onPaid("test", async (rec) => { try { const { fbText } = require("../plan-v2/util"); if (process.env.ADMIN_PSID) await fbText(process.env.ADMIN_PSID, `✅ QPay туршилт амжилттай: ${rec.paid || rec.amount}₮ орж, автомат баталгаажуулалт ажиллалаа.`); } catch (_) { } });
const esc = (x) => String(x || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
router.get("/qpay/test", async (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  const page = (body) => `<!doctype html><html lang="mn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QPay туршилт</title><style>body{font-family:system-ui,sans-serif;max-width:480px;margin:24px auto;padding:0 16px;color:#111;background:#fff}img{width:260px;max-width:100%}a.b{display:block;padding:10px;margin:6px 0;border:1px solid #ddd;border-radius:8px;text-decoration:none;color:#111}#st{font-size:20px;font-weight:600;margin:16px 0}</style></head><body>${body}</body></html>`;
  if (!enabled()) return res.send(page("<p>QPay тохируулаагүй байна.</p>"));
  if (!testOk()) return res.send(page("<p>Туршилтыг минутад 1, хоногт 10 удаа л хийнэ. Түр хүлээгээд дахин нээнэ үү.</p>"));
  try {
    testLog.push(Date.now());
    const inv = await createInvoice({ psid: process.env.ADMIN_PSID || "test", amount: 100, kind: "test", description: "Менежер AI: QPay туршилт 100₮" });
    const links = inv.urls.filter((u) => /^https?:|^[a-z]+:\/\//i.test(u.link || "")).map((u) => `<a class="b" href="${esc(u.link)}">${esc(u.description || u.name)}</a>`).join("");
    res.send(page(`<h2>QPay туршилт — 100₮</h2><p>Банкны аппаараа уншуулна уу, эсвэл утсан дээрээ банкаа сонгоно уу.</p>${inv.qrUrl ? `<img src="${esc(inv.qrUrl)}" alt="QR">` : ""}<div id="st">⏳ Төлбөр хүлээж байна…</div>${inv.short ? `<a class="b" href="${esc(inv.short)}">QPay холбоос</a>` : ""}${links}
<script>const no=${JSON.stringify(inv.no)};async function t(){try{const r=await fetch("/qpay/test/status/"+no);const j=await r.json();if(j.status==="paid"){document.getElementById("st").textContent="✅ Төлбөр орлоо — автомат баталгаажуулалт ажиллаж байна";return}}catch(e){}setTimeout(t,5000)}t();</script>`));
  } catch (e) { console.warn("[qpay] туршилт:", e.message); res.send(page(`<p>QPay нэхэмжлэх үүсгэж чадсангүй: ${esc(String(e.message).slice(0, 120))}</p>`)); }
});
// Зөвхөн манай хадгалсан төлөвийг уншина (QPay руу дуудахгүй)
router.get("/qpay/test/status/:no", async (req, res) => { const r = await getInv(String(req.params.no).slice(0, 60)).catch(() => null); res.json({ status: r && r.kind === "test" ? r.status : "missing" }); });

module.exports = { cbQuery, cbRecover, router, enabled, allowedFor, createInvoice, cancelInvoice, settle, onPaid, getInv, _setFetch: (f) => { fetchImpl = f; tok = null; } };
