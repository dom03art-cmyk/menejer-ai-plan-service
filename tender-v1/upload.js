// Тендерийн хуудас — нэг холбоос бүх шатанд: ТББ илгээх → (Messenger-т төлбөр) → шинжилгээ хүлээх →
// бүрдүүлэх материалын нүднүүд (улаан/шар/ногоон) → «Материал гаргах» → бэлтгэж байна → дууссан.
// Төлбөрөөс өмнө агуулгыг уншихгүй (ТББ-ийг зөвхөн хадгалж, хуудсыг тоолно).
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
const TBB_STATES = ["tnd_upload", "tnd_upload_more", "new"];
const EDIT_STATES = ["tnd_slots", "tnd_done"];
async function phaseOf(psid) { const st = await S.getState(psid).catch(() => null); return !st || TBB_STATES.includes(st.s) ? "tbb" : "bidder"; }
const ACCEPT = /\.(pdf|docx|xlsx|xls|xlsm|pptx|csv|txt|jpe?g|png|webp)$/i;
const rawBody = express.raw({ type: "application/octet-stream", limit: "26mb" });
const fname = (req) => { try { return decodeURIComponent(req.get("x-file-name") || "файл"); } catch (_) { return req.get("x-file-name") || "файл"; } };

// psid тус бүрээр дараалуулна (зэрэг ирсэн хүсэлт case-ийг дарж бичихгүй)
const locks = new Map();
function withLock(psid, fn) { const prev = locks.get(psid) || Promise.resolve(), run = prev.then(fn, fn), tail = run.catch(() => { }); locks.set(psid, tail); tail.then(() => { if (locks.get(psid) === tail) locks.delete(psid); }); return run; }

// ---------- төлөв (хуудас үүнээр зурагдана) ----------
async function stateJSON(psid) {
  const st = (await S.getState(psid)) || { s: "new" }, kase = (await S.getCase(psid)) || {};
  const out = { ok: true, s: st.s || "new", price: st.price || null, url: st.url || "" };
  if (TBB_STATES.includes(out.s)) {
    const PR = require("./pricing"), files = (await S.listFiles(psid)).filter((f) => f.phase === "tbb"), q = PR.quote(PR.sumPages(files, "tbb"));
    Object.assign(out, { files: files.map((f) => ({ id: f.id, name: f.name, pages: f.pages })), pages: q.pages, priceText: q.price ? PR.fmtMoney(q.price) : "", tiers: PR.tierLines(), paidRetry: !!st.paidRetry });
  }
  if (kase.slots && ["tnd_slots", "tnd_composing", "tnd_done"].includes(out.s)) {
    const SL = require("./slots"), T = (kase.base || {}).tender || {};
    const ev = SL.evaluate(kase.slots, kase.values || {}, { tender: T, deadline: T.deadline });
    const vals = {};
    for (const s of kase.slots) { const v = (kase.values || {})[s.key] || {}; vals[s.key] = s.kind === "file" ? { self: !!v.self, files: (v.files || []).map((f) => ({ id: f.id, name: f.name, ...SL.judgeFile(s, f.read || {}, { deadline: T.deadline }) })) } : { value: v.value ?? null }; }
    const free = (st.delivered || 0) === 0 || ((st.delivered || 0) <= 1 && Date.now() - (st.deliveredAt || 0) < 14 * 864e5);
    Object.assign(out, { tender: { name: T.name, entity: T.procuring_entity, budget: T.budget, deadline: T.deadline, type: (kase.base.meta || {}).type, auction: !!T.auction }, slots: kase.slots, values: vals, status: ev.status, offerTotal: ev.offerTotal, reds: SL.reds(kase.slots, ev.status), delivered: st.delivered || 0, canGenerate: out.s === "tnd_slots" || (out.s === "tnd_done" && free && !st.final) });
  }
  return out;
}
router.get("/u/tnd/:token", (req, res) => { const t = tok(req, res, false); if (!t) return; res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).send(page()); });
router.get("/u/tnd/:token/state", async (req, res) => { const t = tok(req, res); if (!t) return; try { res.json(await stateJSON(t.psid)); } catch (e) { console.warn("[tender-page] state", e.message); res.status(500).json({ ok: false, error: "Систем түр саатаж байна" }); } });
router.get("/u/tnd/:token/list", async (req, res) => { const t = tok(req, res); if (!t) return; res.json({ ok: true, files: (await S.listFiles(t.psid)).map((f) => ({ id: f.id, name: f.name, size: f.size, phase: f.phase, pages: f.pages })) }); });

