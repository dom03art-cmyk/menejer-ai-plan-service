'use strict';
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType,
  HeadingLevel, ShadingType, BorderStyle, PageNumber, Footer, Header, PageBreak, TableOfContents,
} = require('docx');
const { amountToWords, fmt } = require('./calc');

const FONT = 'Times New Roman';
const W = 9355; // A4, зүүн 30мм, баруун 15мм
const MISSING = '[ДУТУУ]';

const run = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: FONT, size: o.size || 24, bold: o.bold, italics: o.italics, color: o.color });
const p = (text, o = {}) => new Paragraph({
  alignment: o.align || AlignmentType.JUSTIFIED,
  spacing: { after: o.after ?? 120, line: 276 },
  indent: o.indent ? { firstLine: 567 } : undefined,
  children: Array.isArray(text) ? text : [run(text, o)],
});
let TOC = null;
const h1 = (t) => (TOC && TOC.push(t), 0) || new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 160 }, children: [run(t, { bold: true, size: 28 })] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 120 }, children: [run(t, { bold: true, size: 24 })] });
const pb = () => new Paragraph({ children: [new PageBreak()] });

function table(headers, rows, widths, o = {}) {
  const sum = widths.reduce((a, b) => a + b, 0);
  const ws = widths.map((w) => Math.round((w / sum) * W));
  ws[ws.length - 1] += W - ws.reduce((a, b) => a + b, 0);
  const cell = (text, i, head, fill) => new TableCell({
    width: { size: ws[i], type: WidthType.DXA },
    shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'D9E2F3' } : fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: String(text ?? '').split('\n').map((line) => new Paragraph({
      alignment: head ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [run(line, { size: o.size || 20, bold: head || undefined, color: line.includes(MISSING) ? 'C00000' : undefined })],
    })),
  });
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: ws,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, i, true)) }),
      ...rows.map((r) => new TableRow({ children: r.cells ? r.cells.map((c, i) => cell(c, i, false, r.fill)) : r.map((c, i) => cell(c, i, false)) })),
    ],
  });
}

const kv = (pairs) => table(['Талбар', 'Оруулах утга'], pairs.map(([k, v]) => [k, v == null || v === '' ? MISSING : v]), [35, 65]);

function doc(title, subtitle, children) {
  return new Document({
    creator: 'Менежер Ai',
    title,
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(subtitle, { size: 18, italics: true, color: '666666' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ font: FONT, size: 18, children: [PageNumber.CURRENT] })] })] }) },
      children,
    }],
  });
}

const testBanner = (data) => data.meta.test
  ? [p('ТУРШИЛТЫН ХУВИЛБАР — зохиомол өгөгдөл. Бодит тендерт ашиглахгүй.', { bold: true, color: 'C00000', align: AlignmentType.CENTER })]
  : [];

function fname(data, key, def) {
  const f = (data.tender.forms || []).find((x) => x.key === key);
  if (!f) return def;
  return (f.no === undefined || f.no === null || f.no === '' || f.no === '—') ? f.name : `Маягт ${f.no}. ${f.name}`;
}
const validityText = (data) => {
  const c = data.customer, unit = data.tender.validity_unit === 'working_days' ? 'ажлын өдөр' : 'хоног';
  return c.validity_days ? `${c.validity_days} ${unit}` : null;
};

const dt = (s) => s ? String(s).replace('T', ' ').slice(0, 16) : MISSING;

