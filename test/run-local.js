// Локал тест: node test/run-local.js [assumptions.json] — Word файлыг test/out.docx-д бичнэ.
// PLAN_MOCK=1 бол Claude дуудахгүй. Бодит тест: ANTHROPIC_API_KEY тохируулаад PLAN_MOCK-гүй ажиллуул.
const fs = require("fs");
const { runPipeline } = require("../plan-v2/pipeline");
const A = JSON.parse(fs.readFileSync(process.argv[2] || __dirname + "/domart-assumptions.json", "utf8"));
runPipeline({ id: "local", assumptions: A, conversation: "" }).then(j => {
  fs.writeFileSync(__dirname + "/out.docx", j.buffer);
  console.log(JSON.stringify({ result: j.result, qc: j.qc }, null, 1));
}).catch(e => { console.error(e); process.exit(1); });
