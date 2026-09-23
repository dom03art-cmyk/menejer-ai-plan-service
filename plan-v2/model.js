// Санхүүгийн загвар — AI биш, КОД тооцоолно. Бүх тоо нэг таамаглалын объектоос (A) гарна.
// A-ийн бүтцийг intake.js-ийн SCHEMA-аас үз.

const MONTHS_MN = ["1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар", "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар"];

function productUnit(p) {
  const mat = Object.values(p.materials || {}).reduce((a, b) => a + Number(b || 0), 0);
  const labor = Number(p.labor || 0);
  const net = p.price / (1 + (p.vat_included === false ? 0 : 0.10));
  return { mat, labor, cogs: mat + labor, delivery: Number(p.delivery || 0), net };
}

function loanSchedule(L, r, n, grace) {
  const s = []; let bal = L;
  if (!L || !n) return s;
  const pay = r > 0 ? L * r / (1 - Math.pow(1 + r, -(n - grace))) : L / (n - grace);
  for (let m = 1; m <= n; m++) {
    const it = bal * r;
    let pr = m <= grace ? 0 : pay - it;
    if (m === n) pr = bal;
    s.push({ m, open: bal, int: it, prin: pr, pay: it + pr, close: bal - pr });
    bal -= pr;
  }
  return s;
}

function run(A, o = {}) {
  const vm = o.vol_mult ?? 1, pm = o.price_mult ?? 1, mm = o.mat_mult ?? 1, fm = o.fixed_mult ?? 1;
  const r = o.rate ?? A.loan.rate_monthly, grace = o.grace ?? (A.loan.grace_months || 0);
  const L = A.loan.amount;
  const sched = loanSchedule(L, r, A.loan.months, grace);
  const capexTotal = A.capex.reduce((a, c) => a + c.qty * c.unit_price, 0);
  const inkindTotal = (A.inkind || []).reduce((a, c) => a + c.value, 0);
  const launch = Math.max(0, L - capexTotal - A.init_inventory);
  const erSi = A.er_si ?? 0.135;
  const years = [], months = [];
  const sSum = A.season.reduce((a, b) => a + b, 0);
  for (let y = 0; y < 5; y++) {
    const pg = Math.pow(1 + A.price_growth, y) * pm, vg = Math.pow(1 + A.varcost_growth, y), fg = Math.pow(1 + A.fixed_growth, y) * fm;
    const Y = { rev: 0, mat: 0, labor: 0, deliv: 0, units: {}, rev_p: {} };
    for (const p of A.products) {
      const u = productUnit(p);
      const v = p.volumes[y] * vm;
      const rev = v * u.net * pg;
      Y.units[p.key] = v; Y.rev_p[p.key] = rev;
      Y.rev += rev; Y.mat += v * u.mat * vg * mm; Y.labor += v * u.labor * vg; Y.deliv += v * u.delivery * vg;
    }
    Y.cogs = Y.mat + Y.labor;
    Y.fees = Y.rev * A.pay_fee; Y.mkt = Y.rev * A.mkt_rate;
    const staffCost = A.staff.filter(s => (s.from_year || 1) <= y + 1).reduce((a, s) => a + s.count * s.gross, 0) * (1 + erSi) * 12 * fg;
    const fx = { "Цалин, НДШ (тогтмол ажилтан)": staffCost };
    for (const [k, v] of Object.entries(A.fixed_monthly)) fx[k] = v * 12 * fg;
    if (y === 0 && launch > 0) fx["Нээлтийн маркетингийн кампанит ажил"] = launch;
    Y.fixed = fx; Y.fixed_tot = Object.values(fx).reduce((a, b) => a + b, 0);
    Y.gross = Y.rev - Y.cogs;
    Y.ebitda = Y.gross - Y.deliv - Y.fees - Y.mkt - Y.fixed_tot;
    let dep = 0;
    for (const c of A.capex) if (y < c.life) dep += c.qty * c.unit_price / c.life;
    for (const c of (A.inkind || [])) if (y < c.life) dep += c.value / c.life;
    for (const e of (A.extra_capex || [])) if (y + 1 >= e.year && y + 1 < e.year + e.life) dep += e.amount / e.life;
    Y.dep = dep; Y.ebit = Y.ebitda - dep;
    const ms = sched.slice(y * 12, y * 12 + 12);
    Y.int = ms.reduce((a, s) => a + s.int, 0); Y.prin = ms.reduce((a, s) => a + s.prin, 0); Y.ds = Y.int + Y.prin;
    Y.pbt = Y.ebit - Y.int; Y.tax = Math.max(0, Y.pbt) * A.cit_eff; Y.ni = Y.pbt - Y.tax;
    Y.capex_extra = (A.extra_capex || []).filter(e => e.year === y + 1).reduce((a, e) => a + e.amount, 0);
    Y.inv_end = Y.mat / 12 * 1.5;
    years.push(Y);
    if (y < 3) {
      for (let mi = 0; mi < 12; mi++) {
        const w = A.season[mi] / sSum;
        const calMonth = ((A.start_month_index ?? 10) + mi) % 12;
        const calYear = A.start_year + Math.floor(((A.start_month_index ?? 10) + mi + y * 12) / 12);
        const units = {}; for (const k in Y.units) units[k] = Y.units[k] * w;
        months.push({ y: y + 1, label: `${calYear}.${String(calMonth + 1).padStart(2, "0")}`, mlabel: MONTHS_MN[calMonth], units, rev: Y.rev * w, w });
      }
    }
  }
  // cash flow & balance
  let cash = L - capexTotal - A.init_inventory, invPrev = A.init_inventory;
  let faGross = capexTotal + inkindTotal, accdep = 0, re = 0, loanbal = L;
  const eq0 = inkindTotal + (A.cash_equity || 0); cash += (A.cash_equity || 0);
  const first12 = sched.slice(0, 12).reduce((a, s) => a + s.prin, 0);
  const bs = [{ cash, inv: A.init_inventory, fa: faGross, loan_cur: first12, loan_lt: L - first12, eq: eq0, re: 0 }];
  const cfs = [];
  years.forEach((Y, y) => {
    const dinv = Y.inv_end - invPrev; invPrev = Y.inv_end;
    const op = Y.ni + Y.dep - dinv, invest = -Y.capex_extra, fin = -Y.prin;
    const open = cash; cash = cash + op + invest + fin;
    cfs.push({ open, op, invest, fin, close: cash, dinv });
    faGross += Y.capex_extra; accdep += Y.dep; re += Y.ni; loanbal -= Y.prin;
    const nxt = sched.slice((y + 1) * 12, (y + 2) * 12).reduce((a, s) => a + s.prin, 0);
    bs.push({ cash, inv: Y.inv_end, fa: faGross - accdep, loan_cur: nxt, loan_lt: Math.max(0, loanbal - nxt), eq: eq0, re });
  });
  for (const b of bs) { b.assets = b.cash + b.inv + b.fa; b.le = b.loan_cur + b.loan_lt + b.eq + b.re; b.diff = b.assets - b.le; }
  const inv0 = capexTotal + A.init_inventory + inkindTotal;
  const fcf = [-inv0];
  years.forEach((Y, y) => { let f = Y.ebitda - Y.tax - Y.capex_extra - cfs[y].dinv; if (y === 4) f += Y.inv_end; fcf.push(f); });
  const dscr = years.map(Y => Y.ds > 0 ? (Y.ebitda - Y.tax) / Y.ds : null);
  // monthly cash (3 years)
  const mc = []; let mcash = bs[0].cash;
  months.forEach((m, i) => {
    const Y = years[m.y - 1];
    const variable = (Y.cogs + Y.deliv + Y.fees + Y.mkt) * m.w;
    const fixed = (Y.fixed_tot - (m.y === 1 ? launch : 0)) / 12 + (i === 0 ? launch : 0);
    const debt = sched[i] ? sched[i].pay : 0;
    const net = m.rev - variable - fixed - Y.tax * m.w - debt; mcash += net;
    mc.push({ label: m.label, rev: m.rev, variable, fixed, debt, net, cash: mcash });
  });
  return { years, months, sched, bs, cfs, fcf, dscr, inv0, capexTotal, inkindTotal, launch, mc };
}

