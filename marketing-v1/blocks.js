// AI-ийн бичсэн тусгай блокуудыг (adset, adtext, calendar, positioning) үзүүлэгчид ойлгох энгийн блок болгож хөрвүүлнэ.
// Мөн AI-ийн графикийн тодорхойлолтыг цуглуулж, чанарын шалгалтын тэмдэглэл гаргана.
const WD = ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"];
const str = (v) => String(v ?? "");

function finalize(written, A) {
  const out = {}, specs = {}, issues = []; let n = 0;
  for (const [id, list] of Object.entries(written)) {
    const res = [];
    for (const b of list || []) {
      if (!b || !b.type) continue;
      if (b.type === "adset") {
        const h = (b.headlines || []).map(str), d = (b.descriptions || []).map(str);
        if (h.length < 3) issues.push(`${id}: headline ${h.length} л үлдсэн (40 тэмдэгтийн хязгаар)`);
        const rows = Array.from({ length: Math.max(h.length, d.length) }, (_, i) => [String(i + 1), h[i] || "", h[i] ? String(h[i].length) : "", d[i] || "", d[i] ? String(d[i].length) : ""]);
        if (rows.length) res.push({ type: "table", caption: "", headers: ["№", "Headline", "Тэмдэгт", "Тайлбар", "Тэмдэгт"], rows, widths: [6, 40, 10, 34, 10] });
      } else if (b.type === "adtext") {
        const ps = (Array.isArray(b.paragraphs) ? b.paragraphs : str(b.text).split(/\n+/)).map(str).filter(Boolean);
        if (ps[0] && ps[0].length > 125) { // нээлтийг эхний өгүүлбэрээр тасална
          const m = ps[0].slice(0, 125).match(/^[\s\S]*[.?!](?=\s|$)/);
          if (m && m[0].length >= 30) ps.splice(0, 1, m[0].trim(), ps[0].slice(m[0].length).trim()); else issues.push(`${id}: үндсэн текстийн нээлт 125 тэмдэгтээс урт`);
        }
        if (ps.length) res.push({ type: "box", title: str(b.label || "Үндсэн текст"), text: ps.join("\n") });
      } else if (b.type === "calendar") {
        const rows = (b.rows || []).filter(r => Array.isArray(r)).slice(0, 31);
        if (rows.length && /суваг/i.test(str(rows[0][0])) && /формат/i.test(str(rows[0][1]))) rows.shift(); // толгой мөр давхардсан бол
        if (rows.length < 28) issues.push(`${id}: календарь ${rows.length} өдөртэй (30 байх ёстой)`);
        const d0 = new Date(A.start_date + "T00:00:00Z");
        res.push({ type: "table", caption: "Эхний 30 хоногийн календарь", small: true, headers: ["Огноо", "Гараг", "Суваг", "Формат", "Сэдэв, хийх ажил", "Тулгуур сэдэв", "Зорилго"], widths: [8, 7, 10, 10, 38, 13, 14],
          rows: rows.slice(0, 30).map((r, i) => { const d = new Date(d0.getTime() + i * 86400e3); const c = [...r.map(str), "", "", "", "", ""].slice(0, 5);
            return [`${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`, WD[d.getUTCDay()], ...c]; }) });
      } else if (b.type === "positioning") {
        const pts = (b.points || []).filter(p => p && p.name && isFinite(+p.x) && isFinite(+p.y)).slice(0, 8).map(p => ({ name: str(p.name), x: Math.min(10, Math.max(0, +p.x)), y: Math.min(10, Math.max(0, +p.y)), own: !!p.own }));
        if (pts.length >= 2) { const key = "pos" + (n++); specs[key] = { type: "scatter", title: str(b.title || "Зах зээл дэх байрлал"), x_label: str(b.x_label), y_label: str(b.y_label), points: pts };
          res.push({ type: "chart", key, source: "харьцангуй үнэлгээ, шинжилгээ", fallback: { type: "table", caption: str(b.title || "Зах зээл дэх байрлал"), headers: ["Сонголт", str(b.x_label || "X") + " (0-10)", str(b.y_label || "Y") + " (0-10)"], rows: pts.map(p => [p.own ? "**" + p.name + "**" : p.name, String(p.x), String(p.y)]), widths: [40, 30, 30] } }); }
      } else if (b.type === "gantt") {
        const periods = (b.periods || []).map(str).slice(0, 14), P = periods.length;
        const tasks = (b.tasks || []).filter(t => t && t.name).slice(0, 12).map(t => { const s = Math.min(P - 1, Math.max(0, Math.round(+t.start || 0))); return { name: str(t.name), start: s, end: Math.min(P, Math.max(s + 1, Math.round((+t.start || 0) + (+t.length || 1)))) }; });
        if (P >= 2 && tasks.length) res.push({ type: "gantt", title: str(b.title || "Хэрэгжүүлэх үе шат"), periods, tasks });
      } else if (b.type === "chart") {
        const labels = Array.isArray(b.labels) ? b.labels.map(str) : [];
        const series = (Array.isArray(b.series) ? b.series : []).map(s => [str(s && s.name), ((s && s.values) || []).map(Number)]).filter(s => s[1].length === labels.length && s[1].every(isFinite));
        if (!labels.length || !series.length) continue;
        const key = "llm" + (n++), type = ["bar", "line", "pie"].includes(b.chart_type) ? b.chart_type : "bar";
        specs[key] = { type, title: str(b.title), labels, series: type === "pie" ? series.slice(0, 1) : series };
        res.push({ type: "chart", key, source: b.source ? str(b.source) : "" });
      } else if (["p", "h3", "tip", "note"].includes(b.type)) { if (str(b.text).trim()) res.push({ type: b.type, text: str(b.text) }); }
      else if (["bullets", "numbered", "checklist"].includes(b.type)) { const items = (b.items || []).map(str).filter(Boolean); if (items.length) res.push({ type: b.type, items }); }
      else if (b.type === "table") {
        const headers = (b.headers || []).map(str), rows = (b.rows || []).filter(r => Array.isArray(r)).map(r => [...r.map(str), ...Array(headers.length).fill("")].slice(0, headers.length));
        if (headers.length && rows.length) res.push({ type: "table", caption: str(b.caption || ""), headers, rows, widths: Array.isArray(b.widths) && b.widths.length === headers.length && b.widths.every(w => +w > 0) ? b.widths.map(Number) : undefined });
      } else if (b.type === "box") res.push({ type: "box", title: str(b.title), text: str(b.text) });
      else if (b.type === "flow") { const steps = (b.steps || []).map(str).filter(Boolean).slice(0, 7); if (steps.length >= 2) res.push({ type: "flow", title: str(b.title), steps }); }
    }
    out[id] = res;
  }
  return { written: out, specs, issues };
}
module.exports = { finalize };
