// MKT_MOCK=1 үед Claude дуудахгүйгээр бүтэн урсгалыг (тооцоо → блок → Word/PDF) шалгах туршилтын агуулга.
const OUTLINE = require("./outline");
const LOREM = "Энэ бол угсралтыг шалгах туршилтын догол мөр бөгөөд бодит төлөвлөгөөнд энэ хэсгийг тухайн бизнесийн мэдээлэл, судалгаа, тооцоонд тулгуурлан бичнэ. ";
function section(item, A) {
  const b = [{ type: "tip", text: "Энэ бүлгийг хэрхэн ашиглах: туршилтын тэмдэглэл." }];
  for (let i = 0; i < Math.max(1, Math.round((item.words || 100) / 60)); i++) b.push({ type: "p", text: `**${item.id}:** ` + LOREM.repeat(3) });
  b.push({ type: "table", caption: "Туршилтын хүснэгт", headers: ["Үзүүлэлт", "Утга", "Тайлбар"], rows: [["Нэг", "1 500 000 ₮", "Тайлбар"], ["Хоёр", "25%", "Тайлбар"], ["!Нийт", "1 500 000 ₮", ""]] });
  if (item.id === "2.3") b.push({ type: "positioning", title: "Зах зээл дэх байрлал", x_label: "Үнэ (бага → өндөр)", y_label: "Тохирсон байдал", points: [{ name: A.brand.name, x: 3, y: 7, own: true }, { name: "Өрсөлдөгч А", x: 8, y: 8 }, { name: "Өрсөлдөгч Б", x: 2, y: 3 }] });
  if (item.id === "2.2") b.push({ type: "chart", chart_type: "bar", title: "Сошиал сувгийн хэрэглэгч (сая)", labels: ["Facebook", "Instagram"], series: [{ name: "Хэрэглэгч", values: [2.7, 1.2] }], source: "Туршилт" });
  if (item.id === "3.2") b.push({ type: "table", caption: "", headers: ["", ""], rows: [["Хэн бэ", "30-50 настай эзэн"], ["Зовлон", "Цаг давчуу"]], widths: [26, 74] });
  if (item.id === "4.4") b.push({ type: "flow", title: "Хэрэглэгчийн аялал", steps: ["Мэдэх", "Сонирхох", "Харьцуулах", "Захиалах", "Зөвлөх"] });
  if (item.id === "6.5") b.push({ type: "h3", text: "Багц 1: Борлуулалт. Өнцөг: цаг" }, { type: "adset", headlines: ["Бизнес төслөө өнөөдөр бэлэн болго", "Энэ бол дөчөөс илүү тэмдэгттэй маш урт headline бөгөөд хасагдах ёстой", "Төсөл бичих цаг алга уу?", "50-75 хуудас төсөл", "Тооцоотой төсөл"], descriptions: ["Messenger-ээр шууд захиал", "Word ба PDF файлаар", "1 удаа үнэгүй засвартай", "Одоо мессеж бичээрэй", "Тооцоог код бодно"] },
    { type: "adtext", label: "Үндсэн текст 1 (богино)", paragraphs: ["Зээлийн материалаа бүрдүүлж байна уу?", "✓ Word ба PDF файлаар", "Мессеж бичээрэй."] });
  if (item.id === "8.1") b.push({ type: "gantt", title: "Хэрэгжүүлэх үе шат", periods: ["1-р 7 хоног", "2", "3", "4", "5", "6", "7", "8"], tasks: [{ name: "Бэлтгэл", start: 0, length: 2 }, { name: "Борлуулалтын зар", start: 1, length: 7 }, { name: "Дүгнэлт", start: 7, length: 1 }] });
  if (item.id === "8.3") b.push({ type: "calendar", rows: Array.from({ length: 30 }, (_, i) => ["Facebook", "Зураг", `Туршилтын сэдэв ${i + 1}`, "Зөвлөгөө", "Мэдэх"]) });
  b.push({ type: "checklist", items: ["Туршилтын ажил нэг", "Туршилтын ажил хоёр"] });
  return b;
}
function writeAllMock(ctx) { const out = {}; for (const o of OUTLINE) if (o.group !== "static" && (o.words || o.guide)) out[o.id] = section(o, ctx.A); return out; }
module.exports = { writeAllMock };
