// Тооцооны үр дүнг (calc.js) баримт бичгийн блок (хүснэгт), графикийн тодорхойлолт, AI-д өгөх баримт (facts) болгоно.
// Эдгээр хүснэгтийг AI бичихгүй, код оруулна — тоо зөрөх боломжгүй.
const num = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const money = (n) => (n === null || n === undefined ? "—" : num(n) + " ₮");
const dec = (n, d = 2) => (n === null || n === undefined ? "—" : Number(n).toFixed(d));
const pc = (x) => { const v = x * 100; return (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1)) + "%"; };
const monthLabel = (ym) => (/^\d{4}-\d{2}$/.test(ym) ? parseInt(ym.slice(5), 10) + "-р сар" : ym);
const T = (caption, headers, rows, widths) => ({ type: "table", caption, headers, rows, widths });

function build(A, cfg, fin) {
  const R = fin.realistic, S = R.summary, SC = fin.scenarios, N = R.months.length, sales = Number(cfg.avg_order_value) > 0;
  const months = R.months.map(m => monthLabel(m.month));
  const blocks = {};
  blocks.overviewTable = [T("Ерөнхий мэдээлэл", ["Үзүүлэлт", "Мэдээлэл"], [
    ["Сурталчлах зүйл", `${A.brand.name}: ${A.brand.offer || ""}`], ["Субъектийн төрөл", { product: "Бүтээгдэхүүн, үйлчилгээ", organization: "Байгууллага", person: "Хувь хүн (хувийн брэнд)" }[A.subject_type]],
    ["Үнэ, нөхцөл", A.brand.price_text || "[Захиалагч бөглөнө]"], ["Хамрах хугацаа", `${months[0]}–${months[N - 1]} (${N} сар)`],
    ["Маркетингийн төсөв", `Сард ${money(A.money.monthly_budget)} хүртэл. Төлөвлөсөн нийт дүн ${money(S.total_marketing_cost)}`],
    ["Одоогийн суваг", (A.current && A.current.channels) || "—"], ["Одоогийн борлуулалт", (A.current && A.current.orders) || "—"], ["Хариуцагч", A.team.marketer || "—"]], [32, 68])];
  const kpi = [["Маркетингийн нийт зардал", money(S.total_marketing_cost)], ["Үүнээс зарын төсөв", money(S.total_ad_spend)], ["Зарын харуулалт", num(S.total_impressions)]];
  if (S.total_leads) kpi.push(["Чат, лавлагаа эхлүүлэх хүн", num(S.total_leads)]);
  if (sales) kpi.push(["Зараар ирэх захиалга", `${Math.round(S.new_customers)} орчим`], ["Зараар орох орлого", money(S.marketing_revenue)], ["Нэг захиалга татах зардал (CAC)", money(S.cac)], ["Зардлын өгөөж (ROAS, нийт зардалд)", dec(S.roas_total_cost)]);
  else { if (S.new_followers) kpi.push(["Шинэ дагагч", num(S.new_followers)], ["Нэг дагагчийн зардал", money(S.cost_per_follower)]); if (S.cost_per_lead) kpi.push(["Нэг лавлагааны зардал", money(S.cost_per_lead)]); }
  blocks.kpiTable = [T(`Гол тоон үзүүлэлт, ${N} сар (бодит хувилбар)`, ["Үзүүлэлт", `${N} сарын дүн`], kpi, [55, 45])];

  const assume = [];
  if (sales) assume.push(["Нэг захиалгын дундаж үнэ", money(cfg.avg_order_value), "Захиалагчийн мэдээлэл"], ["Нийт ашгийн хувь", pc(cfg.gross_margin_pct), A.assumed_fields.some(x => /margin|ашиг|өртөг/i.test(x)) ? "Таамаглал" : "Захиалагчийн мэдээлэл"],
    ["Нэг хэрэглэгчийн жилийн худалдан авалт", String(cfg.purchases_per_customer_per_year), "Таамаглал (болгоомжтой)"]);
  assume.push(["Эхний саруудын үр ашгийн түвшин", cfg.efficiency_ramp.map(pc).join(", "), "Таамаглал (зар суралцах үе)"], ["Зарын төсвийн сарын жин", cfg.seasonality.join(", "), "Улирлын төлөвлөлт"]);
  for (const c of cfg.channels) {
    const parts = [c.cpc !== undefined ? `товшилтын үнэ ${money(c.cpc)}` : `1000 харуулалтын үнэ ${money(c.cpm)}, товшилт ${pc(c.ctr_pct || 0)}`];
    if (c.click_to_lead_pct !== undefined) parts.push(`чат/лавлагаа ${pc(c.click_to_lead_pct)}`);
    if (c.lead_to_sale_pct !== undefined) parts.push(`захиалга ${pc(c.lead_to_sale_pct)}`);
    if (c.click_to_sale_pct !== undefined) parts.push(`товшилтоос захиалга ${pc(c.click_to_sale_pct)}`);
    if (c.click_to_follower_pct !== undefined) parts.push(`дагагч ${pc(c.click_to_follower_pct)}`);
    assume.push([c.name, parts.join(", "), c.source || "Таамаглал"]);
  }
  blocks.assumptions = [T("Тооцооны таамаглал", ["Таамаглал", "Утга", "Эх сурвалж"], assume, [34, 42, 24])];

  blocks.channels = [sales
    ? T("Сувгийн задаргаа", ["Суваг", "Төсөв (₮)", "Хувь", "Харуулалт", "Товшилт", "Чат", "Захиалга", "Нэг захиалгын зарын зардал (₮)", "ROAS"],
      [...R.channels.map(c => [c.name, num(c.budget), c.budget_share_pct + "%", num(c.impressions), num(c.clicks), num(c.leads), dec(c.sales, 1), c.cac_ad_only ? num(c.cac_ad_only) : "—", dec(c.roas)]),
        ["!Нийт", num(S.total_ad_spend), "100%", num(S.total_impressions), num(S.total_clicks), num(S.total_leads), dec(S.new_customers, 1), S.new_customers ? num(S.total_ad_spend / S.new_customers) : "—", dec(S.roas_ad_only)]], [20, 11, 7, 12, 10, 7, 9, 15, 9])
    : T("Сувгийн задаргаа", ["Суваг", "Төсөв (₮)", "Хувь", "Харуулалт", "Товшилт", "Лавлагаа", "Дагагч", "Нэг лавлагааны зардал (₮)", "Нэг дагагчийн зардал (₮)"],
      [...R.channels.map(c => [c.name, num(c.budget), c.budget_share_pct + "%", num(c.impressions), num(c.clicks), num(c.leads), num(c.followers), c.cost_per_lead ? num(c.cost_per_lead) : "—", c.cost_per_follower ? num(c.cost_per_follower) : "—"]),
        ["!Нийт", num(S.total_ad_spend), "100%", num(S.total_impressions), num(S.total_clicks), num(S.total_leads), num(S.new_followers), "", ""]], [20, 11, 7, 12, 10, 9, 9, 11, 11])];

  blocks.fixed = [T("Тогтмол зардлын задаргаа", ["Зардал", "Тооцоо", `${N} сарын дүн`, "Тайлбар"],
    [...(cfg.fixed_costs || []).map(f => [f.name, [f.monthly ? `${money(f.monthly)} × ${N} сар` : "", f.one_time ? `${money(f.one_time)} × 1 удаа` : ""].filter(Boolean).join(" + "), money(S.fixed_cost_breakdown[f.name] || 0), f.source || "Таамаглал, бодит үнээр нягтална"]),
      ["!Нийт", "", money(S.total_fixed_cost), ""]], [34, 24, 18, 24])];
  const mw = (first) => [first, ...Array(N + 1).fill((100 - first) / (N + 1))];
  blocks.monthly = [T("Сар бүрийн төсөв", ["Зардал (₮)", ...months, "Нийт"],
    [...R.channels.map((c, i) => [c.name, ...R.months.map(m => num(m.channels[i].budget)), num(c.budget)]),
      ...(cfg.fixed_costs || []).map(f => [f.name, ...R.months.map(m => { const x = m.fixed.find(y => y.name === f.name); return x ? num(x.amount) : "0"; }), num(S.fixed_cost_breakdown[f.name] || 0)]),
      ["!Нийт", ...R.months.map(m => num(m.total_cost)), num(S.total_marketing_cost)]], mw(N > 6 ? 22 : 40))];
  const met = [];
  if (sales) met.push(["Нэг захиалга татах зардал (CAC)", money(S.cac), "Нийт зардал / зараар ирсэн захиалга"]);
  if (S.cost_per_lead) met.push(["Нэг чат, лавлагааны зардал", money(S.cost_per_lead), "Нийт зардал / чат эхлүүлсэн хүн"]);
  if (S.cost_per_follower) met.push(["Нэг дагагчийн зардал", money(S.cost_per_follower), "Нийт зардал / шинэ дагагч"]);
  met.push(["Нэг товшилтын зарын зардал", money(S.cost_per_click), "Зарын төсөв / товшилт"], ["1000 харуулалтын зардал", money(S.cost_per_1000_impressions), "Зарын төсөв / харуулалт × 1000"]);
  if (sales) met.push(["ROAS (зөвхөн зарын төсөвт)", dec(S.roas_ad_only), "Зараар орсон орлого / зарын төсөв"], ["ROAS (нийт зардалд)", dec(S.roas_total_cost), "Зараар орсон орлого / нийт зардал"],
    ["Алдагдалгүй ROAS", dec(S.break_even_roas), "1 / нийт ашгийн хувь"], ["Нэг хэрэглэгчийн насан туршийн ашиг (LTV)", money(S.ltv_gross_profit), "Үнэ × ашгийн хувь × давтамж"],
    ["LTV / CAC", dec(S.ltv_cac_ratio), "Эрүүл түвшин 3-аас дээш"], ["Зардал нөхөгдөх сар", S.payback_month_first_purchase ? S.payback_month_first_purchase + "-р сар" : "Хугацаанд нөхөгдөхгүй", "Хуримтлагдсан цэвэр хувь нэмэр эерэг болох сар"]);
  blocks.metrics = [T("Үр ашгийн үзүүлэлт", ["Үзүүлэлт", "Утга", "Тайлбар"], met, [44, 18, 38])];
  const row = (label, f) => [label, f(SC.pessimistic), f(SC.realistic), f(SC.optimistic)];
  blocks.scenarios = [T("Гурван хувилбар", ["Үзүүлэлт", "Гутранги", "Бодит", "Өөдрөг"], sales
    ? [row("Маркетингийн зардал", x => money(x.total_marketing_cost)), row("Зараар ирэх захиалга", x => dec(x.new_customers, 1)), row("Зараар орох орлого", x => money(x.marketing_revenue)), row("CAC", x => money(x.cac)),
      row("ROAS (нийт зардалд)", x => dec(x.roas_total_cost)), row("Цэвэр хувь нэмэр", x => money(x.net_contribution_first_purchase)), row("LTV / CAC", x => dec(x.ltv_cac_ratio))]
    : [row("Маркетингийн зардал", x => money(x.total_marketing_cost)), row("Лавлагаа", x => num(x.total_leads)), row("Шинэ дагагч", x => num(x.new_followers)), row("Нэг лавлагааны зардал", x => money(x.cost_per_lead)), row("Нэг дагагчийн зардал", x => money(x.cost_per_follower))], [34, 22, 22, 22])];
  const cf = [["Маркетингийн зардал", ...R.months.map(m => num(m.total_cost)), num(S.total_marketing_cost)]];
  if (sales) cf.push(["Зараар ирэх захиалга", ...R.months.map(m => dec(m.new_sales, 1)), dec(S.new_customers, 1)], ["Зараар орох орлого", ...R.months.map(m => num(m.marketing_revenue)), num(S.marketing_revenue)],
    [`Нийт ашиг (${pc(cfg.gross_margin_pct)})`, ...R.months.map(m => num(m.gross_profit)), num(S.gross_profit_from_marketing)], ["Цэвэр хувь нэмэр", ...R.months.map(m => num(m.net_contribution)), num(S.net_contribution_first_purchase)],
    ["Хуримтлагдсан дүн", ...R.months.map(m => num(m.cumulative_net_contribution)), ""]);
  else cf.push(["Харуулалт", ...R.months.map(m => num(m.impressions)), num(S.total_impressions)], ["Лавлагаа", ...R.months.map(m => num(m.leads)), num(S.total_leads)], ["Шинэ дагагч", ...R.months.map(m => num(m.new_followers)), num(S.new_followers)]);
  blocks.cashflow = [T("Сар бүрийн орлого, зардлын урсгал", [sales ? "Үзүүлэлт (₮)" : "Үзүүлэлт", ...months, "Нийт"], cf, mw(N > 6 ? 22 : 36))];

  // Графикууд (QuickChart). title-д нэгж бичнэ.
  const k = (x) => Math.round(x / 1000);
  const charts = {
    budget: { type: "pie", title: `${N} сарын маркетингийн төсвийн хуваарилалт (мянган ₮)`, labels: [...R.channels.map(c => c.name), ...Object.keys(S.fixed_cost_breakdown)], series: [["Төсөв", [...R.channels.map(c => k(c.budget)), ...Object.values(S.fixed_cost_breakdown).map(k)]]] },
    monthly: { type: "bar", title: sales ? "Сар бүрийн маркетингийн зардал ба зараар орох орлого (мянган ₮)" : "Сар бүрийн маркетингийн зардал (мянган ₮)", labels: months,
      series: sales ? [["Маркетингийн зардал", R.months.map(m => k(m.total_cost))], ["Зараар орох орлого", R.months.map(m => k(m.marketing_revenue))]] : [["Маркетингийн зардал", R.months.map(m => k(m.total_cost))]] },
    funnel: { type: "funnel", title: `Зарын юүлүүр, ${N} сар (бодит хувилбар)`, labels: sales ? ["Харуулалт", "Товшилт", "Чат, лавлагаа", "Захиалга"] : ["Харуулалт", "Товшилт", "Лавлагаа", "Дагагч"],
      values: sales ? [S.total_impressions, S.total_clicks, S.total_leads, Math.round(S.new_customers)] : [S.total_impressions, S.total_clicks, S.total_leads, S.new_followers] },
    scenarios: { type: "bar", title: sales ? `Гурван хувилбар: ${N} сарын захиалгын тоо` : `Гурван хувилбар: ${N} сарын лавлагааны тоо`, labels: ["Гутранги", "Бодит", "Өөдрөг"],
      series: [[sales ? "Захиалга" : "Лавлагаа", sales ? [SC.pessimistic.new_customers, SC.realistic.new_customers, SC.optimistic.new_customers] : [SC.pessimistic.total_leads, SC.realistic.total_leads, SC.optimistic.total_leads]]] },
  };
  if (sales) charts.cumulative = { type: "line", title: "Хуримтлагдсан цэвэр хувь нэмэр (мянган ₮)", labels: months, series: [["Хуримтлагдсан цэвэр хувь нэмэр", R.months.map(m => k(m.cumulative_net_contribution))]] };

  // AI-д өгөх тоон баримт: бичвэрт тоо хэрэгтэй бол ЗӨВХӨН эндээс авна
  const facts = { period_months: N, months, budget_cap_monthly: A.money.monthly_budget, avg_order_value: cfg.avg_order_value, gross_margin_pct: cfg.gross_margin_pct,
    gross_profit_per_order: Math.round(cfg.avg_order_value * cfg.gross_margin_pct), summary: S, channels: R.channels,
    months_detail: R.months.map(m => ({ month: monthLabel(m.month), total_cost: m.total_cost, ad_spend: m.ad_spend, fixed_cost: m.fixed_cost, leads: m.leads, new_sales: m.new_sales, revenue: m.marketing_revenue, channels: m.channels.map(c => ({ name: c.name, budget: c.budget })), fixed: m.fixed })),
    scenarios: { pessimistic: SC.pessimistic, optimistic: SC.optimistic }, assumptions: assume.map(a => ({ name: a[0], value: a[1], source: a[2] })), fixed_costs: cfg.fixed_costs,
    ad_history_used: !!A.ad_history_used, warnings: fin.warnings, daily_budget_main: Math.round((cfg.channels[0].monthly_budget || 0) / 30 / 500) * 500 };
  return { blocks, charts, facts };
}
module.exports = { build, money, num, dec, pc, monthLabel };
