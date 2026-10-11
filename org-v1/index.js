// Байгууллагын жилийн төлөвлөгөө ба тайлангийн Express router. Зам: /org/... (API түлхүүртэй), /u/org/... (захиалагчийн upload хуудас).
// Өөрийн дараалалтай. ORG_ENABLED=1 биш бол шинэ ажил хүлээж авахгүй (upload, үнийн санал ажиллана).
// server.js-д:  try { app.use(require("./org-v1")); } catch (e) { console.error("[org-v1] ачаалж чадсангүй:", e.message); }
const express = require("express");
const crypto = require("crypto");
const { runOrg } = require("./pipeline");
const upload = require("./upload");
const M = require("./materials");
const { PRODUCTS } = require("./quote");
const { fbText } = require("../plan-v2/util");
const { newUsage, withUsage } = require("../plan-v2/claude");
const router = express.Router();
router.use(upload);
const jobs = new Map(), activeByPsid = new Map(), queue = []; let running = 0;
const MAX_PARALLEL = Number(process.env.ORG_MAX_PARALLEL || 1);
const hook = (body) => process.env.ORG_DONE_WEBHOOK ? fetch(process.env.ORG_DONE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }).catch(() => { }) : Promise.resolve();
function auth(req, res, next) { if (req.get("x-api-key") !== process.env.API_KEY) return res.status(401).json({ error: "unauthorized" }); next(); }

