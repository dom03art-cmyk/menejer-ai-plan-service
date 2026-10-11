// Жилийн төсвийн тооцоог (plancalc.js) баримт бичгийн хүснэгт, график, AI бичигчид өгөх баримт (facts) болгоно.
// Хүснэгтийг AI бичихгүй, код оруулна. Блокийн формат marketing-v1/fintables.js-тэй ижил: мөр "!"-ээр эхэлбэл нийт дүнгийн мөр.
//   build(A, cfg, res) → { blocks, charts, facts }
const { normalizeCfg, q4, MN, INIT_GROUP, money, num, pct } = require("./plancalc");

const T = (caption, headers, rows, widths) => ({ type: "table", caption, headers, rows, widths });
const mln = (x, d = 1) => (Number.isFinite(x) ? (x / 1e6).toFixed(d).replace(/^-/, "−").replace(/\B(?=(\d{3})+(?!\d))/g, " ") : "—");
const r1 = (x) => Math.round(x / 1e5) / 10; // сая ₮, 1 оронтой
const chg = (a, b) => (a ? pct((b - a) / Math.abs(a)) : "—");
const QH = ["I улирал", "II улирал", "III улирал", "IV улирал"];
const qrow = (label, v, sign = 1) => [label, ...q4(v).map((x) => num(sign * x)), num(sign * v.reduce((a, b) => a + b, 0))];
const sumA = (a) => a.reduce((s, x) => s + x, 0);
const fmtQty = (x) => (Math.abs(x - Math.round(x)) < 1e-9 ? num(x) : x.toFixed(1));

