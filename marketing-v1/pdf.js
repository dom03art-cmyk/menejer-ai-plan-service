// Утсан дээр уншихад зориулсан PDF (pdfmake, гарчиг бодит хуудасны дугаартай). Өнгийг параметрээр авна.
// Фонтын тохиргоог plan-v2/pdf.js аль хэдийн хийсэн (ижил pdfmake); энд дахин өөрчлөхгүй.
require("../plan-v2/pdf");
const pdfmake = require("pdfmake");
const OUTLINE = require("./outline");
const GREY = "#595959";
const rich = (t) => String(t ?? "").split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(p => p.startsWith("**") ? { text: p.slice(2, -2), bold: true } : p);
const isNum = (c) => /^[\s\-−—+]*[\d\s.,]+\s*(%|₮|×)?\s*$/.test(String(c)) && /\d/.test(String(c));
const SAFE = (t) => String(t ?? "").replace(/✓/g, "•").replace(/☐/g, "□");

async function buildPdf({ A, written, fin, charts, th, meta }) {
  const P1 = "#" + th.primary, P2 = "#" + th.accent, LIGHT = "#" + th.light, TOT = "#" + (th.tot || th.light);
  let tableNo = 0, figNo = 0;
  const lines = { hLineColor: "#BBBBBB", vLineColor: "#BBBBBB", hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 3, paddingBottom: () => 3 };
  function table(b) {
    const n = b.headers.length, pct = b.widths && b.widths.length === n ? b.widths : (n === 1 ? [100] : n === 2 ? [35, 65] : [n > 5 ? 24 : 30, ...Array(n - 1).fill((100 - (n > 5 ? 24 : 30)) / (n - 1))]);
    const tot = pct.reduce((a, c) => a + c, 0), widths = pct.map(p => (p / tot * 100).toFixed(2) + "%"); widths[n - 1] = "*";
    const headless = b.headers.every(h => !String(h).trim()), fs = b.small || n > 7 ? 7.5 : n > 5 ? 8.5 : 9.5, body = [];
    if (!headless) body.push(b.headers.map(h => ({ text: SAFE(h), bold: true, color: "white", fillColor: P1, alignment: "center", fontSize: fs })));
    b.rows.forEach((r, ri) => { const isTot = String(r[0] ?? "").startsWith("!");
      body.push(Array.from({ length: n }, (_, i) => { let c = r[i] ?? ""; if (i === 0 && isTot) c = String(c).slice(1);
        return { text: rich(SAFE(c)), bold: isTot || (headless && i === 0), fontSize: fs, alignment: i > 0 && isNum(c) ? "right" : "left", fillColor: isTot ? TOT : ri % 2 ? LIGHT : null }; })); });
    const out = [];
    if (b.caption) { tableNo++; out.push({ text: `Хүснэгт ${tableNo}. ${b.caption}`, bold: true, color: P1, fontSize: 10, alignment: "center", margin: [0, 8, 0, 4] }); }
    out.push({ table: { headerRows: headless ? 0 : 1, widths, body, dontBreakRows: true }, layout: lines, margin: [0, 0, 0, 10] });
    return out;
  }
  function blocks(list) {
    const out = [];
    for (const b of list || []) {
      if (b.type === "p") out.push({ text: rich(SAFE(b.text)), alignment: "justify", margin: [0, 0, 0, 6] });
      else if (b.type === "h3") out.push({ text: SAFE(b.text), style: "h3" });
      else if (b.type === "bullets") out.push({ ul: b.items.map(t => rich(SAFE(t))), margin: [0, 0, 0, 6] });
      else if (b.type === "numbered") out.push({ ol: b.items.map(t => rich(SAFE(t))), margin: [0, 0, 0, 6] });
      else if (b.type === "checklist") b.items.forEach(t => out.push({ columns: [{ width: 16, canvas: [{ type: "rect", x: 2, y: 3, w: 8, h: 8, lineWidth: 0.8, lineColor: "#333333" }] }, { width: "*", text: rich(SAFE(t)) }], margin: [6, 0, 0, 4] }));
      else if (b.type === "tip" || b.type === "note") out.push({ table: { widths: ["*"], body: [[{ text: rich(SAFE(b.text)), italics: true, color: GREY, fontSize: 11, alignment: "justify", margin: [8, 2, 0, 2] }]] },
        layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 2.5 : 0, vLineColor: P2 }, margin: [10, 2, 0, 10] });
      else if (b.type === "box") out.push({ table: { widths: ["*"], body: [[{ stack: [...(b.title ? [{ text: SAFE(b.title), bold: true, color: P1, margin: [0, 0, 0, 4] }] : []), ...String(b.text || "").split("\n").filter(Boolean).map(t => ({ text: rich(SAFE(t)), fontSize: 11.5, margin: [0, 0, 0, 4] }))], fillColor: LIGHT, margin: [8, 6, 8, 4] }]] },
        layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 3 : 0, vLineColor: P2 }, margin: [0, 4, 0, 10] });
      else if (b.type === "table") out.push(...table(b));
      else if (b.type === "gantt") { const P = b.periods.length; figNo++;
        const body = [[{ text: "Ажил", bold: true, color: "white", fillColor: P1, fontSize: 8.5 }, ...b.periods.map(p => ({ text: SAFE(p), bold: true, color: "white", fillColor: P1, fontSize: P > 9 ? 6.5 : 7.5, alignment: "center" }))]];
        b.tasks.forEach((t, k) => body.push([{ text: SAFE(t.name), fontSize: 8.5 }, ...b.periods.map((_, i) => ({ text: "", fillColor: i >= t.start && i < t.end ? (k % 2 ? P2 : P1) : null }))]));
        out.push({ table: { headerRows: 1, widths: ["30%", ...Array(P).fill("*")], body, dontBreakRows: true }, layout: lines, margin: [0, 6, 0, 2] },
          { text: `Зураг ${figNo}. ${SAFE(b.title)}`, italics: true, fontSize: 9, color: GREY, alignment: "center", margin: [0, 2, 0, 10] }); }
      else if (b.type === "flow") { const row = [], widths = []; figNo++;
        b.steps.forEach((s, i) => { if (i) { row.push({ text: "→", bold: true, color: P2, fontSize: 14, alignment: "center", margin: [0, 10, 0, 0], border: [false, false, false, false] }); widths.push(14); }
          row.push({ stack: [{ text: String(i + 1), bold: true, color: P2, alignment: "center" }, { text: SAFE(s), fontSize: 9.5, alignment: "center" }], fillColor: LIGHT, margin: [3, 4, 3, 4] }); widths.push("*"); });
        out.push({ stack: [{ table: { widths, body: [row] }, layout: { hLineColor: P1, vLineColor: P1 } }, { text: `Зураг ${figNo}. ${SAFE(b.title || "Урсгал")}`, italics: true, fontSize: 9, color: GREY, alignment: "center", margin: [0, 3, 0, 0] }], unbreakable: true, margin: [0, 6, 0, 10] }); }
      else if (b.type === "chart") { const c = charts[b.key];
        if (c) { figNo++; out.push({ stack: [{ image: "data:image/png;base64," + c.buf.toString("base64"), width: c.width >= 800 ? 400 : 340, alignment: "center" },
          { text: `Зураг ${figNo}. ${SAFE(c.title || "")}${b.source ? ". Эх сурвалж: " + SAFE(b.source) : ""}`, italics: true, fontSize: 9, color: GREY, alignment: "center", margin: [0, 3, 0, 0] }], unbreakable: true, margin: [0, 6, 0, 10] }); }
        else if (b.fallback) out.push(...table(b.fallback)); }
    }
    return out;
  }
  const content = [
    { text: String(A.brand.name || "").toUpperCase(), fontSize: 20, bold: true, color: P1, alignment: "center", margin: [0, 70, 0, 6] },
    ...(A.brand.slogan ? [{ text: A.brand.slogan, italics: true, color: P2, alignment: "center" }] : []),
    { canvas: [{ type: "line", x1: 60, y1: 0, x2: 410, y2: 0, lineWidth: 1.5, lineColor: P2 }], margin: [0, 150, 0, 16] },
    { text: meta.title, fontSize: meta.title.length > 26 ? 22 : 28, bold: true, color: P1, alignment: "center", margin: [0, 0, 0, 12] },
    ...(meta.subtitle ? [{ text: meta.subtitle, fontSize: 13, alignment: "center", margin: [0, 0, 0, 16] }] : []),
    { text: "Хамрах хугацаа: " + meta.period, color: GREY, alignment: "center" },
    { canvas: [{ type: "line", x1: 60, y1: 0, x2: 410, y2: 0, lineWidth: 1.5, lineColor: P2 }], margin: [0, 16, 0, 0] },
    { text: `${meta.city}\n${meta.year}`, alignment: "center", absolutePosition: { x: 0, y: 740 } },
    { toc: { title: { text: "ГАРЧИГ", style: "h1", alignment: "center" }, numberStyle: { bold: false } }, pageBreak: "before" },
  ];
  for (const o of OUTLINE) {
    content.push({ text: o.t, style: ["h1", "h2", "h3"][o.lvl - 1], tocItem: true, tocMargin: [(o.lvl - 1) * 15, 0, 0, 0], tocStyle: o.lvl === 1 ? { bold: true, color: P1 } : { fontSize: 10.5 }, pageBreak: o.lvl === 1 ? "before" : undefined });
    content.push(...blocks(written[o.id]));
    for (const key of o.attach || []) {
      if (key.startsWith("chart:")) content.push(...blocks([{ type: "chart", key: key.slice(6), source: "тооцоолол" }]));
      else if (key === "sources") content.push(...blocks([{ type: "bullets", items: fin.sources }]));
      else content.push(...blocks(fin.blocks[key]));
    }
  }
  const doc = { pageSize: "A4", pageMargins: [85, 57, 42, 57], content, defaultStyle: { font: "DejaVu", fontSize: 12, lineHeight: 1.15 },
    styles: { h1: { fontSize: 15, bold: true, color: P1, margin: [0, 0, 0, 12] }, h2: { fontSize: 13, bold: true, color: P1, margin: [0, 12, 0, 6] }, h3: { fontSize: 12, bold: true, color: P2, margin: [0, 8, 0, 4] } },
    header: (p) => p <= 1 ? null : { text: meta.header, alignment: "right", fontSize: 8, color: GREY, margin: [85, 25, 42, 0] },
    footer: (p, n) => p <= 1 ? null : { text: `${p} / ${n}`, alignment: "center", fontSize: 8, color: GREY, margin: [85, 20, 42, 0] },
    info: { title: `${A.brand.name} — ${meta.title}` } };
  let pages = 0; doc.footer = (p, n) => { pages = n; return p <= 1 ? null : { text: `${p} / ${n}`, alignment: "center", fontSize: 8, color: GREY, margin: [85, 20, 42, 0] }; };
  const buffer = await pdfmake.createPdf(doc).getBuffer();
  return { buffer, pages };
}
module.exports = { buildPdf };
