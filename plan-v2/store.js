// Дууссан төслийн төлөвийг (таамаглал, судалгаа, бичсэн хэсгүүд) Render Key Value (Redis)-д хадгална.
// Засвар ирэхэд бүтэн төслийг дахин бичихгүй, зөвхөн хамааралтай хэсгүүдийг шинэчлэхэд ашиглана.
// REDIS_URL тохируулаагүй бол чимээгүй алгасна (засвар бүтэн төслөөр хийгдэнэ).
const zlib = require("zlib");
const TTL = Number(process.env.PLAN_STORE_TTL_DAYS || 120) * 86400;
let ready = null;

function getClient() {
  if (!process.env.REDIS_URL) return Promise.resolve(null);
  if (!ready) {
    const { createClient } = require("redis");
    const c = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 10000, reconnectStrategy: (n) => Math.min(n * 500, 5000) } });
    c.on("error", (e) => console.warn("[store]", e.message));
    ready = c.connect().then(() => c).catch((e) => { console.warn("[store] холбогдож чадсангүй:", e.message); ready = null; return null; });
  }
  return ready;
}

async function savePlan(psid, state) {
  try {
    const c = await getClient(); if (!c || !psid) return;
    const buf = zlib.gzipSync(JSON.stringify(state));
    await c.set(`plan:${psid}`, buf.toString("base64"), { EX: TTL });
    console.log(`[store] ${psid} төслийн төлөв хадгалагдлаа (${Math.round(buf.length / 1024)}KB)`);
  } catch (e) { console.warn("[store] хадгалж чадсангүй:", e.message); }
}

async function loadPlan(psid) {
  try {
    const c = await getClient(); if (!c || !psid) return null;
    const v = await c.get(`plan:${psid}`); if (!v) return null;
    return JSON.parse(zlib.gunzipSync(Buffer.from(v, "base64")).toString("utf8"));
  } catch (e) { console.warn("[store] уншиж чадсангүй:", e.message); return null; }
}
// Систем шинэчлэгдэж байх үед ирсэн засварын хүсэлтийг түр хадгална (PLAN_HOLD_REVISIONS=1).
// Redis байхгүй бол процессын санах ойд (дахин асахад алдагдана — Make-ийн restart дахин илгээлт нөөц болно).
const holdMem = new Map();
async function holdSave(psid, conversation) {
  const v = JSON.stringify({ psid, conversation, at: new Date().toISOString() });
  try { const c = await getClient(); if (c) { await c.set(`planhold:${psid}`, v, { EX: 7 * 86400 }); return; } } catch (e) { console.warn("[store] hold хадгалж чадсангүй:", e.message); }
  holdMem.set(psid, v);
}
async function holdList() {
  const out = [];
  try {
    const c = await getClient();
    if (c) { for await (const k of c.scanIterator({ MATCH: "planhold:*", COUNT: 100 })) { for (const key of Array.isArray(k) ? k : [k]) { const v = await c.get(key); if (v) out.push(JSON.parse(v)); } } }
  } catch (e) { console.warn("[store] hold уншиж чадсангүй:", e.message); }
  for (const v of holdMem.values()) out.push(JSON.parse(v));
  return out;
}
async function holdDel(psid) {
  holdMem.delete(psid);
  try { const c = await getClient(); if (c) await c.del(`planhold:${psid}`); } catch (e) { console.warn("[store] hold устгаж чадсангүй:", e.message); }
}
module.exports = { savePlan, loadPlan, holdSave, holdList, holdDel };
