// Байгууллагын жилийн төсвийн тооцоо (mongol-annual-plan skill-ийн annual_calc.py-ийн Node хувилбар, SPEC.md-ийн дүрмээр).
// Баримт бичиг, Excel-ийн БҮХ мөнгөн тоо эндээс гарна — AI тоо зохиохгүй.
//   normalizeCfg(cfg) → өгөгдмөл утга нөхөж, шалгасан тохиргоо (cfg._notes-д засварын тэмдэглэл)
//   calculate(cfg)    → { months[12], totals, lines, by_dept, groups, kpis, scenarios, warnings, ... }
const MN = ["1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар", "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар"];
const COMMON = "Нийтлэг";
const INIT_GROUP = "Төсөл, хөтөлбөр";

const LABELS = {
  company: { income: "Борлуулалтын орлого", income_short: "Орлого", direct: "Борлуулсан бүтээгдэхүүний өртөг", gross: "Нийт ашиг", result: "Цэвэр ашиг",
    pre: "Татварын өмнөх ашиг", op: "Үйл ажиллагааны ашиг", margin: "Цэвэр ашгийн хувь", income_src: "Орлогын эх үүсвэр" },
  state: { income: "Санхүүжилт, орлого", income_short: "Санхүүжилт", direct: "Үйлчилгээний шууд зардал", gross: "Шууд зардлын дараах үлдэгдэл",
    result: "Төсвийн үр дүн (хэмнэлт +, хэтрэлт −)", pre: "Санхүүгийн зардлын дараах үр дүн", op: "Үйл ажиллагааны үр дүн", margin: "Үр дүн ÷ санхүүжилт", income_src: "Санхүүжилтийн эх үүсвэр" },
  ngo: { income: "Орлого, санхүүжилт", income_short: "Орлого", direct: "Хөтөлбөрийн шууд зардал", gross: "Шууд зардлын дараах үлдэгдэл",
    result: "Жилийн үр дүн (илүүдэл +, дутагдал −)", pre: "Санхүүгийн зардлын дараах үр дүн", op: "Үйл ажиллагааны үр дүн", margin: "Үр дүн ÷ орлого", income_src: "Санхүүжилтийн эх үүсвэр" },
};

const num = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ").replace(/^-/, "−");
const money = (n) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : num(n) + " ₮");
const pct = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : (x * 100).toFixed(d) + "%");
const sum = (a) => a.reduce((s, x) => s + x, 0);
const q4 = (v) => [sum(v.slice(0, 3)), sum(v.slice(3, 6)), sum(v.slice(6, 9)), sum(v.slice(9, 12))];
const zeros = () => Array(12).fill(0);

// ───────────── Оролтыг шалгах, өгөгдмөл нөхөх ─────────────
function toNum(x, def = 0) {
  if (typeof x === "number") return Number.isFinite(x) ? x : def;
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "string") {
    let s = x.trim().replace(/[\s ,₮]/g, "").replace(/−/g, "-");
    if (!s) return def;
    let k = 1; if (s.endsWith("%")) { k = 0.01; s = s.slice(0, -1); }
    const v = Number(s); return Number.isFinite(v) ? v * k : def;
  }
  return def;
}
const has = (o, k) => o && o[k] !== undefined && o[k] !== null && o[k] !== "";
const clampM = (x, def) => { const v = Math.round(toNum(x, def)); return Math.min(12, Math.max(1, Number.isFinite(v) ? v : def)); };
const str = (x, def = "") => (x === undefined || x === null || String(x).trim() === "" ? def : String(x).trim());