// Бизнес төсөл, маркетингийн ажил явж байвал дуусахыг хүлээнэ (санах ой, API-ийн хязгаарыг булаалдахгүй)
async function yieldToOthers(job) {
  if (process.env.ORG_YIELD === "0" || process.env.ORG_MOCK === "1") return;
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`, until = Date.now() + Number(process.env.ORG_YIELD_MAX_MIN || 60) * 60000;
  while (Date.now() < until) {
    let busy = false;
    try { const s = await (await fetch(base + "/jobs-status", { signal: AbortSignal.timeout(5000) })).json(); busy = !!(s.running || s.queued); } catch (_) { }
    if (!busy) try { const s = await (await fetch(base + "/mkt/status", { headers: { "x-api-key": process.env.API_KEY || "" }, signal: AbortSignal.timeout(5000) })).json(); busy = !!(s.running || s.queued); } catch (_) { }
    if (!busy) return;
    job.step = "өөр ажил дуусахыг хүлээж байна";
    await new Promise((r) => setTimeout(r, 30000));
  }
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift(); running++; job.status = "running"; job.usage = newUsage();
    yieldToOthers(job).then(() => withUsage(job.usage, () => runOrg(job))).then(() => { job.status = "done"; })
      .catch(async (e) => {
        if (shuttingDown) return;
        const name = PRODUCTS[job.product] ? PRODUCTS[job.product].name : job.product;
        if (e.status === "blocked") {
          job.status = "blocked"; job.error = e.message; console.warn(`[org ${job.id}] ХААГДСАН`, e.message);
          if (job.psid) await fbText(job.psid, require("../plan-v2/guard").CUSTOMER_MSG).catch(() => { });
          if (process.env.ADMIN_PSID) await fbText(process.env.ADMIN_PSID, `⛔ ${name} захиалгыг хаалаа (job ${job.id}, psid ${job.psid || "-"}): ${String(e.message).slice(0, 300)}. Төлбөрийг шалгаж, захиалагчтай холбогдоно уу.`).catch(() => { });
          await hook({ job_id: job.id, psid: job.psid, product: job.product, status: "blocked", error: e.message });
          return;
        }
        job.status = "failed"; job.error = e.message; console.error(`[org ${job.id}] АЛДАА`, e);
        const credit = /credit balance/i.test(e.message || "");
        if (job.psid) await fbText(job.psid, `Уучлаарай, таны захиалгыг («${name}») боловсруулахад техникийн саатал гарлаа. Манай ажилтан тантай удахгүй холбогдоно.`).catch(() => { });
        if (process.env.ADMIN_PSID) await fbText(process.env.ADMIN_PSID, credit ? `⚠️ Anthropic API кредит дууссан! ${name}-ийн захиалагч хүлээгдэж байна.` : `⚠️ ${name} боловсруулахад алдаа гарлаа (job ${job.id}, psid ${job.psid || "-"}): ${String(e.message).slice(0, 300)}`).catch(() => { });
        await hook({ job_id: job.id, psid: job.psid, product: job.product, status: "failed", error: e.message });
      })
      .finally(() => { const u = job.usage || {}; console.log(`[org ${job.id}] токен: input ${u.input}, output ${u.output}, cache бичсэн ${u.cache_write}, cache уншсан ${u.cache_read}, web хайлт ${u.web_searches}, дуудлага ${u.calls}`);
        running--; if (job.psid) activeByPsid.delete(job.psid); job.finishedAt = Date.now(); pump(); });
  }
}

// body: { psid, product?, conversation?, year?, notify? } — product өгөхгүй бол upload хийсэн үеийн бүтээгдэхүүнийг авна.
// Туршилтад: { product, input } (cfg эсвэл metrics) — материал уншихгүй.
router.post("/org/jobs", express.json({ limit: "5mb" }), auth, async (req, res) => {
  if (process.env.ORG_ENABLED !== "1") return res.status(503).json({ error: "org үйлчилгээ идэвхжээгүй (ORG_ENABLED=1)" });
  const { psid, conversation, year, input, digest, A, notify = true } = req.body || {};
  let product = (req.body || {}).product;
  if (!product && psid) { const meta = await M.getMeta(psid).catch(() => null); product = meta && meta.product; }
  if (!PRODUCTS[product]) return res.status(400).json({ error: "product буруу (plan | report_dept | report_dir)" });
  if (!input && psid) { const files = await M.listFiles(psid).catch(() => []); if (!files.length && String(conversation || "").trim().length < 200) return res.status(400).json({ error: "материал алга (захиалагч файл илгээгээгүй эсвэл хадгалах хугацаа дууссан)" }); }
  if (!input && !psid) return res.status(400).json({ error: "psid эсвэл input шаардлагатай" });
  if (psid && activeByPsid.has(psid)) return res.status(202).json({ job_id: activeByPsid.get(psid), status: "already_running" });
  const id = crypto.randomUUID(), job = { id, psid, product, conversation, year, input, digest, A, status: "queued", createdAt: Date.now() };
  jobs.set(id, job); if (psid) activeByPsid.set(psid, id); queue.push(job);
  res.status(202).json({ job_id: id, status: "queued", product, position: queue.length });
  if (psid && notify) fbText(psid, `Таны захиалгыг («${PRODUCTS[product].name}») боловсруулж эхэллээ ⏳ Материалын хэмжээнээс хамаарч 30–90 минут болно. Бэлэн болмогц PDF, Word, Excel файлаар илгээнэ. Энэ хооронд чатыг хаасан ч болно.`).catch(() => { });
  pump();
});
router.get("/org/status", auth, (req, res) => res.json({ enabled: process.env.ORG_ENABLED === "1", running, queued: queue.length, safe_to_deploy: running === 0 && queue.length === 0 }));
router.get("/org/jobs/:id", auth, (req, res) => { const j = jobs.get(req.params.id); if (!j) return res.status(404).json({ error: "not found" });
  res.json({ id: j.id, product: j.product, status: j.status, step: j.step, error: j.error, result: j.result, qc: j.qc, filename: j.filename }); });
router.get("/org/jobs/:id/file", auth, (req, res) => {
  const j = jobs.get(req.params.id), t = req.query.type || "docx";
  const map = { docx: ["buffer", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"], pdf: ["pdf", "application/pdf", ".pdf"], xlsx: ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"] }[t];
  if (!map || !j || !j[map[0]]) return res.status(404).json({ error: "file not ready" });
  res.set({ "Content-Type": map[1], "Content-Disposition": `attachment; filename="${j.filename.replace(/\.docx$/, map[2])}"` }).send(j[map[0]]);
});

let shuttingDown = false;
process.on("SIGTERM", () => { if (shuttingDown) return; shuttingDown = true;
  for (const j of jobs.values()) if ((j.status === "running" || j.status === "queued") && j.psid) hook({ job_id: j.id, psid: j.psid, product: j.product, status: "interrupted" }); });
setInterval(() => { const now = Date.now(); for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > 24 * 3600e3) jobs.delete(id); }, 3600e3).unref();
module.exports = router;
