// Материалын "тооцооны хуудас"-ыг АГУУЛГЫГ УНШИХГҮЙГЭЭР (AI ашиглахгүй) тоолж, шатлалтай үнэ бодно.
// Дүрэм: Word/PDF-ийн хуудас = 1, скан PDF-ийн хуудас ба баримтын зураг = 2, Excel-ийн хуудас (sheet) = 1 + 1000 мөр тутамд 1,
//        PowerPoint-ийн слайд = 1, текст/CSV = 2500 тэмдэгт тутамд 1.
const PRODUCTS = {
  report_dept: { name: "Хэлтэс, албан тушаалын ажлын тайлан", tiers: [49900, 69900, 99900], extra: 20000 },
  report_dir: { name: "Гүйцэтгэх захирлын тайлан", tiers: [149900, 199900, 249900], extra: 50000 },
  plan: { name: "Байгууллагын үйл ажиллагааны төлөвлөгөө, төсөв", tiers: [199900, 249900, 299900], extra: 50000 },
  plan_dept: { name: "Хэлтсийн ажлын төлөвлөгөө", tiers: [69900, 89900, 119900], extra: 20000 },
  bundle_dept: { name: "Хэлтсийн тайлан + ажлын төлөвлөгөө (багц)", parts: ["report_dept", "plan_dept"], discount: 0.17, fixed: { "21–50": 129900 } },
  // Багц: нэг материалаар хоёуланг нь хийнэ; үнэ = хэсгүүдийн үнийн нийлбэрээс 15% хөнгөлөөд ...9 900₮ болгож дээш дугуйлна
  bundle: { name: "Гүйцэтгэх захирлын тайлан + байгууллагын төлөвлөгөө (багц)", parts: ["report_dir", "plan"], discount: 0.15 },
};

function kindOf(name, mime) {
  const n = String(name || "").toLowerCase(), m = String(mime || "").toLowerCase();
  if (m.startsWith("video/") || m.startsWith("audio/") || /\.(mp4|mov|avi|mkv|webm|3gp|m4a|mp3|aac|ogg|wav|amr)$/.test(n)) return "media";
  if (m.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif)$/.test(n)) return "image";
  if (m.includes("pdf") || n.endsWith(".pdf")) return "pdf";
  if (m.includes("wordprocessingml") || n.endsWith(".docx")) return "docx";
  if (n.endsWith(".doc")) return "doc";
  if (m.includes("spreadsheetml") || m.includes("ms-excel") || /\.(xlsx|xls|xlsm)$/.test(n)) return "xlsx";
  if (m.includes("presentationml") || n.endsWith(".pptx")) return "pptx";
  if (m.includes("csv") || m.startsWith("text/") || /\.(csv|txt|md)$/.test(n)) return "text";
  return "unknown";
}

async function countPdf(buf) {
  const { PDFDocument, PDFName, PDFDict } = require("pdf-lib");
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages(); let text = 0;
  for (const p of pages) {
    let has = false;
    try { const res = p.node.Resources(); const font = res && res.lookup(PDFName.of("Font")); has = font instanceof PDFDict && font.keys().length > 0; } catch (_) { }
    if (has) text++;
  }
  const scan = pages.length - text;
  return { pages: pages.length, units: text + scan * 2, note: scan ? `${scan} скан хуудас` : "" };
}

async function countDocx(buf) {
  const JSZip = require("jszip"); const z = await JSZip.loadAsync(buf);
  const app = z.file("docProps/app.xml") ? await z.file("docProps/app.xml").async("string") : "";
  const m = /<Pages>(\d+)<\/Pages>/.exec(app);
  const xml = z.file("word/document.xml") ? await z.file("word/document.xml").async("string") : "";
  const words = xml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  const byWords = Math.max(1, Math.ceil(words / 350));
  const pages = m ? Math.max(Number(m[1]), 1) : byWords;
  return { pages, units: Math.max(pages, byWords) };
}

