// Маркетингийн төсөв, юүлүүр, CAC, ROAS, LTV, 3 хувилбарын тооцоо.
// mongol-marketing-plan skill-ийн marketing_calc.py-ийн яг ижил логик (Node хувилбар). Бүх тоог ЭНЭ код бодно.
function addMonths(ym, n) { const [y, m] = ym.split("-").map(Number); const m0 = (m - 1) + n; return `${y + Math.floor(m0 / 12)}-${String(m0 % 12 + 1).padStart(2, "0")}`; }
const r0 = Math.round, r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;

function run(cfg, effMult = 1) {
  const n = Number(cfg.period_months), aov = Number(cfg.avg_order_value || 0), gm = Number(cfg.gross_margin_pct || 0);
  const pad = (a) => [...(a || []), ...Array(n).fill(1)].slice(0, n);
  const season = pad(cfg.seasonality), ramp = pad(cfg.efficiency_ramp), start = cfg.start_month;
  const months = [], chTot = {}, fixedTot = {};
  for (const c of cfg.channels) chTot[c.name] = { budget: 0, impressions: 0, clicks: 0, leads: 0, followers: 0, sales: 0, revenue: 0 };
  for (let i = 0; i < n; i++) {
    const row = { month_index: i + 1, month: start ? addMonths(start, i) : `${i + 1}-р сар`, channels: [], fixed: [] };
    let ad = 0, imp = 0, clk = 0, lead = 0, sale = 0, fol = 0;
    for (const c of cfg.channels) {
      const b = Number(c.monthly_budget || 0) * season[i];
      let impressions, clicks;
      if (c.cpc !== undefined) { clicks = c.cpc ? b / Number(c.cpc) : 0; impressions = c.ctr_pct ? clicks / Number(c.ctr_pct) : 0; }
      else { impressions = c.cpm ? b / Number(c.cpm) * 1000 : 0; clicks = impressions * Number(c.ctr_pct || 0); }
      const e = ramp[i] * effMult; let leads, sales;
      if (c.click_to_sale_pct !== undefined) { leads = 0; sales = clicks * Number(c.click_to_sale_pct) * e; }
      else { leads = clicks * Number(c.click_to_lead_pct || 0); sales = leads * Number(c.lead_to_sale_pct || 0) * e; }
      const rev = sales * aov, followers = clicks * Number(c.click_to_follower_pct || 0) * e;
      row.channels.push({ name: c.name, budget: r0(b), impressions: r0(impressions), clicks: r0(clicks), leads: r0(leads), followers: r0(followers), sales: r1(sales), revenue: r0(rev) });
      const t = chTot[c.name]; t.budget += b; t.impressions += impressions; t.clicks += clicks; t.leads += leads; t.followers += followers; t.sales += sales; t.revenue += rev;
      ad += b; imp += impressions; clk += clicks; lead += leads; sale += sales; fol += followers;
    }
    let fx = 0;
    for (const f of cfg.fixed_costs || []) {
      let amt = Number(f.monthly || 0);
      if (f.one_time !== undefined && Number(f.month || 1) === i + 1) amt += Number(f.one_time);
      if (amt) { row.fixed.push({ name: f.name, amount: r0(amt) }); fixedTot[f.name] = (fixedTot[f.name] || 0) + amt; }
      fx += amt;
    }
    const rev = sale * aov;
    Object.assign(row, { ad_spend: r0(ad), fixed_cost: r0(fx), total_cost: r0(ad + fx), impressions: r0(imp), clicks: r0(clk), leads: r0(lead), new_followers: r0(fol),
      new_sales: r1(sale), marketing_revenue: r0(rev), gross_profit: r0(rev * gm), net_contribution: r0(rev * gm - ad - fx) });
    months.push(row);
  }
  const total = (k) => months.reduce((s, m) => s + m[k], 0);
  const ad = total("ad_spend"), fx = total("fixed_cost"), cost = total("total_cost"), sales = total("new_sales"), rev = total("marketing_revenue");
  const ltv = aov * gm * Number(cfg.purchases_per_customer_per_year || 1) * Number(cfg.retention_years || 1);
  const cac = sales ? cost / sales : null, base = Number(cfg.baseline_monthly_revenue || 0) * n;
  let cum = 0, payback = null;
  for (const m of months) { cum += m.net_contribution; m.cumulative_net_contribution = r0(cum); if (payback === null && cum >= 0 && aov > 0) payback = m.month_index; }
  const channels = Object.entries(chTot).map(([name, t]) => ({ name, budget: r0(t.budget), budget_share_pct: ad ? r1(t.budget / ad * 100) : 0, impressions: r0(t.impressions), clicks: r0(t.clicks),
    leads: r0(t.leads), followers: r0(t.followers), cost_per_follower: t.followers ? r0(t.budget / t.followers) : null, cost_per_lead: t.leads ? r0(t.budget / t.leads) : null,
    sales: r1(t.sales), revenue: r0(t.revenue), cac_ad_only: t.sales ? r0(t.budget / t.sales) : null, roas: t.budget ? r2(t.revenue / t.budget) : null }));
  const summary = { period_months: n, total_ad_spend: r0(ad), total_fixed_cost: r0(fx), total_marketing_cost: r0(cost), avg_monthly_cost: r0(cost / n),
    total_impressions: total("impressions"), total_clicks: total("clicks"), total_leads: total("leads"), new_followers: total("new_followers"),
    cost_per_1000_impressions: total("impressions") ? r0(ad / total("impressions") * 1000) : null, cost_per_click: total("clicks") ? r0(ad / total("clicks")) : null,
    cost_per_lead: total("leads") ? r0(cost / total("leads")) : null, cost_per_follower: total("new_followers") ? r0(cost / total("new_followers")) : null,
    new_customers: r1(sales), marketing_revenue: r0(rev), gross_profit_from_marketing: r0(rev * gm), net_contribution_first_purchase: r0(rev * gm - cost),
    cac: cac ? r0(cac) : null, roas_ad_only: ad && aov ? r2(rev / ad) : null, roas_total_cost: cost && aov ? r2(rev / cost) : null, break_even_roas: gm ? r2(1 / gm) : null,
    ltv_gross_profit: r0(ltv), ltv_cac_ratio: cac ? r2(ltv / cac) : null, lifetime_net_contribution: r0(sales * ltv - cost), payback_month_first_purchase: payback,
    marketing_cost_pct_of_total_revenue: (rev + base) ? r1(cost / (rev + base) * 100) : null, fixed_cost_breakdown: Object.fromEntries(Object.entries(fixedTot).map(([k, v]) => [k, r0(v)])) };
  return { summary, channels, months };
}

