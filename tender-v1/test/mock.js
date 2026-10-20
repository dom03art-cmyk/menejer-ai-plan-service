// TENDER_MOCK=1 үед Claude-ийн оронд бэлэн хариу (2026-10-19-ний бодит ТББ-ээр скиллийн туршилтад гаргасан JSON).
// TENDER_MOCK_CASE: security (үйлчилгээ, үнийн санал дуудах) | office (бараа, 3 багц) | works (барилгын шинжтэй) | expired
// TENDER_MOCK_BREAK=1 — эхний B2 хариунаас аргачлалыг хасна (засах давталтыг шалгах)
// TENDER_MOCK_GAP=1 — B1 хариунаас доод үнийг хасна (оролцогчоос дутууг асуух урсгалыг шалгах)
const fs = require("fs"), path = require("path");
const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "samples", f), "utf8"));
const CASES = { security: "real-security-2.json", office: "real-office-lot3.json", works: "real-security-2.json", expired: "real-security-2.json" };
let b2calls = 0;
const calls = [];

function respond(task, user) {
  calls.push(task);
  const c = process.env.TENDER_MOCK_CASE || "security";
  const d = load(CASES[c]);
  const tender = JSON.parse(JSON.stringify(d.tender));
  if (c === "expired") tender.deadline = "2026-01-05T10:00:00+08:00";
  if (task === "A1") {
    if (c === "office" && !/Багц 3/.test(user)) return { type: "goods", lots: [{ no: "1", name: "Цаас", budget: 30000000 }, { no: "2", name: "Хавтас", budget: 12000000 }, { no: "3", name: "Бичиг хэргийн жижиг материал", budget: 9900000 }], lot_found: false, tender: {} };
    return { type: c === "works" ? "works" : d.meta.type, works_like: c === "works", works_reason: c === "works" ? "БА-2.2 тусгай зөвшөөрөл, ажлын төсөв шаардсан" : "", lots: [], lot_found: true,
      meta: { type: d.meta.type, standard_version: d.meta.standard_version, source_files: d.meta.source_files }, tender, unreadable: [],
      brief: `«${tender.name}»\nЗахиалагч: ${tender.procuring_entity}\nТөсөвт өртөг: ${tender.budget}₮\nЭцсийн хугацаа: ${tender.deadline}` };
  }
  if (task === "A1X") return { items: [], tech_specs: [], requirements: [{ id: "R101", category: "other", text: "Урт ТББ-ийн 2-р хэсгийн нэмэлт шаардлага", ref: "ТТ 9", evidence: "—" }], forms: [], numeric_criteria: [], inconsistencies: [], contract: {} };
  if (task === "A2") return { known: ["Компанийн нэр: " + d.customer.company.name], questions: ["1. Гарын үсэг зурах хүний нэр, албан тушаал?", "2. 2024, 2025 оны борлуулалтын орлого?", "3. Санал болгох үнэ ба доод үнэ?"], docs: ["Улсын бүртгэлийн гэрчилгээ", "Санхүүгийн тайлан 2024, 2025"], critical: ["signatory", "metrics", "prices", "floor_price"], warning: "" };
  if (task === "GAP") return /доод үнэ|floor/i.test(String(user).split("\n").filter((l) => l.startsWith("Оролцогч:")).join("\n")) ? { missing: [], ready: true } : { missing: ["Доод үнэ (үнийн санал дуудах ажиллагаанд)"], ready: false };
  if (task === "B1") {
    const cu = JSON.parse(JSON.stringify(d.customer));
    if (process.env.TENDER_MOCK_GAP === "1" && calls.filter((x) => x === "B1").length === 1) cu.floor_price = null;
    return { customer: cu };
  }
  if (task === "B2") {
    b2calls++;
    const sections = JSON.parse(JSON.stringify(d.sections || {}));
    if (process.env.TENDER_MOCK_BREAK === "1" && b2calls === 1) delete sections.methodology;
    return { sections, letters: d.letters || [], drafts: d.drafts || [], attachments: d.attachments || [] };
  }
  throw new Error("mock: тодорхойгүй даалгавар " + task);
}
module.exports = { respond, calls, reset: () => { b2calls = 0; calls.length = 0; } };
