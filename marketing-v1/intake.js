// Ярианаас маркетингийн төлөвлөгөөний таамаглалыг (A) гаргаж, кодоор хэвийн болгоно.
// Төсвийн дээд хязгаарыг КОД сахина: AI юу ч гэсэн сарын зардал захиалагчийн хэлсэн төсвөөс хэтрэхгүй.
const { callJSON } = require("../plan-v2/claude");
const { addMonths } = require("./calc");

const SYSTEM = `Чи маркетингийн төлөвлөгөөний мэдээлэл задлагч. Захиалагчтай хийсэн ярианаас доорх JSON-г гарга. Захиалагчийн хэлсэн тоо, нэрийг яг тэр чигээр нь ашигла (оноосон нэрийг засахгүй). Хэлээгүй зүйлийг null болгож, assumed_fields-д бич.
Сувгийн төлөвлөлтийн дүрэм:
- Захиалагчийн хүн хүч, төсөвт тохирсон 2-4 төлбөртэй суваг/кампанит ажил (ганц хүнтэй, бага төсөвтэй бол 2-3). Ихэвчлэн: борлуулалтын зар (төсвийн 55-65%), танигдалт/сонирхол татах видео зар (20-25%), дахин хандах зар (10-15%).
- Сувгийн сарын төсвүүд + тогтмол зардлын сарын дүн нь сарын төсвөөс хэтрэхгүй.
- cpm (1000 харуулалтын үнэ, төгрөг), ctr_pct (0.008-0.02), click_to_lead_pct (чатаар борлуулдаг бол 0.15-0.30), lead_to_sale_pct (үнэтэй, бодож авдаг бол 0.02-0.05; хямд бол 0.05-0.15)-ыг БОЛГООМЖТОЙ, доод талаас нь ав. Вэбсайтаар шууд борлуулдаг бол click_to_sale_pct (0.005-0.03). Борлуулалтгүй зорилго (танигдалт, хувийн брэнд) бол avg_order_value=0 ба click_to_follower_pct (0.05-0.25), click_to_lead_pct.
- Захиалагч өмнөх зарын бодит үр дүн (зарцуулсан дүн, харуулалт/хүрэлт, товшилт, мессеж, захиалга) хэлсэн бол ad_history-д яг тоогоор нь бич.
- fixed_costs: зөвхөн мөнгө гарах зүйл (дизайн/видео хэрэгсэл, хэвлэл, зураг авалт, нөөц 5-10%). Өөрөө хийх ажилд зардал бүү тавь.
- gross_margin_pct: захиалагч өртөг/ашгаа хэлсэн бол түүнээс бод; үгүй бол салбарын ердийн түвшний доод талыг авч assumed_fields-д бич.
Зөвхөн JSON:
{"subject_type":"product|organization|person","brand":{"name":"","slogan":null,"offer":"юу санал болгодог, нэг өгүүлбэр","price_text":"үнэ, нөхцөл","colors":null,"industry":""},
"team":{"size":1,"marketer":"хэн хариуцах"},"location":"","sales_channel":"чат|вэбсайт|дэлгүүр|B2B|холимог",
"start_month":"YYYY-MM (захиалагч эхлэх сараа хэлсэн бол, ж: 11-р сараас → оны дугаартай 2026-11; хэлээгүй бол null)","goal":{"text":"","period_months":3},"money":{"monthly_budget":0,"avg_order_value":0,"gross_margin_pct":0.5,"purchases_per_year":1.0,"baseline_monthly_revenue":0},
"current":{"channels":"одоо ашиглаж буй суваг, дагагч","orders":"одоогийн борлуулалт","proof":"сэтгэгдэл, нотолгоо"},
"audience":"гол худалдан авагчид","competitors":["нэр эсвэл төрөл"],"customer_voice":["хэрэглэгчийн бодит үг, асуулт (захиалагчийн өгснөөр, яг үгээр)"],
"ad_history":{"spend":0,"days":0,"impressions":0,"clicks":0,"messages":0,"orders":0}|null,
"channels":[{"name":"","role":"sales|awareness|retarget","monthly_budget":0,"cpm":0,"ctr_pct":0,"click_to_lead_pct":0,"lead_to_sale_pct":0}],
"fixed_costs":[{"name":"","monthly":0},{"name":"","one_time":0,"month":1}],
"seasonality":[1.0],"efficiency_ramp":[0.6,0.85,1.0],"missing_info":[],"assumed_fields":[]}`;

