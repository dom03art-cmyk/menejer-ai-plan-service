// Файлыг текст болгох. org-v1/rawtext.js-ийн fileText-ийг (Word, Excel, PowerPoint — кодоор; PDF, скан, зураг — Claude үгчлэн хуулбарлана)
// өөрчлөхгүйгээр дуудна. Уншсан текстийг tnd:text-д хадгалж, дахин ажиллуулахад дахин уншихгүй (зардал хэмнэнэ).
const S = require("./store");
const { fileText, tidy } = require("../org-v1/rawtext");

const FILE_CAP = Number(process.env.TENDER_FILE_CAP || 220000); // нэг файлд (ТББ 60–100 хуудас багтана)
const TOTAL_CAP = Number(process.env.TENDER_TOTAL_CAP || 450000);

// → { docs:[{id, name, phase, text}], files:[{name, ok, note}] }
async function readAll(psid, { phase, log = console.log, mock } = {}) {
  const list = (await S.listFiles(psid)).filter((f) => !phase || f.phase === phase);
  const docs = [], files = [];
  for (const f of list) {
    try {
      let t = await S.getText(psid, f.id);
      if (!t) {
        const buf = await S.getFile(psid, f);
        if (!buf) throw new Error("Файлын хадгалах хугацаа дууссан");
        const r = mock ? mock(f, buf) : process.env.TENDER_MOCK === "1" ? { text: buf.toString("utf8"), method: "mock" } : await fileText({ ...f, buf });
        let text = tidy(r.text);
        if (!text) throw new Error("Текст олдсонгүй");
        if (text.length > FILE_CAP) text = text.slice(0, FILE_CAP) + "\n…(файлын үлдсэн хэсгийг уншаагүй)";
        t = { text, method: r.method };
        await S.setText(psid, f.id, t);
        log(`[tender-read] ${f.name}: ${text.length} тэмдэгт (${r.method})`);
      }
      docs.push({ id: f.id, name: f.name, phase: f.phase, text: t.text });
      files.push({ name: f.name, ok: true, note: "" });
    } catch (e) {
      if (/credit balance/i.test(e.message || "")) throw e;
      files.push({ name: f.name, ok: false, note: e.code === "photo" ? "баримт бичиг биш зураг" : e.message });
      log(`[tender-read] ${f.name}: алгаслаа — ${e.message}`);
    }
  }
  const total = docs.reduce((s, d) => s + d.text.length, 0);
  if (total > TOTAL_CAP) for (const d of docs) { const n = Math.max(4000, Math.floor(TOTAL_CAP * d.text.length / total)); if (d.text.length > n) d.text = d.text.slice(0, n) + "\n…(тайрсан)"; }
  return { docs, files };
}

const joinDocs = (docs) => docs.map((d) => `=== Файл: ${d.name} (${d.phase === "bidder" ? "оролцогчийн баримт" : "тендерийн баримт"}) ===\n${d.text}`).join("\n\n");

module.exports = { readAll, joinDocs };
