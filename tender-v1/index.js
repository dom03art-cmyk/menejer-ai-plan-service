// Тендерийн материалын модуль (tender-v1). Зам: /tender/... (API түлхүүртэй), /u/tnd/... (оролцогчийн файл илгээх хуудас).
// server.js-д:  try { app.use(require("./tender-v1")); } catch (e) { console.error("[tender-v1] ачаалж чадсангүй:", e.message); }
// Унтраалга: TENDER_ENABLED=1 биш бол зөвхөн TENDER_ALLOW_PSIDS-д байгаа psid (админ туршилт) ажил үүсгэнэ.
// Өөрийн дараалалтай; бизнес төсөл, маркетинг, тайлангийн ажил явж байвал түүнийг хүлээнэ.
const express = require("express");
const crypto = require("crypto");
const { runAnalyze, runCompose } = require("./pipeline");
const { newUsage, withUsage } = require("../plan-v2/claude");
const router = express.Router();
router.use(require("./upload"));

const jobs = new Map(), activeByPsid = new Map(), queue = []; let running = 0;
const MAX_PARALLEL = Number(process.env.TENDER_MAX_PARALLEL || 1);
const auth = (req, res, next) => (process.env.API_KEY && req.get("x-api-key") === process.env.API_KEY ? next() : res.status(401).json({ error: "unauthorized" }));
const canRun = (psid) => process.env.TENDER_ENABLED === "1" || require("./flow").allowed(psid) && !!process.env.TENDER_ALLOW_PSIDS;

async function yieldToOthers(job) {
  if (process.env.TENDER_YIELD === "0" || process.env.TENDER_MOCK === "1") return;
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`, H = { "x-api-key": process.env.API_KEY || "" }, until = Date.now() + 45 * 60000;
  while (Date.now() < until) {
    let busy = false;
    for (const p of ["/jobs-status", "/mkt/status", "/org/status"]) { if (busy) break; try { const s = await (await fetch(base + p, { headers: H, signal: AbortSignal.timeout(5000) })).json(); busy = !!(s.running || s.queued); } catch (_) { } }
    if (!busy) return;
    job.step = "өөр ажил дуусахыг хүлээж байна"; await new Promise((r) => setTimeout(r, 30000));
  }
}

// kind: "analyze" | "compose"
function enqueue({ psid, kind, ...extra }) {
  if (!psid || !["analyze", "compose"].includes(kind)) return { ok: false, error: "psid, kind" };
  if (!canRun(psid)) return { ok: false, error: "tender үйлчилгээ идэвхжээгүй (TENDER_ENABLED=1)" };
  if (activeByPsid.has(psid)) return { ok: true, job_id: activeByPsid.get(psid), status: "already_running" };
  const id = crypto.randomUUID(), job = { id, psid, kind, ...extra, status: "queued", createdAt: Date.now() };
  jobs.set(id, job); activeByPsid.set(psid, id); queue.push(job); pump();
  return { ok: true, job_id: id, status: "queued", position: queue.length };
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift(); running++; job.status = "running"; job.usage = newUsage(); const t0 = Date.now();
    yieldToOthers(job).then(() => withUsage(job.usage, () => (job.kind === "analyze" ? runAnalyze(job) : runCompose(job))))
      .then(() => { job.status = "done"; })
      .catch(async (e) => { job.status = e.status === "blocked" ? "blocked" : "failed"; job.error = e.message; console.error(`[tender ${job.id}] АЛДАА`, e); await require("./flow").onFailed(job, e).catch(() => { }); })
      .finally(() => { const u = job.usage || {}; job.seconds = Math.round((Date.now() - t0) / 1000);
        console.log(`[tender ${job.id}] ${job.kind} ${job.status} ${job.outcome || ""} ${job.seconds}с | токен in ${u.input} out ${u.output} cache_w ${u.cache_write} cache_r ${u.cache_read} дуудлага ${u.calls}`);
        running--; activeByPsid.delete(job.psid); job.finishedAt = Date.now(); pump(); });
  }
}

router.get("/tender/status", auth, (req, res) => res.json({ enabled: process.env.TENDER_ENABLED === "1", allow: !!process.env.TENDER_ALLOW_PSIDS, running, queued: queue.length, safe_to_deploy: running === 0 && queue.length === 0 }));
router.get("/tender/jobs/:id", auth, (req, res) => { const j = jobs.get(req.params.id); if (!j) return res.status(404).json({ error: "not found" }); res.json({ id: j.id, kind: j.kind, status: j.status, step: j.step, outcome: j.outcome, error: j.error, report: j.report, seconds: j.seconds, usage: j.usage }); });
// Админ / Make: ажлыг гараар эхлүүлэх (жишээ нь алдааны дараа)
router.post("/tender/jobs", express.json(), auth, (req, res) => { const r = enqueue(req.body || {}); res.status(r.ok ? 202 : 400).json(r); });
router.get("/tender/case/:psid", auth, async (req, res) => { const S = require("./store"); res.json({ state: await S.getState(req.params.psid), case: await S.getCase(req.params.psid), files: await S.listFiles(req.params.psid) }); });
// Туршилт: Messenger-гүйгээр урсгалыг дуудах (TENDER_DRY=1 үед мессеж Facebook руу явахгүй)
router.post("/tender/flow", express.json({ limit: "1mb" }), auth, async (req, res) => {
  const b = req.body || {}; if (!b.psid) return res.status(400).json({ error: "psid" });
  const F = require("./flow");
  try { if (!(await F.claims(String(b.psid), b.payload))) return res.json({ state: null, claimed: false }); res.json({ state: await F.handle({ psid: String(b.psid), text: b.text, payload: b.payload, attachments: b.attachments }), claimed: true }); }
  catch (e) { console.error("[tender] flow", e); res.json({ state: "ext", error: e.message }); }
});

// Дахин асахад тасарсан ажлыг сэргээнэ (Render deploy, restart): SIGTERM үед жагсаалтыг хадгалж, асахдаа дахин дараалалд оруулна.
let shuttingDown = false;
process.on("SIGTERM", () => {
  if (shuttingDown) return; shuttingDown = true;
  const cut = [...jobs.values()].filter((j) => j.status === "running" || j.status === "queued").map((j) => ({ psid: j.psid, kind: j.kind }));
  if (cut.length) { console.warn(`[tender] сервер унтарч байна — ${cut.length} ажил тасарлаа`); require("./store").setMisc("interrupted", cut).catch(() => { }); }
});
setTimeout(async () => {
  try {
    const S = require("./store"), cut = (await S.getMisc("interrupted")) || []; if (!cut.length) return;
    await S.setMisc("interrupted", []);
    for (const c of cut) { const r = enqueue(c); console.log(`[tender] тасарсан ажлыг сэргээв: ${c.kind} ${c.psid} → ${r.status || r.error}`); }
  } catch (e) { console.warn("[tender] сэргээх:", e.message); }
}, Number(process.env.TENDER_RESUME_DELAY_MS || 20000)).unref();
setInterval(() => { const now = Date.now(); for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > 24 * 3600e3) jobs.delete(id); }, 3600e3).unref();

module.exports = router;
module.exports.enqueue = enqueue;
module.exports._jobs = jobs;
module.exports.isActive = (psid) => activeByPsid.has(String(psid));
