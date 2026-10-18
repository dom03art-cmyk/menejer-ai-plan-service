// Ярианы түүхээс санхүүгийн загварын таамаглалын объект гаргах.
const { callJSON, FAST, WRITER } = require("./claude");

const DEFAULTS = {
  cit_eff: 0.01, disc: 0.20, price_growth: 0.06, varcost_growth: 0.07, fixed_growth: 0.08,
  pay_fee: 0.01, mkt_rate: 0.07, er_si: 0.135,
  season: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  loan: { amount: 0, months: 36, rate_monthly: 0.017, grace_months: 0 },
  init_inventory: 0, capex: [], inkind: [], extra_capex: [], staff: [], fixed_monthly: {}, cash_equity: 0,
};

const DEFAULT_CONTINGENCY = Math.min(0.3, Math.max(0, Number(process.env.PLAN_CONTINGENCY_RATE ?? 0.10))) || 0;

const SCHEMA = `{
 "company": {"name","reg_no","address","contact_name","phone","founded","core_business","industry"},
 "project": {"title","location","funder","funder_type":"bank|investor","description"},
 "start_year": 2026, "start_month_index": 0-11 (БОРЛУУЛАЛТ эхлэх сар, 0=1-р сар — барилга, угсралт, тоног төхөөрөмж суурилуулалт, туршилтын үйлдвэрлэл дууссаны дараах сар),
 "loan": {"amount","months","rate_monthly","grace_months"},
 "cash_equity": өөрийн мөнгөн хөрөнгө,
 "season": [эхлэх сараас эхлэн 12 тоо, сарын борлуулалтын харьцангуй жин, дундаж=1],
 "products": [{"key","name","unit" (борлуулах нэгж: кг, ширхэг, литр, тн, хайрцаг, үйлчилгээ г.м. — volumes ба price энэ нэгжээр),"price" (НӨАТ-тэй үнэ),"materials": {"орц": нэгжийн үнэ ₮},"labor": нэгжийн хөдөлмөр ₮,"delivery": нэгжийн хүргэлт ₮,"volumes":[5 жилийн жилийн тоо]}],
 "capex": [{"name","qty","unit_price","life" (жил)}],
 "inkind": [{"name","value","life","depreciable"}] (одоо эзэмшиж буй хөрөнгө; мал, газар зэрэг элэгдэлгүй хөрөнгөд "depreciable": false),
 "init_inventory": түүхий эдийн анхны нөөц ₮,
 "extra_capex": [{"name","year","amount","life"}],
 "staff": [{"title","count","gross" (сарын үндсэн цалин),"from_year"}],
 "fixed_monthly": {"зардлын нэр": сарын дүн ₮},
 "mkt_rate": маркетинг орлогын хувь (0.05-0.10),
 "funnel": ЗӨВХӨН захиалагч өөрөө хэлсэн үед: {"monthly_contacts": сард хандаж буй хүний тоо (мессеж, залгалт, ирц), "conv_rate": хандсанаас худалдан авдаг хувь (0-1), "avg_ticket": дундаж нэг худалдан авалтын дүн ₮}. Хэлээгүй талбарыг БҮҮ зохио, огт хэлээгүй бол энэ талбарыг бичихгүй,
 "assumed_fields": ["захиалагч хэлээгүй, чи таамагласан талбарууд"],
 "missing_info": ["банкинд заавал хэрэгтэй боловч дутуу мэдээлэл (регистр, барьцаа г.м.)"],
 "contingency_rate": ЗӨВХӨН захиалагч нөөц төсвийн (гэнэтийн зардлын) хувийг ТОДОРХОЙ хэлсэн үед: "нөөц төсөвгүй", "10%-ийг хас" → 0, "5%" → 0.05. Хэлээгүй бол энэ талбарыг БҮҮ бич,
 "exclude": ["insurance"] — захиалагч тодорхой хасуулахыг хүссэн хэсэг (одоогоор зөвхөн "insurance" = даатгалын хүснэгт). Хүсээгүй бол [],
 "target_requests": ["захиалагч үр дүнг урьдчилж тогтоохыг хүссэн бол (ашиг 50%-иас багагүй, NPV эерэг, зээл төлөх чадвар хангалттай гарга г.м.) түүний үгээр товч"]
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
9. Захиалагч санхүүгийн ҮР ДҮНГ урьдчилж тогтоохыг хүссэн бол (ашиг, ашгийн хувь, NPV, IRR, DSCR-ийг тодорхой хэмжээнд хүргэх) түүнийг target_requests-д бичээд, үүний төлөө ЯМАР Ч тоог (үнэ, тоо хэмжээ, зардал, цалин) өөрчилж, өсгөж, бууруулж БОЛОХГҮЙ. Тоо зөвхөн захиалагчийн хэлсэн бодит мэдээлэл ба зах зээлийн бодит түвшинд тулгуурлана.
10. Хүчин чадал, гарцыг хугацааны нэгжтэй нь (сард, жилд, нэг үйлдвэрлэлийн циклд) зөв хөрвүүлж volumes-д ЖИЛИЙН тоогоор бич. Барилга, засвар, суурилуулалт хийх бол борлуулалтыг тэр ажил дууссаны дараах сараас эхлүүл (start_month_index); эхний жилийн борлуулалтыг хүчин чадлын аажмаар нэмэгдэлтээр тооцож, үйл ажиллагаа зогсдог (жишээ нь өвлийн) саруудад season-ийн жинг бага тавь.
11. Зөвхөн JSON буцаа. Бүтэц:\n${SCHEMA}`;

async function extract(conversationText) {
  const A = await callJSON({ system: SYSTEM, user: `Захиалагчтай хийсэн яриа:\n\n${conversationText}`, model: WRITER, maxTokens: 16000 });
  return normalize(A);
}

function normalize(A) {
  const out = { ...DEFAULTS, ...A, loan: { ...DEFAULTS.loan, ...(A.loan || {}) } };
  if (!Array.isArray(out.season) || out.season.length !== 12) out.season = DEFAULTS.season;
  out.products = (out.products || []).filter(p => p && p.price > 0).map((p, i) => ({
    key: p.key || `p${i + 1}`, name: p.name || `Бүтээгдэхүүн ${i + 1}`, unit: String(p.unit || "").trim().slice(0, 20) || "нэгж", price: Number(p.price),
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
  // Нөөц төсөв: анхдагч 10% (0–30%). Утгыг зөвхөн код тогтооно.
  out.contingency_rate = Math.min(0.3, Math.max(0, Number(out.contingency_rate ?? DEFAULT_CONTINGENCY)));
  if (!isFinite(out.contingency_rate)) out.contingency_rate = DEFAULT_CONTINGENCY;
  out.exclude = Array.isArray(out.exclude) ? out.exclude.filter(x => typeof x === "string") : [];
  out.target_requests = Array.isArray(out.target_requests) ? out.target_requests.filter(x => typeof x === "string" && x.trim()).slice(0, 5) : [];
  out.funnel = require("./funnel").clean(out.funnel);
  out.tax_regime = out.tax_regime === "legacy" ? "legacy" : "auto";
  out.start_year = out.start_year || 2026;
  out.start_month_index = out.start_month_index ?? new Date().getMonth() + 1;
  return out;
}

module.exports = { extract, normalize, DEFAULTS };
