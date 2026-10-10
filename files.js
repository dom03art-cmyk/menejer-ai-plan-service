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
- Зураг бол зөвхөн доторх уншигдах бичиг, тоог гарга. Зургийн дүр төрх, орчин, хүмүүсийг тайлбарлахгүй.
- Хэрэв өмнөх бизнес төсөл бол бүлэг бүрийн гол мэдээлэл, санхүүгийн тоонуудыг хураангуйл.
- Markdown тэмдэгт (** #) бүү ашигла. 2500 тэмдэгтээс хэтрүүлэхгүй.`;

// Төсөлд оруулахгүй зүйлсийн мессеж (код нь дуудагч талд ялгахад)
const PHOTO_MSG = "Баримт бичиг биш зураг тул тооцоонд оруулаагүй. Төсөл гарсны дараа Word файлын 2.4 (бүтээгдэхүүн) эсвэл 3.1 (үйл ажиллагаа) хэсэгт өөрөө оруулна уу.";
const MEDIA_MSG = "Видео, дуу бичлэгийг уншиж чадахгүй. Мэдээллээ текстээр бичих эсвэл баримт бичгийн зургийг илгээнэ үү.";
const coded = (code, msg) => Object.assign(new Error(msg), { code });

function kind(mime, name) {
  const n = (name || "").toLowerCase(); const m = (mime || "").toLowerCase();
  if (m.startsWith("video/") || m.startsWith("audio/") || /\.(mp4|mov|avi|mkv|webm|3gp|m4a|mp3|aac|ogg|oga|opus|wav|amr)$/.test(n)) return "media";
  if (/heic|heif/.test(m) || /\.(heic|heif)$/.test(n)) return "heic";
  if (m.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/.test(n)) return "image";
  if (m.includes("pdf") || n.endsWith(".pdf")) return "pdf";
  if (m.includes("wordprocessingml") || n.endsWith(".docx")) return "docx";
  if (m.includes("spreadsheetml") || m.includes("ms-excel") || /\.(xlsx|xls)$/.test(n)) return "xlsx";
  if (m.includes("csv") || m.startsWith("text/") || /\.(csv|txt)$/.test(n)) return "text";
  return "unknown";
}

// Google Drive / Docs / Sheets хуваалцсан холбоосыг шууд татах холбоос болгоно
function directUrl(url) {
  let m;
  if ((m = url.match(/docs\.google\.com\/document\/d\/([\w-]+)/))) return { url: `https://docs.google.com/document/d/${m[1]}/export?format=docx`, name: "doc.docx" };
  if ((m = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/))) return { url: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`, name: "sheet.xlsx" };
  if ((m = url.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/))) return { url: `https://docs.google.com/presentation/d/${m[1]}/export/pdf`, name: "slides.pdf" };
  if ((m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]+)/))) return { url: `https://drive.google.com/uc?export=download&id=${m[1]}` };
  return { url };
}

async function extract({ url, type, name }) {
  const d = directUrl(url);
  const r = await fetch(d.url, { signal: AbortSignal.timeout(60000), redirect: "follow" });
  if (!r.ok) throw new Error(`Файл татаж чадсангүй (${r.status}). Холбоос нээлттэй (Anyone with the link) эсэхийг шалгана уу.`);
  const buf = Buffer.from(await r.arrayBuffer());
  const mime = r.headers.get("content-type") || "";
  if (/text\/html/.test(mime) && /google/.test(d.url)) throw new Error("Google Drive файл хаалттай байна. Хуваалцах тохиргоог «Anyone with the link» болгоно уу.");
  const cd = r.headers.get("content-disposition") || "";
  const fname = (cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i) || [])[1] || d.name || name || url.split("?")[0];
  return extractBuffer({ buf, mime, name: decodeURIComponent(fname), type });
}

// Claude API-ийн хязгаар: зураг 5MB (base64 биш, түүхий), PDF 100 хуудас / 32MB хүсэлт
const IMG_MAX = 3.7 * 1024 * 1024;   // base64 болоход ~5MB
const PDF_PAGES = 100;
const mb = (n) => (n / 1024 / 1024).toFixed(1);

// Зургийн бодит төрлийг эхний байтаас тогтооно (Messenger, утас буруу mime өгөх нь бий)
function sniffImage(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.slice(0, 4).toString() === "GIF8") return "image/gif";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  if (/ftyp(heic|heix|hevc|mif1|msf1)/.test(buf.slice(4, 12).toString())) return "image/heic";
  return null;
}