const npv = (r, cf) => cf.reduce((a, c, i) => a + c / Math.pow(1 + r, i), 0);
function irr(cf) { let lo = -0.99, hi = 10; if (npv(hi, cf) > 0) return hi; for (let i = 0; i < 300; i++) { const mid = (lo + hi) / 2; npv(mid, cf) > 0 ? lo = mid : hi = mid; } return (lo + hi) / 2; }
function payback(cf) { let c = cf[0]; for (let i = 1; i < cf.length; i++) { const p = c; c += cf[i]; if (c >= 0) return (i - 1) + (-p / cf[i]); } return null; }

function analyse(A) {
  const R = run(A);
  const metric = (r) => ({ npv: npv(A.disc, r.fcf), irr: irr(r.fcf), pb: payback(r.fcf) });
  const base = metric(R);
  const scen = {};
  for (const [nm, mult] of [["Реалистик", 1], ["Консерватив", 0.85], ["Пессимистик", 0.70]]) {
    const r = run(A, { vol_mult: mult });
    scen[nm] = { rev: r.years.map(y => y.rev), ni: r.years.map(y => y.ni), ebitda: r.years.map(y => y.ebitda), dscr: r.dscr.slice(0, 3), mrev: r.months.map(m => m.rev), ...metric(r) };
  }
  const cases = [["Баазын тохиолдол", "—", {}], ["Түүхий эдийн үнэ өсөх", "Материал +15%", { mat_mult: 1.15 }], ["Борлуулалтын үнэ буурах", "Үнэ −10%", { price_mult: 0.9 }],
    ["Борлуулалтын тоо буурах", "Тоо −20%", { vol_mult: 0.8 }], ["Тогтмол зардал өсөх", "Тогтмол +15%", { fixed_mult: 1.15 }],
    ["Хосолсон сөрөг", "Тоо −10%, материал +10%", { vol_mult: 0.9, mat_mult: 1.1 }], ["Зээлийн хүү өсөх", "Жилийн хүү +4 н.х.", { rate: A.loan.rate_monthly + 0.04 / 12 }]];
  const sens = cases.map(([name, change, kw]) => { const r = run(A, kw); const m = metric(r); return { name, change, ni1: r.years[0].ni, ...m, dscr1: r.dscr[0] }; });
  const grace6 = run(A, { grace: 6 }).dscr[0];
  // break-even on main product equivalent
  const Y1 = R.years[0]; const main = A.products[0]; const u = productUnit(main);
  const fixed1 = Y1.fixed_tot + Y1.dep + Y1.int;
  const cm = u.net - u.cogs - u.delivery - u.net * (A.pay_fee + A.mkt_rate);
  const bep = { units: fixed1 / cm, revenue: fixed1 / cm * u.net, cm, fixed: fixed1 };
  const cum = []; R.fcf.reduce((a, c) => { cum.push(a + c); return a + c; }, 0);
  return { A, R, ...base, scen, sens, grace6, bep, cum, balanceOk: R.bs.every(b => Math.abs(b.diff) < 1) };
}

module.exports = { run, analyse, productUnit, npv, irr, payback, loanSchedule, MONTHS_MN };