function normalizeCfg(cfg) {
  if (cfg && cfg._normalized) return cfg;
  cfg = cfg || {};
  const notes = [];
  const arr12 = (v, name, fill = 0) => {
    if (!Array.isArray(v)) { notes.push(`«${name}»: 12 сарын утга массив биш тул ${fill}-ээр нөхөв.`); return Array(12).fill(fill); }
    const a = v.slice(0, 12).map((x) => toNum(x, fill));
    if (v.length !== 12) { notes.push(`«${name}»: ${v.length} утга өгсөн (12 байх ёстой) — ${v.length > 12 ? "илүүг хасав" : `дутууг ${fill}-ээр нөхөв`}.`); while (a.length < 12) a.push(fill); }
    return a;
  };
  const weights = (v, name) => {
    let w = arr12(v, name, 1).map((x) => Math.max(0, x));
    const s = sum(w);
    if (s <= 0) { notes.push(`«${name}»: улирлын жингийн нийлбэр 0 тул тэнцүү жин авав.`); w = Array(12).fill(1); }
    const k = 12 / sum(w);
    return w.map((x) => Math.round(x * k * 10000) / 10000);
  };
  const months = (a, b, name) => {
    let s = clampM(a, 1), e = clampM(b, 12);
    if (s > e) { notes.push(`«${name}»: эхлэх сар (${s}) дуусах сараас (${e}) хойно тул дуусах сарыг ${s} болгов.`); e = s; }
    return [s, e];
  };
  let type = str(cfg.org_type, "company").toLowerCase();
  if (type === "public" || type === "government" || type === "төр") type = "state";
  if (!LABELS[type]) { notes.push(`org_type «${cfg.org_type}» танигдсангүй — company гэж авав.`); type = "company"; }
  const out = {
    _normalized: true, _notes: notes,
    org_name: str(cfg.org_name, "Байгууллага"), org_type: type, year: Math.round(toNum(cfg.year, new Date().getFullYear() + 1)),
    opening_cash: toNum(cfg.opening_cash), seasonality: weights(cfg.seasonality || Array(12).fill(1), "seasonality"),
    si_rate: has(cfg, "si_rate") ? toNum(cfg.si_rate, 0.125) : 0.125,
    tax_rate: has(cfg, "tax_rate") ? toNum(cfg.tax_rate, 0) : (type === "company" ? 0.10 : 0),
    min_wage: toNum(cfg.min_wage), existing_depreciation_monthly: toNum(cfg.existing_depreciation_monthly),
    raise: null, income: [], staff: [], expenses: [], initiatives: [], capex: [], loans: [], prior: null, scenarios: null,
    si_source: str(cfg.si_source), tax_source: str(cfg.tax_source),
  };
  if (out.si_rate > 1) out.si_rate /= 100;
  if (out.tax_rate > 1) out.tax_rate /= 100;
  if (cfg.raise && toNum(cfg.raise.pct) !== 0) {
    let p = toNum(cfg.raise.pct); if (p > 1) p /= 100;
    out.raise = { month: clampM(cfg.raise.month, 1), pct: p, source: str(cfg.raise.source, "Байгууллагын шийдвэр") };
  }
  (cfg.income || []).forEach((ln, i) => {
    const name = str(ln.name, `Орлого ${i + 1}`);
    const kind = ln.kind === "sales" || ln.kind === "amount" ? ln.kind : (has(ln, "price") && (has(ln, "units_annual") || has(ln, "units_monthly")) ? "sales" : "amount");
    const o = { name, kind, dept: str(ln.dept, COMMON), unit: str(ln.unit), source: str(ln.source, "Таамаглал"), prior: has(ln, "prior") ? toNum(ln.prior) : null,
      price: kind === "sales" ? toNum(ln.price) : 1, unit_cost: kind === "sales" ? toNum(ln.unit_cost) : 0, cost_pct: toNum(ln.cost_pct),
      seasonality: Array.isArray(ln.seasonality) ? weights(ln.seasonality, name + " / seasonality") : null, annual: null, monthly: null };
    if (o.cost_pct > 1) o.cost_pct /= 100;
    const mKey = kind === "sales" ? "units_monthly" : "monthly", aKey = kind === "sales" ? "units_annual" : "annual";
    if (Array.isArray(ln[mKey])) o.monthly = arr12(ln[mKey], name);
    else if (has(ln, aKey)) o.annual = toNum(ln[aKey]);
    else { notes.push(`Орлого «${name}»: ${aKey} эсвэл ${mKey} өгөөгүй тул 0 гэж авав.`); o.annual = 0; }
    out.income.push(o);
  });
  (cfg.staff || []).forEach((s, i) => {
    const title = str(s.title, `Ажилтан ${i + 1}`); const [st, en] = months(s.start, s.end, title);
    out.staff.push({ title, dept: str(s.dept, COMMON), count: Math.max(0, toNum(s.count, 1)), gross: Math.max(0, toNum(s.gross)), start: st, end: en, new: !!s.new });
  });
  (cfg.expenses || []).forEach((e, i) => {
    const name = str(e.name, `Зардал ${i + 1}`);
    const o = { name, dept: str(e.dept, COMMON), group: str(e.group, "Үйл ажиллагааны зардал"), source: str(e.source, "Таамаглал"), prior: has(e, "prior") ? toNum(e.prior) : null,
      mode: "monthly", pct_of_income: null, m: zeros() };
    if (has(e, "pct_of_income")) { o.mode = "pct_of_income"; o.pct_of_income = toNum(e.pct_of_income); if (o.pct_of_income > 1) o.pct_of_income /= 100; }
    else if (Array.isArray(e.by_month)) { o.mode = "by_month"; o.m = arr12(e.by_month, name); }
    else if (has(e, "monthly")) { o.mode = "monthly"; o.m = Array(12).fill(toNum(e.monthly)); }
    else if (has(e, "annual")) { o.mode = "annual"; o.m = Array(12).fill(toNum(e.annual) / 12); }
    else notes.push(`Зардал «${name}»: monthly | annual | by_month | pct_of_income-ийн аль нь ч өгөөгүй тул 0 гэж авав.`);
    out.expenses.push(o);
  });
  (cfg.initiatives || []).forEach((it, i) => {
    const name = str(it.name, `Төсөл ${i + 1}`); const [st, en] = months(it.start, it.end, name);
    const life = toNum(it.life_years, 5);
    out.initiatives.push({ name, dept: str(it.dept, COMMON), owner: str(it.owner), start: st, end: en, budget: Math.max(0, toNum(it.budget)), capex: !!it.capex,
      life_years: life > 0 ? life : 5, kpi: str(it.kpi) });
  });
  (cfg.capex || []).forEach((c, i) => {
    const life = toNum(c.life_years, 5);
    out.capex.push({ name: str(c.name, `Хөрөнгө оруулалт ${i + 1}`), dept: str(c.dept, COMMON), month: clampM(c.month, 1), amount: Math.max(0, toNum(c.amount)), life_years: life > 0 ? life : 5 });
  });
  (cfg.loans || []).forEach((l, i) => {
    const name = str(l.name, `Зээл ${i + 1}`); const [st, en] = months(l.start, l.end, name);
    out.loans.push({ name, monthly_principal: toNum(l.monthly_principal), monthly_interest: toNum(l.monthly_interest), start: st, end: en });
  });
  if (cfg.prior && typeof cfg.prior === "object") {
    const p = cfg.prior, n = (k) => (has(p, k) ? toNum(p[k]) : null);
    out.prior = { year: Math.round(toNum(p.year, out.year - 1)), income_total: n("income_total"), expense_total: n("expense_total"), payroll_total: n("payroll_total"), result: n("result"), basis: str(p.basis) };
  }
  const sc = cfg.scenarios || {}, ps = sc.pessimistic || {}, op = sc.optimistic || {};
  out.scenarios = { pessimistic: { income: has(ps, "income") ? toNum(ps.income) : -0.15, cost: has(ps, "cost") ? toNum(ps.cost) : 0.05 },
    optimistic: { income: has(op, "income") ? toNum(op.income) : 0.10, cost: has(op, "cost") ? toNum(op.cost) : 0 } };
  return out;
}

