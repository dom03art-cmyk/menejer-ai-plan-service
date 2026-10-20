// Тендерийн файл илгээх хуудас. Агуулгыг энд уншихгүй — зөвхөн хадгална (төлбөрөөс өмнө AI дуудахгүй).
// GET  /u/tnd/:token  → утсанд зориулсан хуудас           GET  /u/tnd/:token/list
// POST /u/tnd/:token/file (octet-stream, x-file-name, x-file-type)   POST /u/tnd/:token/remove {id}   POST /u/tnd/:token/done
const express = require("express");
const crypto = require("crypto");
const S = require("./store");
const router = express.Router();

const DAYS = () => Number(process.env.TENDER_TTL_DAYS || 30);
const secret = () => "tender-v1:" + (process.env.UPLOAD_SECRET || process.env.API_KEY || "dev");
const sign = (s) => crypto.createHmac("sha256", secret()).update("tnd|" + s).digest("hex").slice(0, 24);
function tokenFor(psid, days = DAYS()) { const exp = Math.floor(Date.now() / 1000 + days * 86400).toString(36), body = `${psid}.${exp}`; return `${body}.${sign(body)}`; }
function verify(t) {
  const p = String(t || "").split("."); if (p.length !== 3) return null;
  const [psid, exp, sig] = p; if (!psid || !/^[0-9a-z]+$/.test(exp) || sig.length !== 24) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(`${psid}.${exp}`)))) return null;
  if (parseInt(exp, 36) * 1000 < Date.now()) return { expired: true };
  return { psid };
}
function tok(req, res, json = true) {
  const t = verify(req.params.token); if (t && !t.expired) return t;
  const msg = t && t.expired ? "Холбоосны хугацаа дууссан. Messenger-ээр шинэ холбоос авна уу." : "Холбоос буруу байна.";
  if (json) res.status(404).json({ ok: false, error: msg }); else res.status(404).set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><p style="font-family:Arial;padding:24px">${msg}</p>`);
  return null;
}
async function phaseOf(psid) { const st = await S.getState(psid).catch(() => null); return !st || ["tnd_upload", "tnd_upload_more", "tnd_lotask", "tnd_pay", "new"].includes(st.s) ? "tbb" : "bidder"; }
const ACCEPT = /\.(pdf|docx|xlsx|xls|xlsm|pptx|csv|txt|jpe?g|png|webp)$/i;
const pub = (f) => ({ id: f.id, name: f.name, size: f.size, phase: f.phase, pages: f.pages });

router.get("/u/tnd/:token", async (req, res) => { const t = tok(req, res, false); if (!t) return; res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).send(page(await phaseOf(t.psid))); });
router.get("/u/tnd/:token/list", async (req, res) => { const t = tok(req, res); if (!t) return; res.json({ ok: true, files: (await S.listFiles(t.psid)).map(pub) }); });
const rawBody = express.raw({ type: "application/octet-stream", limit: "26mb" });
router.post("/u/tnd/:token/file", rawBody, async (req, res) => {
  const t = tok(req, res); if (!t) return;
  let name; try { name = decodeURIComponent(req.get("x-file-name") || "файл"); } catch (_) { name = req.get("x-file-name") || "файл"; }
  const mime = req.get("x-file-type") || "", buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!ACCEPT.test(name) && !/^image\/|pdf/.test(mime)) return res.json({ ok: false, error: "Энэ төрлийн файлыг хүлээж авахгүй (PDF, Word, Excel, зураг)" });
  if (/\.doc$/i.test(name)) return res.json({ ok: false, error: "Хуучин .doc форматыг Word-оор нээгээд .docx болгож хадгална уу" });
  try {
    const PR = require("./pricing"), phase = await phaseOf(t.psid);
    const pc = await PR.pagesOf({ buf, name, mime }); if (pc.error) return res.json({ ok: false, error: pc.error });
    const list = await S.listFiles(t.psid), before = PR.sumPages(list, phase);
    if (phase === "tbb" && before + pc.pages > PR.maxPages()) return res.json({ ok: false, error: `Нийт ${before + pc.pages} хуудас болж байна — ${PR.maxPages()} хуудас хүртэл хүлээж авна. Зураг төсөл, каталог зэрэг шаардлагагүй хавсралтаа хасаад илгээнэ үү.` });
    if (phase === "bidder" && before + pc.pages > PR.bidderMax()) return res.json({ ok: false, error: `Баримтын нийт хэмжээ ${PR.bidderMax()} хуудаснаас хэтэрлээ. ТББ-д шаардсан баримтуудаа л илгээнэ үү (жишээ нь санхүүгийн тайлангийн эхний 2–3 хуудас).` });
    const r = await S.addFile(t.psid, { name, mime, buf, phase, pages: pc.pages });
    if (!r.ok) return res.json({ ok: false, error: r.error });
    const now = PR.sumPages(await S.listFiles(t.psid), phase), q = PR.quote(now);
    res.json({ ok: true, id: r.file.id, duplicate: !!r.duplicate, pages: pc.pages, total: now, price: phase === "tbb" ? PR.fmtMoney(q.price) : null });
  }
  catch (e) { console.warn("[tender-upload]", e.message); res.json({ ok: false, error: "Хадгалж чадсангүй. Дахин оролдоно уу." }); }
});
router.use("/u/tnd/:token/file", (err, req, res, next) => { if (err && (err.type === "entity.too.large" || err.status === 413)) return res.status(413).json({ ok: false, error: "Файл хэт том. Нэг файл 25MB хүртэл." }); next(err); });
router.post("/u/tnd/:token/remove", express.json(), async (req, res) => { const t = tok(req, res); if (!t) return; res.json({ ok: await S.removeFile(t.psid, String((req.body || {}).id || "")).catch(() => false) }); });
router.post("/u/tnd/:token/done", express.json(), async (req, res) => {
  const t = tok(req, res); if (!t) return;
  const files = await S.listFiles(t.psid);
  if (!files.length) return res.status(400).json({ ok: false, error: "Нэг ч файл илгээгээгүй байна." });
  try { await require("./flow").onUploaded(t.psid); } catch (e) { console.warn("[tender-upload] done:", e.message); }
  res.json({ ok: true, files: files.length });
});

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function client() {
  var $ = function (id) { return document.getElementById(id); };
  var input = $("f"), list = $("list"), btn = $("send"), done = $("done"), msg = $("msg"), base = location.pathname.replace(/\/$/, ""), files = [], busy = false;
  function e(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  function render() {
    list.innerHTML = files.map(function (it, i) { return '<li><span class="nm">' + e(it.name) + '</span><span class="st ' + it.cls + '">' + e(it.st) + (busy ? "" : ' <a href="#" data-i="' + i + '" class="x">×</a>') + "</span></li>"; }).join("");
    btn.disabled = busy || !files.some(function (it) { return it.f && !it.sent; });
    done.disabled = busy || !files.some(function (it) { return it.id; });
  }
  list.onclick = function (ev) {
    var a = ev.target.closest && ev.target.closest("a[data-i]"); if (!a) return; ev.preventDefault();
    var it = files[+a.getAttribute("data-i")]; if (!it) return;
    if (!it.id) { files.splice(files.indexOf(it), 1); return render(); }
    busy = true; render();
    fetch(base + "/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id }) }).then(function () { files.splice(files.indexOf(it), 1); }).catch(function () { }).then(function () { busy = false; render(); });
  };
  input.onchange = function () {
    for (var k = 0; k < input.files.length; k++) { var f = input.files[k]; if (files.some(function (it) { return it.name === f.name && it.size === f.size; })) continue;
      files.push(f.size > 25 * 1048576 ? { name: f.name, st: "хэт том (25MB хүртэл)", cls: "err", sent: true } : { f: f, name: f.name, size: f.size, st: "бэлэн", cls: "wait", sent: false }); }
    input.value = ""; render();
  };
  btn.onclick = function () {
    busy = true; msg.textContent = ""; render();
    var q = files.filter(function (it) { return it.f && !it.sent; });
    (function next() {
      var it = q.shift(); if (!it) { busy = false; render(); msg.textContent = "Хадгалагдлаа. Бүгдийг илгээсэн бол «Дууслаа» дарна уу."; return; }
      it.st = "илгээж байна…"; render();
      fetch(base + "/file", { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent(it.f.name), "x-file-type": it.f.type || "" }, body: it.f })
        .then(function (r) { return r.json(); }).then(function (j) { it.sent = true; if (j.ok) { it.id = j.id; it.st = "✓ " + (j.pages || "") + " хуудас"; it.cls = "ok"; if (j.total) $("tot").textContent = j.total + " хуудас" + (j.price ? " · " + j.price : ""); } else { it.st = j.error || "алдаа"; it.cls = "err"; } })
        .catch(function () { it.sent = true; it.st = "сүлжээний алдаа"; it.cls = "err"; }).then(function () { render(); next(); });
    })();
  };
  done.onclick = function () {
    busy = true; render();
    fetch(base + "/done", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(function (r) { return r.json(); })
      .then(function (j) { msg.textContent = j.ok ? "Баярлалаа. Messenger руугаа буцна уу — үргэлжлэлийг тэнд бичнэ." : (j.error || "Алдаа"); msg.className = j.ok ? "ok big" : "err"; })
      .catch(function () { msg.textContent = "Сүлжээний алдаа"; msg.className = "err"; }).then(function () { busy = false; render(); });
  };
  fetch(base + "/list").then(function (r) { return r.json(); }).then(function (j) { (j.files || []).forEach(function (f) { files.push({ id: f.id, name: f.name, st: "✓ " + (f.pages || "") + " хуудас", cls: "ok", sent: true }); }); render(); }).catch(function () { });
  render();
}
function page(phase) {
  const tbb = phase === "tbb";
  const title = tbb ? "Тендерийн баримт бичиг илгээх" : "Байгууллагын баримт илгээх";
  const items = tbb ? ["Тендер шалгаруулалтын баримт бичиг (ТББ) — tender.gov.mn-ээс татсан PDF эсвэл Word, бүтнээр нь", "Техникийн тодорхойлолт, ажлын даалгавар (тусдаа файл бол)", "Нэмэлт өөрчлөлт, тодруулгын хариу (байвал)", "Зарлалын хуудас (заавал биш)"]
    : ["Улсын бүртгэлийн гэрчилгээ, дүрэм", "Санхүүгийн тайлан (ТББ-д заасан он), аудитын дүгнэлт", "Ижил төстэй гэрээ, акт, захиалагчийн тодорхойлолт", "Тусгай зөвшөөрөл, сертификат", "Барааны каталог, үзүүлэлтийн хуудас / ажилтны диплом, CV", "Үнийн тооцоо (Excel) — байвал"];
  return `<!doctype html><html lang="mn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Менежер AI — ${esc(title)}</title>
<style>:root{--navy:#1B2A4A;--gold:#C9A227;--bg:#F6F4EE}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:#222}
.wrap{max-width:520px;margin:0 auto;padding:22px 16px 40px}h1{color:var(--navy);font-size:21px;margin:6px 0}p{line-height:1.5;color:#444}
.card{background:#fff;border-radius:14px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,.06);margin-top:14px}.card h2{font-size:15px;margin:0 0 8px;color:var(--navy)}
.chk{margin:0;padding-left:20px}.chk li{margin:4px 0;font-size:14px;line-height:1.4}label.pick{display:block;text-align:center;background:var(--navy);color:#fff;padding:15px;border-radius:12px;font-size:17px;font-weight:600;cursor:pointer}
input[type=file]{display:none}#list{list-style:none;padding:0;margin:12px 0 0}#list li{padding:10px 12px;border:1px solid #e6e1d3;border-radius:10px;margin-bottom:8px;font-size:14px;display:flex;justify-content:space-between;gap:10px}
.nm{word-break:break-all}.st{text-align:right;white-space:nowrap}.x{color:#b42318;text-decoration:none;font-weight:700;margin-left:10px;font-size:17px}.ok{color:#1a7f37}.err{color:#b42318}.wait{color:#8a6d12}.big{font-weight:600}
button{width:100%;margin-top:12px;padding:14px;border:0;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer}#send{background:#E8E2D0;color:var(--navy)}#done{background:var(--gold);color:var(--navy)}button:disabled{opacity:.5}.small{font-size:13px;color:#666}</style></head>
<body><div class="wrap"><h1>${esc(title)}</h1><p>${tbb ? "Тендерийн баримтаа бүтнээр нь илгээнэ үү. Агуулгыг төлбөр баталгаажсаны дараа л уншина." : "Танд байгаа баримтаа илгээнэ үү — материалд тусгаж, хүчинтэй хугацааг шалгана. Бид эдгээр баримтыг зохиохгүй, зөвхөн таны илгээснийг ашиглана."}</p>
<div class="card"><h2>Илгээх</h2><ul class="chk">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
<div class="card"><label class="pick" for="f">Файл сонгох</label><input id="f" type="file" multiple accept=".pdf,.docx,.xls,.xlsx,.xlsm,.pptx,.csv,.txt,image/*"><ul id="list"></ul>
<button id="send" disabled>Сонгосон файлуудыг илгээх</button><p class="small">PDF, Word, Excel, зураг. Нэг файл 25MB хүртэл.</p>
<p class="small">Нийт: <b id="tot">—</b></p>${tbb ? `<p class="small">Үнэ ТББ-ийн нийт хуудсаар:<br>${require("./pricing").tierLines().replace(/\n/g, "<br>")}</p>` : ""}<button id="done" disabled>Дууслаа</button><p id="msg"></p></div></div><script>(${client.toString()})();</script></body></html>`;
}

module.exports = router;
module.exports.tokenFor = tokenFor;
module.exports.verify = verify;
