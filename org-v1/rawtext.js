// Тайлан, төлөвлөгөөнд зориулсан БҮТЭН текст гаргалт (plan-v2 extractBuffer нь 3000 тэмдэгтийн хураангуй өгдөг тул хангалтгүй).
// Word, Excel, PowerPoint, текстийг кодоор шууд уншина (AI дуудахгүй). PDF, зургийг Claude-аар үгчлэн хуулбарлуулна (хураангуйлахгүй).
// ТӨЛБӨР БАТАЛГААЖСАНЫ ДАРАА л дуудагдана.
const M = require("./materials");
const { kindOf } = require("./quote");
const { pptxText } = require("./extract");

const CAP = Number(process.env.ORG_RAW_CAP || 400000);       // нийт тэмдэгт
const FILE_CAP = Number(process.env.ORG_RAW_FILE_CAP || 150000); // нэг файлд
const PDF_CHUNK = 12; // нэг дуудлагад хуулбарлах PDF хуудас

const TRANSCRIBE = `Чи баримт бичгийг үгчлэн хуулбарлагч. Өгөгдсөн PDF хуудас эсвэл зургийн БҮХ бичиг, тоог анхны дарааллаар нь, ХУРААНГУЙЛАХГҮЙ, тайлбар нэмэхгүйгээр бич.
- Хүснэгтийг мөр бүрийг "|"-ээр тусгаарласан мөр болгон бич (толгой мөрийг оруул). Тоог яг байгаагаар нь (мянгатын тусгаарлагч, таслалтай) хуулна, дугуйлахгүй.
- Гарчиг, огноо, гарын үсгийн доорх нэр, албан тушаал, тамганы бичгийг оруул. Уншигдахгүй хэсгийг [уншигдахгүй] гэж тэмдэглэ.
- Хуудас бүрийн эхэнд "--- хуудас N ---" гэж бич.
- Хэрэв зурагт уншигдах бичиг огт байхгүй бол (хүн, байр, бүтээгдэхүүний зураг) зөвхөн PHOTO_ONLY гэж бич.`;

async function pdfChunks(buf) {
  const { PDFDocument } = require("pdf-lib");
  let doc; try { doc = await PDFDocument.load(buf, { ignoreEncryption: true }); } catch (e) { return [{ buf, from: 1, to: null }]; }
  const n = doc.getPageCount(); if (n <= PDF_CHUNK) return [{ buf, from: 1, to: n }];
  const out = [];
  for (let s = 0; s < n; s += PDF_CHUNK) {
    const part = await PDFDocument.create(), idx = Array.from({ length: Math.min(PDF_CHUNK, n - s) }, (_, i) => s + i);
    (await part.copyPages(doc, idx)).forEach(p => part.addPage(p));
    out.push({ buf: Buffer.from(await part.save()), from: s + 1, to: s + idx.length });
  }
  return out;
}

async function transcribe(content, maxTokens = 16000) {
  const { call, WRITER } = require("../plan-v2/claude");
  return String(await call({ system: TRANSCRIBE, user: content, model: process.env.ORG_TRANSCRIBE_MODEL || WRITER, maxTokens })).trim();
}

function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.slice(0, 4).toString() === "GIF8") return "image/gif";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

