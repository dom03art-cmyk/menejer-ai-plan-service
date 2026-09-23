// Бүтэн урсгал: таамаглал → санхүүгийн загвар → судалгаа → бүлгүүд → Word → шалгалт → илгээх
const { extract, normalize } = require("./intake");
const { analyse } = require("./model");
const { build } = require("./fintables");
const { research } = require("./research");
const { writeAll } = require("./chapters");
const { renderAll } = require("./charts");
const { buildDoc } = require("./document");
const { hasSoffice, findPages, qc, fbText, fbFile } = require("./util");
const { usage } = require("./claude");

async function runPipeline(job, log = console.log) {
  const t0 = Date.now(); const step = (s) => { job.step = s; log(`[${job.id}] ${s} (${Math.round((Date.now() - t0) / 1000)}с)`); };
  step("1/7 таамаглал гаргаж байна");
  const A = job.assumptions ? normalize(job.assumptions) : await extract(job.conversation);
  step("2/7 санхүүгийн загвар");
  const an = analyse(A);
  const fin = build(an);
  step("3/7 судалгаа");
  let res = { macro: [], market: [] };
  try { res = await research(A); } catch (e) { log(`[${job.id}] судалгаа амжилтгүй, судалгаагүй үргэлжилнэ: ${e.message}`); }
  fin.sources = [...new Set([...res.macro, ...res.market].map(x => `${x.source}${x.date ? ", " + x.date : ""}`))].slice(0, 40);
  if (!fin.sources.length) fin.sources = ["Захиалагчийн өгсөн мэдээлэл", "Төслийн санхүүгийн загвар"];
  step("4/7 бүлгүүдийг бичиж байна");
  const written = await writeAll({ A, facts: fin.facts, research: res, conversation: job.conversation }, undefined, (g) => log(`[${job.id}]   ✓ ${g}`));
  step("5/7 график");
  const charts = await renderAll(fin.charts);
  step("6/7 Word угсарч байна");
  let doc = await buildDoc({ A, written, fin, charts, pages: [] });
  let text = null, nPages = null;
  if (hasSoffice()) {
    const fp = findPages(doc.buffer, doc.heads);
    doc = await buildDoc({ A, written, fin, charts, pages: fp.pages });
    text = fp.allText; nPages = fp.nPages;
  } else {
    doc = await buildDoc({ A, written, fin, charts, pages: null }); // Word "Update Field" гарчиг
  }
  job.qc = qc({ an, text, heads: doc.heads, written });
  job.result = { pages: nPages, tables: doc.tables, headings: doc.heads.length, npv: Math.round(an.npv), irr: +(an.irr * 100).toFixed(1), dscr: an.R.dscr.slice(0, 3), usage: { ...usage }, seconds: Math.round((Date.now() - t0) / 1000), missing_info: A.missing_info || [], assumed: A.assumed_fields || [] };
  job.buffer = doc.buffer;
  step("7/7 илгээж байна");
  const fname = `business-plan-${(A.company.name || "plan").replace(/[^a-zA-Z0-9]+/g, "").slice(0, 20) || "plan"}-${new Date().toISOString().slice(0, 10)}.docx`;
  job.filename = fname;
  if (job.psid && process.env.PLAN_MOCK !== "1") {
    await fbFile(job.psid, doc.buffer, fname);
    if ((A.missing_info || []).length) await fbText(job.psid, `Төсөл бэлэн боллоо. Банкинд өгөхийн өмнө дараах мэдээллийг нөхөөрэй: ${A.missing_info.join(", ")}.`);
  }
  if (process.env.MAKE_DONE_WEBHOOK && process.env.PLAN_MOCK !== "1") {
    await fetch(process.env.MAKE_DONE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job.id, psid: job.psid, status: "done", ...job.result, qc: job.qc }) }).catch(e => log("webhook алдаа " + e.message));
  }
  step("дууслаа");
  return job;
}
module.exports = { runPipeline };
