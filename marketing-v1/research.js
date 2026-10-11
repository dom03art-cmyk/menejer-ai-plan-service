// Web хайлтаар маркетингийн судалгаа хийж, баримтуудыг JSON болгон буцаана. Амжилтгүй бол хоосон (төлөвлөгөө судалгаагүй үргэлжилнэ).
const { callJSON, WRITER } = require("../plan-v2/claude");
const SYSTEM = `Чи маркетингийн судлаач. web_search хэрэгслээр хайлт хийж, зөвхөн эх сурвалжтай, огноотой баримтыг цуглуул. Хайлтын үр дүнгээс ишлэл хуулахгүй, өөрийн үгээр товч бич. Эх сурвалжгүй тоо, зохиомол сэтгэгдэл, зохиомол өрсөлдөгч бүү бич. Олдоогүй зүйлийг орхи.
Зөвхөн JSON: {"facts":[{"topic":"market|audience|digital|competitor|price|customer_voice|ad_cost|season","fact":"Монгол хэлээр, тодорхой өгүүлбэр","source":"байгууллага/сайт","date":"он эсвэл он-сар"}]}. 10-22 баримт.`;
const TOPICS = {
  market: (A) => `Монгол Улс. Сурталчлах зүйл: ${A.brand.offer || A.brand.name} (${A.brand.industry || ""}). Зорилтот хүмүүс: ${A.audience || "тодорхойгүй"}.
Хайх: (1) зорилтот бүлгийн тоо, бүтэц, байршил (ҮСХ 1212.mn, яам, холбоодын мэдээ); (2) салбарын хэрэглээний чиг хандлага, улирлын хэлбэлзэл; (3) Монгол дахь интернэт, Facebook, Instagram, Messenger, TikTok-ийн хэрэглэгчийн тоо (DataReportal-ийн хамгийн сүүлийн "Digital ... Mongolia" тайлан); (4) Монголд Facebook зарын харуулалт, товшилтын үнийн нийтлэгдсэн жишиг (олдохгүй бол орхи).`,
  competitors: (A) => `Монгол Улс. Сурталчлах зүйл: ${A.brand.offer || A.brand.name}. Захиалагчийн нэрлэсэн өрсөлдөгчид: ${(A.competitors || []).join(", ") || "нэрлээгүй"}.
Хайх: (1) ижил болон орлуулах бүтээгдэхүүн, үйлчилгээ үзүүлэгчид (нэр, төрөл), тэдний үнэ, санал, ашигладаг суваг; (2) тэдний зарын арга барил, гол амлалт; (3) хэрэглэгчдийн нээлттэй сэтгэгдэл, асуулт, гомдол (худалдааны сайт, хуудасны сэтгэгдэл; яг бичсэнээр нь богино ишлэл, эх сурвалжтай). Нээлттэй эх сурвалжид байхгүй бол зохиохгүй.`,
};
async function research(A) {
  const one = async (k) => { try { return (await callJSON({ system: SYSTEM, user: TOPICS[k](A), webSearch: true, maxSearches: 8, maxTokens: 16000, model: WRITER })).facts || []; } catch (e) { if (/credit balance/i.test(e.message || "")) throw e; console.warn(`[mkt-research] ${k}: ${e.message}`); return []; } };
  const fixSrc = (arr) => arr.map((f) => { const src = String(f.source || "");
    return /web_?search|судалгааны тойм|хайлтын үр дүн/i.test(src) || !src.trim() ? { ...f, source: "Нээлттэй эх сурвалжийн хайлт" } : f; });
  const [market, competitors] = (await Promise.all([one("market"), one("competitors")])).map(fixSrc);
  return { market, competitors };
}
module.exports = { research };
