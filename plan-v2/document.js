// Блокуудыг MNS 5140:2021 стандартын Word баримт бичиг болгоно.
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType,
  ImageRun, Header, Footer, PageNumber, TabStopType, LeaderType, TableOfContents } = require("docx");
const OUTLINE = require("./outline");
const NAVY = "1B2A4A", GOLD = "C9A227", GREY = "595959", LIGHT = "F3F0E6", W = 9300;
const A4 = { width: 11906, height: 16838 }, MARGIN = { top: 1134, bottom: 1134, left: 1701, right: 850 };

const FONT = "Times New Roman";
const runs = (t, base = {}) => String(t ?? "").split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(p => p.startsWith("**") ? new TextRun({ text: p.slice(2, -2), bold: true, size: 24, ...base }) : new TextRun({ text: p, size: 24, ...base }));
const H = (lvl, text, heads) => { heads.push({ lvl, text });
  return new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][lvl - 1], pageBreakBefore: lvl === 1, keepNext: true,
    spacing: { before: lvl === 1 ? 120 : 220, after: 120 }, border: lvl === 1 ? { bottom: { style: "single", size: 12, color: GOLD, space: 4 } } : undefined,
    children: [new TextRun({ text, bold: true, color: lvl === 3 ? "8A6D12" : NAVY, size: [30, 26, 24][lvl - 1] })] }); };
const Pp = (t) => new Paragraph({ spacing: { after: 120, line: 276 }, alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 567 }, children: runs(t) });
const cellP = (t, o) => String(t ?? "").split("\n").map(line => new Paragraph({ alignment: o.align, spacing: { after: 20 }, children: [new TextRun({ text: line, bold: o.bold, size: 19, color: o.color || "000000" })] }));

function table(b) {
  const n = b.headers.length;
  const widths = n === 1 ? [W] : n === 2 ? [Math.round(W * 0.35), W - Math.round(W * 0.35)] : (() => { const first = Math.round(W * (n > 5 ? 0.24 : 0.3)); const rest = Math.floor((W - first) / (n - 1)); return [first, ...Array(n - 1).fill(rest)]; })();
  const textCols = new Set([0, ...(b.left || [])]);
  const isText = (c, i) => textCols.has(i) || isNaN(String(c).replace(/[,%₮\s\-−—.\/×]/g, "").replace(/жил|сая/g, "")) || String(c).length > 22;
  const mk = (c, i, o) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, margins: { top: 50, bottom: 50, left: 90, right: 90 },
    shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade } : undefined, children: cellP(c, o) });
  const rows = [new TableRow({ tableHeader: true, children: b.headers.map((h, i) => mk(h, i, { bold: true, shade: NAVY, color: "FFFFFF", align: AlignmentType.CENTER })) })];
  (b.rows || []).forEach((r, ri) => {
    const tot = String(r[0] ?? "").startsWith("!");
    const cells = Array.from({ length: n }, (_, i) => r[i] ?? "");
    rows.push(new TableRow({ cantSplit: true, children: cells.map((c, i) => mk(i === 0 && tot ? String(c).slice(1) : c, i, { bold: tot, shade: tot ? "E8E0C4" : (ri % 2 ? "F6F4EE" : null), align: isText(c, i) ? AlignmentType.LEFT : AlignmentType.RIGHT })) }));
  });
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, rows });
}