/* ===================== А. ШАЛГАХ ЖАГСААЛТ, ДҮГНЭЛТ ===================== */
function checklistDoc(data, qc) {
  const { tender: t, customer: c, sections: s = {} } = data;
  const decisionText = {
    go: ['ОРОЛЦОХ БОЛОМЖТОЙ', '00703C'],
    conditional: ['ДУТУУ БАРИМТЫГ БҮРДҮҮЛБЭЛ ОРОЛЦОХ БОЛОМЖТОЙ', 'B26B00'],
    nogo: ['ОДООГИЙН БАЙДЛААР ШААРДЛАГА ХАНГАХГҮЙ', 'C00000'],
  }[qc.decision];
  const st = qc.statusById;
  const label = { ok: '✅ Хангана', missing: '⚠️ Дутуу', fail: '❌ Хангахгүй' };
  const fill = { ok: 'E2EFDA', missing: 'FFF2CC', fail: 'F8CBAD' };

  const kids = [
    ...testBanner(data),
    p('ТЕНДЕРТ ОРОЛЦОХ БЭЛТГЭЛИЙН ШАЛГАХ ЖАГСААЛТ', { bold: true, size: 32, align: AlignmentType.CENTER, after: 80 }),
    p('(Дотоод хэрэгцээнд — тендерт илгээхгүй)', { italics: true, align: AlignmentType.CENTER, after: 240 }),
    h1('1. Дүгнэлт'),
    p(decisionText[0], { bold: true, size: 28, color: decisionText[1], align: AlignmentType.CENTER }),
    p(`Шаардлага: ✅ ${qc.counts.ok} · ⚠️ ${qc.counts.missing} · ❌ ${qc.counts.fail}`, { align: AlignmentType.CENTER }),
    ...(s.summary || []).map((x) => p(x, { indent: true })),
    h1('2. Тендерийн товч мэдээлэл'),
    table(['Зүйл', 'Утга'], [
      ['Захиалагч', t.procuring_entity],
      ['Тендерийн нэр, дугаар', `${t.name}\n${t.number}`],
      ['Арга', t.method || MISSING],
      ['Багц', t.lot ? `№${t.lot.no} ${t.lot.name}` : '—'],
      ['Төсөвт өртөг', t.budget ? fmt(t.budget) + '₮' : MISSING],
      ['Санхүүжилт', t.funding || MISSING],
      ['Тендер хүлээн авах эцсийн хугацаа', dt(t.deadline) + ' (цахим системийн серверийн цагаар)'],
      ['Нээлт', dt(t.opening)],
      ['Тодруулга авах хаяг', t.clarification ? `${t.clarification.contact || ''} ${t.clarification.email || ''}`.trim() : MISSING],
      ['Тендерийн баталгаа', t.bid_security && t.bid_security.required ? `${fmt(t.bid_security.amount)}₮ (${t.bid_security.ref || ''})` : 'Шаардахгүй'],
      ['Тендер хүчинтэй байх доод хугацаа', `${t.validity_days_min || 30} ${t.validity_unit === 'working_days' ? 'ажлын өдөр' : 'хоног'}`],
      ['Гүйцэтгэлийн баталгаа', t.performance_security && t.performance_security.required ? `${t.performance_security.pct}%` : 'Шаардахгүй / тодорхойгүй'],
      ['Хүргэх нөхцөл, газар', [t.incoterms, t.delivery_place].filter(Boolean).join('; ') || MISSING],
    ], [35, 65]),
    h1('3. Шаардлага ба таны бэлэн байдал'),
    table(['№', 'Шаардлага', 'ТББ заалт', 'Нотлох баримт', 'Төлөв', 'Тайлбар / хийх ажил'],
      (t.requirements || []).map((r, i) => {
        const x = st.get(r.id) || {};
        return { cells: [i + 1, r.text + (r.category === 'esystem' ? '\n(цахим системээр шалгагдана)' : ''), r.ref, r.evidence, label[x.status] || '?', [x.note, x.action].filter(Boolean).join('\n→ ')], fill: fill[x.status] };
      }), [5, 28, 12, 17, 11, 27], { size: 18 }),
  ];
  if ((qc.numeric || []).length) {
    kids.push(h2('Тоон шалгуурын тооцоо (кодоор)'));
    kids.push(table(['Шаардлага', 'Нөхцөл', 'Он', 'Таны үзүүлэлт', 'Босго', 'Дүн'],
      qc.numeric.flatMap((n) => n.per.map((x, j) => [j ? '' : (n.label || n.req_id), j ? '' : (n.kind === 'any' ? 'Аль нэг жил' : 'Жил тус бүр'), x.year,
        x.value == null ? MISSING : fmt(x.value) + '₮', n.threshold == null ? MISSING : (n.op === '>' ? '> ' : '') + fmt(n.threshold) + '₮' + (n.basis ? ` (${n.basis})` : ''),
        x.value == null || n.threshold == null ? '—' : ((n.op === '>' ? x.value > n.threshold : x.value >= n.threshold) ? '✅' : (n.kind === 'any' && n.result === 'ok' ? '— (өөр жил хангасан)' : '❌'))])),
      [14, 16, 10, 22, 22, 16], { size: 18 }));
  }
  if (qc.auction) {
    const a = qc.auction;
    kids.push(h1('Үнийн санал дуудах ажиллагаанд бэлтгэх'));
    kids.push(p(`Энэ тендерт ${a.start ? dt(a.start) + '-аас ' : ''}${a.hours || '?'} цагийн цахим үнийн санал дуудах ажиллагаа болно. Тендер хүлээн авсны дараа оролцогчид үнээ бууруулан өрсөлдөнө.`, { indent: true }));
    kids.push(table(['Үзүүлэлт', 'Дүн'], [
      ['Тендерт илгээх эхлэх үнэ', a.start_price != null ? fmt(a.start_price) + '₮' : MISSING],
      ['Таны доод үнэ (үүнээс доош бүү буу)', a.floor != null ? fmt(a.floor) + '₮' : MISSING],
      ['Төсөвт өртгийн 80% босго', a.threshold80 != null ? fmt(a.threshold80) + '₮' : MISSING],
      ['Доод үнэ / төсөвт өртөг', a.floor_ratio != null ? (a.floor_ratio * 100).toFixed(1) + '%' : MISSING],
    ], [60, 40]));
    kids.push(p('Доод үнийг таны өөрийн өртөг дээр тулгуурлан тогтоосон. Өрсөлдөөнд автаж өртгөөс доош санал өгвөл гэрээг алдагдалтай гүйцэтгэх эрсдэлтэй. 80%-ийн босгоос доош буувал үнийн үндэслэлийн тайлбар ирүүлэх шаардлагатай.', { indent: true }));
  }
  if ((t.inconsistencies || []).length) {
    kids.push(h1('Тендерийн баримт бичгийн зөрчил, тодруулах зүйлс'));
    kids.push(table(['№', 'Зөрчил', 'ТББ заалт', 'Санал'], t.inconsistencies.map((x, i) => [i + 1, x.text, x.ref || '', x.suggestion || '']), [6, 44, 18, 32], { size: 18 }));
    if ((s.clarification_letter || []).length) {
      kids.push(h2('Тодруулга авах хүсэлтийн төсөл'));
      s.clarification_letter.forEach((x) => kids.push(p(x, { indent: true })));
      kids.push(p('Тодруулгын хүсэлтийг нээлтээс ажлын 5-аас доошгүй өдрийн өмнө ТББ-д заасан хаягаар (тоон гарын үсгээр баталгаажуулан) гаргана.', { italics: true, size: 20 }));
    }
  }
  kids.push(h1('4. Танаас шаардлагатай зүйлс'));
  const todo = (c.requirement_status || []).filter((x) => x.status !== 'ok' && x.action);
  if (todo.length) todo.forEach((x, i) => kids.push(p(`${i + 1}. ${x.action}`)));
  else kids.push(p('Нэмэлт баримт шаардлагагүй.'));
  const common = [
    'tender.gov.mn-д бүртгэлтэй, тоон гарын үсэг бэлэн эсэхээ шалгах.',
    'Үйлчилгээний хураамжийг төлөх (буцаагддаггүй).',
    'Тендерийг эцсийн хугацаанаас дор хаяж 1 ажлын өдрийн өмнө илгээх — сүүлчийн цагт системийн ачаалал ихэсдэг.',
  ];
  kids.push(p('Мөн:', { bold: true }));
  common.forEach((x) => kids.push(p('• ' + x)));

  kids.push(h1('5. Гэрээний нөхцөл ба эрсдэл'));
  const k = t.contract || {};
  kids.push(table(['Нөхцөл', 'Утга'], [
    ['Баталгаат хугацаа', k.warranty || MISSING], ['Алданги', k.liquidated_damages || MISSING],
    ['Төлбөр', k.payment || MISSING], ['Урьдчилгаа', k.advance || MISSING],
  ], [35, 65]));
  (s.risks || []).forEach((x) => kids.push(p('• ' + x)));

  const warns = qc.issues.filter((i) => i.level === 'warn' || (qc.decision === 'nogo' && i.level === 'block'));
  if (warns.length) {
    kids.push(h1('6. Системийн шалгалтын анхааруулга'));
    warns.forEach((i) => kids.push(p('• ' + i.msg)));
  }
  kids.push(h1('Анхааруулга'));
  [
    'Энэхүү жагсаалтыг таны өгсөн мэдээлэл болон тендерийн баримт бичигт үндэслэн гаргасан. Тендерийн баримт бичгийн эх хувьтай өөрөө тулгаж шалгана уу.',
    'Тендер илгээх маягтаар оролцогч хуурамч баримт, мэдээлэл ирүүлбэл тендерт оролцох эрхээ хязгаарлуулах үндэслэл болохыг хүлээн зөвшөөрдөг. Бүх баримт үнэн зөв, хүчинтэй байх ёстой.',
    'Тендерийг цахим системд оруулах, баталгаажуулах, илгээх эцсийн хариуцлага оролцогч танд байна. Менежер Ai тендерт шалгарна гэж баталгаа өгөхгүй.',
  ].forEach((x) => kids.push(p(x, { indent: true })));

  return doc('Шалгах жагсаалт', `${t.number} · Шалгах жагсаалт`, kids);
}

