// Шатлалтай үнэ, стандарт хэсэг хасах, урт ТББ-ийг хэсэглэх
process.env.TENDER_MOCK = "1"; process.env.TENDER_ENABLED = "1"; delete process.env.REDIS_URL;
const PR = require("../pricing"), CX = require("../context");
let bad = 0; const ok = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) bad++; };
(async () => {
  console.log("Үнэ");
  ok(PR.quote(57).price === 149900 && PR.quote(100).price === 149900, "≤100 хуудас: 149 900₮");
  ok(PR.quote(101).price === 179900 && PR.quote(200).price === 179900, "101–200: 179 900₮");
  ok(PR.quote(250).price === 199900 && PR.quote(301).over, "201–300: 199 900₮, 300-аас дээш хүлээж авахгүй");
  const { PDFDocument } = require("pdf-lib");
  const mk = async (n) => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage(); return Buffer.from(await d.save()); };
  ok((await PR.pagesOf({ buf: await mk(57), name: "tbb.pdf", mime: "application/pdf" })).pages === 57, "PDF-ийн хуудсыг агуулга уншилгүй тоолов");

  console.log("Стандарт хэсэг хасах");
  const filler = (w, n) => Array.from({ length: n }, (_, i) => `${w} ${i + 1}. Энэ бол жишиг заалтын текст.`).join("\n");
  const tbb = ["ГАРЧИГ", "I бүлэг. Тендер шалгаруулалтын зааварчилгаа ..... 3", "II бүлэг. Өгөгдлийн хүснэгт ..... 30", "",
    "I БҮЛЭГ. ТЕНДЕР ШАЛГАРУУЛАЛТЫН ЗААВАРЧИЛГАА", filler("ТШЗ", 600), "II БҮЛЭГ. ӨГӨГДЛИЙН ХҮСНЭГТ", "ӨХ ТШЗ 18.1 Борлуулалт 100 сая", filler("ӨХ", 50),
    "VI БҮЛЭГ. ГЭРЭЭНИЙ ЕРӨНХИЙ НӨХЦӨЛ", filler("ГЕН", 400), "ГЭРЭЭНИЙ ТУСГАЙ НӨХЦӨЛ", "ГТН 5. Алданги 0.5%"].join("\n");
  const r = CX.stripStandard(tbb);
  ok(r.removed.length === 2, `2 стандарт хэсэг хасагдлаа (${r.removed.map((x) => x.chars).join(", ")} тэмдэгт)`);
  ok(/ӨХ ТШЗ 18.1 Борлуулалт 100 сая/.test(r.text) && /ГТН 5. Алданги/.test(r.text) && /ӨХ 50\./.test(r.text), "ӨХ, ГТН бүрэн үлдсэн");
  ok(/Тендер шалгаруулалтын зааварчилгаа \.\.\.\.\. 3/.test(r.text), "гарчгийн жагсаалт хэвээр");
  ok(r.text.length < tbb.length * 0.35, `урт ${tbb.length} → ${r.text.length}`);
  const small = CX.fitDocs([{ name: "a", phase: "tbb", text: tbb.slice(0, 20000) }]);
  ok(small.removed.length === 0, "богино ТББ-д юу ч хасахгүй (нарийвчлал түрүүнд)");

  console.log("Урт ТББ хэсэглэх");
  const big = filler("ТТ", 30000);
  const w = CX.windows(big);
  ok(w.length >= 3 && w.every((x) => x.length <= CX.WINDOW()) && w.join("") === big, `${big.length} тэмдэгт → ${w.length} хэсэг, алдагдалгүй`);
  const m = CX.mergeTender({ requirements: [{ id: "R1", text: "a" }], items: [{ no: 1 }] }, { requirements: [{ id: "R1", text: "a" }, { id: "R101", text: "b" }], items: [{ no: 1 }, { no: 2 }] });
  ok(m.requirements.length === 2 && m.items.length === 2, "нэмэлт мөрийг давхардалгүй нэгтгэв");

  console.log("Урт ТББ — бүтэн урсгал");
  const S = require("../store"), F = require("../flow"), I = require("../index"), { OUTBOX } = require("../msg");
  process.env.TENDER_MOCK_CASE = "security";
  const p = "BIG1";
  await F.handle({ psid: p, payload: "TENDER" });
  await S.addFile(p, { name: "TBB.pdf", mime: "application/pdf", buf: Buffer.from(tbb + "\n" + big), phase: "tbb", pages: 180 });
  await F.onUploaded(p);
  ok(OUTBOX.some((x) => x.psid === p && /180 хуудас .*179 900₮/s.test(x.text || "")), "180 хуудас → 179 900₮ гэж мэдэгдэв");
  await F.handle({ psid: p, payload: "TND_ONELOT" });
  ok((await S.getState(p)).price === 179900, "нэхэмжлэх 179 900₮");
  await F.handle({ psid: p, payload: "TND_AGREE" });
  await F.handle({ psid: p, attachments: [{ type: "image", payload: { url: "https://example.invalid/r.jpg" } }] });
  await F.adminAction(`PAYOK|TND|${p}`);
  for (let i = 0; i < 400 && [...I._jobs.values()].some((j) => j.status !== "done" && j.status !== "failed"); i++) await new Promise((r) => setTimeout(r, 25));
  const kase = await S.getCase(p);
  ok(kase.windows >= 3 && kase.removed.length === 2, `${kase.windows} хэсгээр уншиж, стандарт хэсэг хассан`);
  ok(kase.base.tender.requirements.some((x) => x.id === "R101"), "сүүлийн хэсгийн шаардлага tender-т нэмэгдсэн");
  ok((await S.getState(p)).s === "tnd_slots", "нүднүүд рүү шилжсэн");
  console.log(bad ? "АЛДАА " + bad : "Бүгд зөв"); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
