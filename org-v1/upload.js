// Байгууллагын төлөвлөгөө / тайлангийн материал илгээх хуудас (org-v1). АГУУЛГЫГ УНШИХГҮЙ — зөвхөн хадгалж, тоолж, үнэ бодно.
// POST /org/upload-link     (x-api-key) { psid, product } → { url }
// GET  /u/org/:token        → утсанд зориулсан хуудас
// GET  /u/org/:token/list   → хадгалсан файлууд, нийт хуудас, үнэ
// POST /u/org/:token/file   → нэг файл: application/octet-stream (x-file-name, x-file-type толгой) эсвэл JSON { name, type, data(base64) }
// POST /u/org/:token/remove → { id } хадгалсан файлыг хасна
// POST /u/org/:token/done   → нийт дүн, үнийг Messenger-ээр мэдэгдэж ORG_QUOTE_WEBHOOK-д илгээнэ
// GET  /org/quote/:psid, POST /org/clear/:psid (x-api-key)
const express = require("express");
const crypto = require("crypto");
const { countFile, priceFor, fmtMoney, kindOf, PRODUCTS } = require("./quote");
const M = require("./materials");
const util = require("../plan-v2/util");

const router = express.Router();
const BASE = () => process.env.PUBLIC_URL || "https://menejer-ai-plan-service.onrender.com";
const LINK_DAYS = () => Number(process.env.ORG_LINK_TTL_DAYS || process.env.ORG_FILES_TTL_DAYS || 14);