/* ===================== Б. ТЕНДЕРИЙН МАТЕРИАЛ ===================== */
function form1(data, qc) {
  const { tender: t, customer: c } = data;
  const total = qc.calc.total;
  const words = total != null ? amountToWords(total) : null;
  const what = data.meta.type === 'goods' ? 'бараа нийлүүлэхээр' : 'үйлчилгээ үзүүлэхээр';
  const priceStr = total != null ? `${fmt(total)} (${words}) төгрөг` : MISSING;
  const out = [
    h1(fname(data, 'submission', 'Маягт 1. Тендер илгээх маягт')),
    p('Тайлбар: tender.gov.mn-д энэ маягтыг цахим хэлбэрээр бөглөнө. Доорх хүснэгтийн утгуудыг холбогдох талбарт оруулна. Маягтын дугаар, текстийг тухайн тендерийн баримт бичгийн V бүлэгтэй тулгана уу.', { italics: true, size: 20 }),
    kv([
      ['Огноо', c.submission_date],
      ['Захиалагч байгууллага', t.procuring_entity],
      ['Оролцогчийн нэр', c.company.name],
      ['Тендер шалгаруулалтын нэр, дугаар', `${t.name}, ${t.number}`],
      ['Тендерийн үнэ (үнийн хөнгөлөлт тооцоогүй)', priceStr],
      ['Үнийн хөнгөлөлт', c.discount ? c.discount : 'Санал болгохгүй'],
      ['Тендер хүчинтэй байх хугацаа', validityText(data) ? `Тендер нээснээс хойш ${validityText(data)}` : null],
      ['Баталгаажуулах этгээд', c.signatory ? `${c.signatory.position} ${c.signatory.name}` : null],
      ['Хаяг', c.company.address],
    ]),
    h2('Маягтын текст (жишиг баримт бичгийн дагуу)'),
    p(`${c.submission_date || MISSING}`, { align: AlignmentType.RIGHT }),
    p(`${t.procuring_entity}-д`, { bold: true }),
    p(`Манай ${c.company.name} нь танай байгууллагаас зарласан ${t.name} (${t.number}) тендер шалгаруулалтад ${total != null ? `${fmt(total)} (${words}) төгрөгөөр` : MISSING} тендер шалгаруулалтын баримт бичигт заасан хуваарийн дагуу ${what}, дор дурдсан нөхцөлийг баталж энэхүү тендерийг хүргүүлж байна. Үүнд:`, { indent: true }),
  ];
  const clauses = [
    '1. Тендер шалгаруулалтын баримт бичиг, түүнд заасан гэрээний нөхцөл (гэрээний ерөнхий нөхцөл, тусгай нөхцөл, гэрээ баталгаажуулах маягт)-тэй танилцаж, бүрэн хүлээн зөвшөөрч тендер шалгаруулалтад оролцсон.',
    '2. Оролцогч, түүний түншлэлийн гишүүн худалдан авах ажиллагаанд оролцохтой холбоотой хуулиар хориглосон нөхцөлд хамаарахгүй бөгөөд үүний дотор дараах нөхцөлийг гэрчилж байна. Үүнд:',
    '2.1. Төрийн болон орон нутгийн өмчийн хөрөнгөөр бараа, ажил, үйлчилгээ худалдан авах тухай хуулийн 7.1-д заасан нөхцөл үүсээгүй;',
    '2.2. Нөлөө бүхий хувьцаа эзэмшигч, түүний эцсийн өмчлөгч, хөрөнгө эзэмшигч, хамтрагч, эсхүл эдгээрийг гүйцэтгэж байгаа хувиараа аж ахуй эрхлэгч нь Нийтийн албанд нийтийн болон хувийн ашиг сонирхлыг зохицуулах, ашиг сонирхлын зөрчлөөс урьдчилан сэргийлэх тухай хуулийн 20.2 дахь хэсэгт заасан албан тушаал эрхэлж байсан болон эрхэлж байгаа хүн, эсхүл түүнтэй хамаарал бүхий этгээд биш;',
    '2.3. Захиалагчийн удирдлага, хяналт, захиргаанд ажилладаг албан тушаалтанд ашиг олгодоггүй;',
    '2.4. Оролцогчийг төлөөлж буй этгээд нь Нийтийн албанд нийтийн болон хувийн ашиг сонирхлыг зохицуулах, ашиг сонирхлын зөрчлөөс урьдчилан сэргийлэх тухай хуулийн 21.1.3 дахь заалтад заасан хязгаарлалтад хамаарахгүй.',
    '3. Тендертэй холбоотой нотлох баримт, мэдээллийг холбогдох этгээдээс гаргуулах эрхийг захиалагчид үүгээр олгож байна.',
    `4. Тендерт үнийн хөнгөлөлт ${c.discount ? 'санал болгоно: ' + c.discount : 'санал болгохгүй'}.`,
    `5. Тендер нь тендер шалгаруулалтын баримт бичигт заасны дагуу тендер нээснээс хойш ${validityText(data) || MISSING}-ийн хугацаанд хүчинтэй байна.`,
    '6. Хуулийн 7.1, 22.2, 56.5-д заасныг зөрчсөн болон тендер шалгаруулалтад үнэн зөв, зөрүүгүй орчуулга ирүүлэх үүргээ зөрчсөн нь тендер шалгаруулалтад оролцох эрхээ хязгаарлуулсан этгээдийн жагсаалтад бүртгэх үндэслэл болохыг хүлээн зөвшөөрч байна.',
    `7. Тендерт санал болгосон ${data.meta.type === 'goods' ? 'бараа' : 'үйлчилгээ'} нь оюуны өмчийн зөрчилгүй, эрхийн болон биет байдлын доголдолгүй болохыг баталж байна.`,
    '8. Тендерийг холбогдох журмын дагуу бусад оролцогчдод ил болгохыг үүгээр зөвшөөрч, тендерийг нууцлах аливаа үүргээс захиалагчийг бүрэн чөлөөлж байна.',
  ];
  clauses.forEach((x) => out.push(p(x)));
  out.push(p(''), p(`${c.signatory ? c.signatory.position : MISSING}: ____________________ ${c.signatory ? c.signatory.name : ''}`), p('(Тоон гарын үсгээр баталгаажуулбал тамга шаардахгүй — ТШЗ 25.3)', { italics: true, size: 18 }), p(`Хаяг: ${c.company.address || MISSING}`));
  return out;
}

