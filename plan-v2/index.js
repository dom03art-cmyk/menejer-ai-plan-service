// Express router: POST /jobs/plan — ажлыг хүлээн аваад ШУУД 202 буцаана, арын горимд ажиллана.
// Одоо байгаа server.js-д:  app.use(require("./plan-v2"));
const express = require("express");
const crypto = require("crypto");
const { runPipeline } = require("./pipeline");
const { fbText } = require("./util");
const { newUsage, withUsage } = require("./claude");
const router = express.Router();
const jobs = new Map();          // id -> job
const activeByPsid = new Map();  // psid -> id (давхар ажил үүсэхээс сэргийлнэ)
const queue = []; let running = 0;
const MAX_PARALLEL = Number(process.env.PLAN_MAX_PARALLEL || 2);

function auth(req, res, next) { if (req.get("x-api-key") !== process.env.API_KEY) return res.status(401).json({ error: "unauthorized" }); next(); }

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift(); running++; job.status = "running";
    job.usage = newUsage();
    withUsage(job.usage, () => runPipeline(job)).then(() => { job.status = "done"; })
      .catch(async (e) => {
        if (shuttingDown) return;
        if (e.status === "revision_rejected") {
          job.status = "rejected";
          if (process.env.MAKE_DONE_WEBHOOK) fetch(process.env.MAKE_DONE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, psid: job.psid, status: "revision_rejected", history: e.cleanedHistory || "" }) }).catch(() => { });
          return;
        }
        if (e.status === "blocked") {
          job.status = "blocked"; job.error = e.message; console.warn(`[${job.id}] ХААГДСАН`, e.message);
          if (job.psid) await fbText(job.psid, require("./guard").CUSTOMER_MSG).catch(() => { });
          if (process.env.ADMIN_PSID) await fbText(process.env.ADMIN_PSID, `⛔ Бизнес төслийн захиалгыг хаалаа (job ${job.id}, psid ${job.psid || "-"}): ${String(e.message).slice(0, 300)}. Төлбөрийг шалгаж, захиалагчтай холбогдоно уу.`).catch(() => { });
          if (process.env.MAKE_DONE_WEBHOOK) fetch(process.env.MAKE_DONE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, psid: job.psid, status: "blocked", error: e.message }) }).catch(() => { });
          return;
        }
        job.status = "failed"; job.error = e.message; console.error(`[${job.id}] АЛДАА`, e);
        const credit = /credit balance/i.test(e.message || "");
        if (job.psid) await fbText(job.psid, credit ? "Уучлаарай, систем түр саатаж байна. Засагдмагц таны төслийг автоматаар боловсруулж илгээнэ. Хүлээсэнд баярлалаа 🙏" : "Уучлаарай, төсөл боловсруулахад техникийн саатал гарлаа. Та дурын мессеж бичиж дахин эхлүүлж болно, эсвэл манай ажилтан тантай удахгүй холбогдоно.").catch(() => { });
        if (process.env.ADMIN_PSID) await fbText(process.env.ADMIN_PSID, credit ? "⚠️ Anthropic API кредит дууссан! platform.claude.com → Billing хэсгээс кредит нэмнэ үү. Захиалагч хүлээгдэж байна." : `⚠️ Төсөл боловсруулахад алдаа гарлаа (job ${job.id}): ${String(e.message).slice(0, 300)}`).catch(() => { });
        if (process.env.MAKE_DONE_WEBHOOK) fetch(process.env.MAKE_DONE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, psid: job.psid, status: "failed", error: e.message }) }).catch(() => { });
      })
      .finally(() => { const u = job.usage || {}; console.log(`[${job.id}] токен: input ${u.input}, output ${u.output}, cache бичсэн ${u.cache_write}, cache уншсан ${u.cache_read}, web хайлт ${u.web_searches}, дуудлага ${u.calls}, max_tokens давталт ${u.max_tokens_retries}`); running--; if (job.psid) activeByPsid.delete(job.psid); job.finishedAt = Date.now(); pump(); });
  }
}