function renderBlocks(blocks, ctx) {
  const out = [];
  for (const b of blocks || []) {
    if (!b || !b.type) continue;
    switch (b.type) {
      case "p": out.push(Pp(b.text)); break;
      case "h3": out.push(H(3, b.text, ctx.heads)); break;
      case "bullets": for (const it of b.items || []) out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80, line: 276 }, alignment: AlignmentType.JUSTIFIED, children: runs(it) })); break;
      case "numbered": (b.items || []).forEach((it, i) => out.push(new Paragraph({ indent: { left: 567, hanging: 340 }, spacing: { after: 80, line: 276 }, alignment: AlignmentType.JUSTIFIED, children: [new TextRun({ text: `${i + 1}. `, bold: true, size: 24, color: NAVY }), ...runs(it)] }))); break;
      case "note": out.push(new Paragraph({ spacing: { before: 60, after: 200 }, children: [new TextRun({ text: b.text, size: 18, italics: true, color: GREY })] })); break;
      case "box": out.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [W], rows: [new TableRow({ children: [new TableCell({ width: { size: W, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: LIGHT }, margins: { top: 140, bottom: 140, left: 200, right: 200 },
        borders: { left: { style: "single", size: 24, color: GOLD }, top: { style: "nil" }, bottom: { style: "nil" }, right: { style: "nil" } },
        children: [new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: b.title || "", bold: true, size: 22, color: NAVY })] }), ...String(b.text || "").split("\n").map(t => new Paragraph({ spacing: { after: 60 }, alignment: AlignmentType.JUSTIFIED, children: runs(t, { size: 22 }) }))] })] })] }), new Paragraph({ spacing: { after: 120 }, children: [] })); break;
      case "table":
        if (!Array.isArray(b.headers) || !b.headers.length) break;
        ctx.tableNo++;
        out.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 }, children: [new TextRun({ text: `Хүснэгт ${ctx.tableNo}. ${b.caption || ""}`, bold: true, size: 20, color: NAVY })] }));
        out.push(table(b), new Paragraph({ spacing: { after: 160 }, children: [] })); break;
      case "chart": {
        const c = ctx.charts[b.key]; if (!c) break;
        const w = 520, h = Math.round(w * c.height / c.width);
        out.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: !!b.source, spacing: { before: 120, after: b.source ? 40 : 120 }, children: [new ImageRun({ type: "png", data: c.buf, transformation: { width: w, height: h } })] }));
        if (b.source) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: `Эх сурвалж: ${b.source}`, size: 18, italics: true, color: GREY })] }));
        break;
      }
      case "flow": {
        const steps = (b.steps || []).map(String).filter(Boolean).slice(0, 10); if (!steps.length) break;
        if (b.title) out.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 }, children: [new TextRun({ text: b.title, bold: true, size: 20, color: NAVY })] }));
        const box = (t, i, wdt) => new TableCell({ width: { size: wdt, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: LIGHT }, margins: { top: 80, bottom: 80, left: 80, right: 80 },
          borders: { top: { style: "single", size: 8, color: NAVY }, bottom: { style: "single", size: 8, color: NAVY }, left: { style: "single", size: 8, color: NAVY }, right: { style: "single", size: 8, color: NAVY } },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${i + 1}`, bold: true, size: 20, color: GOLD })] }), new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, size: 18 })] })] });
        const arrow = (sym, wdt) => new TableCell({ width: { size: wdt, type: WidthType.DXA }, borders: { top: { style: "nil" }, bottom: { style: "nil" }, left: { style: "nil" }, right: { style: "nil" } }, verticalAlign: "center",
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sym, bold: true, size: 28, color: GOLD })] })] });
        const per = steps.length <= 5 ? steps.length : Math.ceil(steps.length / 2);
        for (let r = 0; r < steps.length; r += per) {
          const part = steps.slice(r, r + per);
          if (r) out.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, children: [new TextRun({ text: "↓", bold: true, size: 28, color: GOLD })] }));
          const aw = 360, bw = Math.floor((W - aw * (part.length - 1)) / part.length);
          const cells = [], widths = [];
          part.forEach((s, j) => { if (j) { cells.push(arrow("→", aw)); widths.push(aw); } cells.push(box(s, r + j, bw)); widths.push(bw); });
          out.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, rows: [new TableRow({ cantSplit: true, children: cells })] }));
        }
        out.push(new Paragraph({ spacing: { after: 160 }, children: [] })); break;
      }
      case "org": {
        const units = (b.units || []).slice(0, 5); if (!units.length) break;
        if (b.title) out.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 }, children: [new TextRun({ text: b.title, bold: true, size: 20, color: NAVY })] }));
        out.push(new Table({ width: { size: 3600, type: WidthType.DXA }, columnWidths: [3600], alignment: AlignmentType.CENTER, rows: [new TableRow({ children: [new TableCell({ width: { size: 3600, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: NAVY }, margins: { top: 100, bottom: 100, left: 100, right: 100 },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(b.head || "Гүйцэтгэх захирал").toUpperCase(), bold: true, size: 20, color: "FFFFFF" })] })] })] })] }));
        out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: "↓", bold: true, size: 28, color: GOLD })] }));
        const uw = Math.floor(W / units.length);
        out.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: units.map(() => uw), rows: [new TableRow({ cantSplit: true, children: units.map(u => new TableCell({ width: { size: uw, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: LIGHT }, margins: { top: 80, bottom: 80, left: 80, right: 80 },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: String(u.name || ""), bold: true, size: 19, color: NAVY })] }), ...(u.roles || []).map(r => new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(r), size: 17 })] }))] })) })] }));
        out.push(new Paragraph({ spacing: { after: 160 }, children: [] })); break;
      }
    }
  }
  return out;
}

function cover(A) {
  const big = (t, size, color = NAVY, bold = true, after = 200) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after }, children: [new TextRun({ text: t, bold, size, color })] });
  return [
    big(A.company.name.toUpperCase(), 32, NAVY, true, 400),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "БАТАЛГААЖУУЛСАН:", bold: true, size: 22 })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Гүйцэтгэх захирал ______________", size: 22 })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 2400 }, children: [new TextRun({ text: "Огноо: ____/____/______", size: 22 })] }),
    big("БИЗНЕС ТӨСӨЛ", 72, NAVY, true, 300),
    big(A.project.title, 30, "333333", false, 500),
    new Paragraph({ alignment: AlignmentType.CENTER, border: { top: { style: "single", size: 18, color: GOLD, space: 8 } }, spacing: { after: 200 }, children: [] }),
    big(`Зээлийн хүсэлт: ${Math.round(A.loan.amount).toLocaleString("en-US")} ₮ · ${A.loan.months} сар`, 26),
    big(`Санхүүжүүлэгч: ${A.project.funder || "—"}`, 24, GREY, false),
    big(`Байршил: ${A.project.location || "—"}`, 24, GREY, false, 3000),
    big(`Улаанбаатар хот, ${new Date().getFullYear()} он`, 26),
  ];
}

async function buildDoc({ A, written, fin, charts, pages }) {
  const ctx = { heads: [], tableNo: 0, charts };
  const body = [];
  for (const o of OUTLINE) {
    body.push(H(o.lvl, o.t, ctx.heads));
    body.push(...renderBlocks(written[o.id], ctx));
    for (const key of o.attach || []) {
      if (key.startsWith("chart:")) body.push(...renderBlocks([{ type: "chart", key: key.slice(6) }], ctx));
      else if (key === "sources") body.push(...renderBlocks([{ type: "bullets", items: fin.sources }], ctx));
      else body.push(...renderBlocks(fin.blocks[key], ctx));
    }
  }
  const header = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, border: { bottom: { style: "single", size: 4, color: GOLD, space: 2 } }, children: [new TextRun({ text: `${A.company.name} — Бизнес төсөл`, size: 16, color: GREY })] })] });
  const footer = new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: W }], children: [new TextRun({ text: `${A.company.name}${A.company.phone ? ", " + A.company.phone : ""}`, size: 16, color: GREY }), new TextRun({ text: "\tХуудас ", size: 16, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY })] })] });
  const tocTitle = new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text: "ГАРЧИГ", bold: true, size: 32, color: NAVY })] });
  const toc = pages
    ? ctx.heads.map((hd, i) => new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: W, leader: LeaderType.DOT }], indent: { left: (hd.lvl - 1) * 400 }, spacing: { before: hd.lvl === 1 ? 120 : 0, after: 40 },
      children: [new TextRun({ text: hd.text, bold: hd.lvl === 1, size: hd.lvl === 3 ? 20 : 22, color: hd.lvl === 1 ? NAVY : "000000" }), new TextRun({ text: `\t${pages[i] ?? ""}`, bold: hd.lvl === 1, size: hd.lvl === 3 ? 20 : 22 })] }))
    : [new TableOfContents("Гарчиг", { hyperlink: true, headingStyleRange: "1-3" })];
  const doc = new Document({ styles: { default: { document: { run: { font: FONT } }, heading1: { run: { font: FONT } }, heading2: { run: { font: FONT } }, heading3: { run: { font: FONT } } } }, features: { updateFields: !pages },
    sections: [
      { properties: { page: { size: A4, margin: MARGIN } }, children: cover(A) },
      { properties: { page: { size: A4, margin: MARGIN } }, headers: { default: header }, footers: { default: footer }, children: [tocTitle, ...toc] },
      { properties: { page: { size: A4, margin: MARGIN } }, headers: { default: header }, footers: { default: footer }, children: body },
    ] });
  return { buffer: await Packer.toBuffer(doc), heads: ctx.heads, tables: ctx.tableNo };
}
module.exports = { buildDoc };