function goodsForms(data, qc) {
  const { tender: t, customer: c } = data;
  const out = [];
  out.push(pb(), h1(fname(data, 'price', 'Маягт 2. Барааны үнийн задаргаа')),
    p('Томьёотой Excel хувилбарыг хавсралт файлаар өгсөн. Цахим системд энэ хүснэгтийн утгыг оруулна.', { italics: true, size: 20 }),
    table(['№', 'Барааны нэр', 'Гарал үүсэл', 'Тоо', 'Нэгж', 'Нэгж үнэ', 'Бүгд үнэ', 'Тээвэр, бусад', 'Татвар', 'Нийт үнэ'],
      [...qc.calc.rows.map((r) => [r.no, r.name, r.origin || MISSING, fmt(r.qty), r.unit,
        r.missing ? MISSING : fmt(r.unit_price), r.missing ? MISSING : fmt(r.subtotal), fmt(r.transport), fmt(r.tax), r.missing ? MISSING : fmt(r.total)]),
      { cells: ['', 'ТЕНДЕРИЙН НИЙТ ҮНЭ', '', '', '', '', '', '', '', qc.calc.total != null ? fmt(qc.calc.total) : MISSING], fill: 'F2F2F2' }],
      [7, 20, 9, 5, 8, 11, 11, 10, 7, 12], { size: 17 }),
    p(qc.calc.total != null ? `Үсгээр: ${amountToWords(qc.calc.total)} төгрөг.` : '', { size: 20 }));

  out.push(pb(), h1('Техникийн тодорхойлолтын нийцлийн хүснэгт'),
    p('«Санал болгож буй» баганад зөвхөн нийлүүлэх барааны бодит үзүүлэлтийг (үйлдвэрлэгчийн баримтаас) бичсэн. Захиалагчийн шаардлагыг хуулаагүй. [ДУТУУ] гэсэн мөрийг оролцогч баримтаар нөхнө.', { italics: true, size: 20 }));
  const offers = new Map((c.tech_offer || []).map((o) => [`${o.item_no}|${o.spec_no}`, o]));
  for (const it of t.items || []) {
    const specs = (t.tech_specs || []).filter((s) => String(s.item_no) === String(it.no));
    if (!specs.length) continue;
    out.push(h2(`Бараа №${it.no}. ${it.name}`));
    out.push(table(['№', 'Захиалагчийн техникийн тодорхойлолт', 'Санал болгож буй техникийн тодорхойлолт', 'Нийцэл', 'Тайлбар / нотлох баримт'],
      specs.map((s) => {
        const o = offers.get(`${s.item_no}|${s.no}`) || {};
        const has = String(o.offered || '').trim();
        return { cells: [s.no, s.requirement, has ? o.offered : MISSING, has ? (o.compliance || '') : '', [o.note, o.evidence].filter(Boolean).join('; ') || (has ? '' : MISSING)], fill: has ? undefined : 'FFF2CC' };
      }), [6, 30, 30, 10, 24], { size: 18 }));
  }

  out.push(pb(), h1('Бараа нийлүүлэлтийн хуваарь'),
    p('1–6-р багана тендерийн баримт бичгээс, 7-р багана — оролцогчийн санал.', { italics: true, size: 20 }));
  const prop = new Map((c.proposed_delivery || []).map((d) => [String(d.item_no), d]));
  out.push(table(['№', 'Барааны нэр', 'Тоо', 'Нэгж', 'Хүргэх цэг', 'Захиалагчийн хугацаа', 'Санал болгох хугацаа (7)'],
    (t.items || []).map((it) => [it.no, it.name, fmt(it.qty), it.unit, t.delivery_place || MISSING,
      it.max_days != null ? `Гэрээ байгуулснаас хойш ${it.max_days} хоногт` : (it.window || MISSING), prop.get(String(it.no)) ? prop.get(String(it.no)).text : MISSING]),
    [5, 24, 7, 7, 17, 20, 20], { size: 18 }));
  return out;
}

