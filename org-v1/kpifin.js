// Хэлтэс, албан тушаалын тайлангийн үзүүлэлтийн тооцоог (kpicalc.js) баримт бичгийн хүснэгт, график, AI бичигчид өгөх баримт (facts) болгоно.
// Хүснэгтийг AI бичихгүй, код оруулна. Блокийн формат marketing-v1/fintables.js, org-v1/planfin.js-тэй ижил: мөр "!"-ээр эхэлбэл нийт дүнгийн мөр.
//   build(meta, m, res) → { blocks, charts, facts }
const { MN, AGG } = require("./kpicalc");

const T = (caption, headers, rows, widths) => ({ type: "table", caption, headers, rows, widths });
const grp = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
// Тоог 2 хүртэлх оронтой, мянгатыг зайгаар; хасах тэмдэг "−"
function plain(x, d = 2) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const neg = x < 0; let s = Math.abs(x).toFixed(d);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  const [a, b] = s.split(".");
  const out = grp(a) + (b ? "." + b : "");
  return (neg && out !== "0" ? "−" : "") + out;
}
// Нэгжээр форматлах: ₮ → "1 500 000 ₮", % → "95.5%", бусад → "1 250 хүн" (suffix=false бол нэгжгүй — «Нэгж» баганатай хүснэгтэд)
function fmtU(x, unit, suffix = true) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  if (unit === "₮") return plain(Math.round(x), 0) + " ₮";
  if (unit === "%") return x.toFixed(1).replace("-", "−") + "%";
  return plain(x) + (suffix && unit ? " " + unit : "");
}
const sign = (x) => (x > 0 ? "+" : "");
function fmtChange(x, unit, suffix = true) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  if (unit === "%") return sign(x) + x.toFixed(1).replace("-", "−") + " пункт";
  return sign(x) + fmtU(x, unit, suffix);
}
const pct = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : (x < 0 ? "−" : "") + Math.abs(x * 100).toFixed(d) + "%");
const short = (x, unit) => (x === null || x === undefined ? "—" : unit === "₮" ? plain(x / 1e6, 1) : unit === "%" ? plain(x, 1) : plain(x));
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const mmText = (x, ncov) => { if (!x.months_met) return "—"; const { met, of } = x.months_met; const gap = ncov - of; return `${of} сарын ${met}-д` + (gap > 0 ? ` (${gap} сар мэдээлэлгүй)` : ""); };
const aggText = (x) => (x.kind === "monthly" ? AGG[x.agg] : x.kind === "value" ? "Нэг утга" : "—");
const targetText = (x, suffix = false) => (x.target === null ? "—" : fmtU(x.target, x.unit, suffix) + (x.target_type === "level" ? " (сар бүр)" : x.target_monthly ? " (сарын төлөвлөгөө)" : ""));
const achText = (x) => (x.achievement !== null ? pct(x.achievement) : x.thin ? "үнэлэх боломжгүй" : "—");

