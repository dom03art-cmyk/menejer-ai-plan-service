// Express router: POST /jobs/plan — ажлыг хүлээн аваад ШУУД 202 буцаана, арын горимд ажиллана.
// Одоо байгаа server.js-д:  app.use(require("./plan-v2"));
const express = require("express");
const crypto = require("crypto");
const { runPipeline } = require("./pipeline");
const { fbText } = require("./util");
const router = express.Router();
const jobs = new Map();          // id -> job
const activeByPsid = new Map();  // psid -> id (давхар ажил үүсэхээс сэргийлнэ)
const queue = []; let running = 0;
const MAX_PARALLEL = Number(process.env.PLAN_MAX_PARALLEL || 1);

function auth(req, res, next) { if (req.get("x-api-key") !== process.env.API_KEY) return res.status(401).json({ error: "unauthorized" }); next(); }

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift(); running++; job.status = "running";
    runPipeline(job).then(() => { job.status = "done"; })
      .catch(async (e) => {
        job.status = "failed"; job.error = e.message; console.error(`[${job.id}] АЛДАА`, e);
        if (job.psid) await fbText(job.psid, "Уучлаарай, төсөл боловсруулахад техникийн саатал гарлаа. Манай ажилтан тантай удахгүй холбогдоно.").catch(() => { });
        if (process.env.MAKE_DONE_WEBHOOK) fetch(process.env.MAKE_DONE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, psid: job.psid, status: "failed", error: e.message }) }).catch(() => { });
      })
      .finally(() => { running--; if (job.psid) activeByPsid.delete(job.psid); job.finishedAt = Date.now(); pump(); });
  }
}

// body: { psid, conversation } эсвэл { psid, assumptions } ; notify:true бол эхлэх мессеж илгээнэ
router.post("/jobs/plan", express.json({ limit: "2mb" }), auth, async (req, res) => {
  const { psid, conversation, assumptions, notify = true } = req.body || {};
  if (!conversation && !assumptions) return res.status(400).json({ error: "conversation эсвэл assumptions шаардлагатай" });
  if (psid && activeByPsid.has(psid)) return res.status(202).json({ job_id: activeByPsid.get(psid), status: "already_running" });
  const id = crypto.randomUUID();
  const job = { id, psid, conversation, assumptions, status: "queued", createdAt: Date.now() };
  jobs.set(id, job); if (psid) activeByPsid.set(psid, id); queue.push(job);
  res.status(202).json({ job_id: id, status: "queued", position: queue.length });
  if (psid && notify) fbText(psid, "Таны бизнес төслийг боловсруулж эхэллээ ⏳ Ойролцоогоор 20–30 минутын дараа PDF болон Word файлаар илгээнэ. Энэ хооронд чатыг хаасан ч болно.").catch(() => { });
  pump();
});

router.get("/jobs/:id", auth, (req, res) => {
  const j = jobs.get(req.params.id); if (!j) return res.status(404).json({ error: "not found" });
  res.json({ id: j.id, status: j.status, step: j.step, error: j.error, result: j.result, qc: j.qc, filename: j.filename });
});
// Бэлэн файлыг татах (шалгах, дахин илгээхэд)
router.get("/jobs/:id/file", auth, (req, res) => {
  const j = jobs.get(req.params.id); if (!j || !j.buffer) return res.status(404).json({ error: "file not ready" });
  res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${j.filename}"` }).send(j.buffer);
});
// Хуучин ажлуудыг 24 цагийн дараа санах ойгоос цэвэрлэх
setInterval(() => { const now = Date.now(); for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > 24 * 3600e3) jobs.delete(id); }, 3600e3).unref();

module.exports = router;