function serviceForms(data, qc) {
  const { customer: c, sections: s = {} } = data;
  const out = [];
  if ((s.methodology || []).length) out.push(pb(), h1(fname(data, 'methodology', 'Ажлын хөтөлбөр, аргачлалын танилцуулга')));
  for (const sec of s.methodology || []) {
    out.push(h2(sec.heading));
    (sec.paragraphs || []).forEach((x) => out.push(p(x, { indent: true })));
  }
  if (s.schedule && s.schedule.length) {
    out.push(pb(), h1('Үйлчилгээ үзүүлэх хуваарь'),
      table(['№', 'Ажил, үе шат', 'Эхлэх', 'Дуусах', 'Хариуцах'], s.schedule.map((r, i) => [i + 1, r.task, r.start, r.end, r.owner || '']), [5, 45, 15, 15, 20]));
  }
  out.push(pb(), h1('Үйлчилгээ үзүүлэх төсөв'),
    table(['№', 'Зардлын нэр', 'Тоо', 'Нэгж', 'Нэгж үнэ', 'Дүн'],
      [...qc.calc.rows.map((r) => [r.no, r.name, fmt(r.qty), r.unit, fmt(r.unit_price), fmt(r.total)]), { cells: ['', 'НИЙТ', '', '', '', fmt(qc.calc.total)], fill: 'F2F2F2' }],
      [5, 45, 10, 10, 15, 15]));
  if ((c.staff || []).length) {
    out.push(pb(), h1(fname(data, 'staff', 'Хүний нөөцийн мэдээлэл')),
      table(['Албан тушаал', 'Ажилтны нэр', 'Боловсрол, мэргэжил', 'Нийт туршлага (жил)', 'Тухайн албан тушаалд (жил)'],
        c.staff.map((x) => [x.position, x.name, x.education, x.total_years, x.position_years]), [20, 20, 30, 15, 15]));
  }
  if ((c.staff || []).some((x) => x.cv)) {
    for (const x of c.staff.filter((y) => y.cv)) {
      out.push(pb(), h1(`${fname(data, 'cv', 'Ажилтны товч намтар (CV)')} — ${x.name}`));
      out.push(kv([['Санал болгож буй албан тушаал', x.position], ['Овог, нэр', x.name], ['Төрсөн он', x.cv.birth_year], ['Мэргэжил', x.cv.profession],
        ['Тухайн байгууллагад ажилласан жил', x.cv.years_in_company], ['Хариуцах ажил', x.cv.duties]]));
      out.push(h2('Боловсрол, сургалт')); (x.cv.education || []).forEach((e) => out.push(p('• ' + e)));
      out.push(h2('Ажилласан туршлага')); (x.cv.experience || []).forEach((e) => out.push(p('• ' + e)));
      out.push(p('Дээрх мэдээлэл үнэн зөв болохыг баталж байна. Ажилтан: ____________   Эрх бүхий этгээд: ____________', { size: 20 }));
    }
  }
  if ((c.equipment || []).length) {
    out.push(h1('Үндсэн тоног төхөөрөмж, техник хэрэгсэл'),
      table(['Нэр, зориулалт', 'Хүчин чадал', 'Тоо', 'Өөрийн эзэмшил / түрээс'], c.equipment.map((x) => [x.name, x.capacity, x.qty, x.ownership]), [40, 20, 10, 30]));
  }
  return out;
}

