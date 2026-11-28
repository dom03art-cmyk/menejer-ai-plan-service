// Хөнгөлөлтийн код. Зөвхөн админ (ADMIN_PSID) Messenger-ээр үүсгэнэ:
//   «код 99900»                         — нэг удаагийн код, бизнес төслийн үнэ 99 900₮ болно (30 хоног хүчинтэй)
//   «код 20%»                           — нэг удаагийн код, бүх үйлчилгээнд 20%
//   «код КЛУБ 20% 30 хоног [50 хүн] [бизнес|маркетинг|тайлан|тендер]» — нэртэй, олон хүнд, хугацаатай
//   «код КЛУБ -30000 14 хоног»          — 30 000₮ хасна
//   «код зогсоо КЛУБ», «кодууд»
// Захиалагч «код КЛУБ» гэж бичиж идэвхжүүлнэ. Нэг хүн нэг кодыг нэг л удаа ашиглана.
// Хөнгөлөлт нь дараагийн QPay нэхэмжлэхийн дүнд (qpay.createInvoice) автоматаар орж, төлбөр бүрэн орсны дараа «ашигласан» болно.
// Хуурамч хөнгөлөлт сурталчлахгүй: код зөвхөн админы өгсөн хүнд хамаарна, бот өөрөө санал болгохгүй.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const FILE = () => process.env.PROMO_FILE || (fs.existsSync("/var/data") ? "/var/data/promo.json" : path.join(require("os").tmpdir(), "promo.json"));
const DAY = 86400e3, REDEEM_DAYS = 30, MIN_PRICE = 1000;
const PRODUCTS = { "бизнес": "biz", "маркетинг": "mkt", "тайлан": "org", "төлөвлөгөө": "org", "тендер": "tender" };
const PNAME = { biz: "бизнес төсөл", mkt: "маркетингийн төлөвлөгөө", org: "тайлан, төлөвлөгөө", tender: "тендерийн материал" };
const money = (n) => `${Math.round(n).toLocaleString("en-US")}₮`;
const day = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10); // Улаанбаатарын цаг

function load() { try { return JSON.parse(fs.readFileSync(FILE(), "utf8")); } catch (_) { return { codes: {}, redeem: {} }; } }
function save(db) { const f = FILE(); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + ".tmp", JSON.stringify(db)); fs.renameSync(f + ".tmp", f); }
const norm = (s) => String(s || "").trim().toUpperCase().replace(/[^0-9A-ZА-ЯЁӨҮ-]/g, "");
const isAdmin = (psid) => !!process.env.ADMIN_PSID && String(psid) === String(process.env.ADMIN_PSID);
function autoName(db) { const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let n; do { n = "НАЙЗ-" + Array.from(crypto.randomBytes(4), (b) => A[b % A.length]).join(""); } while (db.codes[n]); return n; }
const live = (c, now = Date.now()) => c && c.active && c.expires > now && (!c.maxUses || (c.uses || 0) < c.maxUses);
function describe(c) {
  const what = c.type === "pct" ? `${c.value}% хөнгөлөлт` : c.type === "off" ? `${money(c.value)} хасна` : `үнэ ${money(c.value)}`;
  const where = c.products ? c.products.map((p) => PNAME[p]).join(", ") : "бүх үйлчилгээ";
  return `${what} (${where}), ${day(c.expires)} хүртэл${c.maxUses ? `, ${c.maxUses} хүн хүртэл` : ""}`;
}

