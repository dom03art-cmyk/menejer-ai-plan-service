// Захиалагчийн илгээсэн түүхий материалыг (файл) psid тус бүрээр хадгална. АГУУЛГЫГ УНШИХГҮЙ — зөвхөн хадгалж, тоолсон дүнг тэмдэглэнэ.
// REDIS_URL байвал Redis-д (gzip+base64, TTL ORG_FILES_TTL_DAYS, өгөгдмөл 14 хоног), үгүй бол процессын санах ойд (Map).
// Түлхүүрүүд: org:files:<psid> (файлын жагсаалт, JSON), org:file:<psid>:<id> (файлын агуулга), org:meta:<psid> (product, quote), org:rej:<psid> (татгалзсан файлууд)
const zlib = require("zlib");
const crypto = require("crypto");

const LIMITS = { maxFiles: 60, maxFileBytes: 25 * 1024 * 1024, maxTotalBytes: 150 * 1024 * 1024 };
const ttl = () => Math.round(Number(process.env.ORG_FILES_TTL_DAYS || 14) * 86400);
const mb = (n) => (n / 1024 / 1024).toFixed(1);
const K = {
  files: (p) => `org:files:${p}`, file: (p, id) => `org:file:${p}:${id}`,
  meta: (p) => `org:meta:${p}`, rej: (p) => `org:rej:${p}`,
};

// ---- Redis эсвэл санах ой ----
let ready = null, warned = false;
function getClient() {
  if (!process.env.REDIS_URL) {
    if (!warned) { warned = true; console.warn("[org-materials] REDIS_URL алга — материалыг санах ойд хадгална (сервер дахин асахад устна)"); }
    return Promise.resolve(null);
  }
  if (!ready) {
    const { createClient } = require("redis");
    const c = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 10000, reconnectStrategy: (n) => Math.min(n * 500, 5000) } });
    c.on("error", (e) => console.warn("[org-materials]", e.message));
    ready = c.connect().then(() => c).catch((e) => {
      console.warn("[org-materials] Redis-д холбогдож чадсангүй, санах ой ашиглана:", e.message); ready = null; return null;
    });
  }
  return ready;
}
const mem = new Map(); // key -> { v, exp }
const memGet = (k) => { const e = mem.get(k); if (!e) return null; if (e.exp < Date.now()) { mem.delete(k); return null; } return e.v; };
const memSet = (k, v) => mem.set(k, { v, exp: Date.now() + ttl() * 1000 });

async function getJSON(key, def) {
  const c = await getClient();
  if (!c) { const v = memGet(key); return v === null ? def : JSON.parse(v); }
  const v = await c.get(key); return v ? JSON.parse(v) : def;
}
async function setJSON(key, val) {
  const c = await getClient(), s = JSON.stringify(val);
  if (!c) return memSet(key, s);
  await c.set(key, s, { EX: ttl() });
}
async function putBuf(key, buf) {
  const c = await getClient();
  if (!c) return memSet(key, buf);
  await c.set(key, zlib.gzipSync(buf).toString("base64"), { EX: ttl() });
}
async function getBuf(key) {
  const c = await getClient();
  if (!c) return memGet(key);
  const v = await c.get(key); return v ? zlib.gunzipSync(Buffer.from(v, "base64")) : null;
}
async function del(keys) {
  const c = await getClient();
  if (!c) { keys.forEach(k => mem.delete(k)); return; }
  if (keys.length) await c.del(keys);
}
// TTL-ийг сунгах (шинэ файл нэмэхэд бүх материал хамт хадгалагдах хугацаатай байх)
async function touch(psid, ids) {
  const c = await getClient(); const keys = [K.files(psid), K.meta(psid), K.rej(psid), ...ids.map(id => K.file(psid, id))];
  if (!c) { keys.forEach(k => { const e = mem.get(k); if (e) e.exp = Date.now() + ttl() * 1000; }); return; }
  await Promise.all(keys.map(k => c.expire(k, ttl()).catch(() => { })));
}

// psid тус бүрээр дараалуулна (зэрэг ирсэн upload хязгаарыг зөрчихгүй)
const locks = new Map();
function withLock(psid, fn) {
  const prev = locks.get(psid) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => { });
  locks.set(psid, tail);
  tail.then(() => { if (locks.get(psid) === tail) locks.delete(psid); });
  return run;
}