// ───────────── Хугацаагаар хязгаарлах (жил биш төлөвлөгөө) ─────────────
// Жилийн загварыг хадгалж, хугацаанаас гадуурх сарын орлого, зардал, хөрөнгө оруулалтыг 0 болгоно. cfg нь normalizeCfg-ийн гаралт.
function clipToPeriod(c, months) {
  const s = months[0], e = months[months.length - 1], inP = (m) => m >= s && m <= e;
  const mask = (arr) => arr.map((v, i) => (inP(i + 1) ? v : 0));
  c.active = [s, e]; c._notes = c._notes || [];
  for (const ln of c.income) {
    const w = ln.seasonality || c.seasonality, sw = sum(w);
    ln.monthly = mask(ln.monthly ? ln.monthly : w.map((x) => (ln.annual * x) / sw)); ln.annual = null; ln.prior = null;
  }
  c.staff = c.staff.filter((x) => x.end >= s && x.start <= e).map((x) => ({ ...x, start: Math.max(x.start, s), end: Math.min(x.end, e) }));
  for (const x of c.expenses) { x.prior = null; if (x.pct_of_income === null) { x.m = mask(x.m); x.mode = "by_month"; } }
  c.initiatives = c.initiatives.filter((it) => (it.capex ? inP(it.start) : it.end >= s && it.start <= e)).map((it) => {
    if (it.capex) return it;
    const ns = Math.max(it.start, s), ne = Math.min(it.end, e), k = (ne - ns + 1) / (it.end - it.start + 1);
    return { ...it, start: ns, end: ne, budget: Math.round(it.budget * k) };
  });
  c.capex = c.capex.filter((x) => inP(x.month));
  c.loans = c.loans.filter((l) => l.end >= s && l.start <= e).map((l) => ({ ...l, start: Math.max(l.start, s), end: Math.min(l.end, e) }));
  c.prior = null;
  return c;
}

