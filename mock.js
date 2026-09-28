// PLAN_MOCK=1 үед Claude-г дуудахгүй, туршилтын хариу буцаана (API түлхүүргүйгээр бүх урсгалыг шалгах).
function respond(user) {
  if (user.includes("БИЧИХ ХЭСГҮҮД")) {
    const ids = [...user.matchAll(/id "([^"]+)"/g)].map(m => m[1]);
    return JSON.stringify({ sections: ids.map(id => ({ id, blocks: [
      { type: "p", text: `(${id}) Туршилтын догол мөр. Энэ хэсгийг бодит горимд Claude дэлгэрэнгүй бичнэ. **Тод** текстийн жишээ.` },
      { type: "bullets", items: ["Жишээ зүйл 1", "Жишээ зүйл 2"] },
      { type: "chart", chart_type: "bar", title: `${id} график`, labels: ["2023", "2024", "2025"], series: [{ name: "Үзүүлэлт", values: [1, 2, 3] }], source: "Туршилт" },
      { type: "flow", title: "Процесс", steps: ["Захиалга", "Төлбөр", "Үйлдвэрлэл", "Хүргэлт"] },
      { type: "flow", title: "Урт процесс", steps: ["А", "Б", "В", "Г", "Д", "Е"] },
      { type: "org", title: "Бүтэц", head: "Захирал", units: [{ name: "Үйлдвэрлэл", roles: ["Мастер (1)"] }, { name: "Борлуулалт", roles: ["Менежер (1)"] }] },
      { type: "table", caption: `${id} туршилтын хүснэгт`, headers: ["Үзүүлэлт", "Утга", "Тайлбар"], rows: [["А", "1,000", "Жишээ"], ["!Нийт", "1,000", ""]] },
    ] })) });
  }
  if (user.includes("МАКРО") || user.includes("зах зээлийн судалгаа")) {
    return JSON.stringify({ facts: [{ topic: "economy", fact: "Туршилтын баримт", source: "Туршилтын эх сурвалж", date: "2026-07" }] });
  }
  return "{}";
}
module.exports = { respond };
