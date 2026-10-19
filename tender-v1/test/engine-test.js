// Регресс: скиллийн 7 жишээг серверийн хөдөлгүүрээр ажиллуулж, скиллийн (LibreOffice) үр дүнтэй харьцуулна.
const fs = require('fs'), path = require('path');
const { buildPackage } = require('../engine');
const expect = { 'goods-test': 'deliver', 'services-test': 'nogo|blocked', 'real-estation': 'deliver', 'real-security': 'deliver', 'real-security-2': 'deliver', 'real-office-lot3': 'deliver', 'real-office-lot3-nogo': 'nogo' };
(async () => {
  let bad = 0; const out = process.env.OUT;
  for (const f of fs.readdirSync(path.join(__dirname, 'samples')).filter((x) => x.endsWith('.json'))) {
    const name = f.replace('.json', ''), data = JSON.parse(fs.readFileSync(path.join(__dirname, 'samples', f), 'utf8'));
    const r = await buildPackage(data);
    const got = r.report.delivered ? 'deliver' : r.qc.decision === 'nogo' ? 'nogo' : 'blocked';
    const ok = (expect[name] || '').split('|').includes(got);
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${name}: ${got} | ${r.qc.decision} | нийт ${r.report.total} | excel ${JSON.stringify(r.report.excel_check || {})} | файл ${r.files.length} | чат ${r.chat.length} тэмдэгт`);
    if (out) { const d = path.join(out, name); fs.mkdirSync(d, { recursive: true }); for (const x of r.files) fs.writeFileSync(path.join(d, x.name), x.buf); fs.writeFileSync(path.join(d, 'chat.txt'), r.chat); }
  }
  console.log(bad ? `АЛДАА: ${bad}` : 'Бүгд зөв'); process.exit(bad ? 1 : 0);
})();
