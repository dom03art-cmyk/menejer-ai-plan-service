// Ярианы түүхээс санхүүгийн загварын таамаглалын объект гаргах.
const { callJSON, FAST, WRITER } = require("./claude");

const DEFAULTS = {
  cit_eff: 0.01, disc: 0.20, price_growth: 0.06, varcost_growth: 0.07, fixed_growth: 0.08,
  pay_fee: 0.01, mkt_rate: 0.07, er_si: 0.135,
  season: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  loan: { amount: 0, months: 36, rate_monthly: 0.017, grace_months: 0 },
  init_inventory: 0, capex: [], inkind: [], extra_capex: [], staff: [], fixed_monthly: {}, cash_equity: 0,
};

const SCHEMA = `{
 "company": {"name","reg_no","address","contact_name","phone","founded","core_business","industry"},
 "project": {"title","location","funder","funder_type":"bank|investor","description"},
 "start_year": 2026, "start_month_index": 0-11 (эхлэх сар, 0=1-р сар),
 "loan": {"amount","months","rate_monthly","grace_months"},
 "cash_equity": өөрийн мөнгөн хөрөнгө,
 "season": [эхлэх сараас эхлэн 12 тоо, сарын борлуулалтын харьцангуй жин, дундаж=1],
 "products": [{"key","name","price" (НӨАТ-тэй үнэ),"materials": {"орц": нэгжийн үнэ ₮},"labor": нэгжийн хөдөлмөр ₮,"delivery": нэгжийн хүргэлт ₮,"volumes":[5 жилийн жилийн тоо]}],
 "capex": [{"name","qty","unit_price","life" (жил)}],
 "inkind": [{"name","value","life","depreciable"}] (одоо эзэмшиж буй хөрөнгө; мал, газар зэрэг элэгдэлгүй хөрөнгөд "depreciable": false),
 "init_inventory": түүхий эдийн анхны нөөц ₮,
 "extra_capex": [{"name","year","amount","life"}],
 "staff": [{"title","count","gross" (сарын үндсэн цалин),"from_year"}],
 "fixed_monthly": {"зардлын нэр": сарын дүн ₮},
 "mkt_rate": маркетинг орлогын хувь (0.05-0.10),
 "assumed_fields": ["захиалагч хэлээгүй, чи таамагласан талбарууд"],
 "missing_info": ["банкинд заавал хэрэгтэй боловч дутуу мэдээлэл (регистр, барьцаа г.м.)"]
}`;

const SYSTEM = `Чи Монголын банкны стандартын бизнес төслийн санхүүгийн шинжээч. Захиалагчтай хийсэн ярианаас санхүүгийн загварын таамаглалыг гаргана.
Дүрэм:
1. Захиалагчийн хэлсэн тоог ЯГ тэр чигээр нь ашигла (үнэ, орц, зээлийн дүн, хугацаа).
2. Хэлээгүй зүйлийг Монголын 2026 оны зах зээлийн бодит түвшнээр КОНСЕРВАТИВ таамагла, assumed_fields-д заавал бич.
3. Борлуулалтын тоо хэмжээ хүчин чадал, зах зээлийн багтаамжаас хэтрэхгүй, жилийн өсөлт 3-15% байх. Туршилтын борлуулалт байвал түүнд тулгуурла.
4. Зээлийн хөрөнгийн зарцуулалт (capex + init_inventory) зээлийн дүнгээс хэтрэхгүй байх.
5. Цалин хөдөлмөрийн хөлсний доод хэмжээ 792,000 ₮-өөс багагүй.
6. Бизнесийн БҮХ орлогын эх үүсвэрийг тусга (жишээ нь мал аж ахуйд: мах/амьд мал, төллөлтөөр сүргийн өсөлт, сүү, арьс шир; үйлдвэрт: дайвар бүтээгдэхүүн). Үнийг Монголын 2026 оны бодит зах зээлийн түвшинд ав. Мал аж ахуй, газар тариалан, барилгатай төсөлд зээлийн үндсэн төлбөрийн хөнгөлөлтийг (grace_months 6-12) тохиромжтой гэж үзэж болно.
7. Захиалагч "ажилтан авахгүй", "өөрөө ажиллана" гэвэл staff = [] (хоосон). Эзэмшигчийн өөрийн хөдөлмөрийг цалингийн зардал болгож БҮҮ тооц — энэ нь ашгаас олгогдоно.
8. Мал сүрэг, газар бол элэгддэггүй (биологийн/байнгын) хөрөнгө — inkind-д "depreciable": false. Малын төллөлт, сүргийн өсөлтийг жил бүрийн борлуулалтын тоонд тусга.
9. Зөвхөн JSON буцаа. Бүтэц:\n${SCHEMA}`;

async function extract(conversationText) {
  const A = await callJSON({ system: SYSTEM, user: `Захиалагчтай хийсэн яриа:\n\n${conversationText}`, model: WRITER, maxTokens: 8000 });
  return normalize(A);
}

function normalize(A) {
  const out = { ...DEFAULTS, ...A, loan: { ...DEFAULTS.loan, ...(A.loan || {}) } };
  if (!Array.isArray(out.season) || out.season.length !== 12) out.season = DEFAULTS.season;
  out.products = (out.products || []).filter(p => p && p.price > 0).map((p, i) => ({
    key: p.key || `p${i + 1}`, name: p.name || `Бүтээгдэхүүн ${i + 1}`, price: Number(p.price),
    materials: p.materials || {}, labor: Number(p.labor || 0), delivery: Number(p.delivery || 0),
    volumes: (p.volumes || []).concat(Array(5).fill((p.volumes || [0]).slice(-1)[0])).slice(0, 5).map(Number),
  }));
  if (!out.products.length) throw new Error("Бүтээгдэхүүний мэдээлэл олдсонгүй");
  const capexTotal = out.capex.reduce((a, c) => a + c.qty * c.unit_price, 0);
  if (capexTotal + out.init_inventory > out.loan.amount + (out.cash_equity || 0)) {
    // зарцуулалт эх үүсвэрээс хэтэрвэл эргэлтийн нөөцийг багасгана
    out.init_inventory = Math.max(0, out.loan.amount + (out.cash_equity || 0) - capexTotal);
    (out.assumed_fields = out.assumed_fields || []).push("init_inventory (эх үүсвэрт тааруулж багасгав)");
  }
  out.start_year = out.start_year || 2026;
  out.start_month_index = out.start_month_index ?? new Date().getMonth() + 1;
  return out;
}

module.exports = { extract, normalize, DEFAULTS };
