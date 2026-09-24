// Утсан дээр уншихад зориулсан PDF: гарчиг бодит хуудасны дугаартай (pdfmake toc), LibreOffice шаардлагагүй.
const path = require("path");
const pdfmake = require("pdfmake");
const OUTLINE = require("./outline");
// Times New Roman-той ижил хэмжээст Tinos фонт (кирилл, Ө, Ү, ₮ дэмжинэ)
const FD = path.dirname(require.resolve("@expo-google-fonts/tinos/package.json")) + "/";
pdfmake.setFonts({ DejaVu: { normal: FD + "400Regular/Tinos_400Regular.ttf", bold: FD + "700Bold/Tinos_700Bold.ttf", italics: FD + "400Regular_Italic/Tinos_400Regular_Italic.ttf", bolditalics: FD + "700Bold_Italic/Tinos_700Bold_Italic.ttf" } });
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
    else if (b.type === "chart") { const c = ctx.charts[b.key]; if (c) { out.push({ image: "data:image/png;base64," + c.buf.toString("base64"), width: 400, alignment: "center", margin: [0, 6, 0, b.source ? 2 : 10] }); if (b.source) out.push({ text: `Эх сурвалж: ${b.source}`, italics: true, fontSize: 9, color: GREY, alignment: "center", margin: [0, 0, 0, 10] }); } }
    else if (b.type === "flow") {
      const steps = (b.steps || []).map(String).filter(Boolean).slice(0, 10); if (!steps.length) continue;
      const box = (s, i) => ({ stack: [{ text: String(i + 1), bold: true, color: GOLD, alignment: "center" }, { text: s, fontSize: 9.5, alignment: "center" }], fillColor: "#F3F0E6", margin: [3, 4, 3, 4], border: [true, true, true, true] });
      const per = steps.length <= 5 ? steps.length : Math.ceil(steps.length / 2);
      const stack = b.title ? [{ text: b.title, bold: true, color: NAVY, fontSize: 10.5, alignment: "center", margin: [0, 8, 0, 4] }] : [];
      for (let r = 0; r < steps.length; r += per) {
        if (r) stack.push({ text: "↓", bold: true, color: GOLD, fontSize: 14, alignment: "center" });
        const row = [], widths = [];
        steps.slice(r, r + per).forEach((s, j) => { if (j) { row.push({ text: "→", bold: true, color: GOLD, fontSize: 14, alignment: "center", margin: [0, 10, 0, 0], border: [false, false, false, false] }); widths.push(14); } row.push(box(s, r + j)); widths.push("*"); });
        stack.push({ table: { widths, body: [row] }, layout: { hLineColor: NAVY, vLineColor: NAVY } });
      }
      out.push({ stack, unbreakable: true, margin: [0, 0, 0, 10] });
    }
    else if (b.type === "org") {
      const units = (b.units || []).slice(0, 5); if (!units.length) continue;
      const org = [];
      if (b.title) org.push({ text: b.title, bold: true, color: NAVY, fontSize: 10.5, alignment: "center", margin: [0, 8, 0, 4] });
      org.push({ columns: [{ width: "*", text: "" }, { width: 200, table: { widths: ["*"], body: [[{ text: String(b.head || "Гүйцэтгэх захирал").toUpperCase(), bold: true, color: "white", fillColor: NAVY, alignment: "center", margin: [0, 5, 0, 5] }]] }, layout: "noBorders" }, { width: "*", text: "" }] });
      org.push({ text: "↓", bold: true, color: GOLD, fontSize: 14, alignment: "center" });
      org.push({ table: { widths: units.map(() => "*"), body: [units.map(u => ({ stack: [{ text: String(u.name || ""), bold: true, color: NAVY, alignment: "center", margin: [0, 0, 0, 3] }, ...(u.roles || []).map(r => ({ text: String(r), fontSize: 9, alignment: "center" }))], fillColor: "#F3F0E6", margin: [3, 5, 3, 5] }))] }, layout: { hLineColor: NAVY, vLineColor: NAVY } });
      out.push({ stack: org, unbreakable: true, margin: [0, 0, 0, 10] });
    }
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
    defaultStyle: { font: "DejaVu", fontSize: 12, lineHeight: 1.15 },
    styles: { h1: { fontSize: 15, bold: true, color: NAVY, margin: [0, 0, 0, 10] }, h2: { fontSize: 13, bold: true, color: NAVY, margin: [0, 10, 0, 6] }, h3: { fontSize: 11.5, bold: true, color: "#8A6D12", margin: [0, 8, 0, 4] } },
    header: (p) => p <= 1 ? null : { text: `${A.company.name} — Бизнес төсөл`, alignment: "right", fontSize: 8, color: GREY, margin: [85, 25, 42, 0] },
    footer: (p, n) => p <= 1 ? null : { columns: [{ text: A.company.name, fontSize: 8, color: GREY }, { text: `Хуудас ${p} / ${n}`, alignment: "right", fontSize: 8, color: GREY }], margin: [85, 20, 42, 0] },
    info: { title: `${A.company.name} — Бизнес төсөл` },
  };
  const buffer = await pdfmake.createPdf(doc).getBuffer();
  return { buffer };
}
module.exports = { buildPdf };
