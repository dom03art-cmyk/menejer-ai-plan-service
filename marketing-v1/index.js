// Маркетингийн төлөвлөгөөний Express router. БҮХ зам /mkt/-ээр эхэлнэ — бизнес төслийн (/jobs/...) замуудтай давхцахгүй.
// Өөрийн дараалалтай (plan-v2-ийн дараалал, төлөвт хүрэхгүй). MKT_ENABLED=1 гэж тохируулаагүй бол шинэ ажил хүлээж авахгүй (унтраалга).
// server.js-д:  try { app.use(require("./marketing-v1")); } catch (e) { console.error("[marketing-v1] ачаалж чадсангүй:", e.message); }
const express = require("express");
const crypto = require("crypto");
const { runMarketing } = require("./pipeline");
const { fbText } = require("../plan-v2/util");
const { newUsage, withUsage } = require("../plan-v2/claude");
const router = express.Router();
const jobs = new Map(), activeByPsid = new Map(), queue = []; let running = 0;
const MAX_PARALLEL = Number(process.env.MKT_MAX_PARALLEL || 1);
const hook = (body) => process.env.MKT_DONE_WEBHOOK ? fetch(process.env.MKT_DONE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product: "marketing", ...body }), signal: AbortSignal.timeout(8000) }).catch(() => { }) : Promise.resolve();
function auth(req, res, next) { if (req.get("x-api-key") !== process.env.API_KEY) return res.status(401).json({ error: "unauthorized" }); next(); }

// Бизнес төсөл боловсруулагдаж байвал түүнд зам тавьж хүлээнэ (санах ой, API-ийн хязгаарыг булаалдахгүй). MKT_YIELD_TO_PLAN=0 бол хүлээхгүй.
async function yieldToPlan(job) {
  if (process.env.MKT_YIELD_TO_PLAN === "0" || process.env.MKT_MOCK === "1") return;
  const url = `http://127.0.0.1:${process.env.PORT || 3000}/jobs-status`, until = Date.now() + Number(process.env.MKT_YIELD_MAX_MIN || 45) * 60000;
  while (Date.now() < until) {
    try { const s = await (await fetch(url, { signal: AbortSignal.timeout(5000) })).json(); if (!s.running && !s.queued) return; job.step = "бизнес төслийн ажил дуусахыг хүлээж байна"; }
    catch (_) { return; }
    await new Promise(r => setTimeout(r, 30000));
  }
}
function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift(); running++; job.status = "running"; job.usage = newUsage();
    yieldToPlan(job).then(() => withUsage(job.usage, () => runMarketing(job))).then(() => { job.status = "done"; })
      .catch(async (e) => {
        if (shuttingDown) return;
        job.status = "failed"; job.error = e.message; console.error(`[mkt ${job.id}] АЛДАА`, e);
        const credit = /credit balance/i.test(e.message || "");
        if (job.psid) await fbText(job.psid, "Уучлаарай, маркетингийн төлөвлөгөө боловсруулахад техникийн саатал гарлаа. Манай ажилтан тантай удахгүй холбогдоно.").catch(() => { });
        if (process.env.ADMIN_PSID) await fbText(process.env.ADMIN_PSID, credit ? "⚠️ Anthropic API кредит дууссан! Маркетингийн төлөвлөгөөний захиалагч хүлээгдэж байна." : `⚠️ Маркетингийн төлөвлөгөө боловсруулахад алдаа гарлаа (job ${job.id}): ${String(e.message).slice(0, 300)}`).catch(() => { });
        await hook({ job_id: job.id, psid: job.psid, status: "failed", error: e.message });
      })
      .finally(() => { const u = job.usage || {}; console.log(`[mkt ${job.id}] токен: input ${u.input}, output ${u.output}, cache бичсэн ${u.cache_write}, cache уншсан ${u.cache_read}, web хайлт ${u.web_searches}, дуудлага ${u.calls}`); running--; if (job.psid) activeByPsid.delete(job.psid); job.finishedAt = Date.now(); pump(); });
  }
}

// body: { psid, conversation } эсвэл { psid, assumptions }; notify:false бол эхлэх мессеж илгээхгүй. psid өгөхгүй бол Messenger-ээр юу ч илгээхгүй (туршилт).
router.post("/mkt/jobs", auth, (req, res) => {
  if (process.env.MKT_ENABLED !== "1") return res.status(503).json({ error: "marketing үйлчилгээ идэвхжээгүй (MKT_ENABLED=1)" });
  const { psid, conversation, assumptions, notify = true } = req.body || {};
  if (!conversation && !assumptions) return res.status(400).json({ error: "conversation эсвэл assumptions шаардлагатай" });
  if (psid && activeByPsid.has(psid)) return res.status(202).json({ job_id: activeByPsid.get(psid), status: "already_running" });
  const id = crypto.randomUUID(), job = { id, psid, conversation, assumptions, status: "queued", createdAt: Date.now() };
  jobs.set(id, job); if (psid) activeByPsid.set(psid, id); queue.push(job);
  res.status(202).json({ job_id: id, status: "queued", position: queue.length });
  if (psid && notify) fbText(psid, "Таны маркетингийн төлөвлөгөөг боловсруулж эхэллээ ⏳ Бэлэн болмогц PDF болон Word файлаар илгээнэ. Энэ хооронд чатыг хаасан ч болно.").catch(() => { });
  pump();
});
router.get("/mkt/status", auth, (req, res) => res.json({ enabled: process.env.MKT_ENABLED === "1", running, queued: queue.length, safe_to_deploy: running === 0 && queue.length === 0 }));
router.get("/mkt/jobs/:id", auth, (req, res) => { const j = jobs.get(req.params.id); if (!j) return res.status(404).json({ error: "not found" });
  res.json({ id: j.id, status: j.status, step: j.step, error: j.error, result: j.result, qc: j.qc, filename: j.filename }); });
router.get("/mkt/jobs/:id/file", auth, (req, res) => { const j = jobs.get(req.params.id), pdf = req.query.type === "pdf";
  if (req.query.type === "xlsx") { if (!j || !j.xlsx) return res.status(404).json({ error: "file not ready" });
    return res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${j.filename.replace(/\.docx$/, ".xlsx")}"` }).send(j.xlsx); }
  if (!j || !(pdf ? j.pdf : j.buffer)) return res.status(404).json({ error: "file not ready" });
  res.set({ "Content-Type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${pdf ? j.filename.replace(/\.docx$/, ".pdf") : j.filename}"` }).send(pdf ? j.pdf : j.buffer); });

// Сервис унтрах үед (deploy/restart) дуусаагүй ажлыг мэдэгдэнэ. process.exit ДУУДАХГҮЙ — унтраалтыг plan-v2 удирдана.
let shuttingDown = false;
process.on("SIGTERM", () => { if (shuttingDown) return; shuttingDown = true;
  for (const j of jobs.values()) if ((j.status === "running" || j.status === "queued") && j.psid) hook({ job_id: j.id, psid: j.psid, status: "interrupted" }); });
setInterval(() => { const now = Date.now(); for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > 24 * 3600e3) jobs.delete(id); }, 3600e3).unref();
module.exports = router;
