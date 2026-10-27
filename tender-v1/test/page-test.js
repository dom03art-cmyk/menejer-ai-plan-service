// Шинэ урсгал: ТББ хуудас → нөхцөл → төлбөр → нүднүүд (улаан/шар/ногоон) → материал гаргах (сануулгатай)
process.env.TENDER_MOCK = "1"; process.env.TENDER_ENABLED = "1"; process.env.ADMIN_PSID = "ADMIN"; process.env.TENDER_RESUME_DELAY_MS = "999999"; process.env.API_KEY = "k";
delete process.env.REDIS_URL;
const express = require("express"), path = require("path");
const R = (m) => require(path.join(__dirname, "..", m));
const S = R("store"), F = R("flow"), I = R("index"), { OUTBOX } = R("msg"), UP = R("upload");
let fails = 0; const ok = (c, l) => { console.log(`${c ? "  ✓" : "  ✗"} ${l}`); if (!c) fails++; };
const idle = async () => { for (let i = 0; i < 400; i++) { if (![...I._jobs.values()].some((j) => j.status === "running" || j.status === "queued")) return; await new Promise((r) => setTimeout(r, 25)); } throw new Error("ажил дуусахгүй"); };
const msgs = (p) => OUTBOX.filter((m) => m.psid === p);
const app = express(); app.use(I);
(async () => {
  const srv = app.listen(0), port = srv.address().port;
  async function run(caseName, p) {
    process.env.TENDER_MOCK_CASE = caseName;
    const base = `http://127.0.0.1:${port}/u/tnd/${UP.tokenFor(p)}`;
    const J = (u, o) => fetch(base + u, o).then((r) => r.json());
    const P = (u, b) => J(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) });
    const FILE = (u, name, text) => J(u, { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent(name) }, body: Buffer.from(text) });
    await F.handle({ psid: p, payload: "TENDER" });
    let st = await J("/state"); ok(st.s === "tnd_upload", "хуудас ТББ илгээх шатанд");
    const u1 = await FILE("/file", "TBB.txt", "ТББ текст"); ok(u1.ok && u1.price, `ТББ хадгалагдаж үнэ гарав (${u1.price})`);
    await P("/done");
    await F.handle({ psid: p, payload: "TND_ONELOT" });
    ok((await S.getState(p)).s === "tnd_terms" && msgs(p).some((m) => /төлбөр буцаагдахгүй/.test(m.text || "")), "төлбөрөөс өмнө нөхцөл (буцаалтгүй) харуулав");
    await F.handle({ psid: p, payload: "TND_AGREE" });
    ok((await S.getState(p)).s === "tnd_pay", "зөвшөөрсний дараа төлбөр");
    await F.handle({ psid: p, attachments: [{ type: "image", payload: { url: "https://example.invalid/r.jpg" } }] });
    await F.adminAction(`PAYOK|TND|${p}`); await idle();
    if ((await S.getState(p)).s === "tnd_lot") { await F.handle({ psid: p, payload: "TND_LOT_2" }); await idle(); ok((await S.getState(p)).s === "tnd_slots", "олон багцтай — багц сонгоод нүд гарав"); }
    st = await J("/state");
    ok(st.s === "tnd_slots" && st.slots.length > 8, `шинжилгээний дараа ${st.slots.length} нүд гарав`);
    ok(st.slots.some((s) => s.key === "file.cert") && st.slots.some((s) => s.key === "company.name"), "файлын ба бичих нүднүүд");
    ok(msgs(p).some((m) => /нүд бүрт оруулна уу/.test(m.text || "") && /\/u\/tnd\//.test(m.text || "")), "Messenger-т холбоос илгээв");
    ok(st.status["company.name"].status === "red", "хоосон нүд улаан");
    st = await P("/value", { key: "company.name", value: "Туршилт ХХК" }); ok(st.status["company.name"].status === "green", "бөглөхөд ногоон");
    st = await P("/value", { key: "company.reg_no", value: "12345" }); ok(st.status["company.reg_no"].status === "yellow", "регистр буруу хэлбэр — шар");
    st = await FILE("/slot/file.cert/file", "cert.txt", "гэрчилгээ"); if (!st.status) console.log("DBG", st); ok(st.status["file.cert"].status === "green", "зөв файл — ногоон");
    st = await FILE("/slot/file.license/file", "lic.txt", "EXPIRED"); ok(st.status["file.license"].status === "red" && /дууссан/.test(st.status["file.license"].msg), "хугацаа дууссан — улаан, шалтгаантай");
    st = await FILE("/slot/file.license/file", "lic2.txt", "WRONG"); ok(st.status["file.license"].status === "red" && /таарахгүй/.test(st.status["file.license"].msg), "өөр баримт — улаан, «солих»");
    st = await FILE("/slot/file.license/file", "lic3.txt", "SOON"); ok(st.status["file.license"].status === "yellow" && st.values["file.license"].files.length === 1, "солиход нэг файл үлдэж, хугацаа дөхсөн — шар");
    st = await FILE("/slot/file.fin/file", "fin.txt", "OTHERCO"); ok(st.status["file.fin"].status === "yellow" && /таарахгүй/.test(st.status["file.fin"].msg), "өөр компанийн нэртэй — шар");
    const metric = st.slots.find((s) => s.key.startsWith("metrics.") && s.required);
    if (metric) { st = await P("/value", { key: metric.key, value: "-1000000" }); ok(st.status[metric.key].status === "red" && st.status[metric.key].kind === "fail", "тоон босго хангахгүй — улаан (хангахгүй)"); }
    let g = await P("/generate"); ok(g.needConfirm && (g.reds.attach.length + g.reds.data.length + g.reds.fail.length) > 0, "улаан нүдтэй үед сануулга асуув");
    ok((await S.getState(p)).s === "tnd_slots", "сануулгагүйгээр эхлээгүй");
    g = await P("/generate", { confirm: true }); ok(g.ok, "«Тийм, ингээд гарга»");
    st = await J("/state"); ok(st.s === "tnd_composing", "хуудас «бэлтгэж байна»");
    const lock = await P("/value", { key: "company.address", value: "x" }); ok(!lock.ok, "бэлтгэж байхад засах боломжгүй");
    await idle();
    const files = msgs(p).filter((m) => m.file).map((m) => m.file);
    ok(files.includes("01-shalgakh-jagsaalt.docx") && files.includes("02-tenderiin-material.docx"), `дутуу байсан ч материал гарав: ${files.join(", ")}`);
    ok(msgs(p).some((m) => /өөрөө хавсаргах/.test(m.text || "")), "хүргэлтэд «өөрөө хавсаргах» жагсаалт");
    st = await J("/state"); ok(st.s === "tnd_done" && st.canGenerate, "дууссаны дараа 1 удаа дахин гаргах боломжтой");
    await P("/value", { key: "company.address", value: "УБ" });
    g = await P("/generate", { confirm: true }); await idle();
    st = await J("/state"); ok(st.delivered === 2 && !st.canGenerate, "2 дахь удаагаа гаргасны дараа эрх дууссан");
    g = await P("/generate", { confirm: true }); ok(!g.ok, "3 дахь удаа гаргахгүй");
  }
  console.log("1) Үйлчилгээ (харуул хамгаалалт)"); await run("security", "P1");
  console.log("2) Бараа (бичиг хэрэг, багц 3)"); await run("office", "P2").catch((e) => { console.log("  ! " + e.message); fails++; });
  srv.close();
  console.log(fails ? `\nАЛДАА: ${fails}` : "\nБүх шалгалт амжилттай"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