function build(A, cfg0, res) {
  const c = normalizeCfg(cfg0);
  const L = res.labels, Tt = res.totals, K = res.kpis, S = res.series, Y = c.year, org = (A && (A.org_name || (A.org && A.org.name))) || c.org_name;
  const isCo = c.org_type === "company";
  const blocks = {};

  // ───── Таамаглал ─────
  const as = [];
  for (const ln of res.lines.income) {
    const src = c.income.find((x) => x.name === ln.name) || {};
    let v = ln.kind === "sales" ? `${fmtQty(ln.qty_total)} ${ln.unit || "нэгж"} × ${money(ln.price)}${ln.unit_cost ? `; нэгжийн өртөг ${money(ln.unit_cost)}` : ""}` : `Жилд ${money(ln.total)}`;
    if (ln.cost_pct) v += `; шууд зардал орлогын ${pct(ln.cost_pct, 0)}`;
    v += src.monthly ? " (сар бүрээр өгсөн)" : src.seasonality ? " (өөрийн улирлын жингээр)" : "";
    as.push([ln.name, v, ln.source]);
  }
  if (c.raise) as.push(["Цалингийн нэмэгдэл", `${MN[c.raise.month - 1]}аас ${pct(c.raise.pct, 0)}`, c.raise.source]);
  as.push(["Ажил олгогчийн нийгмийн даатгалын шимтгэл", pct(c.si_rate), c.si_source || "Таамаглал: нягтлантай нягтална"]);
  if (c.tax_rate || isCo) as.push(["Орлогын албан татвар", `${pct(c.tax_rate, 0)} (татварын өмнөх ашгаас, өссөн дүнгээр)`, c.tax_source || "Таамаглал: нягтлантай нягтална"]);
  if (c.min_wage) as.push(["Хөдөлмөрийн хөлсний доод хэмжээ", money(c.min_wage), "Хууль тогтоомж"]);
  as.push(["Жилийн эхний мөнгөн хөрөнгө", money(c.opening_cash), "Байгууллагын мэдээлэл"]);
  if (c.existing_depreciation_monthly) as.push(["Одоо байгаа хөрөнгийн сарын элэгдэл", money(c.existing_depreciation_monthly), "Санхүүгийн тайлан"]);
  for (const l of c.loans) as.push([l.name, `Сард үндсэн төлбөр ${money(l.monthly_principal)}, хүү ${money(l.monthly_interest)} (${l.start}–${l.end}-р сар)`, "Зээлийн гэрээ"]);
  if (c.seasonality.some((x) => Math.abs(x - 1) > 1e-6)) as.push(["Улирлын жин (1–12-р сар, нийлбэр 12)", c.seasonality.map((x) => +x.toFixed(2)).join("; "), "Өмнөх жилийн борлуулалтын хэв шинж"]);
  const sc = c.scenarios;
  as.push(["Хувилбарын өөрчлөлт", `Гутранги: орлого ${pct(sc.pessimistic.income, 0)}, тогтмол зардал ${pct(sc.pessimistic.cost, 0)}; өөдрөг: орлого ${pct(sc.optimistic.income, 0)}, тогтмол зардал ${pct(sc.optimistic.cost, 0)}`, "Эрсдэлийн үнэлгээ"]);
  blocks.assumptions = [T(`${Y} оны төсвийн гол таамаглал`, ["Таамаглал", "Утга", "Эх сурвалж"], as, [32, 44, 24])];

  // ───── Орлогын эх үүсвэр ─────
  const hasPrior = res.lines.income.some((l) => l.prior !== null);
  const pr = res.lines.income.map((l) => [l.name, l.dept, num(l.total), pct(Tt.income ? l.total / Tt.income : 0), l.prior !== null ? num(l.prior) : "—", l.prior !== null ? chg(l.prior, l.total) : "—"]);
  const priorSum = sumA(res.lines.income.filter((l) => l.prior !== null).map((l) => l.prior));
  pr.push(["!Нийт", "", num(Tt.income), "100%", hasPrior ? num(priorSum) : "—", hasPrior && res.lines.income.every((l) => l.prior !== null) ? chg(priorSum, Tt.income) : "—"]);
  blocks.products = [T(`${L.income_src} ба өмнөх жилтэй харьцуулалт`, [L.income_src, "Хариуцах нэгж", `${Y} он (₮)`, "Хувь", `${Y - 1} он (₮)`, "Өөрчлөлт"], pr, [30, 16, 16, 9, 16, 13])];
  const sales = res.lines.income.filter((l) => l.kind === "sales");
  if (sales.length) {
    blocks.products.push(T("Бүтээгдэхүүний нэгжийн эдийн засаг", ["Бүтээгдэхүүн, үйлчилгээ", "Жилийн тоо", "Нэгжийн үнэ (₮)", "Нэгжийн шууд өртөг (₮)", "Нэгжийн ашиг (₮)", "Ашгийн хувь"],
      sales.map((l) => { const uc = l.unit_cost + l.price * l.cost_pct; return [l.name, fmtQty(l.qty_total), num(l.price), num(uc), num(l.price - uc), l.price ? pct((l.price - uc) / l.price) : "—"]; }), [32, 12, 14, 16, 14, 12]));
  }

  // ───── Орлого улирлаар ─────
  blocks.income_q = [T(`${L.income} улирлаар (₮)`, [L.income_src, ...QH, "Жилийн дүн", "Хувь"],
    [...res.lines.income.map((l) => [...qrow(l.name, l.income), pct(Tt.income ? l.total / Tt.income : 0)]), [...qrow("!Нийт", S.income), "100%"]], [28, 12, 12, 12, 12, 14, 10])];

  // ───── Орон тоо, цалин ─────
  const staffRows = [];
  for (const d of res.depts) {
    const ls = res.lines.staff.filter((s) => s.dept === d); if (!ls.length) continue;
    for (const s of ls) staffRows.push([s.title + (s.new ? " (шинэ)" : ""), d, fmtQty(s.count), num(s.gross), s.start === 1 && s.end === 12 ? "12 сар" : `${s.start}–${s.end}-р сар`, num(s.total), num(s.total + s.si_total)]);
  }
  staffRows.push(["!Нийт", "", fmtQty(Tt.headcount_end), "", "", num(Tt.payroll), num(Tt.payroll_total)]);
  blocks.payroll_q = [
    T("Орон тоо, цалингийн төсөв", ["Албан тушаал", "Нэгж", "Орон тоо", "Сарын үндсэн цалин (₮)", "Ажиллах хугацаа", "Жилийн цалин (₮)", "Цалин + НДШ (₮)"], staffRows, [24, 15, 8, 14, 12, 13, 14]),
    T("Цалин, НДШ улирлаар (₮)", ["Үзүүлэлт", ...QH, "Жилийн дүн"], [qrow("Үндсэн цалин", S.payroll), qrow(`Ажил олгогчийн НДШ (${pct(c.si_rate)})`, S.si),
      qrow("!Нийт", S.payroll.map((x, i) => x + S.si[i])), ["Орон тоо (улирлын эцэст)", ...[2, 5, 8, 11].map((i) => fmtQty(S.headcount[i])), fmtQty(S.headcount[11])]], [30, 14, 14, 14, 14, 14]),
  ];

  // ───── Зардлын бүлэг ─────
  const gEntries = Object.entries(res.groups);
  const opexAll = S.opex.map((x, i) => x + S.initiative_opex[i]);
  blocks.expense_groups = [
    T("Үйл ажиллагааны зардал бүлгээр (₮)", ["Зардлын бүлэг", ...QH, "Жилийн дүн", "Хувь"],
      [...gEntries.map(([g, v]) => [...qrow(g, v.monthly), pct(sumA(opexAll) ? v.total / sumA(opexAll) : 0)]), [...qrow("!Нийт", opexAll), "100%"]], [28, 12, 12, 12, 12, 14, 10]),
    T("Үйл ажиллагааны зардлын задаргаа (₮)", ["Зардал", "Бүлэг", "Нэгж", "Тооцох арга", "Жилийн дүн", "Өмнөх жил", "Өөрчлөлт"],
      [...res.lines.expenses.map((e) => [e.name, e.group, e.dept, { pct_of_income: `орлогын ${pct(e.pct_of_income)}`, by_month: "сар бүрээр", monthly: "сар бүр ижил", annual: "жилийн дүн ÷ 12" }[e.mode], num(e.total), e.prior !== null ? num(e.prior) : "—", e.prior !== null ? chg(e.prior, e.total) : "—"]),
        ...res.lines.initiatives.filter((x) => !x.capex && x.total).map((x) => ["Төсөл: " + x.name, INIT_GROUP, x.dept, "төслийн хугацаанд тэнцүү", num(x.total), "—", "—"]),
        ["!Нийт", "", "", "", num(sumA(opexAll)), "", ""]], [26, 15, 12, 15, 12, 11, 9]),
  ];

  // ───── Хөрөнгө оруулалт ─────
  if (res.lines.capex.length) {
    blocks.capex = [T("Хөрөнгө оруулалт, элэгдэл", ["Хөрөнгө оруулалт", "Нэгж", "Сар", "Дүн (₮)", "Ашиглах хугацаа", `${Y} оны элэгдэл (₮)`],
      [...res.lines.capex.map((x) => [x.name, x.dept, MN[x.month - 1], num(x.amount), `${+x.life_years.toFixed(1)} жил`, num(x.dep_total)]),
        ["!Нийт", "", "", num(Tt.capex), "", num(sumA(res.lines.capex.map((x) => x.dep_total)))]], [30, 16, 10, 16, 12, 16])];
  }

  // ───── Нэгтгэсэн төсөв улирлаар ─────
  let lines = [[L.income, S.income, 1], [L.direct, S.direct, -1], [L.gross, S.gross, 1], ["Цалин", S.payroll, -1], ["Ажил олгогчийн НДШ", S.si, -1],
    ["Үйл ажиллагааны зардал", S.opex, -1], ["Төсөл, хөтөлбөрийн зардал", S.initiative_opex, -1], ["Элэгдэл", S.depreciation, -1], [L.op, S.op, 1]];
  if (Tt.interest) lines.push(["Зээлийн хүү", S.interest, -1], [L.pre, S.ebt, 1]);
  if (c.tax_rate) lines.push(["Орлогын албан татвар", S.tax, -1]);
  lines.push(["!" + L.result, S.net, 1]);
  lines = lines.filter(([a]) => !((a === L.direct || a === L.gross) && !Tt.direct) && !(a === "Төсөл, хөтөлбөрийн зардал" && !Tt.initiative_opex));
  blocks.summary_q = [T(`${Y} оны нэгтгэсэн төсөв улирлаар (₮)`, ["Үзүүлэлт", ...QH, "Жилийн дүн"], lines.map(([a, v, s]) => qrow(a, v, s)), [30, 14, 14, 14, 14, 14])];

  // ───── Мөнгөн урсгал ─────
  const cl = [["Эхний үлдэгдэл", S.cash_open], ["Мөнгөн орлого", S.cash_in], ["Мөнгөн зарлага", S.cash_out.map((x) => -x)],
    ["  үүнээс цалин, НДШ", S.payroll.map((x, i) => -(x + S.si[i]))], ["  үүнээс хөрөнгө оруулалт", S.capex.map((x) => -x)],
    ["  үүнээс зээлийн төлбөр", S.loan_principal.map((x, i) => -(x + S.interest[i]))], ["  үүнээс татвар", S.tax.map((x) => -x)], ["!Эцсийн үлдэгдэл", S.cash]]
    .filter(([a, v]) => !(a.startsWith("  ") && v.every((x) => Math.abs(x) < 0.5)));
  const half = (lo) => T(`Мөнгөн урсгал, ${MN[lo]}–${MN[lo + 5]} (сая ₮)`, ["Үзүүлэлт", ...MN.slice(lo, lo + 6)], cl.map(([a, v]) => [a, ...v.slice(lo, lo + 6).map((x) => mln(x))]), [28, 12, 12, 12, 12, 12, 12]);
  blocks.cash_h1 = [half(0)]; blocks.cash_h2 = [half(6)];

  // ───── Хэлтсээр ─────
  const dr = res.depts.map((d) => { const x = res.by_dept[d]; return [d, fmtQty(x.headcount), num(x.income), num(x.direct), num(x.payroll), num(x.opex), num(x.capex), num(x.cost), pct(x.share)]; });
  const tot = (k) => sumA(Object.values(res.by_dept).map((x) => x[k]));
  dr.push(["!Нийт", fmtQty(tot("headcount")), num(tot("income")), num(tot("direct")), num(tot("payroll")), num(tot("opex")), num(tot("capex")), num(tot("cost")), "100%"]);
  blocks.dept = [T("Нэгж, хэлтсийн төсөв (₮)", ["Нэгж", "Орон тоо", "Орлого", "Шууд зардал", "Цалин + НДШ", "Үйл ажиллагааны ба төслийн зардал", "Хөрөнгө оруулалт", "Нийт төсөв", "Хувь"], dr, [14, 7, 12, 11, 11, 13, 11, 12, 9])];

  // ───── Хувилбар ─────
  const SC = res.scenarios, srow = (label, f) => [label, f(SC.pessimistic), f(SC.realistic), f(SC.optimistic)];
  blocks.scenarios = [T("Гурван хувилбарын харьцуулалт", ["Үзүүлэлт", `Гутранги (орлого ${pct(sc.pessimistic.income, 0)}, зардал +${pct(sc.pessimistic.cost, 0)})`, "Бодит", `Өөдрөг (орлого +${pct(sc.optimistic.income, 0)})`],
    [srow(L.income, (x) => money(x.income)), srow("Нийт зардал", (x) => money(x.cost)), srow(L.result, (x) => money(x.net)),
      srow("Жилийн эцсийн мөнгөн үлдэгдэл", (x) => money(x.closing_cash)), srow("Хамгийн бага мөнгөн үлдэгдэл", (x) => `${money(x.min_cash)} (${MN[x.min_cash_month - 1]})`)], [28, 26, 22, 24])];

  // ───── Гол үзүүлэлт ─────
  const kp = [[L.income, money(Tt.income), "Жилийн дүн"], ["Нийт зардал", money(Tt.total_cost), "Шууд зардал, цалин, НДШ, үйл ажиллагааны ба төслийн зардал, элэгдэл" + (Tt.interest ? ", хүү" : "") + (Tt.tax ? ", татвар" : "")],
    [L.result, money(Tt.net), ""], [L.margin, pct(K.net_margin), ""]];
  if (Tt.direct) kp.push([isCo ? "Нийт ашгийн хувь" : "Шууд зардлын дараах үлдэгдлийн хувь", pct(K.gross_margin), `(${L.income_short} − шууд зардал) ÷ ${L.income_short.toLowerCase()}`]);
  if (isCo) kp.push(["Алдагдалгүй ажиллах орлого", K.bep_income !== null ? money(K.bep_income) : "—", "Тогтмол зардал ÷ (1 − хувьсах зардлын хувь)"],
    ["Алдагдалгүй түвшнээс давах зай", K.bep_income ? pct(Tt.income / K.bep_income - 1) : "—", "(Орлого ÷ алдагдалгүй орлого) − 1"]);
  kp.push(["Цалин, НДШ-ийн орлогод эзлэх хувь", pct(K.payroll_share), ""], ["Цалин, НДШ-ийн нийт зардалд эзлэх хувь", pct(K.payroll_share_of_cost), ""],
    ["Нэг ажилтанд ногдох орлого", K.income_per_staff !== null ? money(K.income_per_staff) : "—", `Жилийн дүн ÷ дундаж орон тоо (${Tt.headcount_avg.toFixed(1)})`],
    ["Орон тоо (жилийн эхэнд → эцэст)", `${fmtQty(Tt.headcount_start)} → ${fmtQty(Tt.headcount_end)}`, Tt.new_hires ? `Шинэ орон тоо ${fmtQty(Tt.new_hires)}` : ""],
    ["Хөрөнгө оруулалт", money(Tt.capex), ""], ["Жилийн эцсийн мөнгөн үлдэгдэл", money(Tt.closing_cash), `Эхний үлдэгдэл ${money(c.opening_cash)}`],
    ["Хамгийн бага мөнгөн үлдэгдэл", money(K.min_cash), `${K.min_cash_label}ын эцэст`]);
  blocks.kpis = [T("Гол санхүүгийн үзүүлэлт", ["Үзүүлэлт", "Утга", "Тайлбар"], kp, [38, 24, 38])];

  // ───── Өмнөх жилтэй ─────
  if (c.prior) {
    const p = c.prior, rows = [];
    const cmp = (label, a, b) => { if (a === null || a === undefined) return; rows.push([label, num(a), num(b), num(b - a), chg(a, b)]); };
    cmp(L.income + " (нийт)", p.income_total, Tt.income);
    for (const l of res.lines.income) cmp("  " + l.name, l.prior, l.total);
    cmp("Цалин + НДШ", p.payroll_total, Tt.payroll_total);
    for (const e of res.lines.expenses) cmp("  " + e.name, e.prior, e.total);
    cmp("Нийт зардал", p.expense_total, Tt.total_cost);
    cmp("!" + L.result, p.result, Tt.net);
    if (rows.length) blocks.prior = [T(`${p.year} он ба ${Y} оны төлөвлөгөө${p.basis ? ` (${p.year}: ${p.basis})` : ""}`, ["Үзүүлэлт", `${p.year} он (₮)`, `${Y} он (₮)`, "Өөрчлөлт (₮)", "Өсөлт"], rows, [34, 17, 17, 17, 15])];
  }

  // ───── Төсөл, хөтөлбөр ─────
  if (c.initiatives.length) {
    blocks.initiatives = [T("Төсөл, хөтөлбөр, санаачилга", ["Төсөл, хөтөлбөр", "Хариуцах нэгж", "Хариуцагч", "Хугацаа", "Төсөв (₮)", "Хэмжих үзүүлэлт"],
      [...c.initiatives.map((it) => [it.name, it.dept, it.owner || "—", it.start === it.end ? MN[it.start - 1] : `${it.start}–${it.end}-р сар`, num(it.budget) + (it.capex ? " (хөрөнгө оруулалт)" : ""), it.kpi || "—"]),
        ["!Нийт", "", "", "", num(Tt.initiatives_budget), ""]], [24, 13, 14, 11, 15, 23])];
  }

  // ───── Графикууд (сая ₮) ─────
  const incNames = res.lines.income.map((l) => l.name);
  const costMix = [["Шууд зардал", Tt.direct], ["Цалин, НДШ", Tt.payroll_total], ...gEntries.map(([g, v]) => [g, v.total]), ["Элэгдэл", Tt.depreciation], ["Зээлийн хүү", Tt.interest], ["Татвар", Tt.tax]].filter(([, v]) => v > 0.5);
  const charts = {
    income_mix: { type: "pie", title: `${L.income_src}ийн бүтэц, ${Y} он (сая ₮)`, labels: incNames, series: [[L.income_short, res.lines.income.map((l) => r1(l.total))]] },
    income_vs_out: { type: "bar", title: `Сар бүрийн ${L.income_short.toLowerCase()} ба мөнгөн зарлага (сая ₮)`, labels: MN, series: [[L.income_short, S.income.map(r1)], ["Мөнгөн зарлага", S.cash_out.map(r1)]] },
    cash: { type: "line", title: "Сарын эцсийн мөнгөн үлдэгдэл (сая ₮)", labels: MN, series: [["Мөнгөн үлдэгдэл", S.cash.map(r1)]] },
    cost_mix: { type: "pie", title: `Зардлын бүтэц, ${Y} он (сая ₮)`, labels: costMix.map((x) => x[0]), series: [["Зардал", costMix.map((x) => r1(x[1]))]] },
    scenarios: { type: "bar", title: `Гурван хувилбар: ${L.result.split(" (")[0].toLowerCase()} ба мөнгөн үлдэгдэл (сая ₮)`, labels: ["Гутранги", "Бодит", "Өөдрөг"],
      series: [[L.result.split(" (")[0], [SC.pessimistic.net, SC.realistic.net, SC.optimistic.net].map(r1)], ["Хамгийн бага мөнгөн үлдэгдэл", [SC.pessimistic.min_cash, SC.realistic.min_cash, SC.optimistic.min_cash].map(r1)]] },
  };
  if (!incNames.length) delete charts.income_mix;
  if (res.depts.length > 1) charts.dept = { type: "bar", title: "Нэгж, хэлтсийн төсөв (сая ₮)", labels: res.depts, series: [["Нийт төсөв", res.depts.map((d) => r1(res.by_dept[d].cost))]] };

  // ───── AI-д өгөх баримт: бичвэрт тоо хэрэгтэй бол ЗӨВХӨН эндээс ─────
  const F = (x) => ({ raw: Math.round(x), text: money(x) });
  const top = (arr, n) => [...arr].sort((a, b) => b.total - a.total).slice(0, n);
  const facts = {
    org_name: org, org_type: c.org_type, year: Y, labels: L,
    totals: { income: F(Tt.income), direct: F(Tt.direct), gross: F(Tt.gross), payroll: F(Tt.payroll), si: F(Tt.si), payroll_total: F(Tt.payroll_total), opex: F(Tt.opex),
      initiative_opex: F(Tt.initiative_opex), depreciation: F(Tt.depreciation), interest: F(Tt.interest), tax: F(Tt.tax), total_cost: F(Tt.total_cost), result: F(Tt.net),
      capex: F(Tt.capex), loan_principal: F(Tt.loan_principal), opening_cash: F(c.opening_cash), closing_cash: F(Tt.closing_cash), min_cash: F(Tt.min_cash) },
    kpis: { bep_income: K.bep_income !== null ? F(K.bep_income) : null, payroll_share: pct(K.payroll_share), income_per_staff: K.income_per_staff !== null ? F(K.income_per_staff) : null,
      gross_margin: pct(K.gross_margin), net_margin: pct(K.net_margin), min_cash_month: K.min_cash_label, variable_cost_pct: pct(K.variable_pct) },
    headcount: { start: Tt.headcount_start, end: Tt.headcount_end, avg: +Tt.headcount_avg.toFixed(1), new_hires: Tt.new_hires },
    quarters: { income: q4(S.income).map(money), result: q4(S.net).map(money) },
    months: res.months.map((m) => ({ month: m.label, income: Math.round(m.income), cash_out: Math.round(m.cash_out), net: Math.round(m.net), cash: Math.round(m.cash) })),
    income_lines: res.lines.income.map((l) => ({ name: l.name, dept: l.dept, total: money(l.total), share: pct(Tt.income ? l.total / Tt.income : 0), prior: l.prior !== null ? money(l.prior) : null, change: l.prior !== null ? chg(l.prior, l.total) : null, units: l.kind === "sales" ? fmtQty(l.qty_total) : null })),
    top_income: top(res.lines.income, 3).map((l) => `${l.name}: ${money(l.total)}`),
    top_expenses: top([...res.lines.expenses, ...res.lines.initiatives.filter((x) => !x.capex)], 5).map((e) => `${e.name}: ${money(e.total)}`),
    groups: Object.fromEntries(gEntries.map(([g, v]) => [g, money(v.total)])),
    depts: res.depts.map((d) => ({ dept: d, headcount: res.by_dept[d].headcount, budget: money(res.by_dept[d].cost), share: pct(res.by_dept[d].share), income: money(res.by_dept[d].income) })),
    initiatives: c.initiatives.map((it) => ({ name: it.name, dept: it.dept, owner: it.owner, period: `${it.start}–${it.end}-р сар`, budget: money(it.budget), capex: it.capex, kpi: it.kpi })),
    scenarios: Object.fromEntries(["pessimistic", "realistic", "optimistic"].map((k) => [k, { income: money(SC[k].income), cost: money(SC[k].cost), result: money(SC[k].net), closing_cash: money(SC[k].closing_cash), min_cash: money(SC[k].min_cash), min_cash_month: MN[SC[k].min_cash_month - 1] }])),
    prior: c.prior ? { year: c.prior.year, income: c.prior.income_total !== null ? money(c.prior.income_total) : null, cost: c.prior.expense_total !== null ? money(c.prior.expense_total) : null,
      result: c.prior.result !== null ? money(c.prior.result) : null, income_growth: c.prior.income_total ? chg(c.prior.income_total, Tt.income) : null, cost_growth: c.prior.expense_total ? chg(c.prior.expense_total, Tt.total_cost) : null, basis: c.prior.basis } : null,
    rates: { si_rate: pct(c.si_rate), tax_rate: pct(c.tax_rate, 0), raise: c.raise ? `${MN[c.raise.month - 1]}аас ${pct(c.raise.pct, 0)}` : null },
    warnings: res.warnings,
  };
  return { blocks, charts, facts };
}

module.exports = { build, mln };
