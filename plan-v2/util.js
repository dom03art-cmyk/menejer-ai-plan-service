// ---- toc.js: LibreOffice байвал гарчигт бодит хуудасны дугаар тавина ----
const { execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

function hasSoffice() { try { execFileSync("soffice", ["--version"], { stdio: "ignore", timeout: 30000 }); return true; } catch (_) { return false; } }

function findPages(docxBuf, heads) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toc-"));
  const f = path.join(dir, "p.docx"); fs.writeFileSync(f, docxBuf);
  execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, f], { stdio: "ignore", timeout: 240000 });
  const pdf = path.join(dir, "p.pdf");
  const n = +/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [pdf]).toString())[1];
  const norm = s => s.replace(/\s+/g, " ").trim();
  const txt = []; for (let p = 1; p <= n; p++) txt.push(norm(execFileSync("pdftotext", ["-f", String(p), "-l", String(p), "-layout", pdf, "-"]).toString()));
  let start = 0; txt.forEach((t, i) => { if (t.slice(0, 300).includes("ГАРЧИГ")) start = i + 1; });
  // ГАРЧИГ хэд хэдэн хуудас эзэлбэл эхний H1 ол
  const first = norm(heads[0].text).slice(0, 28);
  for (let p = start; p < n; p++) if (txt[p].includes(first)) { start = p; break; }
  let cur = start; const pages = [];
  for (const hd of heads) { const key = norm(hd.text).slice(0, 28); let found = null; for (let p = cur; p < n; p++) if (txt[p].includes(key)) { found = p; break; } if (found !== null) cur = found; pages.push(cur + 1); }
  const allText = txt.join("\n");
  fs.rmSync(dir, { recursive: true, force: true });
  return { pages, nPages: n, allText };
}

// ---- qc.js: чанарын автомат шалгалт ----
function qc({ an, text, heads, written }) {
  const issues = [];
  if (written) {
    const OUTLINE = require("./outline");
    const empty = OUTLINE.filter(o => o.group !== "static" && o.words && !(o.attach || []).length && !(written[o.id] || []).length).map(o => o.id);
    if (empty.length) issues.push(`Хоосон хэсэг: ${empty.join(", ")}`);
  }
  if (!an.balanceOk) issues.push("Балансын тайлан тэнцэхгүй байна");
  if (text) {
    for (const w of ["skill", ".py", "prompt", "JSON", "Claude", "аль хэдийн", "undefined", "NaN", "[object"]) if (text.includes(w)) issues.push(`Текстэд хориотой үг: "${w}"`);
  }
  const seen = new Set(); for (const h of heads) { const num = (h.text.match(/^(\d+(\.\d+)*)\s/) || [])[1]; if (num) { if (seen.has(num)) issues.push(`Давхардсан дугаар: ${num}`); seen.add(num); } }
  const d = an.R.dscr[0]; if (d !== null && d < 1.2) issues.push(`1-р жилийн DSCR ${d.toFixed(2)} < 1.2 — банкны шаардлага хангахгүй байж болзошгүй`);
  return issues;
}

// ---- facebook.js: Messenger-ээр файл, текст илгээх ----
const GRAPH = "https://graph.facebook.com/v21.0/me/messages";
async function fbText(psid, text) {
  const token = process.env.FB_PAGE_TOKEN; if (!token) { console.warn("[fb] FB_PAGE_TOKEN алга"); return; }
  const r = await fetch(`${GRAPH}?access_token=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: { text } }) });
  if (!r.ok) console.warn("[fb] text", r.status, await r.text());
}
async function fbFile(psid, buf, filename, mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
  const token = process.env.FB_PAGE_TOKEN; if (!token) throw new Error("FB_PAGE_TOKEN тохируулаагүй");
  const form = new FormData();
  form.append("recipient", JSON.stringify({ id: psid }));
  form.append("messaging_type", "RESPONSE");
  form.append("message", JSON.stringify({ attachment: { type: "file", payload: { is_reusable: false } } }));
  form.append("filedata", new Blob([buf], { type: mime }), filename);
  const r = await fetch(`${GRAPH}?access_token=${token}`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`FB файл илгээхэд алдаа ${r.status}: ${await r.text()}`);
  return r.json();
}
module.exports = { hasSoffice, findPages, qc, fbText, fbFile };
