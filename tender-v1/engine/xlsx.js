'use strict';
const ExcelJS = require('exceljs');

const FONT = 'Times New Roman';
const BLUE = { argb: 'FF0000FF' };
const thin = { style: 'thin', color: { argb: 'FF808080' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } };
const NUM = '#,##0;(#,##0);-';

function styleRange(ws, r1, r2, c1, c2, fn) {
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) fn(ws.getCell(r, c));
}

function base(ws) {
  ws.eachRow({ includeEmpty: true }, (row) => row.eachCell({ includeEmpty: true }, (c) => {
    c.font = Object.assign({ name: FONT, size: 11 }, c.font || {}, { name: FONT });
  }));
}

function goodsSheet(wb, data, qc) {
  const { tender, customer } = data;
  const ws = wb.addWorksheet('Үнийн задаргаа', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [6, 34, 14, 10, 10, 15, 17, 18, 15, 18, 14].map((w) => ({ width: w }));

  ws.mergeCells('A1:K1');
  ws.getCell('A1').value = 'БАРААНЫ ҮНИЙН ЗАДАРГАА';
  ws.getCell('A1').font = { name: FONT, size: 14, bold: true };
  ws.getCell('A1').alignment = { horizontal: 'center' };
  const info = [
    ['Захиалагч:', tender.procuring_entity],
    ['Тендер:', `${tender.name} (${tender.number})`],
    ['Багц:', tender.lot ? `№${tender.lot.no} ${tender.lot.name}` : '—'],
    ['Оролцогч:', customer.company.name],
  ];
  info.forEach(([k, v], i) => {
    ws.getCell(3 + i, 1).value = k; ws.getCell(3 + i, 1).font = { bold: true };
    ws.mergeCells(3 + i, 2, 3 + i, 11); ws.getCell(3 + i, 2).value = v;
  });

  const hr = 8;
  const heads = ['№', 'Барааны нэр', 'Гарал үүслийн улс', 'Тоо хэмжээ', 'Хэмжих нэгж', 'Нэгж үнэ (₮)',
    'Бүгд үнэ (₮)\n(4×6)', 'Дотоодын тээвэрлэлт, бусад үйлчилгээ (₮)', 'Татвар, хураамж (₮)', 'Нийт үнэ (₮)\n(7+8+9)', 'Монгол гарал үүсэлтэй эсэх'];
  heads.forEach((h, i) => { ws.getCell(hr, i + 1).value = h; ws.getCell(hr + 1, i + 1).value = i + 1; });
  styleRange(ws, hr, hr + 1, 1, 11, (c) => {
    c.font = { name: FONT, bold: true, size: 10 }; c.fill = HEAD_FILL; c.border = border;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  ws.getRow(hr).height = 48;

  const first = hr + 2;
  qc.calc.rows.forEach((r, i) => {
    const row = first + i;
    ws.getCell(row, 1).value = r.no;
    ws.getCell(row, 2).value = r.name;
    ws.getCell(row, 3).value = r.origin || '[ДУТУУ]';
    ws.getCell(row, 4).value = r.qty;
    ws.getCell(row, 5).value = r.unit;
    ws.getCell(row, 6).value = r.missing ? null : r.unit_price;
    ws.getCell(row, 7).value = { formula: `D${row}*F${row}` };
    ws.getCell(row, 8).value = r.missing ? null : r.transport;
    ws.getCell(row, 9).value = r.missing ? null : r.tax;
    ws.getCell(row, 10).value = { formula: `G${row}+H${row}+I${row}` };
    ws.getCell(row, 11).value = r.domestic ? 'Тийм' : 'Үгүй';
    [3, 6, 8, 9, 11].forEach((c) => { ws.getCell(row, c).font = { name: FONT, color: BLUE }; });
    [4, 6, 7, 8, 9, 10].forEach((c) => { ws.getCell(row, c).numFmt = NUM; });
  });
  const last = first + qc.calc.rows.length - 1;
  styleRange(ws, first, last, 1, 11, (c) => { c.border = border; c.alignment = Object.assign({ vertical: 'middle', wrapText: true }, c.alignment || {}); });

  const tr = last + 1;
  ws.mergeCells(tr, 1, tr, 9);
  ws.getCell(tr, 1).value = 'ТЕНДЕРИЙН НИЙТ ҮНЭ';
  ws.getCell(tr, 1).alignment = { horizontal: 'right' };
  ws.getCell(tr, 10).value = { formula: `SUM(J${first}:J${last})` };
  ws.getCell(tr, 10).numFmt = NUM;
  styleRange(ws, tr, tr, 1, 11, (c) => { c.font = { name: FONT, bold: true }; c.border = border; });

  // Төсөвт өртөгтэй харьцуулалт
  const b = tr + 2;
  ws.getCell(b, 2).value = 'Төсөвт өртөг (₮)';
  ws.getCell(b, 10).value = tender.budget; ws.getCell(b, 10).font = { name: FONT, color: BLUE };
  ws.getCell(b + 1, 2).value = 'Санал болгох үнэ / төсөвт өртөг';
  ws.getCell(b + 1, 10).value = { formula: `IF(J${b}=0,"",J${tr}/J${b})` }; ws.getCell(b + 1, 10).numFmt = '0.0%';
  ws.getCell(b + 2, 2).value = 'Шалгалт';
  ws.getCell(b + 2, 10).value = { formula: `IF(J${b + 1}="","",IF(J${b + 1}<0.8,"80%-иас доош: тайлбар заавал",IF(J${b + 1}>1,"Төсөвт өртгөөс их","Хэвийн")))` };
  ws.getCell(b + 3, 2).value = 'Тендерийн баталгаа (ТББ-д заасан, ₮)';
  ws.getCell(b + 3, 10).value = tender.bid_security && tender.bid_security.required ? tender.bid_security.amount : 0;
  ws.getCell(b + 3, 10).font = { name: FONT, color: BLUE };
  [b, b + 3].forEach((r) => { ws.getCell(r, 10).numFmt = NUM; });

  const n = b + 5;
  const notes = [
    'Тайлбар: цэнхэр өнгөтэй нүд — таны (оролцогчийн) оруулсан утга (засаж болно); хар — томьёо (бүү засаарай).',
    'Барааны нэр, тоо хэмжээ, хэмжих нэгжийг ТББ-ийн жагсаалтаас яг хуулсан. Өөрчилж болохгүй.',
    'tender.gov.mn-ийн цахим маягтад нийт үнийг энэ хүснэгтийн «Тендерийн нийт үнэ»-тэй яг ижил оруулна (зөрвөл задаргааны нийлбэрийг үнэ гэж үзнэ — ТШЗ 21.8).',
    'Эх сурвалж: үнэ, гарал үүсэл — оролцогч; тоо хэмжээ, төсөвт өртөг — ТББ.',
  ];
  notes.forEach((t, i) => { ws.mergeCells(n + i, 1, n + i, 11); ws.getCell(n + i, 1).value = t; ws.getCell(n + i, 1).font = { name: FONT, size: 9, italic: true }; });
  ws.views = [{ state: 'frozen', ySplit: hr + 1 }];
  return { totalCell: `J${tr}` };
}

function serviceSheet(wb, data, qc) {
  const ws = wb.addWorksheet('Үйлчилгээний төсөв');
  ws.columns = [6, 44, 12, 12, 16, 18].map((w) => ({ width: w }));
  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = 'ҮЙЛЧИЛГЭЭ ҮЗҮҮЛЭХ ТӨСӨВ';
  ws.getCell('A1').font = { name: FONT, size: 14, bold: true };
  ['№', 'Зардлын нэр', 'Тоо', 'Нэгж', 'Нэгж үнэ (₮)', 'Дүн (₮)'].forEach((h, i) => {
    const c = ws.getCell(3, i + 1); c.value = h; c.font = { name: FONT, bold: true }; c.fill = HEAD_FILL; c.border = border;
  });
  qc.calc.rows.forEach((r, i) => {
    const row = 4 + i;
    ws.getRow(row).values = [r.no, r.name, r.qty, r.unit, r.unit_price];
    ws.getCell(row, 6).value = { formula: `C${row}*E${row}` };
    [3, 5].forEach((c) => { ws.getCell(row, c).font = { name: FONT, color: BLUE }; });
    [3, 5, 6].forEach((c) => { ws.getCell(row, c).numFmt = NUM; });
    styleRange(ws, row, row, 1, 6, (c) => { c.border = border; });
  });
  const tr = 4 + qc.calc.rows.length;
  ws.getCell(tr, 2).value = 'НИЙТ';
  ws.getCell(tr, 6).value = { formula: `SUM(F4:F${tr - 1})` }; ws.getCell(tr, 6).numFmt = NUM;
  styleRange(ws, tr, tr, 1, 6, (c) => { c.font = { name: FONT, bold: true }; c.border = border; });
  return { totalCell: `F${tr}` };
}

function checklistSheet(wb, data, qc) {
  const ws = wb.addWorksheet('Шалгах жагсаалт');
  ws.columns = [6, 50, 18, 30, 12, 40].map((w) => ({ width: w }));
  ['№', 'Шаардлага (ТББ)', 'ТББ-ийн заалт', 'Нотлох баримт', 'Төлөв', 'Хийх ажил'].forEach((h, i) => {
    const c = ws.getCell(1, i + 1); c.value = h; c.font = { name: FONT, bold: true }; c.fill = HEAD_FILL; c.border = border;
    c.alignment = { wrapText: true, vertical: 'middle' };
  });
  const st = qc.statusById;
  const label = { ok: '✅ Хангана', missing: '⚠️ Дутуу', fail: '❌ Хангахгүй' };
  (data.tender.requirements || []).forEach((r, i) => {
    const s = st.get(r.id) || {};
    const row = ws.getRow(2 + i);
    row.values = [i + 1, r.text, r.ref, r.evidence, label[s.status] || '?', s.action || ''];
    row.eachCell((c) => { c.border = border; c.alignment = { wrapText: true, vertical: 'top' }; });
  });
}

// Серверт: файл бичихгүй, workbook-ийг буцаана (томьёог plan-v2/xlsxCalc-аар бодож тулгана)
function buildXlsx(data, qc) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Менежер Ai';
  const res = data.meta.type === 'goods' ? goodsSheet(wb, data, qc) : serviceSheet(wb, data, qc);
  checklistSheet(wb, data, qc);
  wb.eachSheet((ws) => base(ws));
  return { wb, ...res, sheet: data.meta.type === 'goods' ? 'Үнийн задаргаа' : 'Үйлчилгээний төсөв' };
}

module.exports = { buildXlsx };