// ---------- 1-р алхам: ТББ ----------
router.post("/u/tnd/:token/file", rawBody, async (req, res) => {
  const t = tok(req, res); if (!t) return;
  const name = fname(req), mime = req.get("x-file-type") || "", buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!ACCEPT.test(name) && !/^image\/|pdf/.test(mime)) return res.json({ ok: false, error: "Энэ төрлийн файлыг хүлээж авахгүй (PDF, Word, Excel, зураг)" });
  if (/\.doc$/i.test(name)) return res.json({ ok: false, error: "Хуучин .doc форматыг Word-оор нээгээд .docx болгож хадгална уу" });
  try {
    const PR = require("./pricing"), phase = await phaseOf(t.psid);
    if (phase !== "tbb") return res.json({ ok: false, error: "Энэ шатанд баримтаа доорх нүд бүрт оруулна уу" });
    const pc = await PR.pagesOf({ buf, name, mime }); if (pc.error) return res.json({ ok: false, error: pc.error });
    const before = PR.sumPages(await S.listFiles(t.psid), "tbb");
    if (before + pc.pages > PR.maxPages()) return res.json({ ok: false, error: `Нийт ${before + pc.pages} хуудас болж байна — ${PR.maxPages()} хуудас хүртэл хүлээж авна. Шаардлагагүй хавсралтаа хасаад илгээнэ үү.` });
    const r = await S.addFile(t.psid, { name, mime, buf, phase, pages: pc.pages });
    if (!r.ok) return res.json({ ok: false, error: r.error });
    const q = PR.quote(PR.sumPages(await S.listFiles(t.psid), "tbb"));
    res.json({ ok: true, id: r.file.id, duplicate: !!r.duplicate, pages: pc.pages, total: q.pages, price: q.price ? PR.fmtMoney(q.price) : null });
  } catch (e) { console.warn("[tender-upload]", e.message); res.json({ ok: false, error: "Хадгалж чадсангүй. Дахин оролдоно уу." }); }
});
router.use("/u/tnd/:token", (err, req, res, next) => { if (err && (err.type === "entity.too.large" || err.status === 413)) return res.status(413).json({ ok: false, error: "Файл хэт том. Нэг файл 25MB хүртэл." }); next(err); });
router.post("/u/tnd/:token/remove", express.json(), async (req, res) => { const t = tok(req, res); if (!t) return; if ((await phaseOf(t.psid)) !== "tbb") return res.json({ ok: false }); res.json({ ok: await S.removeFile(t.psid, String((req.body || {}).id || "")).catch(() => false) }); });
router.post("/u/tnd/:token/done", express.json(), async (req, res) => {
  const t = tok(req, res); if (!t) return;
  const files = (await S.listFiles(t.psid)).filter((f) => f.phase === "tbb");
  if (!files.length) return res.status(400).json({ ok: false, error: "Нэг ч файл илгээгээгүй байна." });
  try { await require("./flow").onUploaded(t.psid); } catch (e) { console.warn("[tender-upload] done:", e.message); }
  res.json({ ok: true, files: files.length });
});

