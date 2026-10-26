// Тендерийн захиалгын хадгалалт (psid тус бүрээр). REDIS_URL байвал Redis, үгүй бол процессын санах ой.
// Түлхүүрүүд (бусад модулийн түлхүүртэй давхцахгүй "tnd:" угтвартай):
//   tnd:files:<psid>        — файлын жагсаалт (JSON)            tnd:file:<psid>:<id> — файлын агуулга (gzip)
//   tnd:text:<psid>:<id>    — уншсан текст (дахин уншихгүй)    tnd:st:<psid>        — Messenger-ийн төлөв
//   tnd:case:<psid>         — шинжилгээний үр дүн (tender JSON, асуулт, хүргэлт)
const zlib = require("zlib");
const crypto = require("crypto");

const LIMITS = { maxFiles: 40, maxFileBytes: 25 * 1024 * 1024, maxTotalBytes: 120 * 1024 * 1024 };
const ttl = () => Math.round(Number(process.env.TENDER_TTL_DAYS || 30) * 86400);
const K = {
  files: (p) => `tnd:files:${p}`, file: (p, id) => `tnd:file:${p}:${id}`, text: (p, id) => `tnd:text:${p}:${id}`,
  st: (p) => `tnd:st:${p}`, kase: (p) => `tnd:case:${p}`,
};

let ready = null, warned = false;
function client() {
  if (!process.env.REDIS_URL) {
    if (!warned) { warned = true; console.warn("[tender-store] REDIS_URL алга — санах ойд хадгална"); }
    return Promise.resolve(null);
  }
  if (!ready) {
    const { createClient } = require("redis");
    const c = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 10000, reconnectStrategy: (n) => Math.min(n * 500, 5000) } });
    c.on("error", (e) => console.warn("[tender-store]", e.message));
    ready = c.connect().then(() => c).catch((e) => { console.warn("[tender-store] Redis алга:", e.message); ready = null; return null; });
  }
  return ready;
}
const mem = new Map();
const memGet = (k) => { const e = mem.get(k); if (!e) return null; if (e.exp < Date.now()) { mem.delete(k); return null; } return e.v; };
const memSet = (k, v) => mem.set(k, { v, exp: Date.now() + ttl() * 1000 });

async function getJSON(k, def = null) { const c = await client(); if (!c) { const v = memGet(k); return v === null ? def : JSON.parse(v); } const v = await c.get(k); return v ? JSON.parse(v) : def; }
async function setJSON(k, v) { const c = await client(), s = JSON.stringify(v); if (!c) return memSet(k, s); await c.set(k, s, { EX: ttl() }); }
async function putBuf(k, b) { const c = await client(); if (!c) return memSet(k, b); await c.set(k, zlib.gzipSync(b).toString("base64"), { EX: ttl() }); }
async function getBuf(k) { const c = await client(); if (!c) return memGet(k); const v = await c.get(k); return v ? zlib.gunzipSync(Buffer.from(v, "base64")) : null; }
async function del(keys) { const c = await client(); if (!c) { keys.forEach((k) => mem.delete(k)); return; } if (keys.length) await c.del(keys); }

const locks = new Map();
function withLock(psid, fn) {
  const prev = locks.get(psid) || Promise.resolve(), run = prev.then(fn, fn), tail = run.catch(() => { });
  locks.set(psid, tail); tail.then(() => { if (locks.get(psid) === tail) locks.delete(psid); });
  return run;
}

// phase: "tbb" (төлбөрөөс өмнө — тендерийн баримт) | "bidder" (дараа нь — оролцогчийн баримт)
function addFile(psid, { name, mime, buf, phase = "tbb", pages = null }) {
  psid = String(psid || "");
  return withLock(psid, async () => {
    if (!psid) return { ok: false, error: "Хэрэглэгчийн дугаар алга" };
    if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, error: "Файл хоосон байна" };
    if (buf.length > LIMITS.maxFileBytes) return { ok: false, error: `Файл хэт том (${(buf.length / 1048576).toFixed(1)}MB). Нэг файл 25MB хүртэл.` };
    const list = await getJSON(K.files(psid), []);
    const sha = crypto.createHash("sha1").update(buf).digest("hex");
    const dup = list.find((f) => (f.sha && f.sha === sha) || (f.name === name && f.size === buf.length));
    if (dup) return { ok: true, file: dup, duplicate: true };
    if (list.length >= LIMITS.maxFiles) return { ok: false, error: `Нэг захиалгад ${LIMITS.maxFiles} хүртэл файл. Илүүг нь нэг PDF болгож нэгтгэнэ үү.` };
    if (list.reduce((s, f) => s + f.size, 0) + buf.length > LIMITS.maxTotalBytes) return { ok: false, error: "Нийт материал 120MB-аас хэтэрлээ." };
    const id = crypto.randomBytes(6).toString("hex");
    const file = { id, sha, name: String(name || "файл").slice(0, 200), mime: String(mime || ""), size: buf.length, phase, pages, at: new Date().toISOString() };
    await putBuf(K.file(psid, id), buf);
    list.push(file); await setJSON(K.files(psid), list);
    return { ok: true, file };
  });
}
const listFiles = (psid) => getJSON(K.files(String(psid)), []);
async function getFile(psid, f) { return getBuf(K.file(String(psid), f.id)); }
function removeFile(psid, id) {
  psid = String(psid);
  return withLock(psid, async () => {
    const list = await listFiles(psid), i = list.findIndex((f) => f.id === id); if (i < 0) return false;
    list.splice(i, 1); await setJSON(K.files(psid), list); await del([K.file(psid, id), K.text(psid, id)]); return true;
  });
}
async function clear(psid) {
  psid = String(psid);
  return withLock(psid, async () => {
    const list = await listFiles(psid);
    await del([K.files(psid), K.kase(psid), ...list.flatMap((f) => [K.file(psid, f.id), K.text(psid, f.id)])]);
    return list.length;
  });
}
const getText = (psid, id) => getJSON(K.text(String(psid), id));
const setText = (psid, id, v) => setJSON(K.text(String(psid), id), v);
const getState = (psid) => getJSON(K.st(String(psid)));
async function setState(psid, s) { s.at = Date.now(); await setJSON(K.st(String(psid)), s); return s; }
const getCase = (psid) => getJSON(K.kase(String(psid)));
async function patchCase(psid, patch) { const cur = (await getCase(psid)) || {}; const next = { ...cur, ...patch, updated: new Date().toISOString() }; await setJSON(K.kase(String(psid)), next); return next; }

const getMisc = (k) => getJSON(`tnd:misc:${k}`);
const setMisc = (k, v) => setJSON(`tnd:misc:${k}`, v);

module.exports = { getMisc, setMisc, LIMITS, addFile, listFiles, getFile, removeFile, clear, getText, setText, getState, setState, getCase, patchCase };
