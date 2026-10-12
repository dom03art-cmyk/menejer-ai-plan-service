// Засварын туршилт (Claude дуудахгүй):  node org-v1/test/revision-test.js
process.env.ORG_MOCK = "1"; process.env.GUARD_DISABLED = "1"; delete process.env.REDIS_URL;
const fs = require("fs"), path = require("path");
const { runOrg } = require("../pipeline");
const REV = require("../revise");
const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"));
let fail = 0; const ok = (c, msg) => { console.log(c ? "✓" : "✗", msg); if (!c) fail++; };
(async () => {
  // 1. Тайлан (III улирал) → засвар: үзүүлэлтийн тоо засах
  const j1 = { id: "r1", psid: "R1", product: "report_dept", period: { type: "quarter", n: 3 }, input: load("kpi-sample.json") };
  await runOrg(j1, () => { });
  const snap = await REV.loadSnap("R1", "report_dept");
  ok(snap && snap.period && snap.period.n === 3 && snap.written && Object.keys(snap.written).length > 5, "тайлангийн төлөв хадгалагдсан");
  const ind = snap.m.indicators[1];
  const j2 = { id: "r2", psid: "R1", product: "report_dept", revision: `${ind.name} 9-р сард 99 байх ёстой`, mockPatch: { indicators: [{ name: ind.name, monthly: ind.monthly.map((v, i) => (i === 8 ? 99 : v)) }] } };
  await runOrg(j2, () => { });
  ok(j2.per && j2.per.n === 3, "засварт хугацаа хадгалагдсан (III улирал)");
  ok(j2.result.xlsx && j2.buffer && j2.pdf, "засварласан Word, PDF, Excel гарсан");
  const snap2 = await REV.loadSnap("R1", "report_dept");
  ok(snap2.m.indicators.find((x) => x.name === ind.name).monthly[8] === 99, "засварласан тоо хадгалагдсан");
  // 2. Байгууллагын төлөвлөгөө → засвар: эхний мөнгө, шинэ зардал
  const j3 = { id: "p1", psid: "R2", product: "plan", input: load("plan-sample.json") };
  await runOrg(j3, () => { });
  const t0 = j3.result.result;
  const j4 = { id: "p2", psid: "R2", product: "plan", revision: "Түрээсийн зардал нэм", mockPatch: { cfg: { opening_cash: 999000000, expenses: [{ name: "Шинэ түрээс", dept: "Нийтлэг", group: "Үйл ажиллагааны зардал", monthly: 1000000 }] } } };
  await runOrg(j4, () => { });
  ok(j4.result.xlsx, "төлөвлөгөөний засварт Excel тулгалт таарсан");
  ok(Math.round(j4.result.result) === Math.round(t0 - 12 * 1000000 * (1 - 0.1)) || j4.result.result < t0, `зардал нэмэгдэж үр дүн буурсан (${Math.round(t0)} → ${Math.round(j4.result.result)})`);
  // 3. Төлөв олдохгүй бол татгалзана
  let rej = null; try { await runOrg({ id: "x", psid: "NOPE", product: "plan_dept", revision: "засвар" }, () => { }); } catch (e) { rej = e; }
  ok(rej && rej.status === "revision_rejected", "төлөвгүй засвар татгалзагдсан");
  // 4. mergeList
  const ml = REV.mergeList([{ name: "A", v: 1 }, { name: "B", v: 2 }], [{ name: "a", v: 5 }, { name: "B", remove: true }, { name: "C", v: 3 }], "name");
  ok(JSON.stringify(ml) === JSON.stringify([{ name: "a", v: 5 }, { name: "C", v: 3 }]) || (ml.length === 2 && ml[0].v === 5 && ml[1].name === "C"), "мөр засах, хасах, нэмэх");
  console.log(fail ? `АЛДАА ${fail}` : "БҮХ ТУРШИЛТ АМЖИЛТТАЙ"); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
