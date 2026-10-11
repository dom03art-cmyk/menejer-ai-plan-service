// Хууль бус, хор хөнөөлтэй үйл ажиллагаанд төсөл/төлөвлөгөө бичихгүй байх хамгаалалт (бизнес төсөл, маркетинг хоёуланд).
// checkContent(text) → { allowed, category, reason }. Шалгалт өөрөө алдаа гарвал ХААХГҮЙ (хууль ёсны захиалгыг саатуулахгүй).
const { callJSON, FAST } = require("./claude");

const SYSTEM = `Чи бизнес төсөл, маркетингийн төлөвлөгөө бичдэг үйлчилгээний хууль ёсны байдлыг шалгагч. Захиалагчийн ярианаас тухайн ажлын ГОЛ зорилго, үйл ажиллагааг тодорхойлж, дараах ангилалд хамаарах эсэхийг шийд.
ХААХ (allowed=false):
- drugs: хууль бус мансууруулах, сэтгэцэд нөлөөт бодисын үйлдвэрлэл, худалдаа
- weapons: зөвшөөрөлгүй зэвсэг, тэсрэх бодис, түүний эд анги
- terrorism: алан хядах ажиллагаа, хүчирхийлэл, үймээн зохион байгуулах, хэт даврагч бүлэг
- sexual: садар самуун, порнограф, биеэ үнэлэх, бэлгийн үйлчилгээ; хүүхэдтэй холбоотой бэлгийн агуулга (үргэлж хаана)
- trafficking: хүн худалдаалах, хууль бус хөдөлмөр, эрхтэн худалдаа
- illegal_trade: хууль бус наймаа, хууль бусаар хил давуулах, хуурамч бараа, хулгайн эд, ан агнуурын хориотой амьтан, ургамлын наймаа
- fraud: залилан, пирамид схем, мөнгө угаах, хуурамч баримт бичиг, хуурамч зээл, хууль бус мөрийтэй тоглоом, казино
- other_illegal: дээрхээс өөр илт хууль бус үйл ажиллагаа
ЗӨВШӨӨРӨХ (allowed=true): хууль ёсны бүх бизнес, тэр дундаа тусгай зөвшөөрөлтэй эм хангамж, архи, тамхины лицензтэй худалдаа, ан агнуурын хууль ёсны хэрэгсэл, хамгаалалтын үйлчилгээ, дотуур хувцас, гоо сайхан, бар, караоке, эрүүл мэнд, сэтгэл зүйн үйлчилгээ, хууль ёсны улс төрийн үйл ажиллагаа. Эргэлзээтэй бол allowed=true (хүний ажилтан дараа нь харна).
Зөвхөн JSON: {"allowed":true|false,"category":"none|drugs|weapons|terrorism|sexual|trafficking|illegal_trade|fraud|other_illegal","reason":"нэг өгүүлбэр, монголоор"}`;

async function checkContent(text) {
  const t = String(text || "").trim();
  if (!t || process.env.GUARD_DISABLED === "1" || process.env.PLAN_MOCK === "1" || process.env.MKT_MOCK === "1") return { allowed: true, category: "none", reason: "" };
  try {
    const r = await callJSON({ model: FAST, maxTokens: 300, system: SYSTEM, user: `ЗАХИАЛАГЧИЙН ЯРИА:\n${t.slice(0, 20000)}` });
    if (r && r.allowed === false && r.category && r.category !== "none") return { allowed: false, category: String(r.category), reason: String(r.reason || "") };
    return { allowed: true, category: "none", reason: "" };
  } catch (e) {
    if (/credit balance/i.test(e.message || "")) throw e;
    console.warn("[guard] шалгалт алгасав:", e.message);
    return { allowed: true, category: "none", reason: "" };
  }
}

const CUSTOMER_MSG = "Уучлаарай, таны дурдсан үйл ажиллагаа хууль бус эсвэл манай үйлчилгээний нөхцөлд нийцэхгүй байгаа тул бид төсөл, төлөвлөгөө боловсруулах боломжгүй. Төлбөрийн асуудлаар манай ажилтан тантай холбогдоно.";

function blockedError(g) { return Object.assign(new Error(`Хууль бус агуулга (${g.category}): ${g.reason}`), { status: "blocked", guard: g }); }

module.exports = { checkContent, CUSTOMER_MSG, blockedError };
