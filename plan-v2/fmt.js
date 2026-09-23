const f = (n) => (n === null || n === undefined || !isFinite(n)) ? "—" : Math.round(n).toLocaleString("en-US");
const m1 = (n) => (!isFinite(n) ? "—" : (n / 1e6).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const pc = (n, d = 1) => (!isFinite(n) ? "—" : (n * 100).toFixed(d) + "%");

// НДШ, ХХОАТ-тай цалингийн тооцоо (payroll_calc-ийн порт)
function payroll(staff, er = 0.135, ee = 0.115, tax = 0.10) {
  const rows = staff.map(s => {
    const eeSi = Math.round(s.gross * ee), it = Math.round((s.gross - eeSi) * tax), erSi = Math.round(s.gross * er);
    return { ...s, eeSi, it, net: s.gross - eeSi - it, erSi, total: (s.gross + erSi) * s.count };
  });
  return { rows, gross: staff.reduce((a, s) => a + s.gross * s.count, 0), total: rows.reduce((a, r) => a + r.total, 0) };
}
module.exports = { f, m1, pc, payroll };