function commonForms(data) {
  const { customer: c, sections: s = {} } = data;
  const out = [pb(), h1(fname(data, 'similar', 'Ижил төстэй гэрээний мэдээлэл'))];
  const sim = c.contracts_similar || [];
  out.push(table(['Гэрээний нэр', 'Захиалагчийн нэр, хаяг, утас', 'Дүн (₮)', 'Хугацаа (эхэлсэн, дууссан)'],
    sim.length ? sim.map((x) => [x.name, [x.client, x.client_contact].filter(Boolean).join(', '), fmt(x.amount), `${x.start} — ${x.end}`]) : [['Мэдээлэл өгөгдөөгүй', '', '', '']], [30, 30, 15, 25]));
  sim.forEach((x, i) => {
    out.push(h2(`${fname(data, 'similar_detail', 'Ижил төстэй гэрээний дэлгэрэнгүй мэдээлэл')} (${i + 1})`));
    out.push(kv([['Захиалагчийн нэр', x.client], ['Гэрээний нэр', x.name], ['Гэрээний дугаар', x.number], ['Гэрээ байгуулсан огноо', x.start],
      ['Гэрээ дуусгавар болсон огноо', x.end], ['Гэрээний дүн', x.amount != null ? fmt(x.amount) + '₮' : null], ['Гүйцэтгэсэн хаяг, байршил', x.location], ['Гэрээнд оролцсон байдал', x.role]]));
  });
  out.push(h1(fname(data, 'ongoing', 'Хэрэгжүүлж байгаа, хэрэгжүүлэхээр эрх авсан гэрээ')));
  const on = c.contracts_ongoing || [];
  out.push(table(['Гэрээний нэр', 'Захиалагч', 'Дүн', 'Эхэлсэн', 'Үлдсэн гүйцэтгэл', 'Дуусах'],
    on.length ? on.map((x) => [x.name, x.client, fmt(x.amount), x.start, x.remaining, x.end]) : [['Байхгүй', '', '', '', '', '']], [25, 20, 13, 13, 15, 14]));
  for (const l of data.letters || []) {
    out.push(pb(), h1(l.title));
    if (l.ref) out.push(p(`(ТББ: ${l.ref})`, { italics: true, size: 20 }));
    out.push(p(c.submission_date || MISSING, { align: AlignmentType.RIGHT }), p(`${data.tender.procuring_entity}-д`, { bold: true }));
    (l.paragraphs || []).forEach((x) => out.push(p(x, { indent: true })));
    out.push(p(''), p(`${c.signatory ? c.signatory.position : MISSING}: ____________________ ${c.signatory ? c.signatory.name : ''}`), p(`${c.company.name}, ${c.company.address || ''}`, { size: 20 }));
  }
  if ((s.low_price_explanation || []).length) {
    out.push(pb(), h1('Тендерийн үнийн үндэслэлийн тайлбар'));
    s.low_price_explanation.forEach((x) => out.push(p(x, { indent: true })));
  }
  return out;
}