// 100-аас олон хуудастай PDF-ийн эхний 100 хуудсыг салгана
async function trimPdf(buf) {
  try {
    const { PDFDocument } = require("pdf-lib");
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const n = doc.getPageCount();
    if (n <= PDF_PAGES) return { buf, pages: n, trimmed: false };
    const out = await PDFDocument.create();
    const pages = await out.copyPages(doc, Array.from({ length: PDF_PAGES }, (_, i) => i));
    pages.forEach(p => out.addPage(p));
    return { buf: Buffer.from(await out.save()), pages: n, trimmed: true };
  } catch (e) {
    console.warn("[files] pdf-lib:", e.message);
    return { buf, pages: null, trimmed: false };
  }
}

// API-ийн англи алдааг захиалагчид ойлгомжтой болгоно
function friendly(e, k) {
  const m = String((e && e.message) || e || "");
  if (/credit|balance/i.test(m)) return "Систем түр саатаж байна. Хэсэг хугацааны дараа дахин илгээнэ үү.";
  if (k === "image" && /(5 ?MB|exceeds|too large|dimension|pixel)/i.test(m)) return "Зураг хэт том байна. Зургаа энэ чат руу шууд илгээнэ үү.";
  if (k === "image" && /(invalid|unsupported|could not process|media_type)/i.test(m)) return "Зургийн форматыг уншиж чадсангүй. JPG эсвэл PNG зураг илгээнэ үү.";
  if (k === "pdf" && /(password|encrypt)/i.test(m)) return "PDF файл нууц үгээр хамгаалагдсан байна. Хамгаалалтгүй хувилбар эсвэл чухал хуудсуудын зургийг илгээнэ үү.";
  if (k === "pdf") return "PDF файлыг уншиж чадсангүй (хэт том эсвэл гэмтсэн байж магадгүй). Чухал хуудсуудын зургийг (screenshot) илгээнэ үү.";
  return m || "Файл уншиж чадсангүй";
}