function build(meta, m, res) {
  meta = meta || {};
  const ind = res.indicators, months = res.months_covered, ncov = res.ncov, cov = new Set(months), Y = res.year;
  const org = meta.org_name || res.org_name, unitName = meta.unit_name || res.unit_name;
  const star = (x) => (x.missing_months.length ? "*" : "");
  const blocks = {};

  // ───── Үзүүлэлтийн хураангуй ─────
  const hasT = ind.some((x) => x.target !== null), hasP = ind.some((x) => x.prev !== null), hasMM = ind.some((x) => x.months_met);
  const head = ["Үзүүлэлт", "Нэгж", "Гүйцэтгэл", ...(hasT ? ["Зорилт", "Биелэлт"] : []), ...(hasMM ? ["Зорилтод хүрсэн сар"] : []), ...(hasP ? [`${res.prev_year} он`, "Өөрчлөлт"] : []), "Төлөв"];
  const rows = ind.map((x) => [x.name + (x.check ? " (шалгах)" : ""), x.unit || "—", fmtU(x.total, x.unit, false) + star(x),
    ...(hasT ? [targetText(x), achText(x)] : []), ...(hasMM ? [mmText(x, ncov)] : []),
    ...(hasP ? [fmtU(x.prev, x.unit, false), fmtChange(x.change_vs_prev, x.unit, false)] : []), x.status]);
  const n = head.length, rest = Math.floor(((100 - 26 - 8 - 13) / (n - 3)) * 10) / 10;
  blocks.ind_summary = [T(`${unitName ? unitName + ": г" : "Г"}ол үзүүлэлт, ${res.period}`, head, rows, [26, 8, ...Array(n - 3).fill(rest), 13])];

  // ───── Сар бүрийн хүснэгт (хагас жилээр) ─────
  const ml = ind.filter((x) => x.kind === "monthly");
  for (const [key, lo] of [["ind_h1", 0], ["ind_h2", 6]]) {
    if (!ml.length || !months.some((i) => i > lo && i <= lo + 6)) continue;
    const mr = ml.map((x) => [x.unit ? `${x.name} (${x.unit === "₮" ? "сая ₮" : x.unit})` : x.name, ...Array.from({ length: 6 }, (_, j) => (cov.has(lo + j + 1) ? short(x.monthly[lo + j], x.unit) : "·"))]);
    blocks[key] = [T(`Үзүүлэлт сар бүрээр, ${MN[lo]}–${MN[lo + 5]}`, ["Үзүүлэлт (нэгж)", ...MN.slice(lo, lo + 6)], mr, [34, 11, 11, 11, 11, 11, 11])];
  }

  // ───── Эх сурвалж ─────
  blocks.ind_sources = [T("Үзүүлэлт бүрийн эх сурвалж, тооцох арга", ["Үзүүлэлт", "Тооцох арга", "Эх сурвалж", "Дутуу сар", "Төлөв"],
    ind.map((x) => [x.name, aggText(x), x.source || "Эх сурвалж заагаагүй", x.missing_months.join(", ") || "—",
      x.check ? "Шалгах" : !x.source ? "Эх сурвалжгүй" : x.kind === "none" ? "Мэдээлэлгүй" : x.missing_months.length ? "Дутуу" : x.kind === "value" ? "Нэг утга" : "Бүрэн"]), [28, 12, 36, 12, 12])];

  // ───── Асуудал ─────
  if (res.issues.length) blocks.ind_issues = [T("Баталгаажуулах, нөхөх зүйлс", ["№", "Төрөл", "Юу", "Тайлбар", "Асуух зүйл"],
    res.issues.map((q, i) => [String(i + 1), q.type, q.item, q.detail, q.question]), [5, 14, 21, 30, 30])];

  // ───── Мөнгөн үзүүлэлт ─────
  const fin = ind.filter((x) => x.unit === "₮");
  if (fin.length) {
    const fr = fin.map((x) => [x.name + star(x), fmtU(x.target, "₮"), fmtU(x.total, "₮"), achText(x), fmtU(x.prev, "₮"), fmtChange(x.change_vs_prev, "₮"), (x.change_pct > 0 ? "+" : "") + pct(x.change_pct)]);
    if (fin.length > 1 && fin.every((x) => x.agg === "sum" || x.kind === "value")) {
      const s = (k) => (fin.every((x) => x[k] !== null) ? fin.reduce((a, x) => a + x[k], 0) : null);
      const tt = s("total"), tg = s("target"), pv = s("prev");
      fr.push(["!Нийт", fmtU(tg, "₮"), fmtU(tt, "₮"), tt !== null && tg ? pct(tt / tg) : "—", fmtU(pv, "₮"), tt !== null && pv !== null ? fmtChange(tt - pv, "₮") : "—", tt !== null && pv ? (tt > pv ? "+" : "") + pct((tt - pv) / Math.abs(pv)) : "—"]);
    }
    blocks.ind_finance = [T(`Мөнгөн үзүүлэлт, ${res.period}`, ["Үзүүлэлт", "Зорилт", "Гүйцэтгэл", "Биелэлт", `${res.prev_year} он`, "Өөрчлөлт", "Өсөлт"], fr, [24, 15, 15, 10, 15, 13, 8])];
  }

  // ───── Графикууд ─────
  const charts = {};
  const withAch = ind.filter((x) => x.achievement !== null);
  if (withAch.length) charts.ind_bar = { type: "bar", title: `Зорилтын биелэлт (%), ${res.period}`, labels: withAch.map((x) => x.name), series: [["Биелэлт (%)", withAch.map((x) => r1(x.achievement * 100))]] };
  const lab = months.map((i) => MN[i - 1]);
  ml.filter((x) => x.months_with_data >= 2).sort((a, b) => b.months_with_data - a.months_with_data || ind.indexOf(a) - ind.indexOf(b)).slice(0, 3).forEach((x, k) => {
    const v = (arr) => months.map((i) => (arr[i - 1] === null ? null : x.unit === "₮" ? r1(arr[i - 1] / 1e6) : r1(arr[i - 1])));
    const series = [[x.name, v(x.monthly)]];
    if (x.target_monthly) series.push(["Төлөвлөгөө", v(x.target_monthly)]);
    else if (x.target_type === "level" && x.target !== null) series.push(["Зорилт (сар бүр)", months.map(() => (x.unit === "₮" ? r1(x.target / 1e6) : x.target))]);
    charts[`ind_line${k + 1}`] = { type: "line", title: `${x.name}${x.unit ? ` (${x.unit === "₮" ? "сая ₮" : x.unit})` : ""}, сар бүрээр`, labels: lab, series };
  });

  // ───── AI-д өгөх баримт: бичвэрт тоо хэрэгтэй бол ЗӨВХӨН эндээс ─────
  const C = res.counts;
  const facts = {
    org_name: org, unit_name: unitName, year: Y, period: res.period, months_covered: months, months_count: ncov, full_year: res.full,
    counts: { ...C, text: `${C.ind_count} үзүүлэлтээс ${C.ind_with_target} нь зорилттой харьцуулагдсан, ${C.ind_met} нь бүрэн биелсэн, ${C.ind_partial} нь хэсэгчлэн, ${C.ind_missed} нь биелээгүй, ${C.ind_na} нь үнэлэх боломжгүй` },
    indicators: ind.map((x) => ({
      name: x.name, unit: x.unit, category: x.category || null, method: aggText(x), total: fmtU(x.total, x.unit) + star(x), target: x.target !== null ? targetText(x, true) : null,
      achievement: x.achievement !== null ? pct(x.achievement) : null, achievement_reason: x.achievement_reason || null, status: x.status,
      months_met: x.months_met ? mmText(x, ncov) : null, target_note: x.target_note || null, better: x.better === "low" ? "бага нь сайн" : "их нь сайн",
      prev: x.prev !== null ? fmtU(x.prev, x.unit) : null, change: x.change_vs_prev !== null ? fmtChange(x.change_vs_prev, x.unit) : null, change_pct: x.change_pct !== null ? (x.change_pct > 0 ? "+" : "") + pct(x.change_pct) : null,
      months_with_data: x.months_with_data, missing_months: x.missing_months.length ? x.missing_months.join(", ") + "-р сар" : null,
      monthly: x.kind === "monthly" ? Object.fromEntries(months.map((i) => [MN[i - 1], x.monthly[i - 1] === null ? null : fmtU(x.monthly[i - 1], x.unit)])) : null,
      source: x.source || null, check: x.check, note: x.note || null })),
    best: [...withAch].sort((a, b) => b.achievement - a.achievement).slice(0, 3).map((x) => `${x.name}: ${pct(x.achievement)}`),
    worst: [...withAch].sort((a, b) => a.achievement - b.achievement).slice(0, 3).map((x) => `${x.name}: ${pct(x.achievement)}`),
    footnote: res.footnote,
    issues: res.issues.map((q) => `${q.type} — ${q.item}: ${q.detail}${q.question ? ` (асуулт: ${q.question})` : ""}`),
    warnings: res.warnings,
  };
  return { blocks, charts, facts };
}

module.exports = { build, fmtU, fmtChange, plain };
