// Материал илгээх хуудас, тоолох, үнэ, хязгаарын туршилт (AI, Redis ашиглахгүй):  node org-v1/test/upload-test.js
process.env.API_KEY = "test";
delete process.env.REDIS_URL;
delete process.env.FB_PAGE_TOKEN;
delete process.env.ORG_QUOTE_WEBHOOK;
const assert = require("assert");
const express = require("express");

const sent = [];
const util = require("../../plan-v2/util");
const realFb = util.fbText;
util.fbText = async (psid, text) => { sent.push({ psid, text }); return realFb(psid, text); }; // FB_PAGE_TOKEN алга → анхааруулга л бичнэ

const router = require("../upload");
const M = require("../materials");
const { priceFor } = require("../quote");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function makePdf(n) {
  const { PDFDocument, StandardFonts } = require("pdf-lib");
  const d = await PDFDocument.create(), font = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) { const p = d.addPage(); p.drawText(`Page ${i + 1} report text`, { x: 50, y: 700, size: 14, font }); }
  return Buffer.from(await d.save());
}
async function makeDocx() {
  const { Document, Packer, Paragraph } = require("docx");
  const doc = new Document({ sections: [{ children: ["Хэлтсийн ажлын тайлан", "Нэгдүгээр улиралд 12 арга хэмжээ зохион байгуулав.", "KPI биелэлт 94 хувь.", "Дараагийн улирлын зорилт."].map(t => new Paragraph(t)) }] });
  return Packer.toBuffer(doc);
}
async function makeXlsx() {
  const ExcelJS = require("exceljs"); const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("Борлуулалт"); for (let i = 1; i <= 2500; i++) a.addRow([i, "Бараа " + i, i * 1000]);
  const b = wb.addWorksheet("Хураангуй"); b.addRow(["Нийт", 2500]); b.addRow(["Дундаж", 1250]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

(async () => {
  const app = express(); app.use(express.json({ limit: "30mb" })); app.use(router);
  const srv = app.listen(0); const B = `http://127.0.0.1:${srv.address().port}`;
  const post = (u, body, h = {}) => fetch(B + u, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(body || {}) });
  try {
    // --- холбоос ---
    assert.strictEqual((await post("/org/upload-link", { psid: "111", product: "report_dept" })).status, 401);
    assert.strictEqual((await post("/org/upload-link", { psid: "111", product: "xxx" }, { "x-api-key": "test" })).status, 400);
    const { url } = await (await post("/org/upload-link", { psid: "111", product: "report_dept" }, { "x-api-key": "test" })).json();
    assert.ok(url.startsWith("https://menejer-ai-plan-service.onrender.com/u/org/111.d."), url);
    const path = new URL(url).pathname;

    // --- хуудас + клиент JS синтакс ---
    const r = await fetch(B + path); assert.strictEqual(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes("Хэлтэс, албан тушаалын тайланд") && html.includes("KPI"));
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.strictEqual(scripts.length, 1); new Function(scripts[0]);
    for (const p of ["plan", "report_dir"]) { const h = router.page(p); new Function(/<script>([\s\S]*?)<\/script>/.exec(h)[1]); }
    console.log("✓ хуудас 200, клиент JS синтакс зөв (3 бүтээгдэхүүн)");

    // --- хуурамч / хугацаа дууссан / plan-v2 токен ---
    assert.strictEqual((await fetch(B + path.replace(/.$/, c => c === "a" ? "b" : "a"))).status, 404);
    const planV2Tok = require("../../plan-v2/upload").tokenFor("111");
    assert.strictEqual((await fetch(B + "/u/org/" + planV2Tok)).status, 404);
    const exp = router.tokenFor("111", "report_dept", -1);
    const er = await fetch(B + "/u/org/" + exp); assert.strictEqual(er.status, 404); assert.ok((await er.text()).includes("хугацаа дууссан"));
    console.log("✓ хуурамч, хугацаа дууссан, plan-v2 токен татгалзав");

    // --- файлууд ---
    const up = async (name, type, buf, raw = true) => (await (raw
      ? fetch(B + path + "/file", { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent(name), "x-file-type": type }, body: buf })
      : post(path + "/file", { name, type, data: buf.toString("base64") }))).json();
    const pdfBuf = await makePdf(23);
    const pdf = await up("тайлан.pdf", "application/pdf", pdfBuf);
    assert.ok(pdf.ok && pdf.units === 23, JSON.stringify(pdf));
    const docx = await up("тайлан.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", await makeDocx(), false);
    assert.ok(docx.ok && docx.units >= 1, JSON.stringify(docx));
    const xlsx = await up("гүйцэтгэл.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", await makeXlsx());
    assert.ok(xlsx.ok && xlsx.units === 4, JSON.stringify(xlsx)); // (1+2) + 1
    const png = await up("зураг.png", "image/png", PNG); assert.ok(png.ok && png.units === 2);
    const mp4 = await up("бичлэг.mp4", "video/mp4", Buffer.alloc(1000, 1)); assert.ok(!mp4.ok && /Видео/.test(mp4.error), JSON.stringify(mp4));
    const again = await up("тайлан.pdf", "application/pdf", pdfBuf); assert.ok(again.ok && again.duplicate); // давхардал
    const expected = 23 + docx.units + 4 + 2;
    assert.strictEqual(png.total, expected);
    console.log(`✓ pdf 23, docx ${docx.units}, xlsx 4 (${xlsx.note}), png 2, mp4 татгалзав → нийт ${expected}, ${png.priceText} (${png.tier})`);

    const lst = await (await fetch(B + path + "/list")).json();
    assert.strictEqual(lst.files.length, 4); assert.strictEqual(lst.units, expected);

    // --- дууслаа ---
    const done = await (await post(path + "/done")).json();
    const q = priceFor("report_dept", expected);
    assert.ok(done.ok && done.units === expected && done.price === q.price && done.price === 99900, JSON.stringify(done));
    assert.strictEqual(sent.length, 1);
    const t = sent[0].text;
    for (const s of [`Таны илгээсэн материалын хэмжээ: ${expected} хуудас`, "бичлэг.mp4", "99 900₮", "төлбөр баталгаажсаны дараа", "дахин тооцогдоно"]) assert.ok(t.includes(s), "Messenger текстэд алга: " + s);
    assert.ok(!/[*#`]/.test(t), "markdown тэмдэгт");
    const quote = await (await fetch(B + "/org/quote/111", { headers: { "x-api-key": "test" } })).json();
    assert.strictEqual(quote.meta.quote.price, 99900); assert.strictEqual(quote.files.length, 4); assert.strictEqual(quote.rejected.length, 0);
    console.log("✓ done → 99 900₮, Messenger текст:\n---\n" + t + "\n---");

    // --- файл хасах → үнэ дахин бодогдоно ---
    const rm = await (await post(path + "/remove", { id: pdf.id })).json();
    assert.ok(rm.ok && rm.total === expected - 23 && rm.price === 79900);
    console.log("✓ PDF хассаны дараа", rm.total, "хуудас,", rm.priceText);

    // --- plan, файлгүй ---
    const pu = await (await post("/org/upload-link", { psid: "222", product: "plan" }, { "x-api-key": "test" })).json();
    const pd = await (await post(new URL(pu.url).pathname + "/done")).json();
    assert.ok(pd.ok && pd.units === 0 && pd.price === 199900, JSON.stringify(pd));
    const du = await (await post("/org/upload-link", { psid: "333", product: "report_dir" }, { "x-api-key": "test" })).json();
    assert.strictEqual((await post(new URL(du.url).pathname + "/done")).status, 400);
    console.log("✓ plan файлгүй → 199 900₮; report_dir файлгүй → 400");

    // --- extractAll (extractBuffer-ийг stub) ---
    const files = require("../../plan-v2/files"); const realEx = files.extractBuffer;
    files.extractBuffer = async ({ name, type }) => { if (type === "image") throw Object.assign(new Error("x"), { code: "photo" }); return { kind: "x", summary: "Агуулга " + name + " ".repeat(10) }; };
    const ex = await require("../extract").extractAll("111", () => { });
    files.extractBuffer = realEx;
    assert.strictEqual(ex.files.length, 3); assert.ok(ex.text.includes("=== Файл: тайлан.docx ==="));
    assert.ok(ex.files.find(f => f.name === "зураг.png" && !f.ok && /зураг/.test(f.note)));
    const { fit } = require("../extract"); const fp = fit(["a".repeat(200000), "b".repeat(100000)], 150000);
    assert.ok(fp[0].length < 101000 && fp[1].length < 51000);
    console.log("✓ extractAll (stub): ", ex.files.map(f => `${f.name}:${f.ok ? f.chars : f.note}`).join(", "));

    // --- хязгаар ---
    let x = await M.addFile("444", { name: "big.pdf", mime: "application/pdf", buf: Buffer.alloc(25 * 1024 * 1024 + 1), count: { units: 1 } });
    assert.ok(!x.ok && /25MB/.test(x.error));
    for (let i = 0; i < 60; i++) assert.ok((await M.addFile("444", { name: `f${i}.txt`, mime: "text/plain", buf: Buffer.from("x" + i), count: { units: 1 } })).ok);
    x = await M.addFile("444", { name: "f60.txt", mime: "text/plain", buf: Buffer.from("y"), count: { units: 1 } });
    assert.ok(!x.ok && /60/.test(x.error));
    const big = Buffer.alloc(25 * 1024 * 1024 - 100);
    for (let i = 0; i < 6; i++) assert.ok((await M.addFile("555", { name: `b${i}.pdf`, mime: "application/pdf", buf: big, count: { units: 1 } })).ok);
    x = await M.addFile("555", { name: "b6.pdf", mime: "application/pdf", buf: Buffer.alloc(2 * 1024 * 1024), count: { units: 1 } });
    assert.ok(!x.ok && /150MB/.test(x.error), JSON.stringify(x));
    const tooBig = await up("huge.txt", "text/plain", Buffer.alloc(25 * 1024 * 1024 + 10, 65));
    assert.ok(!tooBig.ok && /25MB/.test(tooBig.error), JSON.stringify(tooBig));
    console.log("✓ хязгаар: 25MB/файл, 60 файл, 150MB нийт");

    // --- цэвэрлэх ---
    assert.strictEqual((await post("/org/clear/111", {})).status, 401);
    const cl = await (await post("/org/clear/111", {}, { "x-api-key": "test" })).json();
    assert.ok(cl.ok && cl.removed === 3);
    assert.strictEqual((await M.listFiles("111")).length, 0); assert.strictEqual(await M.getMeta("111"), null);
    await M.clear("444"); await M.clear("555");
    console.log("✓ clear");
    console.log("\nБҮХ ТУРШИЛТ АМЖИЛТТАЙ");
  } finally { srv.close(); }
})().catch(e => { console.error("АЛДАА:", e); process.exit(1); });