const num = (v, d = 0) => { const n = Number(v); return isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function normalize(raw, now = new Date()) {
  const A = JSON.parse(JSON.stringify(raw || {}));
  A.subject_type = ["product", "organization", "person"].includes(A.subject_type) ? A.subject_type : "product";
  A.brand = Object.assign({ name: "Брэнд", slogan: null, offer: "", price_text: "", colors: null, industry: "" }, A.brand || {});
  A.team = Object.assign({ size: 1, marketer: "Эзэн өөрөө" }, A.team || {});
  A.goal = Object.assign({ text: "", period_months: 3 }, A.goal || {});
  const n = [3, 6, 12].includes(num(A.goal.period_months)) ? num(A.goal.period_months) : 3; A.goal.period_months = n;
  if (!/^\d{4}-\d{2}$/.test(A.start_month || "")) { const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; A.start_month = now.getDate() > 20 ? addMonths(ym, 1) : ym; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(A.start_date || "")) { const d = new Date(now.getTime() + 2 * 86400e3); A.start_date = d.toISOString().slice(0, 10); }
  const M = A.money = Object.assign({ monthly_budget: 0, avg_order_value: 0, gross_margin_pct: 0.5, purchases_per_year: 1, baseline_monthly_revenue: 0 }, A.money || {});
  M.monthly_budget = Math.max(0, num(M.monthly_budget)); M.avg_order_value = Math.max(0, num(M.avg_order_value));
  M.gross_margin_pct = clamp(num(M.gross_margin_pct, 0.5) > 1 ? num(M.gross_margin_pct) / 100 : num(M.gross_margin_pct, 0.5), 0.05, 0.95);
  M.purchases_per_year = clamp(num(M.purchases_per_year, 1), 1, 24);
  A.assumed_fields = Array.isArray(A.assumed_fields) ? A.assumed_fields : []; A.missing_info = Array.isArray(A.missing_info) ? A.missing_info : [];
  A.customer_voice = (Array.isArray(A.customer_voice) ? A.customer_voice : []).map(String).filter(Boolean);
  A.competitors = (Array.isArray(A.competitors) ? A.competitors : []).map(String).filter(Boolean);
  // Сувгууд: хязгаар тавьж, хэт өөдрөг тоог дарна
  const pct = (v, hi) => { let x = num(v); if (x > 1) x = x / 100; return clamp(x, 0, hi); };
  A.channels = (Array.isArray(A.channels) ? A.channels : []).filter(c => c && c.name && num(c.monthly_budget) > 0).slice(0, 5).map(c => {
    const o = { name: String(c.name), role: c.role || "sales", monthly_budget: num(c.monthly_budget), source: c.source || "Таамаглал" };
    if (c.cpc !== undefined && num(c.cpc) > 0) o.cpc = num(c.cpc); else o.cpm = Math.max(500, num(c.cpm, 3500));
    o.ctr_pct = pct(c.ctr_pct ?? 0.012, 0.03) || 0.012;
    if (c.click_to_sale_pct !== undefined && num(c.click_to_sale_pct) > 0) o.click_to_sale_pct = pct(c.click_to_sale_pct, 0.05);
    else { o.click_to_lead_pct = pct(c.click_to_lead_pct ?? 0.2, 0.4); if (M.avg_order_value > 0) o.lead_to_sale_pct = pct(c.lead_to_sale_pct ?? 0.03, 0.2); }
    if (c.click_to_follower_pct !== undefined) o.click_to_follower_pct = pct(c.click_to_follower_pct, 0.4);
    return o;
  });
  if (!A.channels.length) throw new Error("Сувгийн төлөвлөгөө гарсангүй (маркетингийн төсөв тодорхойгүй)");
  A.fixed_costs = (Array.isArray(A.fixed_costs) ? A.fixed_costs : []).filter(f => f && f.name && (num(f.monthly) > 0 || num(f.one_time) > 0)).slice(0, 6)
    .map(f => num(f.one_time) > 0 ? { name: String(f.name), one_time: num(f.one_time), month: clamp(Math.round(num(f.month, 1)), 1, n), source: f.source } : { name: String(f.name), monthly: num(f.monthly), source: f.source });
  A.seasonality = [...(Array.isArray(A.seasonality) ? A.seasonality.map(x => clamp(num(x, 1), 0.5, 1.5)) : []), ...Array(n).fill(1)].slice(0, n);
  const defRamp = [0.6, 0.85, 1];
  A.efficiency_ramp = [...(Array.isArray(A.efficiency_ramp) && A.efficiency_ramp.length ? A.efficiency_ramp.map(x => clamp(num(x, 1), 0.3, 1.1)) : defRamp), ...Array(n).fill(1)].slice(0, n);
  // Захиалагчийн зарын бодит түүх хангалттай бол борлуулалтын сувгийн таамаглалыг бодит тоогоор солино
  const h = A.ad_history;
  if (h && num(h.spend) > 0 && num(h.impressions) >= 1000) {
    const main = A.channels.find(c => c.role === "sales") || A.channels[0];
    const src = `Захиалагчийн зарын тайлан${num(h.days) ? " (" + num(h.days) + " хоног)" : ""}`;
    delete main.cpc; main.cpm = Math.max(300, Math.round(num(h.spend) / num(h.impressions) * 1000)); main.source = src;
    if (num(h.clicks) >= 20) main.ctr_pct = clamp(num(h.clicks) / num(h.impressions), 0.002, 0.03);
    if (num(h.clicks) >= 20 && num(h.messages) >= 5 && main.click_to_lead_pct !== undefined) main.click_to_lead_pct = clamp(num(h.messages) / num(h.clicks), 0.02, 0.4);
    if (num(h.messages) >= 20 && num(h.orders) >= 5 && main.lead_to_sale_pct !== undefined) main.lead_to_sale_pct = clamp(num(h.orders) / num(h.messages), 0.005, 0.2);
    A.ad_history_used = true;
  } else A.ad_history_used = false;
  // Төсвийн дээд хязгаар: аль ч сард (сувгийн төсөв × сарын жин + тогтмол зардал) ≤ сарын төсөв
  if (M.monthly_budget > 0) {
    const monthCost = (i) => A.channels.reduce((s, c) => s + c.monthly_budget * A.seasonality[i], 0) + A.fixed_costs.reduce((s, f) => s + (f.monthly || 0) + (f.one_time && f.month === i + 1 ? f.one_time : 0), 0);
    const worst = Math.max(...Array.from({ length: n }, (_, i) => monthCost(i)));
    if (worst > M.monthly_budget) {
      const k = M.monthly_budget / worst;
      A.channels.forEach(c => { c.monthly_budget = Math.floor(c.monthly_budget * k / 1000) * 1000; });
      A.fixed_costs.forEach(f => { if (f.monthly) f.monthly = Math.floor(f.monthly * k / 1000) * 1000; if (f.one_time) f.one_time = Math.floor(f.one_time * k / 1000) * 1000; });
      A.budget_scaled = true;
    }
  }
  A.scale = A.team.size <= 1 && M.monthly_budget <= 1000000 ? "micro" : (A.team.size >= 10 || n === 12 ? "org" : "sme");
  return A;
}

function toCalcConfig(A) {
  return { period_months: A.goal.period_months, start_month: A.start_month, avg_order_value: A.money.avg_order_value, gross_margin_pct: A.money.gross_margin_pct,
    purchases_per_customer_per_year: A.money.purchases_per_year, retention_years: 1, baseline_monthly_revenue: A.money.baseline_monthly_revenue,
    seasonality: A.seasonality, efficiency_ramp: A.efficiency_ramp, channels: A.channels, fixed_costs: A.fixed_costs,
    scenarios: { pessimistic: A.ad_history_used ? 0.7 : 0.6, optimistic: 1.3 } };
}

async function extract(conversation) {
  const today = new Date().toISOString().slice(0, 10);
  const raw = await callJSON({ system: SYSTEM, user: `Өнөөдөр: ${today}\n\nЯРИА:\n${String(conversation).slice(0, 40000)}`, maxTokens: 12000 });
  return normalize(raw);
}
module.exports = { extract, normalize, toCalcConfig };