// ---- API ----
// count — quote.countFile-ийн үр дүн ({ kind, pages, units, note }). Буцаах: { ok, file } эсвэл { ok:false, error }
function addFile(psid, { name, mime, buf, count }) {
  psid = String(psid || "");
  return withLock(psid, async () => {
    if (!psid) return { ok: false, error: "Хэрэглэгчийн дугаар алга" };
    if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, error: "Файл хоосон байна" };
    if (buf.length > LIMITS.maxFileBytes) return { ok: false, error: `Файл хэт том байна (${mb(buf.length)}MB). Нэг файл 25MB хүртэл байна. Файлаа хувааж эсвэл чухал хуудсуудыг нь илгээнэ үү.` };
    const list = await getJSON(K.files(psid), []);
    const dup = list.find(f => f.name === name && f.size === buf.length);
    if (dup) return { ok: true, file: dup, duplicate: true };
    if (list.length >= LIMITS.maxFiles) return { ok: false, error: `Нэг захиалгад ${LIMITS.maxFiles} хүртэл файл илгээх боломжтой. Илүү файлаа нэгтгэж (жишээ нь нэг PDF болгож) илгээнэ үү.` };
    const total = list.reduce((s, f) => s + f.size, 0);
    if (total + buf.length > LIMITS.maxTotalBytes) return { ok: false, error: `Нийт материалын хэмжээ 150MB-аас хэтэрч байна (одоо ${mb(total)}MB). Шаардлагагүй файлаа хасаж эсвэл жижигрүүлж илгээнэ үү.` };
    const id = crypto.randomBytes(6).toString("hex");
    const c = count || {};
    const file = { id, name: String(name || "файл").slice(0, 200), mime: String(mime || ""), size: buf.length, kind: c.kind || "", pages: c.pages || null, units: Number(c.units) || 0, note: c.note || "", at: new Date().toISOString() };
    await putBuf(K.file(psid, id), buf);
    list.push(file);
    await setJSON(K.files(psid), list);
    await touch(psid, list.map(f => f.id));
    return { ok: true, file };
  });
}

const listFiles = async (psid) => getJSON(K.files(String(psid)), []);

async function getFiles(psid) {
  const list = await listFiles(psid), out = [];
  for (const f of list) {
    const buf = await getBuf(K.file(String(psid), f.id));
    if (buf) out.push({ ...f, buf }); else console.warn("[org-materials] файлын агуулга алга:", psid, f.name);
  }
  return out;
}

function removeFile(psid, id) {
  psid = String(psid);
  return withLock(psid, async () => {
    const list = await listFiles(psid), i = list.findIndex(f => f.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    await setJSON(K.files(psid), list);
    await del([K.file(psid, id)]);
    return true;
  });
}

function clear(psid) {
  psid = String(psid);
  return withLock(psid, async () => {
    const list = await listFiles(psid);
    await del([K.files(psid), K.meta(psid), K.rej(psid), ...list.map(f => K.file(psid, f.id))]);
    return list.length;
  });
}

const getMeta = async (psid) => getJSON(K.meta(String(psid)), null);
async function setMeta(psid, patch) {
  const cur = (await getMeta(psid)) || {};
  const next = { ...cur, ...patch, updated: new Date().toISOString() };
  await setJSON(K.meta(String(psid)), next);
  return next;
}

// Татгалзсан файлууд (сүүлийн «дууслаа»-аас хойш) — Messenger-ийн тайланд
async function addRejected(psid, { name, reason }) {
  const l = await getJSON(K.rej(String(psid)), []); l.push({ name, reason, at: new Date().toISOString() });
  await setJSON(K.rej(String(psid)), l.slice(-100));
}
const listRejected = async (psid) => getJSON(K.rej(String(psid)), []);
const clearRejected = async (psid) => del([K.rej(String(psid))]);

const totalUnits = (list) => list.reduce((s, f) => s + (Number(f.units) || 0), 0);

module.exports = { LIMITS, addFile, listFiles, getFiles, removeFile, clear, setMeta, getMeta, addRejected, listRejected, clearRejected, totalUnits };