async function extractBuffer({ buf, mime, name, type }) {
  if (buf.length > MAX) throw new Error(`Файл хэт том (${mb(buf.length)}MB, 20MB хүртэл). Чухал хуудсуудын зургийг илгээнэ үү.`);
  if (type === "video" || type === "audio") throw coded("media", MEDIA_MSG);
  let k = type === "image" ? "image" : kind(mime, name);
  if (k === "media") throw coded("media", MEDIA_MSG);
  const sniff = (k === "image" || k === "heic" || k === "unknown") ? sniffImage(buf) : null;
  if (sniff === "image/heic") k = "heic"; else if (sniff) k = "image";
  if (k === "heic") throw new Error("iPhone-ийн HEIC зургийг уншиж чадахгүй. Зургаа энэ чат руу шууд илгээх эсвэл JPG болгож илгээнэ үү.");
  let content, note = "";
  if (k === "image") {
    if (buf.length > IMG_MAX) throw new Error(`Зураг хэт том байна (${mb(buf.length)}MB). Зургаа энэ чат руу шууд илгээнэ үү, Messenger өөрөө жижигрүүлнэ.`);
    const mt = sniff || (/png/.test(mime) ? "image/png" : /webp/.test(mime) ? "image/webp" : /gif/.test(mime) ? "image/gif" : "image/jpeg");
    content = [{ type: "image", source: { type: "base64", media_type: mt, data: buf.toString("base64") } }, { type: "text", text: "Эхлээд шийд: энэ зурагт бизнес төсөлд хэрэгтэй УНШИГДАХ бичиг, тоо байна уу (баримт бичиг, хүснэгт, үнийн санал, нэхэмжлэх, гэрээ, тайлан, дэлгэцийн зураг, бүтээгдэхүүний шошго, үнийн самбар, тоног төхөөрөмжийн хүчин чадлын шошго)? Байхгүй бол (зөвхөн үйл явц, бүтээгдэхүүн, байр, тоног төхөөрөмж, хүмүүсийн зураг) өөр юу ч бичилгүй яг PHOTO_ONLY гэж хариул. Байвал зөвхөн уншигдах бичиг, тоог гарга." }];
  } else if (k === "pdf") {
    const t = await trimPdf(buf);
    if (t.trimmed) note = `(PDF ${t.pages} хуудастай, эхний ${PDF_PAGES} хуудсыг уншив) `;
    content = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: t.buf.toString("base64") } }, { type: "text", text: "Энэ PDF файлаас бизнес төсөлд хэрэгтэй мэдээллийг гарга." }];
  } else {
    let text;
    if (k === "docx") text = (await require("mammoth").extractRawText({ buffer: buf })).value;
    else if (k === "xlsx") { const XLSX = require("xlsx"); const wb = XLSX.read(buf, { type: "buffer" }); text = wb.SheetNames.map(s => `### ${s}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[s])).join("\n\n"); }
    else if (k === "text") text = buf.toString("utf8");
    else throw new Error("Энэ төрлийн файлыг уншиж чадахгүй. Word, Excel, PDF эсвэл зураг илгээнэ үү.");
    content = `Файлын агуулга:\n\n${text.slice(0, 120000)}`;
  }
  let summary;
  try { summary = await call({ system: SYSTEM, user: content, model: WRITER, maxTokens: 3000 }); }
  catch (e) { console.warn("[files] claude:", k, mb(buf.length) + "MB", e.message); throw new Error(friendly(e, k)); }
  if (k === "image" && /^\s*PHOTO_ONLY/.test(String(summary))) throw coded("photo", PHOTO_MSG);
  return { kind: k, summary: (note + String(summary).trim()).slice(0, 3000) };
}

function auth(req, res, next) { if (req.get("x-api-key") !== process.env.API_KEY) return res.status(401).json({ error: "unauthorized" }); next(); }

// body: { url, type, name } → { ok, kind, summary } (алдаа гарвал ok:false, message — Make захиалагчид дамжуулна)
router.post("/files/extract", express.json({ limit: "1mb" }), auth, async (req, res) => {
  // Нэг мессежид олон хавсралт (жишээ нь 5 зураг) ирвэл бүгдийг уншиж нэгтгэнэ
  let list = req.body && req.body.attachments;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch (_) { list = null; } }
  // Make-ээс "url1|url2|..." ба "image|file|..." хэлбэрээр ирж болно
  if (!list && req.body && typeof req.body.urls === "string" && req.body.urls.includes("|")) {
    const us = req.body.urls.split("|"), ts = String(req.body.types || "").split("|");
    list = us.map((u, i) => ({ url: u, type: ts[i] }));
  } else if (!list && req.body && typeof req.body.urls === "string" && req.body.urls) {
    req.body.url = req.body.urls; req.body.type = req.body.types;
  }
  if (Array.isArray(list) && list.length) {
    const items = list.map(a => ({ url: (a.payload && a.payload.url) || a.url, type: a.type })).filter(a => a.url).slice(0, 10);
    const parts = [], kinds = [], errors = [];
    // Зэрэг уншина (5 хүртэл нэг дор) — 5 зураг ~2 минутаас ~30 секунд болно
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => { while (next < items.length) { const i = next++; try { results[i] = await extract(items[i]); } catch (e) { results[i] = { error: e.message, code: e.code }; } } };
    await Promise.all(Array.from({ length: Math.min(5, items.length) }, worker));
    let photos = 0, media = 0;
    results.forEach((o, i) => { if (o && !o.error) { kinds.push(o.kind); parts.push(`(${i + 1}) ${o.summary}`); } else if (o && o.code === "photo") photos++; else if (o && o.code === "media") media++; else errors.push(o && o.error); });
    if (!parts.length) {
      if (photos && !errors.length && !media) return res.json({ ok: false, code: "photo", message: photos > 1 ? `Эдгээр ${photos} зураг баримт бичиг биш тул тооцоонд оруулаагүй. Төсөл гарсны дараа Word файлдаа өөрөө оруулна уу.` : PHOTO_MSG });
      if (media && !errors.length && !photos) return res.json({ ok: false, code: "media", message: MEDIA_MSG });
      return res.json({ ok: false, message: errors[0] || (media ? MEDIA_MSG : PHOTO_MSG) });
    }
    const readCount = parts.length;
    if (photos) parts.push(`(Мөн ${photos} зураг баримт бичиг биш (үйл явц, бүтээгдэхүүний зураг) байсан тул тооцоонд оруулаагүй — захиалагч Word файлдаа өөрөө оруулна.)`);
    if (media) parts.push(`(${media} видео/дуу бичлэгийг уншаагүй — захиалагч мэдээллээ текстээр бичнэ.)`);
    const kind = [...new Set(kinds)].length === 1 ? kinds[0] : "mixed";
    return res.json({ ok: true, kind, count: readCount, summary: parts.join("\n").slice(0, 6000) });
  }
  try { const out = await extract(req.body || {}); res.json({ ok: true, count: 1, ...out }); }
  catch (e) { console.warn("[files]", e.message); res.json({ ok: false, code: e.code, message: e.message.includes("credit") ? "Систем түр саатаж байна" : e.message }); }
});
module.exports = router;
module.exports.extract = extract;
module.exports.extractBuffer = extractBuffer;
