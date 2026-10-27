// Туршилтын товчлол: ТББ унших (A шат) болон төлбөрийг алгасаж, бэлэн жишээ тендерээр нүдтэй хуудсыг шууд нээнэ.
// Зөвхөн туршигч (TENDER_ALLOW_PSIDS / TENDER_TEST_CODE) ашиглана. Messenger-т:
//   «тендер-хуудас»        — үйлчилгээ (харуул хамгаалалт, үнийн санал дуудах ажиллагаатай)
//   «тендер-хуудас бараа»  — бараа (бичиг хэргийн материал, Багц 3)
// Хуудсан дээрх файл шалгалт (Haiku) ба «Материал гаргах» (B шат) бодитоор ажиллана.
const path = require("path");
const S = require("./store");
const SL = require("./slots");

const KEYWORD = /^\s*тендер[-\s]?хуудас(\s+(бараа|үйлчилгээ))?\s*$/i;

const PRESETS = {
  services: {
    file: "real-security-2.json",
    file_slots: [
      { key: "license", label: "Харуул хамгаалалт эрхлэх тусгай зөвшөөрөл", help: "ЦЕГ-ын Нийгмийн хэв журам хамгаалах газраас олгосон, хүчинтэй", required: true, req_id: "R4", multi: false, checks: { expiry: true, company: true } },
      { key: "fin", label: "Санхүүгийн тайлан (2024, 2025)", help: "e-balance-аас баталгаажсан", required: true, req_id: "R5", multi: true, checks: { company: true } },
      { key: "credit", label: "Зээлийн мэдээллийн сангийн тодорхойлолт", help: "QR кодтой, тендер зарласнаас хойш авсан", required: true, req_id: "R6", multi: false, checks: { company: true } },
      { key: "staff_certs", label: "Ажилтнуудын сургалтын гэрчилгээ", help: "Хяналтын ажилтан 1, ээлжийн харуул 3", required: true, req_id: "R8", multi: true, checks: { expiry: true } },
      { key: "experience", label: "Ижил төстэй ажлын гэрээ, дүгнэлт", help: "2024 эсвэл 2025 онд ≥ 40 500 000₮", required: true, req_id: "R10", multi: true, checks: { company: true } },
      { key: "premises", label: "Хяналтын байрны гэрчилгээ эсвэл нотариатаар баталсан түрээсийн гэрээ", required: true, req_id: "R13", multi: false, checks: { expiry: true } },
      { key: "training", label: "Сургалтын төвтэй байгуулсан гэрээ", required: true, req_id: "R17", multi: false, checks: { expiry: true, company: true } },
    ],
    extra_fields: [{ key: "staff", label: "Ажилтнуудын жагсаалт (нэр, албан тушаал, туршлага)", input: "textarea", required: true }],
  },
  goods: {
    file: "real-office-lot3.json",
    file_slots: [
      { key: "cert", label: "Улсын бүртгэлийн гэрчилгээний хуулбар", help: "2 талаас нь", required: true, req_id: "R1", multi: false, checks: { company: true } },
      { key: "director_id", label: "Захирлын иргэний үнэмлэхний хуулбар", required: true, req_id: "R3", multi: false, checks: { expiry: true } },
      { key: "fin", label: "Санхүүгийн тайлан (2024, 2025)", help: "e-balance-аас баталгаажсан", required: true, req_id: "R15", multi: true, checks: { company: true } },
      { key: "credit", label: "Зээлийн мэдээллийн сангийн тодорхойлолт", help: "QR кодтой, тендер зарласнаас хойш авсан", required: true, req_id: "R18", multi: false, checks: { company: true } },
      { key: "experience", label: "Ижил төстэй бараа нийлүүлсэн гэрээ, нэхэмжлэх", help: "2024 эсвэл 2025 онд санал болгох үнийн 100%-иас багагүй", required: true, req_id: "R19", multi: true, checks: { company: true } },
    ],
    extra_fields: [],
  },
};

const fut = (days) => new Date(Date.now() + days * 864e5 + 8 * 3600e3).toISOString().slice(0, 10) + "T10:00:00+08:00";

// → Messenger-т илгээх текст
async function openDemo(psid, text, url) {
  const kind = /бараа/i.test(text || "") ? "goods" : "services";
  const P = PRESETS[kind];
  const d = require(path.join(__dirname, "test", "samples", P.file));
  const base = { meta: JSON.parse(JSON.stringify(d.meta)), tender: JSON.parse(JSON.stringify(d.tender)) };
  base.tender.deadline = fut(14); base.tender.opening = fut(14); // жишээний огноо өнгөрсөн тул ирээдүйд шилжүүлнэ
  base.meta.demo = true;
  const slots = SL.buildSlots(base, P.file_slots, P.extra_fields);
  await S.clear(psid).catch(() => { });
  await S.patchCase(psid, { base, plan: { file_slots: P.file_slots, extra_fields: P.extra_fields, brief_items: [base.tender.name, base.tender.procuring_entity] }, slots, values: {}, demo: kind, analyzedAt: Date.now() });
  await S.setState(psid, { s: "tnd_slots", url, conv: [], paidAt: Date.now(), demo: true });
  console.log(`[tender] туршилтын хуудас нээв: ${psid} (${kind})`);
  return `🧪 ТУРШИЛТ — ТББ уншилт, төлбөрийг алгаслаа. Жишээ тендер:
• ${base.tender.name}
• ${base.tender.procuring_entity}

Нүдтэй хуудас (${slots.filter((x) => x.kind === "file").length} баримт, ${slots.filter((x) => x.kind !== "file").length} мэдээлэл):
${url}

Файл оруулахад бодит шалгалт (Haiku) ажиллана. «Материал гаргах» дарвал материал бодитоор бичигдэнэ (~$1, 10–20 мин).
Нөгөө жишээ: «тендер-хуудас ${kind === "goods" ? "үйлчилгээ" : "бараа"}»`;
}

module.exports = { KEYWORD, openDemo, PRESETS };