// ---- Токен: psid.productCode.expiry(base36).HMAC — plan-v2-ийн токеноос тусдаа нууц угтвартай ----
const CODES = { plan: "p", report_dept: "d", report_dir: "r", bundle: "b", plan_dept: "q", bundle_dept: "e" };
const BY_CODE = Object.fromEntries(Object.entries(CODES).map(([k, v]) => [v, k]));
const secret = () => "org-v1:" + (process.env.UPLOAD_SECRET || process.env.API_KEY || "dev");
const sign = (s) => crypto.createHmac("sha256", secret()).update("org|" + s).digest("hex").slice(0, 24);
function tokenFor(psid, product, days = LINK_DAYS()) {
  const exp = Math.floor(Date.now() / 1000 + days * 86400).toString(36);
  const body = `${psid}.${CODES[product]}.${exp}`;
  return `${body}.${sign(body)}`;
}
// → { psid, product } | { expired: true } | null
function verify(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4) return null;
  const [psid, code, exp, sig] = parts;
  if (!psid || !BY_CODE[code] || !/^[0-9a-z]+$/.test(exp) || sig.length !== 24) return null;
  const want = sign(`${psid}.${code}.${exp}`);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (parseInt(exp, 36) * 1000 < Date.now()) return { expired: true };
  return { psid, product: BY_CODE[code] };
}
const EXPIRED = "Холбоосны хугацаа дууссан байна. Messenger-ээр шинэ холбоос авна уу.";
function tok(req, res, json = true) {
  const t = verify(req.params.token);
  if (t && !t.expired) return t;
  const msg = t && t.expired ? EXPIRED : "Холбоос буруу байна.";
  if (json) res.status(404).json({ ok: false, error: msg }); else res.status(404).set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><p style="font-family:Arial;padding:24px">${msg}</p>`);
  return null;
}
const auth = (req, res, next) => (req.get("x-api-key") === process.env.API_KEY && process.env.API_KEY ? next() : res.status(401).json({ error: "unauthorized" }));

async function send(psid, text) {
  try { await util.fbText(psid, text); } catch (e) { console.warn("[org-upload] Messenger илгээж чадсангүй:", e.message); }
}
async function summary(psid, product) {
  const files = await M.listFiles(psid), units = M.totalUnits(files), q = priceFor(product, units);
  return { files, units, price: q.price, priceText: fmtMoney(q.price) + (q.full ? ` (тусад нь ${fmtMoney(q.full)})` : ""), tier: q.tier, name: q.name, full: q.full || null };
}
const pub = (f) => ({ id: f.id, name: f.name, units: f.units, note: f.note, kind: f.kind, size: f.size });

router.post("/org/upload-link", express.json(), auth, async (req, res) => {
  const { psid, product } = req.body || {};
  if (!psid) return res.status(400).json({ error: "psid" });
  if (!PRODUCTS[product]) return res.status(400).json({ error: "product: plan | report_dept | report_dir | bundle | plan_dept | bundle_dept" });
  await M.setMeta(psid, { product }).catch(e => console.warn("[org-upload] meta:", e.message));
  res.json({ url: `${BASE()}/u/org/${tokenFor(psid, product)}` });
});

router.get("/u/org/:token", (req, res) => {
  const t = tok(req, res, false); if (!t) return;
  res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).send(page(t.product));
});

router.get("/u/org/:token/list", async (req, res) => {
  const t = tok(req, res); if (!t) return;
  try { const s = await summary(t.psid, t.product); res.json({ ok: true, ...s, files: s.files.map(pub) }); }
  catch (e) { console.warn("[org-upload] list:", e.message); res.status(500).json({ ok: false, error: "Систем түр саатаж байна" }); }
});

const rawBody = express.raw({ type: "application/octet-stream", limit: "26mb" });
const jsonBody = express.json({ limit: "36mb" });
router.post("/u/org/:token/file", (req, res, next) => rawBody(req, res, (e) => e ? next(e) : jsonBody(req, res, next)), async (req, res) => {
  const t = tok(req, res); if (!t) return;
  let name, mime, buf;
  if (Buffer.isBuffer(req.body)) {
    try { name = decodeURIComponent(req.get("x-file-name") || "файл"); } catch (_) { name = req.get("x-file-name") || "файл"; }
    mime = req.get("x-file-type") || ""; buf = req.body;
  } else {
    const b = req.body || {}; name = String(b.name || "файл"); mime = String(b.type || ""); buf = Buffer.from(String(b.data || ""), "base64");
  }
  const reject = async (error) => { await M.addRejected(t.psid, { name, reason: error }).catch(() => { }); const s = await summary(t.psid, t.product).catch(() => null); return res.json({ ok: false, units: 0, error, ...(s ? { total: s.units, price: s.price, priceText: s.priceText, tier: s.tier } : {}) }); };
  try {
    if (!buf.length) return reject("Файл хоосон байна");
    if (buf.length > M.LIMITS.maxFileBytes) return reject(`Файл хэт том байна (${(buf.length / 1048576).toFixed(1)}MB). Нэг файл 25MB хүртэл байна.`);
    const c = await countFile({ buf, name, mime });
    if (c.error) return reject(c.error);
    const r = await M.addFile(t.psid, { name, mime, buf, count: c });
    if (!r.ok) return reject(r.error);
    const s = await summary(t.psid, t.product);
    res.json({ ok: true, id: r.file.id, units: r.file.units, note: r.file.note || "", duplicate: !!r.duplicate, total: s.units, price: s.price, priceText: s.priceText, tier: s.tier });
  } catch (e) {
    console.warn("[org-upload] file:", name, e.message);
    res.json({ ok: false, units: 0, error: "Файлыг хадгалж чадсангүй. Дахин оролдоно уу." });
  }
});
// Хэт том хүсэлт (413) г.м. алдааг JSON-оор
router.use("/u/org/:token/file", (err, req, res, next) => {
  if (err && (err.type === "entity.too.large" || err.status === 413)) return res.status(413).json({ ok: false, units: 0, error: "Файл хэт том байна. Нэг файл 25MB хүртэл байна." });
  next(err);
});

router.post("/u/org/:token/remove", express.json(), async (req, res) => {
  const t = tok(req, res); if (!t) return;
  const ok = await M.removeFile(t.psid, String((req.body || {}).id || "")).catch(() => false);
  const s = await summary(t.psid, t.product);
  res.json({ ok, total: s.units, price: s.price, priceText: s.priceText, tier: s.tier });
});

router.post("/u/org/:token/done", express.json(), async (req, res) => {
  const t = tok(req, res); if (!t) return;
  try {
    const s = await summary(t.psid, t.product);
    if (!s.files.length && t.product !== "plan") return res.status(400).json({ ok: false, error: "Та нэг ч файл илгээгээгүй байна. Тайланд ашиглах материалаа эхлээд илгээнэ үү." });
    const rej = await M.listRejected(t.psid);
    const quote = { units: s.units, price: s.price, tier: s.tier, files: s.files.length, at: new Date().toISOString() };
    await M.setMeta(t.psid, { product: t.product, quote });
    await M.clearRejected(t.psid);
    await send(t.psid, doneText(t.product, s, rej));
    try { await require("./flow").onQuote(t.psid, t.product, quote); } catch (e) { console.warn("[org-upload] flow:", e.message); }
    if (process.env.ORG_QUOTE_WEBHOOK) {
      try {
        const r = await fetch(process.env.ORG_QUOTE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ psid: t.psid, product: t.product, units: s.units, price: s.price, files: s.files.length }), signal: AbortSignal.timeout(15000) });
        if (!r.ok) console.warn("[org-upload] webhook", r.status);
      } catch (e) { console.warn("[org-upload] webhook:", e.message); }
    }
    res.json({ ok: true, units: s.units, price: s.price, priceText: s.priceText, tier: s.tier, files: s.files.length });
  } catch (e) {
    console.warn("[org-upload] done:", e.message);
    res.status(500).json({ ok: false, error: "Систем түр саатаж байна. Дахин оролдоно уу." });
  }
});

function doneText(product, s, rej) {
  const parts = [`${s.name}`];
  if (s.files.length) parts.push(`Хүлээн авсан материал (${s.files.length} файл):\n` + s.files.map((f, i) => `${i + 1}. ${f.name} — ${f.units} хуудас${f.note ? ` (${f.note})` : ""}`).join("\n"));
  else parts.push("Та материал илгээгээгүй байна. Төлөвлөгөөг таны Messenger-ээр өгсөн мэдээлэлд үндэслэн боловсруулна.");
  if (rej.length) parts.push(`Хүлээн аваагүй файл (${rej.length}):\n` + rej.map((f, i) => `${i + 1}. ${f.name} — ${f.reason}`).join("\n"));
  parts.push(`Таны илгээсэн материалын хэмжээ: ${s.units} хуудас\nҮнийн шатлал: ${s.tier} хуудас\n${s.full ? `Тусад нь авбал: ${fmtMoney(s.full)}\nБагцын үнэ (15% хөнгөлөлт): ${fmtMoney(s.price)}` : `Үнэ: ${fmtMoney(s.price)}`}`);
  parts.push("Материалын агуулгыг төлбөр баталгаажсаны дараа л уншиж боловсруулна. Төлбөр хийхээс өмнө нэмэлт файл байвал мөн л холбоосоор илгээж болно, үнэ дахин тооцогдоно.");
  return parts.join("\n\n");
}

// ---- API (Make) ----
router.get("/org/quote/:psid", auth, async (req, res) => {
  try {
    const psid = req.params.psid, meta = await M.getMeta(psid), files = await M.listFiles(psid), units = M.totalUnits(files);
    const product = (meta && meta.product) || null;
    const q = product && PRODUCTS[product] ? priceFor(product, units) : null;
    res.json({ psid, meta, product, units, price: q ? q.price : null, tier: q ? q.tier : null, files: files.map(pub), rejected: await M.listRejected(psid) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/org/clear/:psid", auth, async (req, res) => {
  try { res.json({ ok: true, removed: await M.clear(req.params.psid) }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Хуудас ----
const COPY = {
  plan: { title: "Жилийн төлөвлөгөө, төсөвт материал илгээх", intro: "Байгаа материалаа илгээвэл төлөвлөгөөг танай байгууллагын бодит мэдээлэлд илүү ойр боловсруулна. Бүгд заавал биш — байхгүй бол шууд «Дууслаа» дарна уу.",
    list: ["Өмнөх жилийн үйл ажиллагааны төлөвлөгөө", "Өмнөх жилийн тайлан (үйл ажиллагаа, санхүү)", "Орлого, зарлагын задаргаа (Excel)", "Орон тоо, цалингийн мэдээлэл", "Байгууллагын бүтэц, хэлтсүүд", "Стратеги, зорилт, ТУЗ/удирдлагын шийдвэр (байвал)"] },
  report_dept: { title: "Хэлтэс, албан тушаалын тайланд материал илгээх", intro: "Тайлангийн хугацаанд хийсэн ажлаа харуулах материалаа илгээнэ үү. Тоо баримтыг зөвхөн таны материалаас авна. Энэ тайлан нэг хэлтэс, албан тушаалын хүрээнд бичигдэнэ; байгууллагын бүтэн (ТУЗ-д тавих) тайлан хэрэгтэй бол «Гүйцэтгэх захирлын тайлан»-г сонгоно уу.",
    list: ["Ажлын төлөвлөгөө (жил, улирал, сар)", "Сарын, улирлын тайлангууд", "Гүйцэтгэлийн хүснэгт (Excel)", "KPI, шалгуур үзүүлэлтийн биелэлт", "Хурлын тэмдэглэл, шийдвэр", "Зураг, баримт (арга хэмжээ, ажлын үр дүн)"] },
  plan_dept: { title: "Хэлтсийн ирэх оны төлөвлөгөөнд материал илгээх", intro: "Өнгөрсөн оны ажлаа харуулах материалаа илгээнэ үү: үүний бодит дүнг суурь болгож ирэх оны зорилт, ажлыг төлөвлөнө. Тоо баримтыг зөвхөн таны материалаас авна.",
    list: ["Өнгөрсөн оны ажлын төлөвлөгөө, тайлан", "Гүйцэтгэлийн хүснэгт, KPI (Excel)", "Хэлтсийн чиг үүрэг, ажлын байрны тодорхойлолт", "Удирдлагаас өгсөн чиглэл, байгууллагын зорилт (байвал)", "Хурлын тэмдэглэл, шийдвэр", "Ирэх онд хийх санаа, санал (тэмдэглэл)"] },
  bundle_dept: { title: "Хэлтсийн тайлан ба ирэх оны төлөвлөгөөнд материал илгээх", intro: "Нэг материалаар өнгөрсөн оны ажлын тайлан ба ирэх оны ажлын төлөвлөгөөг хоёуланг нь боловсруулна. Тоо баримтыг зөвхөн таны материалаас авна.",
    list: ["Ажлын төлөвлөгөө (жил, улирал, сар)", "Сарын, улирлын тайлангууд", "Гүйцэтгэлийн хүснэгт, KPI (Excel)", "Хэлтсийн чиг үүрэг", "Хурлын тэмдэглэл, шийдвэр", "Ирэх онд хийх санаа, санал (тэмдэглэл)"] },
  bundle: { title: "Захирлын тайлан ба жилийн төлөвлөгөөнд материал илгээх", intro: "Нэг материалаар өнгөрсөн жилийн захирлын тайлан ба ирэх жилийн төлөвлөгөө, төсвийг хоёуланг нь боловсруулна. Тоо баримтыг зөвхөн таны материалаас авна.",
    list: ["Санхүүгийн тайлан (баланс, орлого үр дүн, мөнгөн гүйлгээ)", "Борлуулалт, орлого зарлагын задаргаа (Excel)", "Хэлтсүүдийн тайлан, төлөвлөгөөний биелэлт, KPI", "Орон тоо, цалингийн мэдээлэл, байгууллагын бүтэц", "ТУЗ-ийн шийдвэр, стратеги, ирэх жилийн зорилт", "Төсөл, хөрөнгө оруулалт, эрсдэлийн мэдээлэл (байвал)"] },
  report_dir: { title: "Гүйцэтгэх захирлын тайланд материал илгээх", intro: "ТУЗ-д танилцуулах тайланд байгууллагын тоо баримтыг зөвхөн таны материалаас авна.",
    list: ["Санхүүгийн тайлан (баланс, орлого үр дүн, мөнгөн гүйлгээ)", "Борлуулалт, орлогын задаргаа", "Хэлтсүүдийн тайлан", "Төлөвлөгөөний биелэлт, KPI", "ТУЗ-ийн шийдвэр, өмнөх хурлын тэмдэглэл", "Төсөл, хөрөнгө оруулалт, эрсдэлийн мэдээлэл (байвал)"] },
};
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Хөтөч дээр ажиллах код — энгийн функц (template literal-ийн escape алдаанаас сэргийлж toString()-оор оруулна)
function client(CFG) {
  var $ = function (id) { return document.getElementById(id); };
  var input = $("f"), list = $("list"), btn = $("send"), doneBtn = $("done"), msg = $("msg");
  var files = [], busy = false, total = 0;
  var base = location.pathname.replace(/\/$/, "");
  var MAXB = 25 * 1024 * 1024;
  function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  function isMedia(f) { return /^(video|audio)\//.test(f.type || "") || /\.(mp4|mov|avi|mkv|webm|3gp|m4a|mp3|aac|ogg|wav|amr|opus)$/i.test(f.name); }
  function isImg(f) { return /^image\//.test(f.type || "") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name); }
  function setTotal(j) {
    if (!j || j.total === undefined) return; total = j.total;
    $("tot").textContent = j.total + " хуудас"; $("price").textContent = j.priceText || ""; $("tier").textContent = j.tier ? "Шатлал: " + j.tier + " хуудас" : "";
  }
  function render() {
    list.innerHTML = files.map(function (it, i) {
      var x = busy ? "" : ' <a href="#" data-i="' + i + '" class="x">×</a>';
      return '<li><span class="nm">' + esc(it.name) + '</span><span class="st ' + it.cls + '">' + esc(it.st) + x + '</span></li>';
    }).join("");
    btn.disabled = busy || !files.some(function (it) { return it.f && !it.sent; });
    doneBtn.disabled = busy || (!CFG.allowEmpty && !files.some(function (it) { return it.id; }));
  }
  list.onclick = function (e) {
    var a = e.target.closest && e.target.closest("a[data-i]"); if (!a) return; e.preventDefault();
    var i = +a.getAttribute("data-i"), it = files[i]; if (!it) return;
    if (it.id) {
      busy = true; render();
      fetch(base + "/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id }) })
        .then(function (r) { return r.json(); }).then(function (j) { setTotal(j); files.splice(files.indexOf(it), 1); })
        .catch(function () { }).then(function () { busy = false; render(); });
    } else { files.splice(i, 1); render(); }
  };
  input.onchange = function () {
    for (var k = 0; k < input.files.length; k++) {
      var f = input.files[k];
      if (files.some(function (it) { return it.name === f.name && it.size === f.size; })) continue;
      if (isMedia(f)) files.push({ name: f.name, size: f.size, st: "видео, дуу хүлээж авахгүй", cls: "err", sent: true });
      else if (!isImg(f) && f.size > MAXB) files.push({ name: f.name, size: f.size, st: "хэт том (25MB хүртэл)", cls: "err", sent: true });
      else files.push({ f: f, name: f.name, size: f.size, st: "бэлэн", cls: "wait", sent: false });
    }
    input.value = ""; render();
  };
  function shrink(f) {
    if (!isImg(f) || /gif/i.test(f.type) || !window.createImageBitmap && !window.Image) return Promise.resolve(f);
    return new Promise(function (ok) {
      var url = URL.createObjectURL(f), img = new Image();
      img.onerror = function () { URL.revokeObjectURL(url); ok(f); };
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, M = 2000;
        if (f.size < 1500000 && w <= M && h <= M && /jpe?g|png/i.test(f.type)) { URL.revokeObjectURL(url); return ok(f); }
        var k = Math.min(1, M / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
        var c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
        var q = 0.85;
        (function step() {
          c.toBlob(function (b) {
            if (!b) return ok(f);
            if (b.size > 3000000 && q > 0.4) { q -= 0.15; return step(); }
            ok(new File([b], f.name.replace(/\.(heic|heif|png|webp|jpe?g)$/i, "") + ".jpg", { type: "image/jpeg" }));
          }, "image/jpeg", q);
        })();
      };
      img.src = url;
    });
  }
  btn.onclick = function () {
    busy = true; msg.textContent = ""; render();
    var queue = files.filter(function (it) { return it.f && !it.sent; });
    (function next() {
      var it = queue.shift();
      if (!it) { busy = false; render(); msg.textContent = "Файлууд хадгалагдлаа. Бүгдийг илгээж дуусаад «Дууслаа» дарна уу."; return; }
      it.st = "илгээж байна…"; it.cls = "wait"; render();
      shrink(it.f).then(function (g) {
        return fetch(base + "/file", { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent(it.f.name), "x-file-type": g.type || "" }, body: g });
      }).then(function (r) { return r.json(); }).then(function (j) {
        it.sent = true; setTotal(j);
        if (j.ok) { it.id = j.id; it.st = j.units + " хуудас" + (j.note ? " (" + j.note + ")" : ""); it.cls = "ok"; }
        else { it.st = j.error || "алдаа"; it.cls = "err"; }
      }).catch(function () { it.st = "сүлжээний алдаа — дахин сонгоно уу"; it.cls = "err"; it.sent = true; })
        .then(function () { render(); next(); });
    })();
  };
  doneBtn.onclick = function () {
    if (files.some(function (it) { return it.f && !it.sent; }) && !confirm("Илгээгээгүй файл байна. Тэдгээрийг орхиод дуусгах уу?")) return;
    busy = true; render();
    fetch(base + "/done", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) { msg.textContent = "Баярлалаа. Нийт " + j.units + " хуудас, үнэ " + j.priceText + ". Дэлгэрэнгүйг Messenger-ээр илгээлээ. Messenger руугаа буцна уу."; msg.className = "ok big"; }
        else { msg.textContent = j.error || "Алдаа гарлаа"; msg.className = "err"; }
      }).catch(function () { msg.textContent = "Сүлжээний алдаа. Дахин оролдоно уу."; msg.className = "err"; })
      .then(function () { busy = false; render(); });
  };
  fetch(base + "/list").then(function (r) { return r.json(); }).then(function (j) {
    if (!j.ok) return;
    j.files.forEach(function (f) { files.push({ id: f.id, name: f.name, size: f.size, st: f.units + " хуудас" + (f.note ? " (" + f.note + ")" : ""), cls: "ok", sent: true }); });
    setTotal({ total: j.units, priceText: j.priceText, tier: j.tier }); render();
  }).catch(function () { });
  render();
}

function page(product) {
  const c = COPY[product], base = priceFor(product, 0);
  const cfg = JSON.stringify({ product, allowEmpty: product === "plan" }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="mn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Менежер AI — Материал илгээх</title>
<style>
:root{--navy:#1B2A4A;--gold:#C9A227;--bg:#F6F4EE}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:#222}
.wrap{max-width:520px;margin:0 auto;padding:22px 16px 40px}
h1{color:var(--navy);font-size:21px;margin:6px 0 6px;line-height:1.3}p{line-height:1.5;color:#444;margin:8px 0}
.card{background:#fff;border-radius:14px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,.06);margin-top:14px}
.card h2{font-size:15px;margin:0 0 8px;color:var(--navy)}
.chk{margin:0;padding-left:20px}.chk li{margin:4px 0;line-height:1.4;font-size:14px}
label.pick{display:block;text-align:center;background:var(--navy);color:#fff;padding:15px;border-radius:12px;font-size:17px;font-weight:600;cursor:pointer}
input[type=file]{display:none}
#list{list-style:none;padding:0;margin:12px 0 0}#list li{padding:10px 12px;border:1px solid #e6e1d3;border-radius:10px;margin-bottom:8px;font-size:14px;display:flex;justify-content:space-between;gap:10px}
.nm{word-break:break-all}.st{text-align:right;white-space:nowrap}
.x{color:#b42318;text-decoration:none;font-weight:700;margin-left:10px;font-size:17px}
.ok{color:#1a7f37}.err{color:#b42318}.wait{color:#8a6d12}.big{font-weight:600}
button{width:100%;margin-top:12px;padding:14px;border:0;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer}
#send{background:#E8E2D0;color:var(--navy)}#done{background:var(--gold);color:var(--navy)}
button:disabled{opacity:.5;cursor:default}
.sum{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.sum b{font-size:20px;color:var(--navy)}
.small{font-size:13px;color:#666}
</style></head><body><div class="wrap">
<h1>${esc(c.title)}</h1>
<p>${esc(c.intro)}</p>
<div class="card"><h2>Илгээх материал${product === "plan" ? " (бүгд заавал биш)" : ""}</h2><ul class="chk">${c.list.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
<div class="card">
<label class="pick" for="f">Файл сонгох</label>
<input id="f" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.xlsm,.ppt,.pptx,.csv,.txt,image/*">
<ul id="list"></ul>
<button id="send" disabled>Сонгосон файлуудыг илгээх</button>
<p class="small">Word, Excel, PDF, PowerPoint, зураг. Нэг файл 25MB хүртэл, нийт 60 файл. Видео, дуу бичлэг хүлээж авахгүй.</p>
</div>
<div class="card">
<div class="sum"><span>Тооцооны хуудас</span><b id="tot">0 хуудас</b></div>
<div class="sum"><span>Үнэ</span><b id="price">${esc(fmtMoney(base.price))}</b></div>
<p class="small" id="tier">Шатлал: ${esc(base.tier)} хуудас</p>
<p class="small">Үнэ материалын хэмжээгээр (Word, PDF хуудас, Excel хүснэгт, зураг) шатлалтай бодогдоно. Материалын агуулгыг төлбөр баталгаажсаны дараа л уншина.</p>
<button id="done"${product === "plan" ? "" : " disabled"}>Дууслаа, үнийн санал авах</button>
<p id="msg"></p>
</div>
</div>
<script>(${client.toString()})(${cfg});</script></body></html>`;
}

module.exports = router;
module.exports.orgUploadRouter = router;
module.exports.tokenFor = tokenFor;
module.exports.verify = verify;
module.exports.page = page;
