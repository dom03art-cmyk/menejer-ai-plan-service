// Захиалагчийн Messenger-ээр илгээсэн файл (Word, Excel, PDF, зураг, CSV/текст)-ыг уншиж,
// төсөлд хэрэгтэй мэдээллийг тоо баримттайгаар нь товчлон буцаана. Make үүнийг ярианы түүхэнд нэмнэ.
const express = require("express");
const { call, WRITER } = require("./claude");
const router = express.Router();
const MAX = 20 * 1024 * 1024;

const SYSTEM = `Чи бизнес төслийн шинжээч. Захиалагчийн илгээсэн файлаас бизнес төсөл бичихэд хэрэгтэй бүх мэдээллийг Монгол хэлээр гаргаж бич.
Дүрэм:
- Тоо баримтыг (үнэ, өртөг, тоо хэмжээ, зардал, орлого, зээл, цалин, хөрөнгө, огноо) ЯГ файлд байгаагаар нь хадгал. Тоо зохиохгүй.
- Хүснэгт бол гол мөр, баганыг товч жагсаалт болгон хадгал.
- Зураг бол юу харагдаж байгааг (бүтээгдэхүүн, байр, тоног төхөөрөмж, баримт бичиг) болон доторх бичиг, тоог бич.
- Хэрэв өмнөх бизнес төсөл бол бүлэг бүрийн гол мэдээлэл, санхүүгийн тоонуудыг хураангуйл.
- Markdown тэмдэгт (** #) бүү ашигла. 2500 тэмдэгтээс хэтрүүлэхгүй.`;

function kind(mime, name) {
  const n = (name || "").toLowerCase(); const m = (mime || "").toLowerCase();
  if (m.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/.test(n)) return "image";
  if (m.includes("pdf") || n.endsWith(".pdf")) return "pdf";
  if (m.includes("wordprocessingml") || n.endsWith(".docx")) return "docx";
  if (m.includes("spreadsheetml") || m.includes("ms-excel") || /\.(xlsx|xls)$/.test(n)) return "xlsx";
  if (m.includes("csv") || m.startsWith("text/") || /\.(csv|txt)$/.test(n)) return "text";
  return "unknown";
}

async function extract({ url, type, name }) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Файл татаж чадсангүй (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX) throw new Error("Файл хэт том (20MB-аас их)");
  const mime = r.headers.get("content-type") || "";
  const k = type === "image" ? "image" : kind(mime, name || url.split("?")[0]);
  let content;
  if (k === "image") {
    const mt = /png/.test(mime) ? "image/png" : /webp/.test(mime) ? "image/webp" : /gif/.test(mime) ? "image/gif" : "image/jpeg";
    content = [{ type: "image", source: { type: "base64", media_type: mt, data: buf.toString("base64") } }, { type: "text", text: "Энэ зургаас бизнес төсөлд хэрэгтэй мэдээллийг гарга." }];
  } else if (k === "pdf") {
    content = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }, { type: "text", text: "Энэ PDF файлаас бизнес төсөлд хэрэгтэй мэдээллийг гарга." }];
  } else {
    let text;
    if (k === "docx") text = (await require("mammoth").extractRawText({ buffer: buf })).value;
    else if (k === "xlsx") { const XLSX = require("xlsx"); const wb = XLSX.read(buf, { type: "buffer" }); text = wb.SheetNames.map(s => `### ${s}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[s])).join("\n\n"); }
    else if (k === "text") text = buf.toString("utf8");
    else throw new Error("Энэ төрлийн файлыг уншиж чадахгүй. Word, Excel, PDF эсвэл зураг илгээнэ үү.");
    content = `Файлын агуулга:\n\n${text.slice(0, 120000)}`;
  }
  const summary = await call({ system: SYSTEM, user: content, model: WRITER, maxTokens: 3000 });
  return { kind: k, summary: String(summary).trim().slice(0, 3000) };
}

function auth(req, res, next) { if (req.get("x-api-key") !== process.env.API_KEY) return res.status(401).json({ error: "unauthorized" }); next(); }

// body: { url, type, name } → { ok, kind, summary } (алдаа гарвал ok:false, message — Make захиалагчид дамжуулна)
router.post("/files/extract", express.json({ limit: "1mb" }), auth, async (req, res) => {
  try { const out = await extract(req.body || {}); res.json({ ok: true, ...out }); }
  catch (e) { console.warn("[files]", e.message); res.json({ ok: false, message: e.message.includes("credit") ? "Систем түр саатаж байна" : e.message }); }
});
module.exports = router;
