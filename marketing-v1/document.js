// Блокуудыг Word баримт бичиг болгоно (MNS 5140:2021 зах, Times New Roman). Өнгийг параметрээр (th) авна — модулийн төлөвгүй.
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType,
  ImageRun, Header, Footer, PageNumber, TableOfContents, LevelFormat, BorderStyle, VerticalAlign } = require("docx");
const OUTLINE = require("./outline");
const FONT = "Times New Roman", GREY = "595959", W = 9355;
const A4 = { width: 11906, height: 16838 }, MARGIN = { top: 1134, bottom: 1134, left: 1701, right: 850 };
const isNum = (c) => /^[\s\-−—+]*[\d\s.,]+\s*(%|₮|×)?\s*$/.test(String(c)) && /\d/.test(String(c));

function runs(t, o = {}) {
  const out = [];
  String(t ?? "").split("**").forEach((p, i) => { if (p !== "") out.push(new TextRun({ text: p, bold: !!o.bold || i % 2 === 1, size: o.size || 24, color: o.color, italics: o.italics, font: FONT })); });
  return out.length ? out : [new TextRun({ text: "", size: o.size || 24, font: FONT })];
}

async function buildDoc({ A, written, fin, charts, th, meta }) {
  const P1 = th.primary, P2 = th.accent, LIGHT = th.light, TOT = th.tot || th.light;
  const heads = []; let tableNo = 0, figNo = 0;
  const H = (lvl, text) => { if (lvl < 3) heads.push({ lvl, text });
    return new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][lvl - 1], pageBreakBefore: lvl === 1, keepNext: true,
      spacing: { before: lvl === 1 ? 0 : lvl === 2 ? 280 : 200, after: lvl === 1 ? 240 : lvl === 2 ? 140 : 100 }, children: [new TextRun({ text, bold: true, color: lvl === 3 ? P2 : P1, size: [30, 26, 24][lvl - 1], font: FONT })] }); };
  const Pp = (t) => new Paragraph({ spacing: { after: 140, line: 276 }, alignment: AlignmentType.JUSTIFIED, children: runs(t) });
  const cellPs = (t, o) => String(t ?? "").split("\n").map(line => new Paragraph({ alignment: o.align, spacing: { after: 20 }, children: runs(line, { size: o.size, bold: o.bold, color: o.color }) }));
  const caption = (t) => new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 80 }, children: [new TextRun({ text: t, bold: true, size: 20, color: P1, font: FONT })] });
  const gap = () => new Paragraph({ spacing: { after: 140 }, children: [] });

  function table(b) {
    const n = b.headers.length; let pct = b.widths && b.widths.length === n ? b.widths : (n === 1 ? [100] : n === 2 ? [35, 65] : [n > 5 ? 24 : 30, ...Array(n - 1).fill((100 - (n > 5 ? 24 : 30)) / (n - 1))]);
    const tot = pct.reduce((a, c) => a + c, 0); const widths = pct.map(p => Math.floor(W * p / tot)); widths[n - 1] += W - widths.reduce((a, c) => a + c, 0);
    const headless = b.headers.every(h => !String(h).trim()), size = b.small || n > 7 ? 17 : n > 5 ? 18 : 20;
    const mk = (c, i, o) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 55, bottom: 55, left: 90, right: 90 },
      shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined, children: cellPs(c, { size, bold: o.bold, color: o.color, align: o.align }) });
    const rows = [];
    if (!headless) rows.push(new TableRow({ tableHeader: true, cantSplit: true, children: b.headers.map((h, i) => mk(h, i, { fill: P1, bold: true, color: "FFFFFF", align: AlignmentType.CENTER })) }));
    b.rows.forEach((r, ri) => { const isTot = String(r[0] ?? "").startsWith("!");
      rows.push(new TableRow({ cantSplit: true, children: Array.from({ length: n }, (_, i) => { let c = r[i] ?? ""; if (i === 0 && isTot) c = String(c).slice(1);
        return mk(c, i, { fill: isTot ? TOT : ri % 2 ? LIGHT : undefined, bold: isTot || (headless && i === 0), align: i > 0 && isNum(c) ? AlignmentType.RIGHT : AlignmentType.LEFT }); }) })); });
    const out = [];
    if (b.caption) { tableNo++; out.push(caption(`Хүснэгт ${tableNo}. ${b.caption}`)); }
    out.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, rows }), gap());
    return out;
  }
  function gantt(b) {
    const P = b.periods.length, first = Math.floor(W * 0.3), cw = Math.floor((W - first) / P), widths = [first, ...Array(P).fill(cw)]; widths[P] += W - widths.reduce((a, c) => a + c, 0);
    const cell = (t, i, o = {}) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 50, bottom: 50, left: 60, right: 60 },
      shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined, children: [new Paragraph({ alignment: o.align, children: runs(t, { size: o.size || 16, bold: o.bold, color: o.color }) })] });
    const rows = [new TableRow({ tableHeader: true, children: [cell("Ажил", 0, { fill: P1, bold: true, color: "FFFFFF", size: 17 }), ...b.periods.map((p, i) => cell(p, i + 1, { fill: P1, bold: true, color: "FFFFFF", size: P > 9 ? 13 : 15, align: AlignmentType.CENTER }))] })];
    b.tasks.forEach((t, k) => rows.push(new TableRow({ cantSplit: true, children: [cell(t.name, 0, { size: 17 }), ...b.periods.map((_, i) => cell("", i + 1, { fill: i >= t.start && i < t.end ? (k % 2 ? P2 : P1) : undefined }))] })));
    figNo++;
    return [new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, rows }), new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 200 }, children: [new TextRun({ text: `Зураг ${figNo}. ${b.title}`, size: 20, italics: true, color: GREY, font: FONT })] })];
  }
  function flow(b) {
    const n = b.steps.length, aw = 300, bw = Math.floor((W - aw * (n - 1)) / n), widths = []; b.steps.forEach((_, i) => { if (i) widths.push(aw); widths.push(bw); }); widths[widths.length - 1] += W - widths.reduce((a, c) => a + c, 0);
    const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, cells = []; let wi = 0;
    b.steps.forEach((s, i) => {
      if (i) cells.push(new TableCell({ width: { size: widths[wi++], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, borders: { top: none, bottom: none, left: none, right: none }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: runs("→", { bold: true, color: P2, size: 26 }) })] }));
      cells.push(new TableCell({ width: { size: widths[wi++], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, margins: { top: 90, bottom: 90, left: 60, right: 60 }, shading: { type: ShadingType.CLEAR, fill: LIGHT, color: "auto" },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: runs(String(i + 1), { bold: true, color: P2, size: 20 }) }), new Paragraph({ alignment: AlignmentType.CENTER, children: runs(s, { size: n > 5 ? 17 : 19 }) })] }));
    });
    figNo++;
    return [new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, rows: [new TableRow({ cantSplit: true, children: cells })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 200 }, children: [new TextRun({ text: `Зураг ${figNo}. ${b.title || "Урсгал"}`, size: 20, italics: true, color: GREY, font: FONT })] })];
  }
  function blocks(list) {
    const out = [];
    for (const b of list || []) {
      if (b.type === "p") out.push(Pp(b.text));
      else if (b.type === "h3") out.push(H(3, b.text));
      else if (b.type === "bullets") b.items.forEach(t => out.push(new Paragraph({ numbering: { reference: "bul", level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 80, line: 276 }, children: runs(t) })));
      else if (b.type === "numbered") b.items.forEach((t, i) => out.push(new Paragraph({ indent: { left: 500, hanging: 360 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 80, line: 276 }, children: runs(`**${i + 1}.** ${t}`) })));
      else if (b.type === "checklist") b.items.forEach(t => out.push(new Paragraph({ indent: { left: 400, hanging: 400 }, spacing: { after: 80, line: 276 }, children: runs("☐  " + t) })));
      else if (b.type === "tip" || b.type === "note") out.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 160, line: 276 }, indent: { left: 280 },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: P2, space: 10 } }, children: runs(b.text, { italics: true, color: GREY, size: 22 }) }));
      else if (b.type === "box") { const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
        out.push(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [W], rows: [new TableRow({ children: [new TableCell({ width: { size: W, type: WidthType.DXA }, margins: { top: 120, bottom: 120, left: 200, right: 200 },
          shading: { type: ShadingType.CLEAR, fill: LIGHT, color: "auto" }, borders: { top: none, bottom: none, right: none, left: { style: BorderStyle.SINGLE, size: 24, color: P2 } },
          children: [...(b.title ? [new Paragraph({ spacing: { after: 100 }, children: runs(b.title, { bold: true, color: P1 }) })] : []), ...String(b.text || "").split("\n").filter(Boolean).map(t => new Paragraph({ spacing: { after: 100, line: 276 }, children: runs(t, { size: 23 }) }))] })] })] }), gap()); }
      else if (b.type === "table") out.push(...table(b));
      else if (b.type === "gantt") out.push(...gantt(b));
      else if (b.type === "flow") out.push(...flow(b));
      else if (b.type === "chart") { const c = charts[b.key];
        if (c) { figNo++; const w = c.width >= 800 ? 440 : 380;
          out.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 140, after: 60 }, children: [new ImageRun({ type: "png", data: c.buf, transformation: { width: w, height: Math.round(w * c.height / c.width) } })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: `Зураг ${figNo}. ${c.title || ""}${b.source ? ". Эх сурвалж: " + b.source : ""}`, size: 20, italics: true, color: GREY, font: FONT })] }));
        } else if (b.fallback) out.push(...table(b.fallback)); }
    }
    return out;
  }
  const center = (t, o = {}) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: o.before || 0, after: o.after || 0 }, border: o.border,
    children: [new TextRun({ text: t, bold: o.bold, size: o.size || 24, color: o.color, italics: o.italics, font: FONT })] });
  const rule = { style: BorderStyle.SINGLE, size: 12, color: P2, space: 18 };
  const cover = [center(String(A.brand.name || "").toUpperCase(), { before: 1400, bold: true, size: 40, color: P1 })];
  if (A.brand.slogan) cover.push(center(A.brand.slogan, { before: 120, italics: true, color: P2 }));
  cover.push(center(meta.title, { before: 2600, bold: true, size: meta.title.length > 26 ? 40 : 52, color: P1, border: { top: rule } }));
  if (meta.subtitle) cover.push(center(meta.subtitle, { before: 240, size: 26 }));
  cover.push(center("Хамрах хугацаа: " + meta.period, { before: 400, color: GREY, border: { bottom: rule } }), center(meta.city, { before: 4200 }), center(meta.year, { before: 60 }));

  const body = [center("ГАРЧИГ", { bold: true, size: 30, color: P1, after: 240 }), new TableOfContents("Гарчиг", { hyperlink: true, headingStyleRange: "1-2" })];
  for (const o of OUTLINE) {
    body.push(H(o.lvl, o.t)); body.push(...blocks(written[o.id]));
    for (const key of o.attach || []) {
      if (key.startsWith("chart:")) body.push(...blocks([{ type: "chart", key: key.slice(6), source: "тооцоолол" }]));
      else if (key === "sources") body.push(...blocks([{ type: "bullets", items: fin.sources }]));
      else body.push(...blocks(fin.blocks[key]));
    }
  }
  const header = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P2, space: 4 } },
    children: [new TextRun({ text: meta.header, size: 17, color: GREY, font: FONT })] })] });
  const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: GREY, font: FONT })] })] });
  const doc = new Document({ features: { updateFields: true }, styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    numbering: { config: [{ reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 260 } } } }] }] },
    sections: [{ properties: { page: { size: A4, margin: MARGIN } }, children: cover },
      { properties: { page: { size: A4, margin: MARGIN } }, headers: { default: header }, footers: { default: footer }, children: body }] });
  return { buffer: await Packer.toBuffer(doc), heads, tables: tableNo, figures: figNo };
}
module.exports = { buildDoc };
