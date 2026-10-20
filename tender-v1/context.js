// Claude-д өгөх текстийн хэмжээг хянах.
// 1) Урт бол ТББ-ийн стандарт хэсгийг (I бүлэг ТШЗ, ГЕН — жишиг баримттай ижил) хасна; тоон утгууд ӨХ, ГТН-д үлдэнэ.
// 2) Хасаад ч урт бол «цонх» болгон хуваана: эхний цонхоор ТББ задлаад, үлдсэнээс нэмэлт мөрийг (бараа, үзүүлэлт, шаардлага) нэмж авна.
// Монгол кирилл ≈ 2 тэмдэгт/токен гэж тооцоолно (болгоомжтой). SYSTEM ≈ 31k токен.
const WINDOW = () => Number(process.env.TENDER_WINDOW_CHARS || 240000);   // ≈120k токен + SYSTEM → 200k-аас бага
const STRIP_AT = () => Number(process.env.TENDER_STRIP_AT || 160000);

// [эхлэл, төгсгөл] — эхлэлээс хойшх анхны төгсгөл; гарчгийн жагсаалт (TOC) дахь богино давхцлыг алгасахын тулд хамгийн урт хэсгийг сонгоно
const SECTIONS = [
  { name: "I бүлэг — Тендер шалгаруулалтын зааварчилгаа (ТШЗ)", start: /(тендер шалгаруулалтын заавар(чилгаа)?|тендерт оролцогчдод өгөх заавар)/i, end: /өгөгдлийн хүснэгт/i,
    note: "[I бүлэг (ТШЗ) — жишиг баримттай ижил стандарт текст тул хассан. Тоон утга, шаардлагыг Өгөгдлийн хүснэгтээс уншина.]" },
  { name: "Гэрээний ерөнхий нөхцөл (ГЕН)", start: /гэрээний ерөнхий нөхцөл/i, end: /гэрээний тусгай нөхцөл/i,
    note: "[Гэрээний ерөнхий нөхцөл (ГЕН) — стандарт текст тул хассан. Онцлог нөхцөлийг ГТН-ээс уншина.]" },
];
const MIN_SECTION = 8000;

function lineStarts(text, re) { const out = []; let pos = 0; for (const line of text.split("\n")) { if (line.length < 200 && re.test(line)) out.push(pos); pos += line.length + 1; } return out; }

function stripStandard(text) {
  const removed = [];
  for (const sec of SECTIONS) {
    const S = lineStarts(text, sec.start), E = lineStarts(text, sec.end);
    let best = null;
    for (const s of S) { const e = E.find((x) => x > s); if (e && e - s >= MIN_SECTION && (!best || e - s > best[1] - best[0])) best = [s, e]; }
    if (!best) continue;
    // гарчгийн мөрийг үлдээж, биеийг тэмдэглэлээр солино
    const headEnd = text.indexOf("\n", best[0]) + 1 || best[0];
    removed.push({ name: sec.name, chars: best[1] - headEnd });
    text = text.slice(0, headEnd) + sec.note + "\n\n" + text.slice(best[1]);
  }
  return { text, removed };
}

// docs: [{name, phase, text}] → { docs, removed:[] } (зөвхөн нийт урт STRIP_AT-аас их үед, зөвхөн ТББ-д)
function fitDocs(docs) {
  const total = docs.reduce((s, d) => s + d.text.length, 0), removed = [];
  if (total <= STRIP_AT()) return { docs, removed };
  const out = docs.map((d) => {
    if (d.phase !== "tbb") return d;
    const r = stripStandard(d.text); r.removed.forEach((x) => removed.push({ file: d.name, ...x }));
    return { ...d, text: r.text };
  });
  return { docs: out, removed };
}

// Урт текстийг мөрийн хилээр WINDOW хэмжээний цонх болгоно
function windows(text, size = WINDOW()) {
  if (text.length <= size) return [text];
  const out = []; let rest = text;
  while (rest.length > size) { let cut = rest.lastIndexOf("\n", size); if (cut < size * 0.6) cut = size; out.push(rest.slice(0, cut)); rest = rest.slice(cut); }
  if (rest.trim()) out.push(rest);
  return out;
}

// B шатны контекст: оролцогчийн баримт бүрэн, ТББ багтвал хамт (tender JSON-д бүх шаардлага аль хэдийн бий)
function composeContext(docs, join) {
  const bid = docs.filter((d) => d.phase === "bidder"), tbb = docs.filter((d) => d.phase !== "bidder");
  let text = join([...bid, ...tbb]), note = "";
  if (text.length > WINDOW()) {
    text = join(bid);
    note = "\n\n(ТББ-ийн бүтэн текст энд ороогүй — шаардлагууд tender JSON-д бий.)";
    if (text.length > WINDOW()) { text = text.slice(0, WINDOW()) + "\n…(оролцогчийн баримтын үлдсэн хэсгийг тайрсан)"; note += " Оролцогчийн баримтын зарим хэсэг тайрагдсан."; }
  }
  return text + note;
}

// A1-ийн нэмэлт цонхны үр дүнг нэгтгэнэ (давхардлыг түлхүүрээр хасна)
function mergeTender(base, add) {
  const t = base || {};
  const keyed = { items: (x) => String(x.no), tech_specs: (x) => `${x.item_no}|${x.no}`, requirements: (x) => x.id || x.text, forms: (x) => x.key || x.name, numeric_criteria: (x) => x.req_id, inconsistencies: (x) => x.text };
  for (const [k, key] of Object.entries(keyed)) {
    const cur = Array.isArray(t[k]) ? t[k] : [], seen = new Set(cur.map(key));
    for (const x of (add && Array.isArray(add[k]) ? add[k] : [])) if (!seen.has(key(x))) { cur.push(x); seen.add(key(x)); }
    if (cur.length) t[k] = cur;
  }
  return t;
}

module.exports = { stripStandard, fitDocs, windows, composeContext, mergeTender, WINDOW };