function warnings(cfg, res) {
  const w = [], s = res.summary, salesGoal = Number(cfg.avg_order_value || 0) > 0;
  if (!salesGoal && !s.new_followers && !s.total_leads) w.push("Борлуулалтгүй зорилготой атал дагагч, лавлагааны хөрвүүлэлт өгөгдөөгүй.");
  if (salesGoal && s.roas_total_cost !== null && s.break_even_roas && s.roas_total_cost < s.break_even_roas) w.push(`Зардлын өгөөж (${s.roas_total_cost}) алдагдалгүй байх цэг (${s.break_even_roas})-ээс доогуур: эхний худалдан авалтаар маркетингийн зардал нөхөгдөхгүй.`);
  if (salesGoal && s.ltv_cac_ratio !== null && s.ltv_cac_ratio < 3) w.push(`LTV/CAC = ${s.ltv_cac_ratio} (эрүүл түвшин 3.0-аас дээш).`);
  const p = s.marketing_cost_pct_of_total_revenue;
  if (salesGoal && p !== null && p > 25) w.push(`Маркетингийн зардал орлогын ${p}% (ердийн хүрээ 5-15%, шинэ бизнест 20% хүртэл).`);
  for (const c of cfg.channels) {
    if (Number(c.ctr_pct || 0) > 0.05) w.push(`'${c.name}': товшилтын хувь ${(c.ctr_pct * 100).toFixed(1)}% хэт өндөр.`);
    const conv = c.click_to_sale_pct !== undefined ? Number(c.click_to_sale_pct) : Number(c.click_to_lead_pct || 0) * Number(c.lead_to_sale_pct || 0);
    if (conv > 0.08) w.push(`'${c.name}': товшилтоос борлуулалт руу ${(conv * 100).toFixed(1)}% хөрвөх нь хэт өөдрөг.`);
  }
  return w;
}

function calculate(cfg) {
  const real = run(cfg, 1), sc = cfg.scenarios || {};
  return { realistic: real, scenarios: { pessimistic: run(cfg, Number(sc.pessimistic ?? 0.7)).summary, realistic: real.summary, optimistic: run(cfg, Number(sc.optimistic ?? 1.25)).summary }, warnings: warnings(cfg, real) };
}
module.exports = { calculate, run, addMonths };