// ---------- 2-р алхам: нүднүүд ----------
async function editable(psid) { const st = await S.getState(psid); return st && EDIT_STATES.includes(st.s) && !st.final ? st : null; }
router.post("/u/tnd/:token/slot/:key/file", rawBody, async (req, res) => {
  const t = tok(req, res); if (!t) return;
  const key = String(req.params.key), name = fname(req), mime = req.get("x-file-type") || "", buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!(await editable(t.psid))) return res.json({ ok: false, error: "Одоо засах боломжгүй (материал бэлтгэж байна эсвэл захиалга дууссан)" });
  if (!ACCEPT.test(name) && !/^image\/|pdf/.test(mime)) return res.json({ ok: false, error: "PDF, Word, Excel эсвэл зураг оруулна уу" });
  if (/\.doc$/i.test(name)) return res.json({ ok: false, error: "Хуучин .doc форматыг .docx болгож хадгална уу" });
  const kase = await S.getCase(t.psid), slot = kase && (kase.slots || []).find((s) => s.key === key && s.kind === "file");
  if (!slot) return res.status(404).json({ ok: false, error: "Нүд олдсонгүй" });
  try {
    // Хуудасны тоо зардалд нөлөөлөхгүй (эхний хэдэн хуудсыг л шалгана) тул нүдний файлд хуудасны хязгаар тавихгүй — зөвхөн 25MB/файл
    const PR = require("./pricing"), pc = await PR.pagesOf({ buf, name, mime }).catch(() => ({ pages: null }));
    const r = await S.addFile(t.psid, { name, mime, buf, phase: "bidder", pages: pc.error ? null : pc.pages });
    if (!r.ok) return res.json({ ok: false, error: r.error });
    const SL = require("./slots");
    let read; try { read = await SL.readFileForSlot(slot, r.file, buf); } catch (e) { if (/credit balance/i.test(e.message || "")) require("./msg").admin("⚠️ Anthropic API кредит дууссан! (тендерийн файл шалгалт)"); read = { readable: true, matches: true, problems: ["Автомат шалгалт түр ажилласангүй — дараа нь гараар шалгагдана"] }; }
    await withLock(t.psid, async () => {
      const k = await S.getCase(t.psid), values = k.values || {}, v = values[key] || { files: [] };
      delete v.self;
      v.files = slot.multi ? [...(v.files || []).filter((f) => f.id !== r.file.id), { id: r.file.id, name, read }] : [{ id: r.file.id, name, read }];
      values[key] = v; await S.patchCase(t.psid, { values });
    });
    res.json(await stateJSON(t.psid));
  } catch (e) { console.warn("[tender-page] slot file", e.message); res.json({ ok: false, error: "Хадгалж чадсангүй. Дахин оролдоно уу." }); }
});
router.post("/u/tnd/:token/slot/:key/remove", express.json(), async (req, res) => {
  const t = tok(req, res); if (!t) return; if (!(await editable(t.psid))) return res.json({ ok: false });
  const key = String(req.params.key), id = String((req.body || {}).id || "");
  await withLock(t.psid, async () => { const k = await S.getCase(t.psid), values = k.values || {}; if (values[key]) values[key].files = (values[key].files || []).filter((f) => f.id !== id); await S.patchCase(t.psid, { values }); });
  res.json(await stateJSON(t.psid));
});
// «Өөрөө хавсаргана» (файл оруулахгүй, tender.gov.mn-д оролцогч өөрөө хавсаргана)
router.post("/u/tnd/:token/slot/:key/self", express.json(), async (req, res) => {
  const t = tok(req, res); if (!t) return; if (!(await editable(t.psid))) return res.json({ ok: false, error: "Одоо засах боломжгүй" });
  const key = String(req.params.key), on = !!(req.body || {}).on;
  const kase = await S.getCase(t.psid), slot = kase && (kase.slots || []).find((s) => s.key === key && s.kind === "file");
  if (!slot) return res.status(404).json({ ok: false });
  await withLock(t.psid, async () => { const k = await S.getCase(t.psid), values = k.values || {}, v = values[key] || { files: [] }; if (on) v.self = true; else delete v.self; values[key] = v; await S.patchCase(t.psid, { values }); });
  res.json(await stateJSON(t.psid));
});
router.post("/u/tnd/:token/value", express.json({ limit: "200kb" }), async (req, res) => {
  const t = tok(req, res); if (!t) return; if (!(await editable(t.psid))) return res.json({ ok: false, error: "Одоо засах боломжгүй" });
  const { key, value } = req.body || {};
  const kase = await S.getCase(t.psid), slot = kase && (kase.slots || []).find((s) => s.key === key && s.kind !== "file");
  if (!slot) return res.status(404).json({ ok: false });
  const clean = slot.kind === "table" ? (Array.isArray(value) ? value.slice(0, 200).map((r) => Object.fromEntries(Object.entries(r || {}).map(([a, b]) => [String(a).slice(0, 40), String(b ?? "").slice(0, 300)]))) : []) : String(value ?? "").slice(0, 4000);
  await withLock(t.psid, async () => { const k = await S.getCase(t.psid), values = k.values || {}; values[key] = { value: clean }; await S.patchCase(t.psid, { values }); });
  res.json(await stateJSON(t.psid));
});
router.post("/u/tnd/:token/generate", express.json(), async (req, res) => {
  const t = tok(req, res); if (!t) return;
  const j = await stateJSON(t.psid);
  if (!j.canGenerate) return res.json({ ok: false, error: j.s === "tnd_composing" ? "Материалыг бэлтгэж байна" : "Дахин гаргах эрх дууссан эсвэл захиалга хаагдсан" });
  const R = j.reds || { attach: [], data: [], fail: [] };
  if ((R.attach.length || R.data.length || R.fail.length) && !(req.body || {}).confirm) return res.json({ ok: false, needConfirm: true, reds: R });
  try { await require("./flow").startCompose(t.psid, { reds: R }); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ---------- хуудас ----------
function client() {
  var $ = function (id) { return document.getElementById(id); };
  var base = location.pathname.replace(/\/$/, ""), S = null, poll = null, busyKeys = {};
  var GROUPS = [["company", "🏢 Компанийн мэдээлэл"], ["sign", "✍️ Гарын үсэг зурах хүн"], ["offer", "💰 Үнийн санал"], ["metrics", "📊 Тоон шалгуур (ТББ-ийн босго)"], ["docs", "📎 Хавсаргах баримтууд"], ["other", "📝 Нэмэлт мэдээлэл"]];
  function e(t) { return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function money(n) { return n == null ? "" : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "₮"; }
  function api(path, opt) { return fetch(base + path, opt).then(function (r) { return r.json(); }); }
  function post(path, body) { return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); }
  function load() { return api("/state").then(function (j) { if (j.ok) { S = j; render(); } }); }
  function dot(st) { return '<span class="dot ' + (st || "empty") + '"></span>'; }
  function startPoll(ms) { if (poll) clearInterval(poll); poll = setInterval(load, ms); }
  function stopPoll() { if (poll) clearInterval(poll); poll = null; }

  function render() {
    var s = S.s, h = "";
    if (["tnd_upload", "tnd_upload_more", "new"].indexOf(s) >= 0) { stopPoll(); return renderTbb(); }
    if (s === "tnd_analyzing") { startPoll(15000); h = card("⏳ ТББ-г уншиж байна", "Тендерийн шаардлагыг задалж, танд бүрдүүлэх материалын жагсаалт гаргаж байна. 15–30 минут болно. Энэ хуудсыг хаасан ч болно — бэлэн болмогц Messenger-т мэдэгдэнэ."); }
    else if (["tnd_lotask", "tnd_terms", "tnd_pay", "tnd_payreview", "tnd_lot"].indexOf(s) >= 0) { startPoll(15000); h = card("📲 Messenger руу буцна уу", s === "tnd_lot" ? "Тендер олон багцтай байна — Messenger-т аль багцад оролцохоо сонгоно уу." : "Багц сонгох, нөхцөл зөвшөөрөх, төлбөр хийх алхам Messenger-т байна. Төлбөр орсны дараа энд бүрдүүлэх материалын жагсаалт гарна."); }
    else if (s === "tnd_composing") { startPoll(20000); h = card("⏳ Материалыг бэлтгэж байна", "Маягт, үнийн санал, аргачлал, албан бичгийг бэлтгэж байна. 20–40 минут болно. Бэлэн болмогц файлууд Messenger-т ирнэ.") + (S.slots ? slotsHtml(true) : ""); }
    else if (s === "tnd_slots" || s === "tnd_done") { stopPoll(); h = (s === "tnd_done" ? card("✅ Материал Messenger-т илгээгдсэн", S.canGenerate ? "Нүднүүдээ засаж, баримт нэмээд доорх товчоор дахин гаргаж болно (1 удаа үнэгүй)." : "Энэ захиалгын дахин гаргах эрх дууссан.") : "") + slotsHtml(!S.canGenerate); }
    else { stopPoll(); h = card("Захиалга хаагдсан", "Шинэ тендерт Messenger-ээр «Тендерийн материал»-ыг сонгоно уу."); }
    $("app").innerHTML = h; bind();
  }
  function card(t, p) { return '<div class="card"><h2>' + e(t) + "</h2><p>" + e(p) + "</p></div>"; }

  // ---- ТББ илгээх ----
  var tbbQ = [];
  function renderTbb() {
    var files = S.files || [];
    $("app").innerHTML = '<div class="card"><h2>1. Тендерийн баримт бичиг (ТББ)</h2><p>tender.gov.mn-ээс татсан ТББ-гээ бүтнээр нь (PDF/Word), техникийн тодорхойлолт, нэмэлт өөрчлөлт байвал хамт илгээнэ үү. Агуулгыг төлбөр баталгаажсаны дараа л уншина.</p>' +
      '<label class="pick" for="f">Файл сонгох</label><input id="f" type="file" multiple accept=".pdf,.docx,.xls,.xlsx,image/*"><ul class="list">' +
      files.map(function (f) { return '<li><span class="nm">' + e(f.name) + '</span><span class="ok">' + (f.pages || 1) + ' х. <a href="#" class="x" data-rm="' + f.id + '">×</a></span></li>'; }).join("") +
      tbbQ.map(function (q) { return '<li><span class="nm">' + e(q.name) + '</span><span class="' + q.cls + '">' + e(q.st) + "</span></li>"; }).join("") + "</ul>" +
      '<p class="sum">Нийт: <b>' + (S.pages || 0) + " хуудас</b>" + (S.paidRetry ? " (төлбөр төлөгдсөн)" : S.priceText ? " · үнэ <b>" + e(S.priceText) + "</b>" : "") + "</p>" +
      (S.paidRetry ? "" : '<p class="small">' + e(S.tiers || "").replace(/\n/g, "<br>") + "</p>") +
      '<button id="tbbDone"' + (files.length ? "" : " disabled") + '>Дууслаа</button><p id="msg" class="small"></p></div>';
    $("f").onchange = function () { var fl = [].slice.call($("f").files); $("f").value = ""; upTbb(fl); };
    $("tbbDone").onclick = function () { this.disabled = true; post("/done").then(function (j) { $("msg").textContent = j.ok ? "Баярлалаа. Messenger руугаа буцна уу — багц сонгож, төлбөрөө хийнэ." : (j.error || "Алдаа"); setTimeout(load, 1500); }); };
    [].forEach.call(document.querySelectorAll("[data-rm]"), function (a) { a.onclick = function (ev) { ev.preventDefault(); post("/remove", { id: a.getAttribute("data-rm") }).then(load); }; });
  }
  function upTbb(fl) {
    if (!fl.length) return load();
    var f = fl.shift(), q = { name: f.name, st: "илгээж байна…", cls: "wait" }; tbbQ.push(q); renderTbb();
    fetch(base + "/file", { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent(f.name), "x-file-type": f.type || "" }, body: f })
      .then(function (r) { return r.json(); }).then(function (j) { tbbQ.splice(tbbQ.indexOf(q), 1); if (!j.ok) alert(f.name + ": " + (j.error || "алдаа")); })
      .catch(function () { tbbQ.splice(tbbQ.indexOf(q), 1); alert("Сүлжээний алдаа"); }).then(function () { load().then(function () { upTbb(fl); }); });
  }

  // ---- нүднүүд ----
  function counts() { var c = { green: 0, yellow: 0, red: 0 }; S.slots.forEach(function (s) { var st = (S.status[s.key] || {}).status; if (c[st] != null) c[st]++; }); return c; }
  function slotsHtml(locked) {
    var T = S.tender || {}, c = counts(), h = '<div class="card head"><h2>' + e(T.name || "Тендер") + "</h2><p>" + e(T.entity || "") + (T.budget ? " · төсөвт өртөг " + money(T.budget) : "") + (T.deadline ? "<br>⏰ Эцсийн хугацаа: <b>" + e(String(T.deadline).replace("T", " ").slice(0, 16)) + "</b>" : "") + "</p>" +
      '<div class="cnt"><span>' + dot("green") + c.green + " бэлэн</span><span>" + dot("yellow") + c.yellow + " анхаарах</span><span>" + dot("red") + c.red + " дутуу</span></div>" + (S.offerTotal ? '<p class="small">Санал болгох үнэ (тооцоолсон): <b>' + money(S.offerTotal) + "</b></p>" : "") + "</div>";
    GROUPS.forEach(function (g) {
      var list = S.slots.filter(function (s) { return s.group === g[0]; }); if (!list.length) return;
      h += '<div class="card"><h3>' + g[1] + "</h3>" + list.map(function (s) { return slotHtml(s, locked); }).join("") + "</div>";
    });
    if (!locked) h += '<div class="bar"><button id="gen">' + (S.delivered ? "🔄 Дахин гаргах" : "📄 Материал гаргах") + "</button></div>";
    return h;
  }
  function slotHtml(s, locked) {
    var st = S.status[s.key] || {}, v = S.values[s.key] || {}, dis = locked ? " disabled" : "", h = '<div class="slot ' + (st.status || "empty") + '" id="s_' + e(s.key) + '"><div class="lbl">' + dot(st.status) + e(s.label) + (s.required ? "" : ' <span class="opt">(заавал биш)</span>') + "</div>";
    if (s.help) h += '<div class="help">' + e(s.help) + "</div>";
    if (s.kind === "field") {
      if (s.input === "select") h += '<select data-k="' + e(s.key) + '"' + dis + '><option value="">— сонгох —</option>' + s.options.map(function (o) { return "<option" + (v.value === o ? " selected" : "") + ">" + e(o) + "</option>"; }).join("") + "</select>";
      else if (s.input === "textarea") h += '<textarea rows="3" data-k="' + e(s.key) + '"' + dis + ">" + e(v.value || "") + "</textarea>";
      else h += '<input data-k="' + e(s.key) + '" ' + (s.input === "number" ? 'inputmode="numeric"' : "") + ' value="' + e(v.value || "") + '"' + dis + ">";
    } else if (s.kind === "table") {
      var rows = v.value || [];
      var list = s.free ? (rows.length ? rows : [{}]) : s.rows.map(function (r) { var x = rows.filter(function (y) { return String(y.id) === r.id; })[0] || { id: r.id }; x._label = r.label; return x; });
      h += '<div class="tbl" data-t="' + e(s.key) + '">' + list.map(function (r, i) {
        return '<div class="row" data-i="' + i + '" data-id="' + e(r.id || "") + '">' + (r._label ? '<div class="rl">' + e(r._label) + "</div>" : "") + '<div class="cols">' + s.columns.map(function (c) {
          return '<label><span>' + e(c.t) + (c.req ? "" : "") + '</span><input data-c="' + c.k + '" ' + (c.n ? 'inputmode="numeric"' : "") + ' value="' + e(r[c.k] == null ? "" : r[c.k]) + '"' + dis + "></label>"; }).join("") + "</div></div>"; }).join("") +
        (s.free && !locked ? '<button class="mini" data-add="' + e(s.key) + '">+ мөр нэмэх</button>' : "") + "</div>";
    } else {
      h += '<ul class="list">' + (v.files || []).map(function (f) { return '<li class="' + f.status + '"><span class="nm">' + dot(f.status) + e(f.name) + "</span>" + (locked ? "" : '<a href="#" class="x" data-frm="' + e(s.key) + "|" + f.id + '">×</a>') + "</li>"; }).join("") + "</ul>";
      if (busyKeys[s.key]) h += '<div class="wait">⏳ шалгаж байна… (10–40 сек)</div>';
      else if (!locked && v.self && !(v.files || []).length) h += '<button class="mini" data-self="' + e(s.key) + '" data-on="0">↩︎ Буцаах — файл оруулна</button>';
      else if (!locked && (s.multi || !(v.files || []).length)) { h += '<label class="pick small" for="u_' + e(s.key) + '">' + ((v.files || []).length ? "+ файл нэмэх" : "Файл оруулах") + '</label><input id="u_' + e(s.key) + '" data-u="' + e(s.key) + '" type="file" accept=".pdf,.docx,.xls,.xlsx,image/*"' + (s.multi ? " multiple" : "") + ">";
        if (!(v.files || []).length) h += '<button class="mini" data-self="' + e(s.key) + '" data-on="1">📎 Өөрөө хавсаргана (том файл, эсвэл дараа бүрдүүлнэ)</button>'; }
      else if (!locked) h += '<label class="pick small alt" for="u_' + e(s.key) + '">Солих</label><input id="u_' + e(s.key) + '" data-u="' + e(s.key) + '" data-replace="1" type="file" accept=".pdf,.docx,.xls,.xlsx,image/*">';
    }
    if (st.msg) h += '<div class="msg">' + e(st.msg) + "</div>";
    return h + "</div>";
  }
  function saveVal(key, value) { return post("/value", { key: key, value: value }).then(function (j) { if (j.ok) { S = j; render(); } }); }
  function tableVal(el) { var rows = []; [].forEach.call(el.querySelectorAll(".row"), function (r) { var o = {}; if (r.getAttribute("data-id")) o.id = r.getAttribute("data-id"); [].forEach.call(r.querySelectorAll("[data-c]"), function (i) { o[i.getAttribute("data-c")] = i.value; }); var any = Object.keys(o).some(function (k) { return k !== "id" && o[k]; }); if (any || o.id) rows.push(o); }); return rows; }
  function bind() {
    [].forEach.call(document.querySelectorAll("[data-k]"), function (i) { i.onchange = function () { saveVal(i.getAttribute("data-k"), i.value); }; });
    [].forEach.call(document.querySelectorAll("[data-t]"), function (t) { [].forEach.call(t.querySelectorAll("[data-c]"), function (i) { i.onchange = function () { saveVal(t.getAttribute("data-t"), tableVal(t)); }; }); });
    [].forEach.call(document.querySelectorAll("[data-add]"), function (b) { b.onclick = function () { var k = b.getAttribute("data-add"), t = document.querySelector('[data-t="' + k + '"]'), rows = tableVal(t); rows.push({ name: " " }); saveVal(k, rows); }; });
    [].forEach.call(document.querySelectorAll("[data-u]"), function (inp) { inp.onchange = function () { var k = inp.getAttribute("data-u"), fl = [].slice.call(inp.files); upSlot(k, fl); }; });
    [].forEach.call(document.querySelectorAll("[data-frm]"), function (a) { a.onclick = function (ev) { ev.preventDefault(); var p = a.getAttribute("data-frm").split("|"); post("/slot/" + encodeURIComponent(p[0]) + "/remove", { id: p[1] }).then(function (j) { if (j.ok) { S = j; render(); } }); }; });
    [].forEach.call(document.querySelectorAll("[data-self]"), function (b) { b.onclick = function () { post("/slot/" + encodeURIComponent(b.getAttribute("data-self")) + "/self", { on: b.getAttribute("data-on") === "1" }).then(function (j) { if (j.ok !== false && j.slots) { S = j; render(); } }); }; });
    if ($("gen")) $("gen").onclick = function () { gen(false); };
  }
  function upSlot(k, fl) {
    if (!fl.length) { delete busyKeys[k]; return render(); }
    busyKeys[k] = 1; render();
    var f = fl.shift();
    fetch(base + "/slot/" + encodeURIComponent(k) + "/file", { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent(f.name), "x-file-type": f.type || "" }, body: f })
      .then(function (r) { return r.json(); }).then(function (j) { if (j.ok && j.slots) S = j; else alert(f.name + ": " + (j.error || "алдаа")); })
      .catch(function () { alert("Сүлжээний алдаа — дахин оролдоно уу"); }).then(function () { upSlot(k, fl); });
  }
  function gen(confirm) {
    $("gen").disabled = true;
    post("/generate", { confirm: confirm }).then(function (j) {
      if (j.needConfirm) return showConfirm(j.reds);
      if (!j.ok) { alert(j.error || "Алдаа"); $("gen").disabled = false; return; }
      load();
    });
  }
  function showConfirm(R) {
    var sec = function (t, arr, note) { return arr.length ? "<h4>" + t + "</h4><ul>" + arr.map(function (x) { return "<li><b>" + e(x.label) + "</b> — " + e(x.msg) + "</li>"; }).join("") + "</ul><p class='small'>" + note + "</p>" : ""; };
    var m = document.createElement("div"); m.className = "modal";
    m.innerHTML = '<div class="box"><h3>Дараах зүйлс дутуу байна</h3>' +
      sec("❌ Шаардлага хангахгүй", R.fail, "Энэ шаардлагыг хангахгүй бол тендерээс хасагдах эрсдэл өндөр.") +
      sec("✏️ Маягтад орох мэдээлэл дутуу", R.data, "Материалд [ДУТУУ] гэж хоосон үлдэнэ — Word файлд та өөрөө нөхнө.") +
      sec("📎 Хавсаргах баримт дутуу", R.attach, "Материал бүрэн гарна. Эдгээрийг tender.gov.mn-д та өөрөө хавсаргана.") +
      '<p>Үүнийг мэдэж байж материалаа одоо гаргах уу? Төлбөр буцаагдахгүй; 1 удаа үнэгүй дахин гаргах эрхтэй.</p><button id="yes">Тийм, ингээд гарга</button><button id="no" class="alt">Буцаж нөхөх</button></div>';
    document.body.appendChild(m);
    $("yes").onclick = function () { m.remove(); gen(true); };
    $("no").onclick = function () { m.remove(); $("gen").disabled = false; };
  }
  load();
}
function page() {
  return `<!doctype html><html lang="mn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Менежер AI — Тендерийн материал</title>
<style>:root{--navy:#1B2A4A;--gold:#C9A227;--bg:#F6F4EE;--red:#d92d20;--yel:#e0a400;--grn:#16a34a}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:#222}
.wrap{max-width:560px;margin:0 auto;padding:16px 14px 110px}header{color:var(--navy);font-weight:700;font-size:18px;padding:6px 2px}
.card{background:#fff;border-radius:14px;padding:14px;box-shadow:0 2px 10px rgba(0,0,0,.06);margin-top:12px}.card h2{font-size:17px;margin:0 0 6px;color:var(--navy)}.card h3{font-size:15px;margin:0 0 8px;color:var(--navy)}p{line-height:1.5;color:#444;margin:6px 0}
.small{font-size:13px;color:#666}.sum{margin-top:10px}.cnt{display:flex;gap:14px;font-size:14px;margin-top:6px;flex-wrap:wrap}
.dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;vertical-align:middle;background:#c9c9c9}.dot.green{background:var(--grn)}.dot.yellow{background:var(--yel)}.dot.red{background:var(--red)}
.slot{border-left:5px solid #c9c9c9;background:#fafafa;border-radius:10px;padding:10px 10px 10px 12px;margin:10px 0}.slot.green{border-color:var(--grn);background:#f0fdf4}.slot.yellow{border-color:var(--yel);background:#fffbeb}.slot.red{border-color:var(--red);background:#fef3f2}
.lbl{font-weight:600;font-size:14px}.opt{font-weight:400;color:#888;font-size:12px}.help{font-size:12.5px;color:#666;margin:4px 0 6px}.msg{font-size:13px;margin-top:6px;color:#333}.slot.red .msg{color:var(--red)}.slot.yellow .msg{color:#8a6100}
input,select,textarea{width:100%;font-size:16px;padding:10px;border:1px solid #d8d3c4;border-radius:9px;background:#fff;margin-top:4px}textarea{font-family:inherit}
.tbl .row{border-top:1px dashed #ddd;padding:8px 0}.rl{font-size:13px;font-weight:600;margin-bottom:4px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:6px}.cols label span{font-size:11.5px;color:#666}.cols input{padding:8px;font-size:15px;margin-top:2px}
label.pick{display:block;text-align:center;background:var(--navy);color:#fff;padding:13px;border-radius:11px;font-size:16px;font-weight:600;cursor:pointer;margin-top:8px}label.pick.small{padding:9px;font-size:14px}label.pick.alt{background:#E8E2D0;color:var(--navy)}input[type=file]{display:none}
.list{list-style:none;padding:0;margin:8px 0 0}.list li{padding:8px 10px;border:1px solid #e6e1d3;border-radius:9px;margin-bottom:6px;font-size:14px;display:flex;justify-content:space-between;gap:8px;background:#fff}.nm{word-break:break-all}.x{color:var(--red);text-decoration:none;font-weight:700;font-size:18px;margin-left:8px}
.ok{color:var(--grn);white-space:nowrap}.wait{color:#8a6d12;font-size:13px;margin-top:6px}
button{width:100%;margin-top:10px;padding:14px;border:0;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;background:var(--gold);color:var(--navy)}button.alt{background:#E8E2D0}button.mini{padding:8px;font-size:14px;background:#E8E2D0}button:disabled{opacity:.5}
.bar{position:fixed;left:0;right:0;bottom:0;background:rgba(246,244,238,.97);padding:8px 14px 14px;box-shadow:0 -2px 10px rgba(0,0,0,.08)}.bar button{max-width:532px;display:block;margin:0 auto}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;z-index:9}.box{background:#fff;border-radius:16px 16px 0 0;padding:16px;max-width:560px;width:100%;max-height:85vh;overflow:auto}.box h4{margin:12px 0 4px;font-size:14px}.box ul{margin:0;padding-left:18px;font-size:13.5px}
</style></head><body><div class="wrap"><header>📑 Менежер AI · Тендерийн материал</header><div id="app"><div class="card"><p>Ачаалж байна…</p></div></div></div>
<script>(${client.toString()})();</script></body></html>`;
}

module.exports = router;
module.exports.tokenFor = tokenFor;
module.exports.verify = verify;
module.exports.stateJSON = stateJSON;
