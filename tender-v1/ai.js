// Claude дуудлагууд (A1 ТББ задлах, A2 асуулт, GAP бэлэн эсэх, B1 өгөгдөл, B2 текст).
// plan-v2/claude.js-ийн callJSON-ийг өөрчлөхгүйгээр ашиглана. TENDER_MOCK=1 бол test/mock.js-ийн бэлэн хариуг буцаана.
const P = require("./prompts");
const MOCK = () => process.env.TENDER_MOCK === "1";
const MODEL = () => process.env.TENDER_MODEL || require("../plan-v2/claude").WRITER;

function ask(task, docsText, user, maxTokens) {
  if (MOCK()) return require("./test/mock").respond(task, user);
  const { callJSON } = require("../plan-v2/claude");
  // SYSTEM + файлуудын текст = ижил угтвар → дараагийн дуудлагууд cache-ээс уншина
  return callJSON({ system: P.SYSTEM, cached: `######## ФАЙЛУУД ########\n${docsText || "(файл алга)"}`, user, model: MODEL(), maxTokens });
}

const analyzeTender = (docsText, lot) => ask("A1", docsText, P.A1(lot), 32000);
const analyzeMore = (docsText, tender, part, parts) => ask("A1X", docsText, P.A1X(tender, part, parts), 24000);
const questions = (docsText, tender, conv) => ask("A2", docsText, P.A2(tender, conv), 6000);
async function gapCheck(critical, qs, conv) {
  if (MOCK()) return require("./test/mock").respond("GAP", conv);
  const { callJSON, FAST } = require("../plan-v2/claude");
  return callJSON({ system: "Чи тендерийн мэдээлэл шалгагч. Зөвхөн JSON хариул.", user: P.GAP(critical, qs, conv), model: process.env.TENDER_GAP_MODEL || FAST, maxTokens: 1500 });
}
const customerData = (docsText, base, conv, issues) => ask("B1", docsText, P.B1(base, conv, issues), 24000);
const texts = (docsText, base, conv, issues) => ask("B2", docsText, P.B2(base, conv, issues), 32000);

module.exports = { analyzeTender, analyzeMore, questions, gapCheck, customerData, texts };
