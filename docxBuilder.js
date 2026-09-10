// build_docx_reference.js (mongol-business-plan skill)-ийн H1/H2/H3/P/Table helper-үүдийг
// ерөнхий "sections" массиваас баримт бичиг угсардаг байдлаар өргөтгөсөн хувилбар.
// MNS 5140:2021 стандартын дагуу: А4, margin 30/15/20/20мм, Arial 12pt, мөр хоорондын зай 1.15, Justify.

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, AlignmentType, PageNumber, Header, Footer, ImageRun,
  TabStopType, LeaderType, TableOfContents, PageBreak,
} = require("docx");

const DEFAULT_ACCENT = "1F6F3E";
const DEFAULT_ACCENT2 = "2E7D32";
const GREY = "595959";

// MNS 5140:2021 хуудасны хэмжээс (twips, 1мм ≈ 56.7 twips)
const A4 = { width: 11906, height: 16838 }; // 210mm x 297mm
const OFFICIAL_MARGIN = { top: 1134, bottom: 1134, left: 1701, right: 850 }; // 20/20/30/15мм

function makeHelpers(accent, accent2) {
  function H1(text) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120, line: 276 },
      children: [new TextRun({ text, bold: true, color: accent, size: 28 })],
    });
  }
  function H2(text) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 120, line: 276 },
      children: [new TextRun({ text, bold: true, color: accent2, size: 24 })],
    });
  }
  function H3(text) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 100, line: 276 },
      children: [new TextRun({ text, bold: true, color: accent2, size: 24 })],
    });
  }
  function P(text, opts = {}) {
    return new Paragraph({
      spacing: { after: 120, line: 276 }, alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({ text: String(text), size: 24, ...opts })],
    });
  }
  function Bullet(text) {
    return new Paragraph({
      spacing: { after: 80, line: 276 }, bullet: { level: 0 },
      children: [new TextRun({ text: String(text), size: 24 })],
    });
  }
  function Note(text) {
    return new Paragraph({
      spacing: { after: 200, line: 276 },
      children: [new TextRun({ text: String(text), size: 20, italics: true, color: GREY })],
    });
  }
  function cell(text, opts = {}) {
    const { bold = false, shade = null, width = 2000, color = "000000", align = AlignmentType.LEFT, size = 20 } = opts;
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: shade ? { type: ShadingType.CLEAR, fill: shade } : undefined,
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: [new Paragraph({ alignment: align, children: [new TextRun({ text: String(text), bold, size, color })] })],
    });
  }
  function makeTable(headers, rows, widths) {
    const w = widths && widths.length === headers.length ? widths : headers.map(() => Math.floor(9350 / headers.length));
    return new Table({
      width: { size: w.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: w,
      rows: [
        new TableRow({
          tableHeader: true,
          children: headers.map((h, i) => cell(h, { bold: true, shade: accent, color: "FFFFFF", width: w[i], align: AlignmentType.CENTER })),
        }),
        ...rows.map((r, ri) => new TableRow({
          children: r.map((c, i) => cell(c, { width: w[i], shade: ri % 2 === 1 ? "F2F7F2" : null, align: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT })),
        })),
      ],
    });
  }
  return { H1, H2, H3, P, Bullet, Note, makeTable };
}

function quickChartUrl(cfg) {
  // cfg: {type, title, labels, series:[{name,values}], values, y_label, accent_color, accent_color2}
  const palette = [cfg.accent_color || DEFAULT_ACCENT, cfg.accent_color2 || DEFAULT_ACCENT2, "#2E6F9E", "#8B3E5E", "#6B6B6B"].map((c) => (c.startsWith("#") ? c : `#${c}`));
  let chartJsConfig;
  if (cfg.type === "pie") {
    chartJsConfig = {
      type: "pie",
      data: {
        labels: cfg.labels,
        datasets: [{ data: cfg.values, backgroundColor: palette }],
      },
      options: {
        plugins: {
          title: { display: !!cfg.title, text: cfg.title || "", font: { size: 18, weight: "bold" } },
          legend: { position: "bottom" },
        },
      },
    };
  } else {
    const type = cfg.type === "bar" ? "bar" : "line";
    chartJsConfig = {
      type,
      data: {
        labels: cfg.labels,
        datasets: (cfg.series || []).map((s, i) => ({
          label: s.name,
          data: s.values,
          backgroundColor: type === "bar" ? palette[i % palette.length] : "transparent",
          borderColor: palette[i % palette.length],
          borderWidth: 3,
          pointRadius: 4,
          fill: false,
          tension: 0.15,
        })),
      },
      options: {
        plugins: {
          title: { display: !!cfg.title, text: cfg.title || "", font: { size: 18, weight: "bold" } },
          legend: { display: (cfg.series || []).length > 1, position: "bottom" },
        },
        scales: {
          y: { title: { display: !!cfg.y_label, text: cfg.y_label || "" } },
        },
      },
    };
  }
  const encoded = encodeURIComponent(JSON.stringify(chartJsConfig));
  return `https://quickchart.io/chart?width=900&height=500&devicePixelRatio=2&backgroundColor=white&format=png&c=${encoded}`;
}