// ---- клипер (контент бүтээгч) ----
// «код клипер БОЛД»            — БОЛД нэртэй код: худалдан авагчид CLIPPER_PCT% (анхдагч 20%), 1 жил, хүний тоо хязгааргүй;
//                                 төлбөр бүрэн орсон борлуулалт бүрт клиперт CLIPPER_REWARD (анхдагч 10 000₮) урамшуулал тооцно
// «код клипер БОЛД 15% 90 хоног» — хувь, хугацааг өөрчилж болно
// «код клипер тайлан»          — клипер бүрийн борлуулалт, төлөх урамшуулал
// «код клипер төлсөн БОЛД»     — БОЛД-д урамшууллыг шилжүүлсэн гэж тэмдэглэнэ (үлдэгдэл 0 болно)
const REWARD = () => Number(process.env.CLIPPER_REWARD || 10000);
const CPCT = () => Number(process.env.CLIPPER_PCT || 20);
function clipperCommand(t) {
  const m = t.match(/^код\s+клипер(?:\s+(.*))?$/i); if (!m) return null;
  const rest = String(m[1] || "").trim(), db = load();
  if (!rest || /^тайлан$/i.test(rest)) {
    const list = Object.values(db.codes).filter((c) => c.clipper).map((c) => {
      const n = (c.clipper.sales || []).length, paid = c.clipper.paidCount || 0, owe = (n - paid) * c.clipper.reward;
      return `• ${c.name}${live(c) ? "" : " (зогссон)"}: ${n} борлуулалт, төлөх ${money(owe)}${paid ? ` (өмнө ${paid}-ийг төлсөн)` : ""}`;
    });
    return list.length ? `🎬 Клиперүүд:\n${list.join("\n")}\n\nТөлсний дараа «код клипер төлсөн НЭР» гэж бичнэ үү.` : "Клипер алга. «код клипер НЭР» гэж үүсгэнэ.";
  }
  let x = rest.match(/^төлсөн\s+(\S+)$/i);
  if (x) {
    const c = db.codes[norm(x[1])]; if (!c || !c.clipper) return `«${norm(x[1])}» клипер олдсонгүй.`;
    const n = (c.clipper.sales || []).length, owe = (n - (c.clipper.paidCount || 0)) * c.clipper.reward;
    c.clipper.paidCount = n; c.clipper.payments = [...(c.clipper.payments || []), { at: Date.now(), amount: owe }]; save(db);
    return `✅ ${c.name}: ${money(owe)} төлсөн гэж тэмдэглэлээ. Үлдэгдэл 0.`;
  }
  const words = rest.split(/\s+/), name = norm(words[0]);
  if (!name || name.length < 3) return "Клиперийн кодын нэр 3-аас дээш тэмдэгт байна. Жишээ: «код клипер БОЛД».";
  if (db.codes[name] && live(db.codes[name])) return `«${name}» нэртэй идэвхтэй код байна. Өөр нэр сонгоно уу.`;
  const opts = " " + words.slice(1).join(" ") + " ";
  const pct = opts.match(/\s(\d+(?:[.,]\d+)?)\s*%\s/), days = opts.match(/\s(\d+)\s*хоног\s/i);
  const value = pct ? Number(pct[1].replace(",", ".")) : CPCT();
  if (!(value > 0 && value < 100)) return "Хувь 1–99 хооронд байна.";
  db.codes[name] = { active: true, uses: 0, usedBy: {}, createdAt: Date.now(), name, type: "pct", value, products: null, maxUses: 0,
    expires: Date.now() + (days ? Number(days[1]) : 365) * DAY, clipper: { reward: REWARD(), sales: [], paidCount: 0 } };
  save(db);
  return `✅ Клипер код үүслээ: ${name}\n${describe(db.codes[name])}. Борлуулалт бүрт клиперт ${money(REWARD())}.\n\nКлипер үзэгчиддээ: «Менежер AI пэйж рүү чатаар "код ${name}" гэж бичээд ${value}% хөнгөлөлт аваарай» гэж хэлнэ.\nТайлан: «код клипер тайлан».`;
}

// ---- админы тушаал ----
function adminCommand(text) {
  const clip = clipperCommand(String(text || "").trim()); if (clip) return clip;
  const db = load(), t = String(text || "").trim();
  if (/^кодууд$/i.test(t)) {
    const list = Object.values(db.codes).filter((c) => live(c)).map((c) => `• ${c.name}: ${describe(c)} — ${c.uses || 0} хүн ашигласан`);
    return list.length ? `Идэвхтэй кодууд:\n${list.join("\n")}` : "Идэвхтэй код алга.";
  }
  let m = t.match(/^код\s+зогсоо\s+(\S+)$/i);
  if (m) { const c = db.codes[norm(m[1])]; if (!c) return `«${norm(m[1])}» код олдсонгүй.`; c.active = false; save(db); return `⛔ «${c.name}» кодыг зогсоолоо.`; }
  m = t.match(/^код\s+(.+)$/i); if (!m) return null;
  let rest = " " + m[1] + " ";
  const take = (re) => { const x = rest.match(re); if (x) rest = rest.replace(x[0], " "); return x; };
  const days = take(/\s(\d+)\s*хоног\s/i), people = take(/\s(\d+)\s*хүн\s/i), pct = take(/\s(\d+(?:[.,]\d+)?)\s*%\s/), off = take(/\s-\s*(\d[\d\s,]*\d|\d)\s*₮?\s/);
  const products = [];
  for (const w of Object.keys(PRODUCTS)) { const x = take(new RegExp(`\\s${w}\\S*\\s`, "i")); if (x && !products.includes(PRODUCTS[w])) products.push(PRODUCTS[w]); }
  const price = take(/\s(\d[\d\s,]*\d|\d)\s*₮?\s/);
  const words = rest.trim().split(/\s+/).filter(Boolean);
  const help = "Жишээ: «код 99900» (нэг удаагийн, бизнес төслийн үнэ), «код 20%», «код КЛУБ 20% 30 хоног 50 хүн», «код КЛУБ -30000 14 хоног маркетинг», «код зогсоо КЛУБ», «кодууд».";
  if (words.length > 1) return `Тушаалыг ойлгосонгүй. ${help}`;
  const c = { active: true, uses: 0, usedBy: {}, createdAt: Date.now() };
  const num = (x) => Number(String(x).replace(/[\s,]/g, ""));
  if (pct) { c.type = "pct"; c.value = Number(String(pct[1]).replace(",", ".")); if (!(c.value > 0 && c.value < 100)) return "Хувь 1–99 хооронд байна."; }
  else if (off) { c.type = "off"; c.value = num(off[1]); if (!(c.value >= 1000)) return "Хасах дүн 1 000₮-өөс их байна."; }
  else if (price) { c.type = "price"; c.value = num(price[1]); if (!(c.value >= MIN_PRICE)) return "Үнэ 1 000₮-өөс их байна."; if (!products.length) products.push("biz"); }
  else return `Хөнгөлөлтийн хэмжээг бичнэ үү. ${help}`;
  if (c.type === "price" && products.length > 1) return "Тогтмол үнэ нэг үйлчилгээнд л ажиллана. Олон үйлчилгээнд хувиар (жишээ нь 20%) бичнэ үү.";
  c.products = products.length ? products : null;
  const multi = !!(days || people);
  c.maxUses = people ? Number(people[1]) : multi ? 0 : 1;
  c.expires = Date.now() + (days ? Number(days[1]) : 30) * DAY;
  c.name = words[0] ? norm(words[0]) : autoName(db);
  if (!c.name || c.name.length < 3) return "Кодын нэр 3-аас дээш тэмдэгт байна.";
  if (db.codes[c.name] && live(db.codes[c.name])) return `«${c.name}» нэртэй идэвхтэй код байна. Өөр нэр сонгох эсвэл «код зогсоо ${c.name}» гэж бичнэ үү.`;
  db.codes[c.name] = c; save(db);
  return `✅ Код үүслээ: ${c.name}\n${describe(c)}${c.maxUses === 1 ? ", 1 удаа" : ""}.\n\nЗахиалагч чатандаа «код ${c.name}» гэж бичнэ.`;
}

