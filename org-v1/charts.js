// Графикийг QuickChart.io-оор PNG болгоно. Амжилтгүй бол null (баримт бичиг графикгүй эсвэл хүснэгтээр үргэлжилнэ).
// Өнгийг параметрээр авна (модулийн түвшний төлөвгүй) — plan-v2-ийн графикт нөлөөлөхгүй, зэрэг ажиллахад аюулгүй.
const palette = (th) => ["#" + th.primary, "#" + th.accent, "#2E6F9E", "#8B3E5E", "#6B6B6B", "#3F7F5F", "#B5651D", "#4B4B8F"];
const fmt = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

function config(spec, th) {
  const C = palette(th), title = { display: true, text: spec.title, font: { size: 18 } };
  if (spec.type === "funnel") {
    return { type: "bar", data: { labels: spec.labels.map((l, i) => `${l}: ${fmt(spec.values[i])}`), datasets: [{ label: "", data: spec.values.map(v => Math.max(1, v)), backgroundColor: C[0] }] },
      options: { indexAxis: "y", plugins: { title, legend: { display: false } }, scales: { x: { type: "logarithmic", display: false } } } };
  }
  if (spec.type === "scatter") {
    return { type: "scatter", data: { datasets: spec.points.map((p, i) => ({ label: p.name, data: [{ x: p.x, y: p.y }], backgroundColor: p.own ? C[1] : C[(i % 6) + 2] || C[0], borderColor: "#FFFFFF", pointRadius: p.own ? 12 : 8 })) },
      options: { plugins: { title, legend: { display: true, position: "right" } }, scales: { x: { min: 0, max: 10, title: { display: true, text: spec.x_label }, ticks: { display: false } }, y: { min: 0, max: 10, title: { display: true, text: spec.y_label }, ticks: { display: false } } } } };
  }
  const isPie = spec.type === "pie";
  return { type: spec.type, data: { labels: spec.labels, datasets: spec.series.map(([name, data], i) => ({ label: name, data, backgroundColor: isPie ? C : C[i % C.length], borderColor: isPie ? "#FFFFFF" : C[i % C.length], fill: false, borderWidth: isPie ? 1 : 3 })) },
    options: { plugins: { title, legend: { display: isPie || spec.series.length > 1 } } } };
}
async function render(spec, th) {
  const width = spec.type === "pie" || spec.type === "scatter" ? 640 : 800, height = spec.type === "scatter" ? 460 : 420;
  try {
    const res = await fetch("https://quickchart.io/chart", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chart: config(spec, th), width, height, format: "png", backgroundColor: "white", version: "4" }), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return { buf: Buffer.from(await res.arrayBuffer()), width, height, title: spec.title };
  } catch (e) { console.warn("[org-chart] " + spec.title + ": " + e.message); return null; }
}
async function renderAll(specs, th) { const out = {}; for (const [k, s] of Object.entries(specs)) out[k] = await render(s, th); return out; }
module.exports = { renderAll, config };
