// Хугацааны сонголтын туршилт (Claude дуудахгүй):  node org-v1/test/period-test.js [outdir]
process.env.ORG_MOCK = "1"; process.env.GUARD_DISABLED = "1";
const fs = require("fs"), path = require("path");
const { runOrg } = require("../pipeline");
const PER = require("../period");
const out = process.argv[2] || "/tmp";
const cases = [
  ["plan", "plan-sample.json", { type: "quarter", n: 1 }, 2027],
  ["plan", "plan-sample.json", { type: "month", n: 5 }, 2027],
  ["plan", "plan-sample.json", { type: "half", n: 2 }, 2027],
  ["report_dept", "kpi-sample.json", { type: "quarter", n: 3 }],
  ["report_dir", "kpi-sample.json", { type: "half", n: 1 }],
  ["plan_dept", "kpi-sample.json", { type: "month", n: 11 }, 2026],
  ["plan_dept", "kpi-sample.json", { type: "quarter", n: 1 }, 2027],
];
(async () => {
  let fail = 0;
  for (const [product, file, period, periodYear] of cases) {
    const job = { id: `${product}-${period.type}${period.n}`, product, period, periodYear, input: JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8")) };
    await runOrg(job, () => { });
    const tag = `${product}-${period.type}${period.n}`;
    fs.writeFileSync(path.join(out, tag + ".docx"), job.buffer);
    if (job.pdf) fs.writeFileSync(path.join(out, tag + ".pdf"), job.pdf);
    if (job.xlsx) fs.writeFileSync(path.join(out, tag + ".xlsx"), job.xlsx);
    const ok = job.result.xlsx && job.per && job.per.type === period.type;
    if (!ok) fail++;
    console.log(ok ? "✓" : "✗", tag, JSON.stringify({ period: job.per && job.per.full, pages: job.result.pages, xlsx: job.result.xlsx, qc: job.qc.filter((q) => /Excel|Хоосон|хориотой/.test(q)) }));
  }
  // next() ба он тогтоох
  const n1 = PER.next({ type: "quarter", n: 4 }, 2026), n2 = PER.next({ type: "month", n: 3 }, 2026);
  if (!(n1.n === 1 && n1.year === 2027 && n2.n === 4 && n2.year === 2026)) { fail++; console.log("✗ next"); } else console.log("✓ next");
  const now = { y: 2026, m: 10 }, py = PER.planYear({ type: "quarter", n: 1 }, now), ry = PER.reportYear({ type: "quarter", n: 4 }, now);
  const py2 = PER.planYear({ type: "quarter", n: 4 }, now), py3 = PER.planYear({ type: "half", n: 2 }, now), py4 = PER.planYear({ type: "month", n: 11 }, now);
  if (!(py === 2027 && ry === 2026 && py2 === 2026 && py3 === 2027 && py4 === 2026)) { fail++; console.log("✗ year", py, ry); } else console.log("✓ year");
  console.log(fail ? `АЛДАА ${fail}` : "БҮХ ТУРШИЛТ АМЖИЛТТАЙ");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