function companyProfile(data) {
  const cp = (data.sections || {}).company_profile || [];
  if (!cp.length) return [];
  const out = [h1('Байгууллагын танилцуулга')];
  for (const sec of cp) { if (sec.heading) out.push(h2(sec.heading)); (sec.paragraphs || []).forEach((x) => out.push(p(x, { indent: true }))); }
  out.push(pb());
  return out;
}

function draftDoc(data, d) {
  const c = data.customer;
  const kids = [
    p('ТӨСӨЛ — байгууллага уншиж, засварлаад байгууллагын эрх бүхий этгээдийн шийдвэрээр (тушаалаар) батална. Батлагдаагүй төслийг тендерт ирүүлж болохгүй.', { bold: true, color: 'C00000', align: AlignmentType.CENTER }),
    p(''),
    p('БАТЛАВ', { bold: true, align: AlignmentType.RIGHT, after: 40 }),
    p(`${c.company.name}-ийн ${c.signatory ? c.signatory.position.toLowerCase() : 'захирал'}`, { align: AlignmentType.RIGHT, after: 40 }),
    p(`______________ ${c.signatory ? c.signatory.name : ''}`, { align: AlignmentType.RIGHT, after: 40 }),
    p('20__ оны __ сарын __ өдрийн __ дугаар тушаалаар', { align: AlignmentType.RIGHT, after: 240 }),
    p(d.title.toUpperCase(), { bold: true, size: 28, align: AlignmentType.CENTER, after: 240 }),
  ];
  for (const sec of d.sections || []) { if (sec.heading) kids.push(h2(sec.heading)); (sec.paragraphs || []).forEach((x) => kids.push(p(x, { indent: true }))); }
  return doc(d.title, `${c.company.name} · ТӨСӨЛ`, kids);
}

