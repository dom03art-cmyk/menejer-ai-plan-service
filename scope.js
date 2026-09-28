// Засварын хүсэлт анхны төслийн сэдвийн хүрээнд байгаа эсэхийг шалгана.
// Өөр бизнес/сэдвээр шинэ төсөл бичүүлэх гэвэл татгалзана (засварын эрхийг буцааж олгоно).
const { callJSON, FAST } = require("./claude");
const MARK = "Засварын хүсэлт";

async function checkRevisionScope(conversation) {
  const i = (conversation || "").indexOf(MARK);
  if (i < 0) return { isRevision: false, inScope: true };
  const last = conversation.lastIndexOf(MARK);
  const original = conversation.slice(0, i).slice(-8000);
  const revision = conversation.slice(last).slice(0, 4000);
  const out = await callJSON({
    model: FAST, maxTokens: 400,
    system: `Чи бизнес төслийн үйлчилгээний хяналтын ажилтан. Захиалагч анх нэг бизнес төсөл захиалсан бөгөөд үнэгүй засварын эрхтэй. Засвар гэдэг нь ИЖИЛ бизнесийн төслийн тоо, мэдээлэл, хэсгийг өөрчлөх, нэмэх, санхүүжилтийн хэлбэр (банк/сан/хөрөнгө оруулагч), зээлийн дүн, байршил, бүтээгдэхүүний жагсаалтыг тодотгох явдал. ӨӨР бизнес/салбар/үйл ажиллагаа (жишээ нь хувцасны дэлгүүрээс кафе руу) болгох бол шинэ төсөл тул засварын хүрээнд орохгүй.
Мөн засварын хүсэлт нь БОДИТ өөрчлөлт хүссэн эсэхийг тогтоо (is_change_request). Ямар нэг тоо, хэсэг, мэдээлэл өөрчлөх/нэмэх/хасах, файл/зураг тусгах гэх мэт хийх зүйл заасан бол true. Зөвхөн мэндчилгээ, талархал, "за", "ок", "ойлголоо", асуулт, санамсаргүй тэмдэгт гэх мэт хийх өөрчлөлт огт заагаагүй бол false. Эргэлзээтэй бол true.
Зөвхөн JSON: {"in_scope": true|false, "is_change_request": true|false, "original_topic": "товч", "requested_topic": "товч", "reason": "Монгол хэлээр 1 өгүүлбэр"}`,
    user: `АНХНЫ ЗАХИАЛГЫН ЯРИА:\n${original}\n\nЗАСВАРЫН ХҮСЭЛТ:\n${revision}`,
  });
  // татгалзвал ярианы түүхээс сүүлийн (хүрээнээс гадуурх) хүсэлтийг хасна
  const cut = conversation.lastIndexOf("|", last) >= 0 ? conversation.lastIndexOf("|", last) : last;
  return { isRevision: true, inScope: out.in_scope !== false, isChange: out.is_change_request !== false, cleanedHistory: conversation.slice(0, cut).trim(), ...out };
}
module.exports = { checkRevisionScope };
