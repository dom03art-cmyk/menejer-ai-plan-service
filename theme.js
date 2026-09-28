// Төслийн салбараас хамааруулж баримт бичгийн өнгийг сонгоно (primary, accent, light)
const PALETTES = [
  { name: "agri", keys: ["мал", "үхэр", "хонь", "ямаа", "адуу", "ферм", "хүлэмж", "ногоо", "тариалан", "сүү", "мах", "тэжээл", "жимс", "чацаргана", "төмс", "үр тариа", "зөгий"], primary: "1E4D2B", accent: "B8860B", light: "EEF3EA", tot: "DCE6D5" },
  { name: "food", keys: ["талх", "бейкери", "нарийн боов", "бялуу", "хоол", "кафе", "ресторан", "кофе", "цай", "ундаа", "жүүс", "гурил", "хүнс", "амттан"], primary: "5A2E1A", accent: "D9822B", light: "FBF1E6", tot: "F2DFC8" },
  { name: "build", keys: ["барилга", "материал", "блок", "цемент", "тоосго", "мод", "төмөр", "үйлдвэр", "засвар", "дулаалга", "wpc", "бетон", "хаалга", "цонх"], primary: "2F3E4E", accent: "E07A1F", light: "EEF1F4", tot: "DCE2E8" },
  { name: "tech", keys: ["програм", "апп", "онлайн", "технологи", "it ", "вэб", "дата", "систем", "digital", "цахим"], primary: "0D3B66", accent: "1FA2C4", light: "EAF3F8", tot: "D3E6F1" },
  { name: "health", keys: ["эмнэлэг", "эрүүл", "гоо сайхан", "шүд", "аптек", "эм ", "спа", "массаж", "фитнес", "салон"], primary: "0F5257", accent: "D98E8E", light: "EAF4F3", tot: "D2E8E6" },
  { name: "retail", keys: ["хувцас", "дэлгүүр", "импорт", "худалдаа", "гутал", "цүнх", "загвар", "бараа", "декор", "гэр ахуй"], primary: "4A2545", accent: "C9A227", light: "F5EEF4", tot: "E8DAE6" },
];
const DEFAULT = { name: "default", primary: "1B2A4A", accent: "C9A227", light: "F3F0E6", tot: "E8E0C4" };

function pickTheme(A, conversation) {
  const hay = [A && A.company && A.company.name, A && A.company && A.company.industry, A && A.project && A.project.title, A && A.project && A.project.industry,
    ...((A && A.products) || []).map(p => p.name), String(conversation || "").slice(0, 3000)].filter(Boolean).join(" ").toLowerCase();
  let best = DEFAULT, score = 0;
  for (const p of PALETTES) { const s = p.keys.reduce((n, k) => n + (hay.split(k).length - 1), 0); if (s > score) { score = s; best = p; } }
  return best;
}
module.exports = { pickTheme, DEFAULT };