// ───────────── Сар бүрийн тооцоо ─────────────
// incK — орлогын (тоо хэмжээний) үржүүлэгч, costK — тогтмол үйл ажиллагааны зардал ба төслийн зардлын үржүүлэгч.
function incomeQty(ln, season) {
  if (ln.monthly) return ln.monthly.slice();
  const w = ln.seasonality || season, s = sum(w);
  return w.map((x) => (ln.annual * x) / s);
}
function capexItems(c) {
  const out = [];
  c.initiatives.forEach((it, k) => { if (it.capex) out.push({ name: it.name, dept: it.dept, month: it.start, amount: it.budget, life_years: it.life_years, from: "initiative", idx: k }); });
  c.capex.forEach((x, k) => out.push({ ...x, from: "capex", idx: k }));
  return out;
}

function run(c, incK = 1, costK = 1) {
  const raiseM = c.raise ? c.raise.month : 13, raiseP = c.raise ? c.raise.pct : 0;
  const R = {};
  R.income_lines = c.income.map((ln) => {
    const qty = incomeQty(ln, c.seasonality).map((x) => x * incK);
    const income = qty.map((q) => q * ln.price);
    const direct = qty.map((q, i) => q * ln.unit_cost + income[i] * ln.cost_pct);
    return { name: ln.name, dept: ln.dept, kind: ln.kind, unit: ln.unit, price: ln.price, unit_cost: ln.unit_cost, cost_pct: ln.cost_pct, source: ln.source, prior: ln.prior,
      qty, income, direct, total: sum(income), direct_total: sum(direct), qty_total: sum(qty) };
  });
  R.income = zeros().map((_, i) => sum(R.income_lines.map((l) => l.income[i])));
  R.direct = zeros().map((_, i) => sum(R.income_lines.map((l) => l.direct[i])));
  R.staff_lines = c.staff.map((s) => {
    const monthly = zeros().map((_, i) => (s.start <= i + 1 && i + 1 <= s.end ? s.count * s.gross * (i + 1 >= raiseM ? 1 + raiseP : 1) : 0));
    return { ...s, monthly, total: sum(monthly), si_total: sum(monthly) * c.si_rate };
  });
  R.payroll = zeros().map((_, i) => sum(R.staff_lines.map((l) => l.monthly[i])));
  R.si = R.payroll.map((x) => x * c.si_rate);
  R.headcount = zeros().map((_, i) => sum(c.staff.filter((s) => s.start <= i + 1 && i + 1 <= s.end).map((s) => s.count)));
  R.expense_lines = c.expenses.map((e) => {
    const monthly = zeros().map((_, i) => (e.pct_of_income !== null ? e.pct_of_income * R.income[i] : e.m[i] * costK));
    return { name: e.name, dept: e.dept, group: e.group, mode: e.mode, pct_of_income: e.pct_of_income, source: e.source, prior: e.prior, monthly, total: sum(monthly), variable: e.pct_of_income !== null };
  });
  R.initiative_lines = c.initiatives.map((it) => {
    const n = it.end - it.start + 1;
    const monthly = zeros().map((_, i) => (!it.capex && it.start <= i + 1 && i + 1 <= it.end ? (it.budget / n) * costK : 0));
    return { name: it.name, dept: it.dept, group: INIT_GROUP, monthly, total: sum(monthly), capex: it.capex };
  });
  R.opex = zeros().map((_, i) => sum(R.expense_lines.map((l) => l.monthly[i])));
  R.var_opex = zeros().map((_, i) => sum(R.expense_lines.filter((l) => l.variable).map((l) => l.monthly[i])));
  R.initiative_opex = zeros().map((_, i) => sum(R.initiative_lines.map((l) => l.monthly[i])));
  R.capex_items = capexItems(c).map((x) => {
    const monthly = zeros().map((_, i) => (i + 1 === x.month ? x.amount : 0));
    const dep = zeros().map((_, i) => (i + 1 > x.month ? x.amount / x.life_years / 12 : 0));
    return { ...x, monthly, dep, dep_total: sum(dep) };
  });
  R.capex = zeros().map((_, i) => sum(R.capex_items.map((x) => x.monthly[i])));
  const inAct = (i) => !c.active || (c.active[0] <= i + 1 && i + 1 <= c.active[1]);
  R.capex_items.forEach((x) => { x.dep = x.dep.map((v, i) => (inAct(i) ? v : 0)); x.dep_total = sum(x.dep); });
  R.depreciation = zeros().map((_, i) => (inAct(i) ? c.existing_depreciation_monthly + sum(R.capex_items.map((x) => x.dep[i])) : 0));
  const act = (l, i) => l.start <= i + 1 && i + 1 <= l.end;
  R.interest = zeros().map((_, i) => sum(c.loans.filter((l) => act(l, i)).map((l) => l.monthly_interest)));
  R.loan_principal = zeros().map((_, i) => sum(c.loans.filter((l) => act(l, i)).map((l) => l.monthly_principal)));
  R.gross = R.income.map((x, i) => x - R.direct[i]);
  R.op = R.gross.map((x, i) => x - R.payroll[i] - R.si[i] - R.opex[i] - R.initiative_opex[i] - R.depreciation[i]);
  R.ebt = R.op.map((x, i) => x - R.interest[i]);
  R.tax = []; let cum = 0, prev = 0;
  for (let i = 0; i < 12; i++) { cum += R.ebt[i]; const ytd = Math.max(0, cum) * c.tax_rate; R.tax.push(ytd - prev); prev = ytd; }
  R.net = R.ebt.map((x, i) => x - R.tax[i]);
  R.cash_in = R.income.slice();
  R.cash_out = zeros().map((_, i) => R.direct[i] + R.payroll[i] + R.si[i] + R.opex[i] + R.initiative_opex[i] + R.interest[i] + R.tax[i] + R.capex[i] + R.loan_principal[i]);
  R.cash_open = []; R.cash = []; let cash = c.opening_cash;
  for (let i = 0; i < 12; i++) { R.cash_open.push(cash); cash = cash + R.cash_in[i] - R.cash_out[i]; R.cash.push(cash); }
  const keys = ["income", "direct", "gross", "payroll", "si", "opex", "var_opex", "initiative_opex", "depreciation", "op", "interest", "ebt", "tax", "net", "capex", "loan_principal", "cash_in", "cash_out"];
  R.tot = Object.fromEntries(keys.map((k) => [k, sum(R[k])]));
  R.tot.total_cost = R.tot.direct + R.tot.payroll + R.tot.si + R.tot.opex + R.tot.initiative_opex + R.tot.depreciation + R.tot.interest + R.tot.tax;
  const mi = R.cash.indexOf(Math.min(...R.cash));
  R.min_cash = R.cash[mi]; R.min_cash_month = mi + 1; R.closing_cash = R.cash[11];
  return R;
}