function attachmentsIndex(data) {
  const list = data.attachments || [];
  if (!list.length) return [];
  return [h1('Хавсралтын жагсаалт'), table(['Хавсралт №', 'Баримтын нэр', 'ТББ-ийн шаардлага', 'Төлөв'],
    list.map((a) => [a.no, a.name, a.ref || '', a.status || '']), [12, 40, 25, 23])];
}

function materialsDoc(data, qc) {
  const t = data.tender;
  TOC = [];
  const built = [
    ...testBanner(data),
    p(data.customer.company.name, { bold: true, size: 28, align: AlignmentType.CENTER, after: 60 }),
    p('ТЕНДЕРИЙН МАТЕРИАЛ', { bold: true, size: 36, align: AlignmentType.CENTER, after: 120 }),
    p(t.name, { size: 26, align: AlignmentType.CENTER, after: 60 }),
    p(`Тендер шалгаруулалтын дугаар: ${t.number}${t.lot ? ` · Багц №${t.lot.no}` : ''}`, { align: AlignmentType.CENTER, after: 60 }),
    p(`Захиалагч: ${t.procuring_entity}`, { align: AlignmentType.CENTER, after: 240 }),
    '__TOC__',
    ...attachmentsIndex(data),
    pb(),
    ...companyProfile(data),
    ...form1(data, qc),
    ...(data.meta.type === 'goods' ? goodsForms(data, qc) : serviceForms(data, qc)),
    ...commonForms(data),
  ];
  const titles = TOC.filter((x) => x !== 'Хавсралтын жагсаалт');
  TOC = null;
  const toc = [p('Агуулга', { bold: true, size: 26 }), ...titles.map((x, i) => p(`${i + 1}. ${x}`, { after: 60 }))];
  const kids = built.flatMap((k) => (k === '__TOC__' ? toc : [k]));
  return doc('Тендерийн материал', `${t.number} · ${data.customer.company.name}`, kids);
}

async function write(d, path) { fs.writeFileSync(path, await Packer.toBuffer(d)); }
const toBuffer = (d) => Packer.toBuffer(d);

module.exports = { checklistDoc, materialsDoc, draftDoc, write, toBuffer };
