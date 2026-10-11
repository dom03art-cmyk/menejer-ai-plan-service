// Claude дуудахгүй бүтэн урсгалын туршилт:  ORG_MOCK=1 node org-v1/test/pipeline-test.js [outdir]
process.env.ORG_MOCK = "1"; process.env.GUARD_DISABLED = "1";
const fs = require("fs"), path = require("path");
const { runOrg } = require("../pipeline");
const out = process.argv[2] || "/tmp";
(async () => {
  for (const [product, file] of [["plan", "plan-sample.json"], ["report_dept", "kpi-sample.json"], ["report_dir", "kpi-sample.json"]]) {
    const job = { id: product, product, input: JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8")) };
    await runOrg(job, () => { });
    fs.writeFileSync(path.join(out, product + ".docx"), job.buffer);
    if (job.pdf) fs.writeFileSync(path.join(out, product + ".pdf"), job.pdf);
    if (job.xlsx) fs.writeFileSync(path.join(out, product + ".xlsx"), job.xlsx);
    console.log(product, JSON.stringify({ pages: job.result.pages, tables: job.result.tables, xlsx: job.result.xlsx, qc: job.qc.slice(0, 6) }));
  }
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
