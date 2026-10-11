// ТӨЛБӨР БАТАЛГААЖСАНЫ ДАРАА л дуудагдана: хадгалсан материалыг plan-v2/files.js extractBuffer-оор (Claude) нэг нэгээр нь уншиж нэгтгэнэ.
const M = require("./materials");
const { kindOf } = require("./quote");

const CAP = Number(process.env.ORG_EXTRACT_CAP || 150000);

// PowerPoint-ийг extractBuffer шууд уншдаггүй тул слайдын текстийг гаргаж текст файл болгон дамжуулна
async function pptxText(buf) {
  const JSZip = require("jszip"); const z = await JSZip.loadAsync(buf);
  const slides = Object.keys(z.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  const out = [];
  for (const [i, f] of slides.entries()) {
    const xml = await z.file(f).async("string");
    const t = (xml.match(/<a:t>([^<]*)<\/a:t>/g) || []).map(s => s.replace(/<\/?a:t>/g, "")).join(" ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    out.push(`Слайд ${i + 1}: ${t}`);
  }
  return out.join("\n");
}

// Урт хэсгүүдийг уртынх нь хэмжээгээр пропорциональ тайрна
function fit(parts, cap) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  if (total <= cap) return parts;
  return parts.map(p => { const n = Math.max(500, Math.floor(cap * p.length / total)); return p.length > n ? p.slice(0, n) + "\n…(тайрсан)" : p; });
}

async function extractAll(psid, log = console.log) {
  const { extractBuffer } = require("../plan-v2/files"); // залгаж туршихад (stub) зориулж дуудах үед авна
  const list = await M.getFiles(psid);
  const files = [], parts = [];
  for (const f of list) {
    try {
      const k = kindOf(f.name, f.mime);
      let arg = { buf: f.buf, mime: f.mime, name: f.name, type: k === "image" ? "image" : undefined };
      if (k === "pptx") arg = { buf: Buffer.from(await pptxText(f.buf), "utf8"), mime: "text/plain", name: f.name.replace(/\.pptx$/i, "") + ".txt" };
      const out = await extractBuffer(arg);
      const text = String((out && out.summary) || "").trim();
      parts.push(`=== Файл: ${f.name} ===\n${text}`);
      files.push({ name: f.name, ok: true, chars: text.length, note: "" });
      log(`[org-extract] ${psid} ${f.name}: ${text.length} тэмдэгт`);
    } catch (e) {
      const note = e.code === "photo" ? "Баримт бичиг биш зураг тул алгаслаа" : e.code === "media" ? "Видео, дуу бичлэг тул алгаслаа" : (e.message || "Уншиж чадсангүй");
      files.push({ name: f.name, ok: false, chars: 0, note });
      log(`[org-extract] ${psid} ${f.name}: алгаслаа — ${note}`);
    }
  }
  const text = fit(parts, CAP).join("\n\n");
  return { text, files };
}

module.exports = { extractAll, pptxText, fit };
