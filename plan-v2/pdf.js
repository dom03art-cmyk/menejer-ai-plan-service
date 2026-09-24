// Утсан дээр уншихад зориулсан PDF: гарчиг бодит хуудасны дугаартай (pdfmake toc), LibreOffice шаардлагагүй.
const path = require("path");
const pdfmake = require("pdfmake");
const OUTLINE = require("./outline");
const FD = path.dirname(require.resolve("dejavu-fonts-ttf/package.json")) + "/ttf/";
pdfmake.setFonts({ DejaVu: { normal: FD + "DejaVuSans.ttf", bold: FD + "DejaVuSans-Bold.ttf", italics: FD + "DejaVuSans-Oblique.ttf", bolditalics: FD + "DejaVuSans-BoldOblique.ttf" } });
pdfmake.setLocalAccessPolicy(p => p.startsWith(FD));
pdfmake.setUrlAccessPolicy(() => false);
const NAVY = "#1B2A4A", GOLD = "#C9A227", GREY = "#595959";

const rich = (t) => String(t ?? "").split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(p => p.startsWith("**") ? { text: p.slice(2, -2), bold: true } : p);
const isNum = (c) => /^[\s\-−—+]*[\d.,]+\s*(%|₮|×|жил|сая)?\s*$/.test(String(c));

function table(b, ctx) {
  const n = b.headers.length;
  const widths = n === 1 ? ["*"] : n === 2 ? ["35%", "*"] : [n > 5 ? "22%" : "28%", ...Array(n - 1).fill("*")];
  const fs = n > 6 ? 7.5 : n > 4 ? 8.5 : 9.5;
  const body = [b.headers.map(h => ({ text: String(h), bold: true, color: "white", fillColor: NAVY, alignment: "center", fontSize: fs }))];
  (b.rows || []).forEach((r, ri) => {
    const tot = String(r[0] ?? "").startsWith("!");
    body.push(Array.from({ length: n }, (_, i) => {
      let c = r[i] ?? ""; if (i === 0 && tot) c = String(c).slice(1);
      return { text: String(c), bold: tot, fontSize: fs, alignment: i > 0 && isNum(c) ? "right" : "left", fillColor: tot ? "#E8E0C4" : ri % 2 ? "#F6F4EE" : null };
    }));
  });
  ctx.tableNo++;
  return [{ text: `Хүснэгт ${ctx.tableNo}. ${b.caption || ""}`, bold: true, color: NAVY, fontSize: 10, alignment: "center", margin: [0, 8, 0, 4] },
    { table: { headerRows: 1, widths, body, dontBreakRows: true }, layout: { hLineColor: "#BBBBBB", vLineColor: "#BBBBBB", hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 2, paddingBottom: () => 2 }, margin: [0, 0, 0, 10] }];
}

function blocks(list, ctx) {
  const out = [];
  for (const b of list || []) {
    if (!b || !b.type) continue;
    if (b.type === "p") out.push({ text: rich(b.text), alignment: "justify", margin: [0, 0, 0, 6], leadingIndent: 20 });
    else if (b.type === "h3") out.push({ text: b.text, style: "h3", tocItem: true, tocMargin: [30, 0, 0, 0] });
    else if (b.type === "bullets") out.push({ ul: (b.items || []).map(rich), margin: [0, 0, 0, 6] });
    else if (b.type === "numbered") out.push({ ol: (b.items || []).map(rich), margin: [0, 0, 0, 6] });
    else if (b.type === "note") out.push({ text: b.text, italics: true, fontSize: 8.5, color: GREY, margin: [0, 2, 0, 10] });
    else if (b.type === "box") out.push({ table: { widths: ["*"], body: [[{ stack: [{ text: b.title || "", bold: true, color: NAVY, margin: [0, 0, 0, 4] }, ...String(b.text || "").split("\n").map(t => ({ text: rich(t), alignment: "justify" }))], fillColor: "#F3F0E6", margin: [8, 6, 8, 6] }]] },
      layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 3 : 0, vLineColor: GOLD }, margin: [0, 4, 0, 10] });
    else if (b.type === "table" && Array.isArray(b.headers) && b.headers.length) out.push(...table(b, ctx));
    else if (b.type === "chart") { const c = ctx.charts[b.key]; if (c) out.push({ image: "data:image/png;base64," + c.buf.toString("base64"), width: 400, alignment: "center", margin: [0, 6, 0, 10] }); }
  }
  return out;
}

