'use strict';
// Тендерийн хөдөлгүүр (mongol-tender скиллийн scripts/build.js-ийн серверийн хувилбар).
// Файл бичихгүй, LibreOffice шаардахгүй: бүх гаралтыг санах ойд (Buffer) буцаана.
// Excel-ийн томьёог plan-v2/xlsxCalc-аар бодож, кодын нийт дүнтэй тулгана — зөрвөл материал илгээхгүй.
const { runQC } = require('./qc');
const { buildXlsx } = require('./xlsx');
const { checklistDoc, materialsDoc, draftDoc, toBuffer } = require('./docx');
const { chatSummary } = require('./chat');
const { computeWorkbook } = require('../../plan-v2/xlsxCalc');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const addrRC = (a) => { const m = /^([A-Z]+)(\d+)$/.exec(a); let c = 0; for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64); return [Number(m[2]), c]; };

// data — json-contract.md-ийн бүтэн JSON (meta, tender, customer, ...)
// opts.force — оролцогч дутуу/хангахгүй байгааг мэдсээр байж материалаа авахыг сонгосон: шалгах жагсаалт + маягтуудыг
//              [ДУТУУ] тэмдэглэгээтэй гаргана (үнэ бүрэн бол Excel-ийг тулгаж гаргана, дутуу бол Excel-гүй).
// → { qc, chat, report, files:[{ name, buf, mime }] }
async function buildPackage(data, opts = {}) {
  const qc = runQC(data);
  const files = [];
  files.push({ name: '01_Шалгах_жагсаалт.docx', buf: await toBuffer(checklistDoc(data, qc)), mime: DOCX });
  const chat = chatSummary(data, qc);
  const report = { decision: qc.decision, counts: qc.counts, total: qc.calc.total, ratio: qc.ratio, issues: qc.issues, delivered: false, forced: false };
  const gated = qc.decision === 'nogo' || qc.blocked;

  if (gated && !opts.force) {
    report.reason = qc.decision === 'nogo' ? 'Шаардлага хангахгүй — зөвхөн шалгах жагсаалт, дүгнэлт гаргав.' : 'Чанарын хяналт зогсоов — материалыг илгээхгүй.';
  } else {
    report.forced = gated;
    const priced = qc.calc.complete !== false && qc.calc.total != null && qc.calc.total > 0;
    let wb = null;
    if (priced) {
      const x = buildXlsx(data, qc); wb = x.wb;
      const calc = computeWorkbook(wb);
      let value = null; try { value = calc.value(x.sheet, ...addrRC(x.totalCell)); } catch (e) { value = e.message; }
      report.excel_check = { formulas: calc.count, errors: calc.errors.length, value };
      if (calc.errors.length || typeof value !== 'number' || Math.abs(value - qc.calc.total) > 0.5) {
        report.reason = `Excel-ийн нийт (${value}) кодын тооцоо (${qc.calc.total})-той таарахгүй эсвэл томьёоны алдаатай — илгээхгүй.`;
        report.excel_bad = true;
        return { qc, chat, report, files };
      }
    } else report.excel_skipped = 'Үнэ дутуу тул үнийн задаргааны Excel гаргаагүй';
    files.push({ name: '02_Тендерийн_материал.docx', buf: await toBuffer(materialsDoc(data, qc)), mime: DOCX });
    if (wb) files.push({ name: '03_Үнийн_задаргаа.xlsx', buf: Buffer.from(await wb.xlsx.writeBuffer()), mime: XLSX });
    let i = 0;
    for (const d of data.drafts || []) {
      if (!(d.sections || []).length) continue;
      files.push({ name: `${String(4 + i++).padStart(2, '0')}_${d.file || d.key}_ТӨСӨЛ.docx`, buf: await toBuffer(draftDoc(data, d)), mime: DOCX });
    }
    report.delivered = true;
  }
  report.files = files.map((f) => f.name);
  return { qc, chat, report, files };
}

module.exports = { buildPackage, runQC };