async function fetchChartImage(cfg) {
  const url = quickChartUrl(cfg);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`QuickChart дуудлага амжилтгүй (${res.status}): ${cfg.title || cfg.type}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

function buildCoverPage(meta) {
  const children = [];
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 400 },
    children: [new TextRun({ text: (meta.org_name || "").toUpperCase(), bold: true, size: 28 })],
  }));
  if (meta.approved_by) {
    children.push(new Paragraph({
      alignment: AlignmentType.RIGHT, spacing: { after: 40 },
      children: [new TextRun({ text: "БАТАЛГААЖУУЛСАН:", bold: true, size: 22 })],
    }));
    children.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 20 }, children: [new TextRun({ text: `Албан тушаал: ${meta.approved_by.position || "....................."}`, size: 20 })] }));
    children.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 20 }, children: [new TextRun({ text: "Гарын үсэг: _______________", size: 20 })] }));
    children.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 600 }, children: [new TextRun({ text: `Нэр: ${meta.approved_by.name || "....................."}      Огноо: ${meta.approved_by.date || "....................."}`, size: 20 })] }));
  }
  for (let i = 0; i < 6; i++) children.push(new Paragraph({ text: "" }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: meta.doc_title || "БИЗНЕС ТӨСӨЛ", bold: true, size: 48 })],
  }));
  if (meta.project_name) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: meta.project_name, size: 28, bold: true })] }));
  }
  if (meta.location) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [new TextRun({ text: meta.location, size: 24 })] }));
  }
  for (let i = 0; i < 8; i++) children.push(new Paragraph({ text: "" }));
  if (meta.implementer || meta.phone) {
    children.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 40 }, children: [new TextRun({ text: `Хэрэгжүүлэгч: ${meta.implementer || ""}`, size: 20 })] }));
    children.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 400 }, children: [new TextRun({ text: `Утас: ${meta.phone || ""}`, size: 20 })] }));
  }
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: meta.city_year || "Улаанбаатар хот, 2026 он", size: 24 })],
  }));
  return children;
}

/**
 * @param {object} payload
 * @param {object} payload.meta
 * @param {Array} payload.sections - typed blocks: h1/h2/h3/p/bullet/note/table/chart/pagebreak
 * @returns {Promise<Buffer>}
 */
async function buildDocx(payload) {
  const meta = payload.meta || {};
  const accent = (meta.accent_color || DEFAULT_ACCENT).replace(/^#/, "");
  const accent2 = (meta.accent_color2 || DEFAULT_ACCENT2).replace(/^#/, "");
  const { H1, H2, H3, P, Bullet, Note, makeTable } = makeHelpers(accent, accent2);

  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const bodyChildren = [];

  for (const block of sections) {
    const type = block.type;
    try {
      if (type === "h1") bodyChildren.push(H1(block.text));
      else if (type === "h2") bodyChildren.push(H2(block.text));
      else if (type === "h3") bodyChildren.push(H3(block.text));
      else if (type === "p" || type === "paragraph") bodyChildren.push(P(block.text));
      else if (type === "bullet") bodyChildren.push(Bullet(block.text));
      else if (type === "note") bodyChildren.push(Note(block.text));
      else if (type === "table") bodyChildren.push(makeTable(block.headers, block.rows, block.widths));
      else if (type === "pagebreak") bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));
      else if (type === "chart") {
        const imgBuf = await fetchChartImage(Object.assign({ accent_color: accent, accent_color2: accent2 }, block));
        bodyChildren.push(new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 160 },
          children: [new ImageRun({ data: imgBuf, transformation: { width: block.width || 480, height: block.height || 270 } })],
        }));
        if (block.source_note) bodyChildren.push(Note(block.source_note));
      } else {
        // Тодорхойгүй төрөл — параграф болгон текстээр оруулна (алдагдахгүй байх зорилготой fallback)
        if (block.text) bodyChildren.push(P(String(block.text)));
      }
    } catch (e) {
      bodyChildren.push(Note(`[Санамж: "${block.title || block.text || type}" хэсгийг оруулахад алдаа гарлаа — ${e.message}]`));
    }
  }

  const header = new Header({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: meta.header_right || `${meta.company_name || ""} — Бизнес төсөл`, size: 16, color: GREY })],
    })],
  });
  const footer = new Footer({
    children: [new Paragraph({
      tabStops: [{ type: "right", position: 9600 }],
      children: [
        new TextRun({ text: meta.footer_left || meta.implementer || "", size: 16, color: GREY }),
        new TextRun({ text: "\tХуудас ", size: 16, color: GREY }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY }),
      ],
    })],
  });
  const bodyPage = { size: A4, margin: Object.assign({}, OFFICIAL_MARGIN, { top: 1000, bottom: 1000 }) };

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial" } } } },
    sections: [
      {
        properties: { page: { size: A4, margin: OFFICIAL_MARGIN } },
        children: buildCoverPage(meta),
      },
      {
        properties: { page: bodyPage },
        headers: { default: header }, footers: { default: footer },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text: "ГАРЧИГ", bold: true, size: 32, color: accent })] }),
          new TableOfContents("Гарчиг", { hyperlink: true, headingStyleRange: "1-3" }),
          new Paragraph({ children: [new PageBreak()] }),
        ],
      },
      {
        properties: { page: bodyPage },
        headers: { default: header }, footers: { default: footer },
        children: bodyChildren,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildDocx, fetchChartImage, quickChartUrl };
