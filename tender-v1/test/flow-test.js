// Бүтэн урсгалын туршилт (Facebook, Claude, Redis-гүйгээр): node tender-v1/test/flow-test.js
process.env.TENDER_MOCK = "1"; process.env.TENDER_ENABLED = "1"; process.env.ADMIN_PSID = "ADMIN"; process.env.TENDER_RESUME_DELAY_MS = "999999";
delete process.env.REDIS_URL; delete process.env.QPAY_CLIENT_ID;
const path = require("path");
const R = (m) => require(path.join(__dirname, "..", m));
const S = R("store"), F = R("flow"), I = R("index"), { OUTBOX } = R("msg"), MOCK = R("test/mock");
let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? "  ✓" : "  ✗"} ${label}`); if (!cond) fails++; };
const idle = async () => { for (let i = 0; i < 400; i++) { if (![...I._jobs.values()].some((j) => j.status === "running" || j.status === "queued")) return; await new Promise((r) => setTimeout(r, 25)); } throw new Error("ажил дуусахгүй байна"); };
const msgs = (psid) => OUTBOX.filter((m) => m.psid === psid);
const say = async (psid, o) => { if (!(await F.claims(psid, o.payload))) return "NOT_CLAIMED"; return F.handle({ psid, ...o }); };
const lastJob = () => [...I._jobs.values()].pop();

async function toPaid(psid, lot) {
  await say(psid, { payload: "TENDER" });
  await S.addFile(psid, { name: "TBB.pdf", mime: "application/pdf", buf: Buffer.from("ТББ текст (mock)"), phase: "tbb" });
  await F.onUploaded(psid);
  await say(psid, lot ? { text: lot } : { payload: "TND_ONELOT" });
  await say(psid, { payload: "TND_AGREE" });
  await say(psid, { attachments: [{ type: "image", payload: { url: "https://example.invalid/receipt.jpg" } }] });
  await F.adminAction(`PAYOK|TND|${psid}`);
  await idle();
}

(async () => {
  console.log("1) Үйлчилгээ (харуул хамгаалалт, үнийн санал дуудах) — бүтэн урсгал");
  process.env.TENDER_MOCK_CASE = "security"; MOCK.reset();
  let p = "U1"; await toPaid(p);
  ok((await S.getState(p)).s === "tnd_slots", "шинжилгээний дараа нүднүүд бөглөх төлөвт");
  ok((await say(p, { text: "сайн уу" })) === "ext" && msgs(p).slice(-1)[0].text.includes("/u/tnd/"), "чатаар бичихэд хуудасны холбоос дахин илгээв");
  await F.startCompose(p, {}); await idle();
  const st1 = await S.getState(p);
  ok(st1.s === "tnd_done" && st1.delivered === 1, "материал хүргэгдэв");
  const files1 = msgs(p).filter((m) => m.file).map((m) => m.file);
  ok(files1.includes("01-shalgakh-jagsaalt.docx") && files1.includes("02-tenderiin-material.docx"), `файлууд: ${files1.join(", ")}`);
  ok(msgs(p).some((m) => /⏰/.test(m.text || "")), "чатад хугацаа үлдсэн");
  ok(!msgs(p).some((m) => /захиалагч(ийн)? өгсөн|Claude|JSON/.test(m.text || "")), "дотоод үг алга");

  console.log("2) Бараа, олон багц — багц сонгуулах");
  process.env.TENDER_MOCK_CASE = "office"; MOCK.reset();
  p = "U2"; await toPaid(p);
  ok((await S.getState(p)).s === "tnd_lot", "багц сонгуулах төлөвт");
  await say(p, { payload: "TND_LOT_2" }); await idle();
  ok((await S.getState(p)).s === "tnd_slots", "Багц 3 сонгоод нүднүүд гарав");
  await F.startCompose(p, {}); await idle();
  const files2 = msgs(p).filter((m) => m.file).map((m) => m.file);
  ok(files2.length === 4 && files2.some((f) => /^04-/.test(f)), `бараа + бодлогын төсөл: ${files2.join(", ")}`);

  console.log("3) Барилгын шинжтэй «үйлчилгээ»");
  process.env.TENDER_MOCK_CASE = "works"; MOCK.reset();
  p = "U3"; await toPaid(p);
  ok((await S.getState(p)).s === "tnd_done" && msgs(p).some((m) => /барилга угсралтын ажил/.test(m.text || "")), "зөвхөн шалгах жагсаалт, тайлбартай");
  ok(msgs(p).filter((m) => m.file).length === 1 && msgs("ADMIN").some((m) => /барилгын шинжтэй/.test(m.text || "")), "1 файл, админд мэдэгдэв");

  console.log("4) Хугацаа дууссан тендер");
  process.env.TENDER_MOCK_CASE = "expired"; MOCK.reset();
  p = "U4"; await toPaid(p);
  ok(msgs(p).some((m) => /хугацаа .*дууссан/.test(m.text || "")), "хугацаа дууссаныг мэдэгдэв");

  console.log("4б) Хугацаа дууссан → төлбөрөөрөө өөр тендер илгээх");
  ok(msgs(p).some((m) => (m.buttons || []).includes("📄 Өөр тендер илгээх")), "«Өөр тендер илгээх» товч ирэв");
  await say(p, { payload: "TND_NEWTENDER" });
  ok((await S.getState(p)).s === "tnd_upload" && (await S.listFiles(p)).length === 0, "хуучин файл цэвэрлэгдэж, шинэ ТББ хүлээж байна");
  process.env.TENDER_MOCK_CASE = "security";
  await S.addFile(p, { name: "TBB2.pdf", mime: "application/pdf", buf: Buffer.from("ТББ 2"), phase: "tbb" });
  await F.onUploaded(p); await say(p, { payload: "TND_ONELOT" }); await idle();
  ok((await S.getState(p)).s === "tnd_slots" && !msgs(p).slice(-6).some((m) => /💳 Төлбөр|нөхцөл/.test(m.text || "")), "дахин төлбөр, нөхцөлгүйгээр шинжилж нүднүүд гарав");
  await say(p, { payload: "TND_NEWTENDER" });
  ok((await S.getState(p)).s === "tnd_slots", "бөглөж байх үед «өөр тендер» товч ажиллахгүй");

  console.log("4в) Олон багцтай, хугацаа дууссан → багц асуухгүй шууд мэдэгдэнэ");
  process.env.TENDER_MOCK_CASE = "office"; process.env.TENDER_MOCK_LOTEXPIRED = "1"; MOCK.reset();
  p = "U4c"; await toPaid(p);
  ok((await S.getState(p)).s === "tnd_done" && msgs(p).some((m) => /хугацаа .*дууссан/.test(m.text || "")) && MOCK.calls.filter((x) => x === "A1").length === 1, "багц сонгуулалгүй, 1 шинжилгээгээр зогсов");
  delete process.env.TENDER_MOCK_LOTEXPIRED;

  console.log("5) Claude аргачлал орхисон → автоматаар засав");
  process.env.TENDER_MOCK_CASE = "security"; process.env.TENDER_MOCK_BREAK = "1"; MOCK.reset();
  p = "U5"; await toPaid(p); await F.startCompose(p, {}); await idle();
  ok((await S.getState(p)).delivered === 1 && MOCK.calls.filter((x) => x === "B2").length === 2, "B2 дахин дуудагдаж материал гарав");
  delete process.env.TENDER_MOCK_BREAK;

  console.log("6) Доод үнэ дутуу ч оролцогчийн сонголтоор материал гарна");
  process.env.TENDER_MOCK_GAP = "1"; MOCK.reset();
  p = "U6"; await toPaid(p); await F.startCompose(p, { reds: { attach: [], data: [{ label: "Доод үнэ" }], fail: [] } }); await idle();
  ok((await S.getState(p)).delivered === 1 && msgs(p).some((m) => m.file === "02-tenderiin-material.docx"), "дутуу байсан ч материал хүргэгдэв");
  delete process.env.TENDER_MOCK_GAP;

  console.log("7) Үндсэн цэс рүү гарах, унтраалга");
  p = "U7"; process.env.TENDER_MOCK_CASE = "security"; await toPaid(p);
  ok((await say(p, { payload: "MKT_PLAN" })) === "NOT_CLAIMED" && (await S.getState(p)).s === "tnd_left", "Маркетинг дарахад тендерээс гарав");
  ok((await say(p, { text: "сайн уу" })) === "NOT_CLAIMED", "дараагийн мессеж үндсэн урсгал руу");
  process.env.TENDER_ENABLED = "0";
  ok((await say("U8", { payload: "TENDER" })) === "NOT_CLAIMED", "TENDER_ENABLED≠1 үед хүлээж авахгүй");
  process.env.TENDER_ALLOW_PSIDS = "ADMIN";
  ok((await say("ADMIN", { payload: "TENDER" })) === "ext", "админ туршилтаар ашиглаж болно");
  ok((await say("U9", { payload: "TENDER" })) === "NOT_CLAIMED", "бусдад хаалттай");
  ok(I.enqueue({ psid: "U9", kind: "analyze" }).ok === false, "бусдад ажил үүсгэхгүй");

  console.log("8) Туршилтын товчлол «тендер-хуудас» — ТББ уншилт, төлбөргүй");
  process.env.TENDER_ENABLED = "0"; process.env.TENDER_MOCK_CASE = "security"; MOCK.reset();
  ok((await say("U10", { text: "тендер-хуудас" })) === "NOT_CLAIMED", "туршигч биш бол ажиллахгүй");
  ok((await say("ADMIN", { text: "тендер-хуудас" })) === "ext" && (await S.getState("ADMIN")).s === "tnd_slots", "туршигчид хуудас шууд нээгдэв");
  const kd = await S.getCase("ADMIN");
  ok(kd.slots.filter((x) => x.kind === "file").length === 7 && new Date(kd.base.tender.deadline) > new Date() && !MOCK.calls.includes("A1"), "7 баримтын нүд, хугацаа ирээдүйд, A1 дуудаагүй");
  ok(msgs("ADMIN").slice(-1)[0].text.includes("/u/tnd/"), "холбоос илгээв");
  await say("ADMIN", { text: "Тендер-хуудас бараа" });
  const kg = await S.getCase("ADMIN");
  ok(kg.demo === "goods" && kg.slots.some((x) => x.key === "prices"), "бараа: үнийн хүснэгттэй");
  await F.startCompose("ADMIN", {}); await idle();
  ok((await S.getState("ADMIN")).delivered === 1, "туршилтын хуудаснаас материал гарав");

  console.log("9) Санамсаргүй эхэлсэн боловсруулалтыг зогсоох");
  MOCK.reset(); await say("ADMIN", { text: "тендер-хуудас" });
  await F.startCompose("ADMIN", {});
  ok(msgs("ADMIN").slice(-1)[0].buttons.includes("⏹ Зогсоох"), "«Зогсоох» товч ирэв");
  ok((await say("ADMIN", { payload: "TND_STOP" })) === "ext" && (await S.getState("ADMIN")).s === "tnd_slots", "зогсоогоод нүдний хуудас руу буцав");
  await idle();
  const stS = await S.getState("ADMIN");
  ok(stS.s === "tnd_slots" && !msgs("ADMIN").slice(-3).some((m) => m.file) && lastJob().status === "cancelled", "материал гараагүй, ажил цуцлагдсан");
  ok(!(stS.runs > 1), "гаргах эрх хасагдаагүй");

  console.log(fails ? `\nАЛДАА: ${fails}` : "\nБүх шалгалт амжилттай");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