async function countPptx(buf) {
  const JSZip = require("jszip"); const z = await JSZip.loadAsync(buf);
  const n = Object.keys(z.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
  return { pages: n, units: Math.max(1, n) };
}

function countXlsx(buf) {
  const XLSX = require("xlsx"); const wb = XLSX.read(buf, { type: "buffer", sheetRows: 0, bookSheets: false });
  let units = 0, rows = 0;
  for (const s of wb.SheetNames) {
    const ref = wb.Sheets[s] && wb.Sheets[s]["!ref"]; if (!ref) continue;
    const r = XLSX.utils.decode_range(ref), n = r.e.r - r.s.r + 1;
    rows += n; units += 1 + Math.floor(n / 1000);
  }
  return { pages: wb.SheetNames.length, units: Math.max(1, units), note: `${wb.SheetNames.length} хуудас (sheet), ${rows} мөр` };
}

// Нэг файлын тооцооны хуудас. Уншиж чадахгүй бол { units: 0, error }.
async function countFile({ buf, name, mime }) {
  const k = kindOf(name, mime);
  try {
    if (k === "media") return { kind: k, units: 0, error: "Видео, дуу бичлэгийг хүлээж авахгүй" };
    if (k === "image") return { kind: k, pages: 1, units: 2 };
    if (k === "pdf") return { kind: k, ...(await countPdf(buf)) };
    if (k === "docx") return { kind: k, ...(await countDocx(buf)) };
    if (k === "pptx") return { kind: k, ...(await countPptx(buf)) };
    if (k === "xlsx") return { kind: k, ...countXlsx(buf) };
    if (k === "text") { const n = Math.max(1, Math.ceil(buf.toString("utf8").length / 2500)); return { kind: k, pages: n, units: n }; }
    if (k === "doc") return { kind: k, units: 0, error: "Хуучин .doc форматыг уншихгүй. Word-оор нээгээд .docx болгож хадгалаад илгээнэ үү" };
    return { kind: k, units: 0, error: "Энэ төрлийн файлыг хүлээж авахгүй (Word, Excel, PDF, PowerPoint, зураг)" };
  } catch (e) {
    return { kind: k, units: 0, error: /password|encrypt/i.test(e.message) ? "Нууц үгтэй файл байна" : "Файлыг нээж чадсангүй (гэмтсэн байж магадгүй)" };
  }
}

// Шатлал: ≤20 / 21–50 / 51–100; 100-аас дээш 50 хуудас (эсвэл түүний хэсэг) тутамд нэмэгдэнэ.
function priceFor(product, units) {
  const p = PRODUCTS[product]; if (!p) throw new Error("Үл мэдэгдэх бүтээгдэхүүн: " + product);
  const u = Math.ceil(Number(units) || 0);
  if (p.parts) {
    const qs = p.parts.map((x) => priceFor(x, u)), full = qs.reduce((a, q) => a + q.price, 0);
    const price = (p.fixed && p.fixed[qs[0].tier]) || Math.ceil(full * (1 - p.discount) / 10000) * 10000 - 100;
    return { product, name: p.name, units: u, tier: qs[0].tier, price, full, saving: full - price, parts: qs };
  }
  let price, tier;
  if (u <= 20) { price = p.tiers[0]; tier = "20 хүртэл"; }
  else if (u <= 50) { price = p.tiers[1]; tier = "21–50"; }
  else if (u <= 100) { price = p.tiers[2]; tier = "51–100"; }
  else { const extra = Math.ceil((u - 100) / 50); price = p.tiers[2] + extra * p.extra; tier = `100-аас дээш (+${extra} × ${p.extra.toLocaleString("en-US").replace(/,/g, " ")}₮)`; }
  return { product, name: p.name, units: u, tier, price };
}

const fmtMoney = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "₮";
module.exports = { PRODUCTS, kindOf, countFile, priceFor, fmtMoney };