// Нэг файл → { text, method }. Алдаа гарвал throw (дээд түвшинд алгасна).
async function fileText(f) {
  const k = kindOf(f.name, f.mime);
  if (k === "docx") return { text: (await require("mammoth").extractRawText({ buffer: f.buf })).value, method: "word" };
  if (k === "xlsx") {
    const XLSX = require("xlsx"); const wb = XLSX.read(f.buf, { type: "buffer" });
    return { text: wb.SheetNames.map(s => `### Хуудас: ${s}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[s], { blankrows: false }).replace(/,+$/gm, "")).join("\n\n"), method: "excel" };
  }
  if (k === "pptx") return { text: await pptxText(f.buf), method: "powerpoint" };
  if (k === "text") return { text: f.buf.toString("utf8"), method: "text" };
  if (k === "pdf") {
    const parts = [];
    for (const c of await pdfChunks(f.buf)) {
      const t = await transcribe([{ type: "document", source: { type: "base64", media_type: "application/pdf", data: c.buf.toString("base64") } },
        { type: "text", text: `Энэ PDF-ийн бүх хуудсыг үгчлэн хуулбарла${c.from > 1 ? ` (эдгээр нь анхны баримтын ${c.from}–${c.to}-р хуудас; дугаарыг ${c.from}-аас эхлүүл)` : ""}.` }], 20000);
      parts.push(t);
    }
    return { text: parts.join("\n"), method: "pdf" };
  }
  if (k === "image") {
    const mt = sniff(f.buf); if (!mt) throw new Error("Зургийн форматыг уншиж чадсангүй (JPG, PNG байх ёстой)");
    if (f.buf.length > 5 * 1024 * 1024) throw new Error("Зураг 5MB-аас том");
    const t = await transcribe([{ type: "image", source: { type: "base64", media_type: mt, data: f.buf.toString("base64") } }, { type: "text", text: "Энэ зургийн бүх бичиг, тоог үгчлэн хуулбарла." }], 8000);
    if (/^\s*PHOTO_ONLY/.test(t)) throw Object.assign(new Error("Баримт бичиг биш зураг тул алгаслаа"), { code: "photo" });
    return { text: t, method: "image" };
  }
  throw new Error("Энэ төрлийн файлыг уншиж чадахгүй");
}

const tidy = (t) => String(t || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

// → { docs:[{name, text}], text, files:[{name, ok, chars, method, note}] }
async function extractRaw(psid, log = console.log) {
  const list = await M.getFiles(psid);
  const docs = [], files = [];
  for (const f of list) {
    try {
      let { text, method } = await fileText(f);
      text = tidy(text); const cut = text.length > FILE_CAP;
      if (cut) text = text.slice(0, FILE_CAP) + "\n…(файлын үлдсэн хэсгийг уншаагүй)";
      if (!text) throw new Error("Текст олдсонгүй (хоосон эсвэл зурган скан байж магадгүй)");
      docs.push({ name: f.name, text });
      files.push({ name: f.name, ok: true, chars: text.length, method, note: cut ? "хэт урт тул эхний хэсгийг уншив" : "" });
      log(`[org-raw] ${f.name}: ${text.length} тэмдэгт (${method})`);
    } catch (e) {
      if (/credit balance/i.test(e.message || "")) throw e;
      files.push({ name: f.name, ok: false, chars: 0, method: "", note: e.message || "Уншиж чадсангүй" });
      log(`[org-raw] ${f.name}: алгаслаа — ${e.message}`);
    }
  }
  // Нийт хязгаараас хэтэрвэл файл бүрийг уртынх нь хэмжээгээр тайрна
  const total = docs.reduce((s, d) => s + d.text.length, 0);
  if (total > CAP) for (const d of docs) { const n = Math.max(3000, Math.floor(CAP * d.text.length / total)); if (d.text.length > n) d.text = d.text.slice(0, n) + "\n…(тайрсан)"; }
  const text = docs.map(d => `=== Файл: ${d.name} ===\n${d.text}`).join("\n\n");
  return { docs, text, files };
}

// Урт текстийг ~size тэмдэгтийн хэсгүүдэд (файлын болон мөрийн хилээр) хуваана
function chunk(docs, size = Number(process.env.ORG_CHUNK || 60000)) {
  const out = []; let cur = "";
  const push = () => { if (cur.trim()) out.push(cur); cur = ""; };
  for (const d of docs) {
    const head = `=== Файл: ${d.name} ===\n`;
    if (cur.length + head.length + d.text.length <= size) { cur += (cur ? "\n\n" : "") + head + d.text; continue; }
    push();
    let rest = d.text, part = 1;
    while (rest.length) {
      let cutAt = rest.length <= size ? rest.length : rest.lastIndexOf("\n", size); if (cutAt < size * 0.5) cutAt = Math.min(size, rest.length);
      const piece = rest.slice(0, cutAt); rest = rest.slice(cutAt);
      if (!rest.length && piece.length < size * 0.6) cur = `=== Файл: ${d.name}${part > 1 ? ` (үргэлжлэл ${part})` : ""} ===\n` + piece;
      else out.push(`=== Файл: ${d.name}${part > 1 ? ` (үргэлжлэл ${part})` : ""} ===\n` + piece);
      part++;
    }
  }
  push();
  return out;
}

module.exports = { extractRaw, fileText, chunk, tidy };
