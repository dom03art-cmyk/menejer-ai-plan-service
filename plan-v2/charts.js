// Графикийг QuickChart.io-оор PNG болгоно. Амжилтгүй бол null (баримт бичиг графикгүй үргэлжилнэ).
const COLORS = ["#1B2A4A", "#C9A227", "#2E6F9E", "#8B3E5E", "#6B6B6B"];
async function render(spec, width = 800, height = 420) {
  const isPie = spec.type === "pie";
  const chart = {
    type: spec.type,
    data: { labels: spec.labels, datasets: spec.series.map(([name, data], i) => ({ label: name, data, backgroundColor: isPie ? COLORS : COLORS[i % 5], borderColor: COLORS[i % 5], fill: false, borderWidth: 3 })) },
    options: { plugins: { title: { display: true, text: spec.title, font: { size: 18 } }, legend: { display: isPie || spec.series.length > 1 } } },
  };
  try {
    const res = await fetch("https://quickchart.io/chart", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chart, width, height, format: "png", backgroundColor: "white", version: "4" }), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return { buf: Buffer.from(await res.arrayBuffer()), width, height };
  } catch (e) { console.warn("[chart] " + spec.title + ": " + e.message); return null; }
}
async function renderAll(specs) { const out = {}; for (const [k, s] of Object.entries(specs)) out[k] = await render(s, s.type === "pie" ? 560 : 800, s.type === "pie" ? 420 : 420); return out; }
module.exports = { renderAll };