// Засварын хүсэлтийг түр хүлээлгэх (PLAN_HOLD_REVISIONS=1). Унтраасны дараа сервис асахад хүлээлгэсэн хүсэлтүүд автоматаар ажиллана.
const store = require("./store");
const REV_MARK = "Засварын хүсэлт";
const holding = () => process.env.PLAN_HOLD_REVISIONS === "1";
const HOLD_MSG = "Таны засварын хүсэлтийг хүлээн авлаа ✅ Систем шинэчлэгдэж байгаа тул засвар хэдэн цагийн дотор хийгдэж, PDF болон Word файлаар энд ирнэ. Засварын эрх тань хасагдаагүй, хүсэлтээ дахин бичих шаардлагагүй. Хүлээсэнд баярлалаа 🙏";
function enqueueHeld(h) {
  const id = crypto.randomUUID();
  const job = { id, psid: h.psid, conversation: h.conversation, status: "queued", createdAt: Date.now() };
  jobs.set(id, job); activeByPsid.set(h.psid, id); queue.push(job);
  fbText(h.psid, "Таны засварыг боловсруулж эхэллээ ⏳ Ойролцоогоор 30–45 минутын дараа PDF болон Word файлаар илгээнэ.").catch(() => { });
  pump(); return id;
}
async function releaseHeld(log = console.log) {
  if (holding()) return [];
  const list = await store.holdList(), started = [];
  for (const h of list) {
    if (!h || !h.psid || !h.conversation) continue;
    await store.holdDel(h.psid);
    if (activeByPsid.has(h.psid)) { log(`[hold] ${h.psid} аль хэдийн ажиллаж байна — давхар эхлүүлэхгүй`); continue; }
    started.push(enqueueHeld(h)); log(`[hold] ${h.psid} хүлээлгэсэн засварыг эхлүүлэв`);
  }
  return started;
}
if (process.env.PLAN_MOCK !== "1") setTimeout(() => releaseHeld().catch((e) => console.warn("[hold]", e.message)), 25000).unref();

// body: { psid, conversation } эсвэл { psid, assumptions } ; notify:true бол эхлэх мессеж илгээнэ
router.post("/jobs/plan", express.json({ limit: "2mb" }), auth, async (req, res) => {
  const { psid, conversation, assumptions, notify = true } = req.body || {};
  if (!conversation && !assumptions) return res.status(400).json({ error: "conversation эсвэл assumptions шаардлагатай" });
  if (psid && activeByPsid.has(psid)) return res.status(202).json({ job_id: activeByPsid.get(psid), status: "already_running" });
  // Систем шинэчлэгдэж байх үед засварын хүсэлтийг хүлээлгэнэ: шинэчлэл дуусаад автоматаар ажиллана
  if (psid && conversation && holding() && String(conversation).includes(REV_MARK)) {
    await store.holdSave(psid, conversation);
    console.log(`[hold] ${psid} засварын хүсэлтийг хүлээлгэв`);
    res.status(202).json({ status: "held" });
    if (notify) fbText(psid, HOLD_MSG).catch(() => { });
    if (process.env.ADMIN_PSID) fbText(process.env.ADMIN_PSID, `⏸ Засварын хүсэлт хүлээлгэгдэв (psid ${psid}). Систем шинэчлэгдсэний дараа автоматаар ажиллана.`).catch(() => { });
    return;
  }
  const id = crypto.randomUUID();
  const job = { id, psid, conversation, assumptions, status: "queued", createdAt: Date.now() };
  jobs.set(id, job); if (psid) activeByPsid.set(psid, id); queue.push(job);
  // Дарааллын байрлалаас хамааруулж хүлээх хугацааг тооцно (нэг төсөл ~40 мин, MAX_PARALLEL зэрэг)
  const ahead = running + queue.length - 1;             // энэ ажлаас өмнө байгаа (ажиллаж буй + дараалалд)
  const waves = Math.floor(ahead / MAX_PARALLEL);        // хэдэн "ээлж" хүлээх вэ
  const lo = 30 + waves * 40, hi = 45 + waves * 40;
  res.status(202).json({ job_id: id, status: "queued", position: queue.length, eta_min: [lo, hi] });
  if (psid && notify) {
    const msg = waves === 0
      ? "Таны бизнес төслийг боловсруулж эхэллээ ⏳ Ойролцоогоор 30–45 минутын дараа PDF болон Word файлаар илгээнэ. Энэ хооронд чатыг хаасан ч болно."
      : `Таны захиалгыг хүлээн авлаа ✅ Одоогоор өөр захиалгууд боловсруулагдаж байгаа тул таны өмнө ${ahead} захиалга байна. Ойролцоогоор ${lo}–${hi} минутын дараа PDF болон Word файлаар илгээнэ. Энэ хооронд чатыг хаасан ч болно.`;
    fbText(psid, msg).catch(() => { });
  }
  pump();
});

// Deploy хийхээс өмнө шалгах: ажиллаж буй/дараалалд байгаа төсөл байвал deploy хийхгүй хүлээнэ (нууц мэдээлэлгүй).
router.get("/jobs-status", (req, res) => res.json({ running, queued: queue.length, safe_to_deploy: running === 0 && queue.length === 0 }));