function calculate(cfg0) {
  const c = normalizeCfg(cfg0);
  const L = LABELS[c.org_type];
  const R = run(c);
  const T = R.tot;
  const [A0, A1] = c.active || [1, 12];
  const months = zeros().map((_, i) => ({
    month: i + 1, label: MN[i], income: R.income[i], direct_cost: R.direct[i], gross: R.gross[i], payroll: R.payroll[i], si: R.si[i], opex: R.opex[i],
    initiative_opex: R.initiative_opex[i], depreciation: R.depreciation[i], op: R.op[i], interest: R.interest[i], ebt: R.ebt[i], tax: R.tax[i], net: R.net[i],
    capex: R.capex[i], loan_principal: R.loan_principal[i], cash_open: R.cash_open[i], cash_in: R.cash_in[i], cash_out: R.cash_out[i], cash: R.cash[i], headcount: R.headcount[i],
  }));
  const totals = { ...T, payroll_total: T.payroll + T.si, opening_cash: c.opening_cash, closing_cash: R.closing_cash, min_cash: R.min_cash,
    headcount_start: R.headcount[A0 - 1], headcount_end: R.headcount[A1 - 1], headcount_avg: sum(R.headcount) / (A1 - A0 + 1), headcount_max: Math.max(0, ...R.headcount),
    new_hires: sum(c.staff.filter((s) => s.new).map((s) => s.count)), initiatives_budget: sum(c.initiatives.map((x) => x.budget)) };

  // Зардлын бүлэг
  const groups = {};
  for (const l of [...R.expense_lines, ...R.initiative_lines.filter((x) => !x.capex)]) {
    if (!groups[l.group]) groups[l.group] = { monthly: zeros(), total: 0 };
    l.monthly.forEach((v, i) => { groups[l.group].monthly[i] += v; });
    groups[l.group].total += l.total;
  }
  // Хэлтэс, нэгж
  const depts = [];
  const addD = (d) => { if (!depts.includes(d)) depts.push(d); };
  [c.income, c.staff, c.expenses, c.initiatives, c.capex].forEach((coll) => coll.forEach((x) => addD(x.dept)));
  const by_dept = {};
  for (const d of depts) {
    const income = sum(R.income_lines.filter((l) => l.dept === d).map((l) => l.total));
    const direct = sum(R.income_lines.filter((l) => l.dept === d).map((l) => l.direct_total));
    const payroll = sum(R.staff_lines.filter((l) => l.dept === d).map((l) => l.total)) * (1 + c.si_rate);
    const opex = sum([...R.expense_lines, ...R.initiative_lines].filter((l) => l.dept === d).map((l) => l.total));
    const capex = sum(R.capex_items.filter((x) => x.dept === d).map((x) => x.amount));
    const headcount = sum(c.staff.filter((s) => s.dept === d && s.end >= A1 && s.start <= A1).map((s) => s.count));
    const cost = direct + payroll + opex + capex;
    by_dept[d] = { income, direct, payroll, opex, capex, cost, headcount };
  }
  const grandBudget = sum(Object.values(by_dept).map((x) => x.cost));
  for (const d of depts) by_dept[d].share = grandBudget ? by_dept[d].cost / grandBudget : 0;

  // Гол үзүүлэлт
  const fixed = T.payroll + T.si + (T.opex - T.var_opex) + T.initiative_opex + T.depreciation + T.interest;
  const varPct = T.income ? (T.direct + T.var_opex) / T.income : null;
  const bep = varPct !== null && varPct < 1 ? fixed / (1 - varPct) : null;
  const kpis = {
    bep_income: c.org_type === "company" ? bep : null, bep_any: bep, fixed_cost: fixed, variable_pct: varPct,
    payroll_share: T.income ? (T.payroll + T.si) / T.income : null, payroll_share_of_cost: T.total_cost ? (T.payroll + T.si) / T.total_cost : null,
    income_per_staff: totals.headcount_avg ? T.income / totals.headcount_avg : null,
    gross_margin: T.income ? T.gross / T.income : null, net_margin: T.income ? T.net / T.income : null,
    min_cash: R.min_cash, min_cash_month: R.min_cash_month, min_cash_label: MN[R.min_cash_month - 1], closing_cash: R.closing_cash,
  };

  // Хувилбар
  const sc = c.scenarios;
  const mk = (r, k) => ({ inc_k: k[0], cost_k: k[1], income: r.tot.income, cost: r.tot.income - r.tot.net, total_cost: r.tot.total_cost, net: r.tot.net,
    closing_cash: r.closing_cash, min_cash: r.min_cash, min_cash_month: r.min_cash_month, cash: r.cash, net_monthly: r.net });
  const kp = [1 + sc.pessimistic.income, 1 + sc.pessimistic.cost], ko = [1 + sc.optimistic.income, 1 + sc.optimistic.cost];
  const RP = run(c, ...kp), RO = run(c, ...ko);
  const scenarios = { pessimistic: mk(RP, kp), realistic: mk(R, [1, 1]), optimistic: mk(RO, ko), params: sc };

  // Анхааруулга
  const warnings = [...c._notes];
  if (R.min_cash < 0) {
    const negs = R.cash.map((x, i) => (x < 0 ? i + 1 : null)).filter(Boolean);
    warnings.push(`Мөнгөн үлдэгдэл ${negs.join(", ")}-р сарын эцэст сөрөг гарна (хамгийн бага нь ${MN[R.min_cash_month - 1]}: ${money(R.min_cash)}). Зардлын хуваарь, орлогын хугацаа эсвэл нэмэлт эх үүсвэрийг шийдвэрлэх шаардлагатай.`);
  }
  if (T.net < 0) warnings.push(`Жилийн үр дүн сөрөг (${money(T.net)}). Нөөцөөс санхүүжүүлэх санаатай шийдвэр бол баримт бичигт тайлбарлана, үгүй бол зорилт эсвэл зардлаа эргэн харна.`);
  if (T.income > 0 && T.total_cost > T.income) warnings.push(`Нийт зардал (${money(T.total_cost)}) нийт орлого, санхүүжилтээс (${money(T.income)}) ${money(T.total_cost - T.income)}-өөр давж байна.`);
  if (T.income <= 0 && T.total_cost > 0) warnings.push(`${L.income} тооцоонд ороогүй (0 ₮) боловч зардал ${money(T.total_cost)} байна — санхүүжилтийн эх үүсвэрийг оруулна уу.`);
  if (RP.min_cash < 0 && R.min_cash >= 0) warnings.push(`Гутранги хувилбарт мөнгөн үлдэгдэл ${MN[RP.min_cash_month - 1]}д сөрөг (${money(RP.min_cash)}) болно. Эрсдэлийн бүлэгт хойшлуулах зардлын жагсаалт бичнэ.`);
  if (c.prior && c.prior.income_total && c.prior.expense_total) {
    const gi = T.income / c.prior.income_total - 1, ge = T.total_cost / c.prior.expense_total - 1;
    if (ge > gi + 0.05) warnings.push(`Зардлын өсөлт (${pct(ge)}) орлогын өсөлтөөс (${pct(gi)}) 5 нэгж хувиас илүү өндөр байна. Шалтгааныг тайлбарлана.`);
    if (gi > 0.5) warnings.push(`Орлогын зорилт өмнөх жилээс ${pct(gi)} өсөхөөр байна. Юугаар хангахыг стратегийн бүлэгт тодорхой үндэслэнэ.`);
  }
  if (c.org_type === "company" && T.income && (T.payroll + T.si) / T.income > 0.6) warnings.push(`Цалин, НДШ орлогын ${pct((T.payroll + T.si) / T.income)}-ийг эзэлж байна (60%-иас их). Салбарын онцлог эсэхийг тайлбарлана.`);
  if (c.min_wage) for (const s of c.staff) if (s.gross > 0 && s.gross < c.min_wage) warnings.push(`«${s.title}»-ийн цалин ${money(s.gross)} нь хөдөлмөрийн хөлсний доод хэмжээнээс (${money(c.min_wage)}) бага. Цагийн ажил бол тэмдэглэнэ, үгүй бол цалинг засна.`);
  if (!c.min_wage && c.staff.length) warnings.push("Хөдөлмөрийн хөлсний доод хэмжээ (min_wage) өгөөгүй тул цалинг түүнтэй тулгаж шалгаагүй.");
  for (const ln of c.income) if (ln.kind === "sales" && ln.annual !== null && ln.annual > 0 && ln.annual < 24) warnings.push(`«${ln.name}»: жилд ${num(ln.annual)} нэгжийг улирлын жингээр хуваахад сарын тоо бутархай гарна. Аль сард борлуулахыг units_monthly-ээр заавал зөв.`);
  if (c.income.length === 0) warnings.push("Орлого, санхүүжилтийн мөр өгөөгүй байна.");

  const lines = { income: R.income_lines, staff: R.staff_lines, expenses: R.expense_lines, initiatives: R.initiative_lines, capex: R.capex_items };
  return { cfg: c, labels: L, org_type: c.org_type, year: c.year, months, totals, lines, by_dept, depts, groups, kpis, scenarios, warnings,
    series: Object.fromEntries(["income", "direct", "gross", "payroll", "si", "opex", "var_opex", "initiative_opex", "depreciation", "op", "interest", "ebt", "tax", "net", "capex", "loan_principal", "cash_open", "cash_in", "cash_out", "cash", "headcount"].map((k) => [k, R[k]])) };
}

const quarterly = (arr) => q4(arr);
module.exports = { calculate, normalizeCfg, clipToPeriod, run, quarterly, q4, MN, LABELS, INIT_GROUP, COMMON, money, num, pct, toNum };