async function buildPdf({ A, written, fin, charts }) {
  const ctx = { tableNo: 0, charts };
  const content = [
    { text: A.company.name.toUpperCase(), fontSize: 16, bold: true, color: NAVY, alignment: "center", margin: [0, 40, 0, 20] },
    { text: "БАТАЛГААЖУУЛСАН:\nГүйцэтгэх захирал ______________\nОгноо: ____/____/______", alignment: "right", fontSize: 10, margin: [0, 0, 0, 150] },
    { text: "БИЗНЕС ТӨСӨЛ", fontSize: 34, bold: true, color: NAVY, alignment: "center", margin: [0, 0, 0, 14] },
    { text: A.project.title, fontSize: 14, alignment: "center", margin: [0, 0, 0, 20] },
    { canvas: [{ type: "line", x1: 100, y1: 0, x2: 390, y2: 0, lineWidth: 2, lineColor: GOLD }], margin: [0, 0, 0, 14] },
    { text: `Зээлийн хүсэлт: ${Math.round(A.loan.amount).toLocaleString("en-US")} ₮ · ${A.loan.months} сар`, bold: true, alignment: "center", fontSize: 12 },
    { text: `Санхүүжүүлэгч: ${A.project.funder || "—"}\nБайршил: ${A.project.location || "—"}`, alignment: "center", color: GREY, fontSize: 11, margin: [0, 6, 0, 0] },
    { text: `Улаанбаатар хот, ${new Date().getFullYear()} он`, alignment: "center", bold: true, absolutePosition: { x: 0, y: 760 } },
    { toc: { title: { text: "ГАРЧИГ", style: "h1" }, numberStyle: { bold: false } }, pageBreak: "before" },
  ];
  for (const o of OUTLINE) {
    const st = ["h1", "h2", "h3"][o.lvl - 1];
    content.push({ text: o.t, style: st, tocItem: true, tocMargin: [(o.lvl - 1) * 15, 0, 0, 0], tocStyle: o.lvl === 1 ? { bold: true, color: NAVY } : {}, pageBreak: o.lvl === 1 ? "before" : undefined });
    content.push(...blocks(written[o.id], ctx));
    for (const key of o.attach || []) {
      if (key.startsWith("chart:")) content.push(...blocks([{ type: "chart", key: key.slice(6) }], ctx));
      else if (key === "sources") content.push(...blocks([{ type: "bullets", items: fin.sources }], ctx));
      else content.push(...blocks(fin.blocks[key], ctx));
    }
  }
  const doc = {
    pageSize: "A4", pageMargins: [85, 57, 42, 57], content,
    defaultStyle: { font: "DejaVu", fontSize: 10.5, lineHeight: 1.2 },
    styles: { h1: { fontSize: 15, bold: true, color: NAVY, margin: [0, 0, 0, 10] }, h2: { fontSize: 13, bold: true, color: NAVY, margin: [0, 10, 0, 6] }, h3: { fontSize: 11.5, bold: true, color: "#8A6D12", margin: [0, 8, 0, 4] } },
    header: (p) => p <= 1 ? null : { text: `${A.company.name} — Бизнес төсөл`, alignment: "right", fontSize: 8, color: GREY, margin: [85, 25, 42, 0] },
    footer: (p, n) => p <= 1 ? null : { columns: [{ text: A.company.name, fontSize: 8, color: GREY }, { text: `Хуудас ${p} / ${n}`, alignment: "right", fontSize: 8, color: GREY }], margin: [85, 20, 42, 0] },
    info: { title: `${A.company.name} — Бизнес төсөл` },
  };
  const buffer = await pdfmake.createPdf(doc).getBuffer();
  return { buffer };
}
module.exports = { buildPdf };