router.get("/jobs/:id", auth, (req, res) => {
  const j = jobs.get(req.params.id); if (!j) return res.status(404).json({ error: "not found" });
  res.json({ id: j.id, status: j.status, step: j.step, error: j.error, result: j.result, qc: j.qc, filename: j.filename });
});
// Бэлэн файлыг татах (шалгах, дахин илгээхэд)
router.get("/jobs/:id/file", auth, (req, res) => {
  const j = jobs.get(req.params.id); if (!j || !j.buffer) return res.status(404).json({ error: "file not ready" });
  res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${j.filename}"` }).send(j.buffer);
});
// Render дахин асах (deploy/restart) үед SIGTERM ирнэ: дуусаагүй ажлуудыг Make-д "interrupted" гэж мэдэгдэнэ.
// Make 2.5 минут хүлээгээд ижил яриагаар ажлыг автоматаар дахин эхлүүлнэ — захиалагч юу ч мэдэхгүй.
let shuttingDown = false;
process.on("SIGTERM", async () => {
  if (shuttingDown) return; shuttingDown = true;
  const pending = [...jobs.values()].filter(j => (j.status === "running" || j.status === "queued") && j.psid);
  console.log(`[shutdown] ${pending.length} дуусаагүй ажлыг Make-д мэдэгдэж байна`);
  if (process.env.MAKE_DONE_WEBHOOK) {
    await Promise.allSettled(pending.map(j => fetch(process.env.MAKE_DONE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: j.id, psid: j.psid, status: "interrupted" }), signal: AbortSignal.timeout(8000) })));
  }
  process.exit(0);
});

// Хуучин ажлуудыг 24 цагийн дараа санах ойгоос цэвэрлэх
setInterval(() => { const now = Date.now(); for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > 24 * 3600e3) jobs.delete(id); }, 3600e3).unref();

// Сервис дахин асахад санах ой дахь дараалал алдагддаг. Make-д мэдэгдэж,
// "боловсруулж байна" төлөвтэй үлдсэн захиалгуудыг дахин илгээлгэнэ.
if (process.env.MAKE_RESTART_WEBHOOK && process.env.PLAN_MOCK !== "1") {
  setTimeout(() => {
    fetch(process.env.MAKE_RESTART_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "service_restarted", at: new Date().toISOString() }) })
      .then(r => console.log("[plan-v2] restart мэдэгдэл илгээсэн", r.status)).catch(e => console.warn("[plan-v2] restart мэдэгдэл алдаа", e.message));
  }, 15000).unref();
}

// Томьёотой Excel санхүүгийн загвар (нэмэлт үйлчилгээ). Үндсэн урсгалаас тусдаа: энд алдаа гарсан ч төсөл бичих ажилд нөлөөлөхгүй.
// body: { psid } (хадгалсан төслөөс) эсвэл { assumptions } ; send:true бол Messenger-ээр илгээнэ (to: өөр хүлээн авагчийн PSID).
// send байхгүй бол файлыг хариунд буцаана. Тооцоо системийнхтэй зөрвөл 422 буцааж, файл ИЛГЭЭХГҮЙ.
router.post("/jobs/xlsx", express.json({ limit: "2mb" }), auth, async (req, res) => {
  try {
    const { psid, assumptions, send, to } = req.body || {};
    const { makeModel } = require("./xlsxModel"); const { analyse } = require("./model"); const { normalize } = require("./intake"); const { loadPlan } = require("./store");
    let A = assumptions ? normalize(assumptions) : null;
    if (!A && psid) { const st = await loadPlan(psid); A = st && st.A; if (A && A.contingency_rate === undefined) A.contingency_rate = 0; if (A && A.tax_regime === undefined) A.tax_regime = "legacy"; } // хуучин төсөлд нөөц төсөв нэмэхгүй — хүргэсэн Word-той тоо таарна
    if (!A) return res.status(404).json({ ok: false, error: "Энэ захиалагчийн хадгалсан төсөл олдсонгүй" });
    const m = await makeModel(A, analyse(A));
    if (!m.ok) { console.warn("[xlsx] шалгалт унав", JSON.stringify(m.bad.slice(0, 5))); return res.status(422).json({ ok: false, error: "Excel-ийн тооцоо системийн тооцоотой таарсангүй — файл илгээгээгүй", bad: m.bad.slice(0, 10) }); }
    const company = String(A.company?.name || "").replace(/[«»"\\/:*?<>|]/g, "").trim().slice(0, 40);
    const filename = `Санхүүгийн загвар${company ? " - " + company : ""}.xlsx`, mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (send) {
      const { fbFile } = require("./util"); await fbFile(to || psid, m.buffer, filename, mime);
      console.log(`[xlsx] ${to || psid} руу илгээлээ (${m.formulas} томьёо, ${m.total} шалгалт)`);
      return res.json({ ok: true, sent_to: to || psid, filename, formulas: m.formulas, checks: m.total });
    }
    res.set({ "Content-Type": mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` }).send(m.buffer);
  } catch (e) { console.warn("[xlsx]", e.message); res.status(500).json({ ok: false, error: String(e.message).slice(0, 300) }); }
});

router.use(require("./files"));
router.use(require("./upload"));
module.exports = router;
module.exports.releaseHeld = releaseHeld;
module.exports._q = { jobs, activeByPsid, queue };