// ---- захиалагч идэвхжүүлэх ----
function redeem(psid, text) {
  const m = String(text || "").trim().match(/^(?:код|kod)\s*[:\-]?\s*(\S+)$/i);
  if (!m) return { ok: false, msg: "Кодоо «код КОДЫН_НЭР» хэлбэрээр бичнэ үү." };
  const db = load(), name = norm(m[1]), c = db.codes[name];
  if (!c || !live(c)) return { ok: false, msg: "❌ Ийм код олдсонгүй эсвэл хугацаа нь дууссан байна." };
  if (c.usedBy && c.usedBy[psid]) return { ok: false, msg: "Та энэ кодыг өмнө нь ашигласан байна." };
  db.redeem[psid] = { code: name, at: Date.now() }; save(db);
  return { ok: true, code: c, msg: `✅ «${name}» код идэвхжлээ: ${describe(c)}.\n\nДараагийн захиалгын төлбөрт хөнгөлөлт автоматаар тооцогдоно. Үйлчилгээгээ сонгоно уу.\n\nХэрэв нэхэмжлэх аль хэдийн ирсэн бол «Цуцлах» дараад дахин захиалбал хөнгөлөлттэй үнээр гарна.` };
}

// ---- нэхэмжлэхийн дүнд хэрэглэх ----
function productOf(kind, meta) {
  if (kind === "biz") return "biz";
  if (kind === "tender") return "tender";
  if (kind === "flow") return meta && meta.product === "marketing" ? "mkt" : meta && meta.product === "bplan" ? "biz" : "org";
  return null; // засвар (bizrev), туршилт — хөнгөлөхгүй
}
function apply(psid, kind, meta, amount) {
  const db = load(), r = db.redeem[String(psid)];
  if (!r || Date.now() - r.at > REDEEM_DAYS * DAY) return null;
  const c = db.codes[r.code], p = productOf(kind, meta);
  if (!p || !live(c) || (c.usedBy && c.usedBy[psid]) || (c.products && !c.products.includes(p))) return null;
  let v = c.type === "pct" ? amount * (1 - c.value / 100) : c.type === "off" ? amount - c.value : c.value;
  v = Math.max(MIN_PRICE, Math.round(v / 100) * 100);
  if (!(v < amount)) return null;
  return { code: c.name, before: amount, amount: v };
}
function consume(psid, code) {
  const db = load(), c = db.codes[code]; if (!c) return;
  let sale = false;
  c.usedBy = c.usedBy || {}; if (!c.usedBy[psid]) { c.usedBy[psid] = Date.now(); c.uses = (c.uses || 0) + 1; if (c.clipper) { (c.clipper.sales = c.clipper.sales || []).push({ psid: String(psid), at: Date.now() }); sale = true; } }
  if (db.redeem[psid] && db.redeem[psid].code === code) delete db.redeem[psid];
  save(db);
  if (sale && process.env.ADMIN_PSID) {
    const n = c.clipper.sales.length, owe = (n - (c.clipper.paidCount || 0)) * c.clipper.reward;
    try { Promise.resolve(require("./flow")._send(process.env.ADMIN_PSID, `🎬 Клипер «${c.name}»-ээр борлуулалт орлоо (нийт ${n}). Клиперт төлөх үлдэгдэл: ${money(owe)}.`)).catch(() => { }); } catch (_) { }
  }
}
const isCodeText = (t) => /^\s*(?:код|kod)(?:ууд|\s|:|$)/i.test(String(t || ""));
module.exports = { adminCommand, redeem, apply, consume, isAdmin, isCodeText, _file: FILE };
