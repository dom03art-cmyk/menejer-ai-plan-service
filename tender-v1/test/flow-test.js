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
  await say(psid, { attachments: [{ type: "image", payload: { url: "https://example.invalid/receipt.jpg" } }] });
  await F.adminAction(`PAYOK|TND|${psid}`);
  await idle();
}

(async () => {
  console.log("1) Үйлчилгээ (харуул хамгаалалт, үнийн санал дуудах) — бүтэн урсгал");
  process.env.TENDER_MOCK_CASE = "security"; MOCK.reset();
  let p = "U1"; await toPaid(p);
  ok((await S.getState(p)).s === "tnd_interview", "шинжилгээний дараа асуулт асуух төлөвт");
  ok(msgs(p).some((m) => /Материал бэлтгэхэд дараах мэдээлэл/.test(m.text || "")), "асуулт илгээгдсэн");
  ok((await say(p, { text: "Захирал Б.Бат. 2024: 85 сая, 2025: 90 сая" })) === "ext", "хариулт хүлээж авав");
  await say(p, { payload: "TND_READY" });
  ok(msgs(p).some((m) => /хэрэгтэй хэвээр/.test(m.text || "")), "дутуу (доод үнэ) нэг удаа асуув");
  await say(p, { text: "Доод үнэ 70 сая" }); await say(p, { payload: "TND_READY" }); await idle();
  const st1 = await S.getState(p);
  ok(st1.s === "tnd_done" && st1.delivered === 1, "материал хүргэгдэв");
  const files1 = msgs(p).filter((m) => m.file).map((m) => m.file);
  ok(files1.includes("01-shalgakh-jagsaalt.docx") && files1.includes("02-tenderiin-material.docx") && files1.includes("03-unii-zadargaa.xlsx"), `файлууд: ${files1.join(", ")}`);
  ok(msgs(p).some((m) => /💰 Санал болгох үнэ/.test(m.text || "") && /↘️/.test(m.text || "") && /⏰/.test(m.text || "")), "чатад үнэ, доод үнэ, хугацаа үлдсэн");
  ok(!msgs(p).some((m) => /захиалагч(ийн)? өгсөн|Claude|JSON/.test(m.text || "")), "дотоод үг алга");
  await say(p, { payload: "TND_RERUN" }); await say(p, { text: "Ажилтан нэмэгдсэн" }); await say(p, { payload: "TND_READY" }); await idle();
  ok((await S.getState(p)).delivered === 2, "1 удаа үнэгүй дахин гаргав");
  await say(p, { payload: "TND_RERUN" });
  ok((await S.getState(p)).s === "tnd_left", "2 дахь дахин гаргалтаас татгалзав");

  console.log("2) Бараа, олон багц — багц сонгуулах");
  process.env.TENDER_MOCK_CASE = "office"; MOCK.reset();
  p = "U2"; await toPaid(p);
  ok((await S.getState(p)).s === "tnd_lot", "багц сонгуулах төлөвт");
  await say(p, { payload: "TND_LOT_2" }); await idle();
  ok((await S.getState(p)).s === "tnd_interview", "Багц 3 сонгоод асуулт ирэв");
  await say(p, { text: "мэдээлэл" }); await say(p, { payload: "TND_GO" }); await idle();
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

  console.log("5) Claude аргачлал орхисон → автоматаар засав");
  process.env.TENDER_MOCK_CASE = "security"; process.env.TENDER_MOCK_BREAK = "1"; MOCK.reset();
  p = "U5"; await toPaid(p); await say(p, { text: "доод үнэ 70 сая" }); await say(p, { payload: "TND_GO" }); await idle();
  ok((await S.getState(p)).delivered === 1 && MOCK.calls.filter((x) => x === "B2").length === 2, "B2 дахин дуудагдаж материал гарав");
  delete process.env.TENDER_MOCK_BREAK;

  console.log("6) Оролцогчийн мэдээлэл дутуу (доод үнэ) → асуугаад дахин");
  process.env.TENDER_MOCK_GAP = "1"; MOCK.reset();
  p = "U6"; await toPaid(p); await say(p, { text: "мэдээлэл" }); await say(p, { payload: "TND_GO" }); await idle();
  ok((await S.getState(p)).s === "tnd_interview" && msgs(p).some((m) => /дутуу байна:/.test(m.text || "") && /доод үнэ/i.test(m.text || "")), "дутууг жагсааж асуув");
  await say(p, { text: "Доод үнэ 72 сая" }); await say(p, { payload: "TND_READY" }); await idle();
  ok((await S.getState(p)).delivered === 1, "нөхсөний дараа хүргэгдэв");
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

  console.log(fails ? `\nАЛДАА: ${fails}` : "\nБүх шалгалт амжилттай");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
