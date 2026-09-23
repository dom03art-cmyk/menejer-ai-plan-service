// Web search-ээр судалгаа хийж, баримтуудыг JSON болгон буцаана.
// Салбарын түвшний (захиалагчаас үл хамаарах) судалгааг 90 хоног кэшлэнэ.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { callJSON, WRITER } = require("./claude");
const CACHE_DIR = process.env.RESEARCH_CACHE_DIR || "/tmp/research-cache";
const TTL = 90 * 24 * 3600 * 1000;

const TOPICS = {
  macro: (ind) => `Монгол Улс, ${ind} салбарт хамаарах МАКРО орчны хамгийн сүүлийн тоо баримт: (1) хууль эрх зүй — татварын горим (ААНОАТ, НӨАТ), ЖДҮ-ийн дэмжлэг, хөнгөлөлттэй зээлийн хөтөлбөр (нэр, нөхцөл), салбарын стандарт/зөвшөөрөл; (2) нийгэм — ҮСХ-ны өрхийн орлого, зарлага, орлогын бүлэг (хамгийн сүүлийн улирал); (3) эдийн засаг — ДНБ-ий өсөлт, инфляц, Монголбанкны бодлогын хүү, ам.доллар/юанийн ханш; (4) байгаль орчин — салбарт нөлөөлөх цаг уур, хаягдлын асуудал; (5) технологи — интернэт, Facebook/Instagram хэрэглэгчийн тоо, цахим төлбөр.`,
  market: (ind, desc) => `Монгол болон дэлхийн ${ind} зах зээлийн судалгаа: (1) дэлхийн/бүс нутгийн зах зээлийн хэмжээ, жилийн өсөлт (CAGR) эх сурвалжтай; (2) Монгол дахь зах зээлийн хэмжээ эсвэл тооцоолоход хэрэгтэй тоо (өрхийн тоо, хэрэглэгчийн тоо, импортын хэмжээ); (3) Монгол дахь гол өрсөлдөгчид — НЭРЭЭР нь, үнийн түвшин, суваг; (4) хэрэглэгчийн худалдан авах зуршил; (5) салбарын ашгийн маржин, жишиг үзүүлэлт. Төслийн тайлбар: ${desc}`,
};
const SYSTEM = `Чи судлаач. web_search хэрэгслээр хайлт хийж, зөвхөн эх сурвалжтай, огноотой тоо баримтыг цуглуул. Хэрэгслийн хайлтын үр дүнгээс ишлэл хуулахгүй, өөрийн үгээр товч бич. Эх сурвалжгүй тоо бүү зохио.
Зөвхөн JSON буцаа: {"facts":[{"topic":"legal|social|economy|environment|technology|market_size|competitors|consumers|benchmark","fact":"Монгол хэлээр, тоотой өгүүлбэр","source":"байгууллага/сайт","date":"он-сар"}]}. 12-25 баримт.`;

function cacheGet(key) {
  try { const p = path.join(CACHE_DIR, key + ".json"); const d = JSON.parse(fs.readFileSync(p, "utf8")); if (Date.now() - d.t < TTL) return d.v; } catch (_) { }
  return null;
}
function cacheSet(key, v) { try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(path.join(CACHE_DIR, key + ".json"), JSON.stringify({ t: Date.now(), v })); } catch (_) { } }

async function research(A) {
  const ind = A.company.industry || A.project.title;
  const indKey = crypto.createHash("md5").update(ind.toLowerCase()).digest("hex").slice(0, 12);
  let macro = cacheGet("macro-" + indKey);
  if (!macro) {
    macro = (await callJSON({ system: SYSTEM, user: TOPICS.macro(ind), webSearch: true, maxSearches: 8, maxTokens: 8000, model: WRITER })).facts || [];
    cacheSet("macro-" + indKey, macro);
  }
  // Зах зээлийн судалгаа нь төсөл бүрт өөр (өрсөлдөгч, хэрэглэгч) тул кэшлэхгүй
  const market = (await callJSON({ system: SYSTEM, user: TOPICS.market(ind, A.project.description || ""), webSearch: true, maxSearches: 8, maxTokens: 8000, model: WRITER })).facts || [];
  return { macro, market };
}
module.exports = { research };
