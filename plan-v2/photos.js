// Захиалагчийн илгээсэн зураг (бүтээгдэхүүн, байр, тоног төхөөрөмж, баг)-ийг хадгалж, бизнес төслийн тохирох бүлэгт оруулна.
// Хадгалах газар: PHOTO_DIR (Render Disk, байнгын) эсвэл түр хавтас (/tmp — сервер дахин асахад устна).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR = () => process.env.PHOTO_DIR || "/tmp/menejer-photos";
const MAX_PER = Number(process.env.PHOTO_MAX || 12);      // захиалагч бүрт
const MAX_BYTES = 4 * 1024 * 1024;
const TTL_DAYS = Number(process.env.PHOTO_TTL_DAYS || 120);
// Зураг оруулж болох бүлгүүд
const SECTIONS = { "2.4": "Бүтээгдэхүүн, үйлчилгээ", "3.1": "Үйлдвэрлэл, технологи, байр, тоног төхөөрөмж", "3.4": "Баг, хамт олон" };

const safe = (psid) => String(psid || "").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 40);
const dirOf = (psid) => path.join(DIR(), safe(psid));

// JPEG/PNG-ийн хэмжээг толгойноос уншина (нэмэлт сан шаардахгүй)
function dims(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { type: "png", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return { type: "jpg", h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

function readMeta(psid) {
  try { return JSON.parse(fs.readFileSync(path.join(dirOf(psid), "meta.json"), "utf8")); } catch (_) { return []; }
}
function writeMeta(psid, list) { fs.mkdirSync(dirOf(psid), { recursive: true }); fs.writeFileSync(path.join(dirOf(psid), "meta.json"), JSON.stringify(list)); }

// Буцаах: { ok, reason? }
function save(psid, buf, { caption, section, name } = {}) {
  if (!safe(psid) || !buf || !buf.length) return { ok: false, reason: "хоосон" };
  if (buf.length > MAX_BYTES) return { ok: false, reason: "хэт том" };
  const d = dims(buf);
  if (!d || !d.w || !d.h) return { ok: false, reason: "JPG эсвэл PNG биш" };
  const hash = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16);
  const list = readMeta(psid).filter((x) => Date.now() - (x.at || 0) < TTL_DAYS * 86400e3);
  if (list.some((x) => x.hash === hash)) return { ok: true, dup: true };
  if (list.length >= MAX_PER) return { ok: false, reason: `${MAX_PER}-аас олон зураг` };
  const file = `${hash}.${d.type}`;
  fs.mkdirSync(dirOf(psid), { recursive: true });
  fs.writeFileSync(path.join(dirOf(psid), file), buf);
  list.push({ file, hash, type: d.type, w: d.w, h: d.h, caption: String(caption || "Зураг").slice(0, 120), section: SECTIONS[section] ? section : "3.1", name: String(name || "").slice(0, 80), at: Date.now() });
  writeMeta(psid, list);
  return { ok: true };
}

// Бүлэг тус бүрээр: { "2.4": [{buf, fmt, w, h, caption}], ... }
function load(psid) {
  const out = {};
  for (const m of readMeta(psid)) {
    if (Date.now() - (m.at || 0) > TTL_DAYS * 86400e3) continue;
    try { const buf = fs.readFileSync(path.join(dirOf(psid), m.file)); (out[m.section] = out[m.section] || []).push({ buf, fmt: m.type, w: m.w, h: m.h, caption: m.caption }); } catch (_) { }
  }
  return out;
}
const count = (psid) => readMeta(psid).length;
function clear(psid) { try { fs.rmSync(dirOf(psid), { recursive: true, force: true }); } catch (_) { } }

// Бичсэн бүлгүүдэд зургийн блок нэмсэн хуулбар (snapshot-д хадгалахгүй, зөвхөн баримт угсрахад)
function withPhotos(written, byId) {
  if (!byId || !Object.keys(byId).length) return written;
  const w = { ...written };
  for (const [id, list] of Object.entries(byId)) w[id] = [...(w[id] || []), ...list.map((p) => ({ ...p, type: "photo" }))];
  return w;
}

module.exports = { save, load, count, clear, withPhotos, dims, SECTIONS };
