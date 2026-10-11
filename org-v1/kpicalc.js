// Хэлтэс, албан тушаалын тайлангийн тоон үзүүлэлтийн тооцоо (mongol-annual-plan skill-ийн kpi_calc.py-ийн Node хувилбар).
// Мөнгөн ба мөнгөн бус (хүн, ширхэг, хувь, цаг, өдөр) үзүүлэлт. Баримт бичиг, Excel-ийн бүх тоо эндээс гарна — AI тоо зохиохгүй.
//   normalizeMetrics(m) → шалгасан, өгөгдмөл нөхсөн metrics (m._notes-д засварын тэмдэглэл)
//   calculate(m)        → { period, months_covered, ncov, indicators[], counts, issues[], footnote, warnings[] }
// Дүрэм (role-report-guide.md «Үзүүлэлт → metrics.json»):
//   null = мэдээлэл алга (тэг биш). agg: sum | avg | last. better: low бол биелэлт урвуу (зорилт ÷ гүйцэтгэл).
//   target_monthly — зөвхөн гүйцэтгэлтэй саруудын төлөвлөгөөтэй харьцуулна. target_type "level" — сар бүр хүрэх түвшин,
//   биелэлт = зорилтод хүрсэн сарын хувь. strict — "3-аас доош" (3 орохгүй). Хамарсан сарын талаас бага нь мэдээлэлтэй бол «Үнэлэх боломжгүй».
//   ind_met — зорилтоо бүрэн (100%) биелүүлсэн үзүүлэлтийн тоо (түвшний зорилтод бүх сард хүрсэн).
const MN = ["1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар", "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар"];
const AGG = { sum: "Нийлбэр", avg: "Дундаж", last: "Эцсийн утга" };
const ST = { met: "Биелсэн", partial: "Хэсэгчлэн", miss: "Биелээгүй", na: "Үнэлэх боломжгүй" };
const R4 = (x) => Math.round(x * 1e4) / 1e4; // төлөвийн босгыг хөвөгч таслалын алдаанаас хамгаална (Excel-д ROUND(x,4))

const str = (x, def = "") => (x === undefined || x === null || String(x).trim() === "" ? def : String(x).trim());
// Тоо эсвэл null. "1 500 000 ₮", "96,5%", "−3" зэргийг таньна; хувийг 0.01-ээр үржүүлэхгүй (үзүүлэлтийн хувь нь 96 гэх мэт).
function numOrNull(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "string") {
    let s = x.trim().replace(/[\s ₮%]/g, "").replace(/−/g, "-");
    if (!s || /^(null|-|—|n\/a|байхгүй)$/i.test(s)) return null;
    if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(",", "."); else s = s.replace(/,/g, "");
    const v = Number(s); return Number.isFinite(v) ? v : null;
  }
  return null;
}
const has = (o, k) => o && o[k] !== undefined && o[k] !== null && o[k] !== "";

function normalizeMetrics(m) {
  if (m && m._normalized) return m;
  m = m || {};
  const notes = [];
  const year = Math.round(numOrNull(m.year) ?? new Date().getFullYear());
  let months = Array.isArray(m.months_covered) && m.months_covered.length ? m.months_covered.map((x) => Math.round(numOrNull(x))).filter((x) => x >= 1 && x <= 12) : [];
  months = [...new Set(months)].sort((a, b) => a - b);
  if (!months.length) { if (Array.isArray(m.months_covered) && m.months_covered.length) notes.push("months_covered танигдсангүй — 12 сар гэж авав."); months = Array.from({ length: 12 }, (_, i) => i + 1); }
  const cov = new Set(months);
  const arr12 = (v, name, key) => {
    if (!Array.isArray(v)) return null;
    const a = v.slice(0, 12).map(numOrNull);
    if (v.length !== 12) { notes.push(`«${name}»: ${key} ${v.length} утгатай (12 байх ёстой) — ${v.length > 12 ? "илүүг хасав" : "дутууг null (мэдээлэлгүй)-ээр нөхөв"}.`); while (a.length < 12) a.push(null); }
    return a;
  };
  const inds = [];
  (Array.isArray(m.indicators) ? m.indicators : []).forEach((it, k) => {
    it = it || {};
    const name = str(it.name, `Үзүүлэлт ${k + 1}`);
    let agg = str(it.agg, "sum").toLowerCase();
    if (agg === "average" || agg === "mean") agg = "avg";
    if (agg === "end" || agg === "latest") agg = "last";
    if (!AGG[agg]) { notes.push(`«${name}»: agg «${it.agg}» танигдсангүй (sum | avg | last) — sum гэж авав.`); agg = "sum"; }
    let better = str(it.better, "high").toLowerCase();
    if (better !== "low") better = "high";
    let target_type = str(it.target_type, "total").toLowerCase() === "level" ? "level" : "total";
    let monthly = arr12(it.monthly, name, "monthly");
    if (it.monthly !== undefined && it.monthly !== null && !monthly) notes.push(`«${name}»: monthly массив биш тул хэрэглэсэнгүй.`);
    let outside = 0;
    if (monthly) monthly = monthly.map((x, i) => { if (x !== null && !cov.has(i + 1)) { outside++; return null; } return x; });
    if (outside) notes.push(`«${name}»: хамрах хугацаанаас гадуурх ${outside} сарын утгыг тооцоонд оруулсангүй.`);
    const value = monthly ? null : numOrNull(it.value);
    const kind = monthly ? "monthly" : value !== null ? "value" : "none";
    let target_monthly = arr12(it.target_monthly, name, "target_monthly");
    if (target_monthly && kind !== "monthly") { notes.push(`«${name}»: target_monthly нь сар бүрийн гүйцэтгэлгүй үзүүлэлтэд хэрэглэгдэхгүй.`); target_monthly = null; }
    if (target_type === "level" && kind !== "monthly") { notes.push(`«${name}»: түвшний зорилт (level) сар бүрийн утгагүй тул нийт зорилтоор харьцуулав.`); target_type = "total"; }
    if (target_monthly && target_type === "level") { notes.push(`«${name}»: target_monthly ба level зэрэг өгсөн — target_monthly-г ашиглав.`); target_type = "total"; }
    inds.push({ name, unit: str(it.unit), agg, kind, monthly: monthly || Array(12).fill(null), value,
      target: numOrNull(it.target), target_monthly, target_type, strict: !!it.strict, better, prev: numOrNull(it.prev),
      source: str(it.source), check: !!it.check, note: str(it.note), category: str(it.category || it.group), auto_issue: it.auto_issue !== false });
  });
  const issues = (Array.isArray(m.issues) ? m.issues : []).filter(Boolean).map((q) => ({ type: str(q.type, "Асуулт"), item: str(q.item), detail: str(q.detail), question: str(q.question) }));
  return { _normalized: true, _notes: notes, org_name: str(m.org_name, "Байгууллага"), unit_name: str(m.unit_name), year, prev_year: Math.round(numOrNull(m.prev_year) ?? year - 1),
    months_covered: months, indicators: inds, issues };
}

const monthsText = (arr) => arr.map((i) => `${i}`).join(", ") + "-р сар";
function periodText(year, months) {
  if (months.length === 12) return `${year} он`;
  const contiguous = months.every((x, i) => i === 0 || x === months[i - 1] + 1);
  return contiguous ? (months.length === 1 ? `${year} оны ${months[0]}-р сар` : `${year} оны ${months[0]}–${months[months.length - 1]}-р сар`) : `${year} оны ${monthsText(months)}`;
}

function calcOne(x, months) {
  const ncov = months.length;
  const ok = (a, t) => (x.better === "high" ? (x.strict ? a > t : a >= t) : (x.strict ? a < t : a <= t));
  const m = x.monthly, xs = m.filter((v) => v !== null);
  const missing = x.kind === "monthly" ? months.filter((i) => m[i - 1] === null) : [];
  let total = null;
  if (x.kind === "monthly" && xs.length) total = x.agg === "sum" ? xs.reduce((a, b) => a + b, 0) : x.agg === "avg" ? xs.reduce((a, b) => a + b, 0) / xs.length : xs[xs.length - 1];
  if (x.kind === "value") total = x.value;
  let target = x.target, months_met = null, target_note = "", pairsN = null;
  if (x.target_monthly) {
    const pairs = [];
    for (let i = 0; i < 12; i++) if (m[i] !== null && x.target_monthly[i] !== null) pairs.push([m[i], x.target_monthly[i]]);
    pairsN = pairs.length;
    if (pairs.length) {
      const ts = pairs.map((p) => p[1]);
      target = x.agg === "sum" ? ts.reduce((a, b) => a + b, 0) : x.agg === "avg" ? ts.reduce((a, b) => a + b, 0) / ts.length : ts[ts.length - 1];
      months_met = { met: pairs.filter(([a, t]) => ok(a, t)).length, of: pairs.length };
      target_note = `${pairs.length} сарын төлөвлөгөөтэй харьцуулсан`;
    } else target = null;
  } else if (x.target_type === "level" && target !== null) {
    months_met = { met: xs.filter((a) => ok(a, target)).length, of: xs.length };
    target_note = `сар бүр зорилтоос ${x.better === "high" ? (x.strict ? "дээш" : "багагүй") : (x.strict ? "доош" : "ихгүй")} байх`;
  }
  const measured = x.kind === "monthly" ? (pairsN !== null ? pairsN : xs.length) : null;
  const thin = x.kind === "monthly" && measured * 2 < ncov;
  let achievement = null, reason = "";
  if (total === null && !(x.target_type === "level" && months_met)) reason = "Гүйцэтгэлийн мэдээлэл алга";
  else if (target === null) reason = x.target_monthly ? "Гүйцэтгэлтэй сарын төлөвлөгөө алга" : "Зорилт тогтоогоогүй";
  else if (thin) reason = `Хамарсан ${ncov} сарын ${measured}-д л мэдээлэлтэй (талаас бага)`;
  else if (x.target_type === "level" && months_met) { if (months_met.of) achievement = months_met.met / months_met.of; else reason = "Гүйцэтгэлийн мэдээлэл алга"; }
  else if (target === 0) { if (x.better === "low") achievement = total === 0 ? 1 : 0; else reason = "Зорилт 0 тул харьцуулах боломжгүй"; }
  else achievement = x.better === "high" ? total / target : (total ? target / total : 1);
  const change = total !== null && x.prev !== null ? total - x.prev : null;
  const change_pct = change !== null && x.prev ? change / Math.abs(x.prev) : null;
  const status = achievement === null ? ST.na : R4(achievement) >= 1 ? ST.met : R4(achievement) >= 0.8 ? ST.partial : ST.miss;
  return { name: x.name, unit: x.unit, agg: x.agg, kind: x.kind, category: x.category, monthly: m, total, target, target_type: x.target_type, target_monthly: x.target_monthly,
    target_note, better: x.better, strict: x.strict, achievement, achievement_reason: reason, prev: x.prev, change_vs_prev: change, change_pct,
    months_with_data: x.kind === "monthly" ? xs.length : null, measured, missing_months: missing, months_met, thin, status,
    source: x.source, check: x.check, note: x.note, auto_issue: x.auto_issue };
}

function calculate(m0) {
  const c = normalizeMetrics(m0);
  const months = c.months_covered, ncov = months.length, full = ncov === 12;
  const indicators = c.indicators.map((x) => calcOne(x, months));
  const issues = c.issues.map((q) => ({ ...q, auto: false }));
  const add = (type, item, detail, question) => issues.push({ type, item, detail, question, auto: true });
  for (const x of indicators) {
    if (!x.source) add("Эх сурвалж", x.name, "Эх сурвалж заагаагүй тоо. Эх сурвалжгүй тоог тайланд баталгаатай гэж үзэхгүй", "Энэ тоо ямар баримтаас (файл, бүртгэл, тушаал) гарсныг заана уу");
    if (!x.auto_issue) continue;
    if (x.kind === "none") add("Дутуу", x.name, "Сарын утга ч, нэг утга ч өгөгдөөгүй", "Энэ үзүүлэлтийн гүйцэтгэлийг өгнө үү");
    if (x.missing_months.length) add("Дутуу", x.name, `${x.missing_months.join(", ")}-р сарын мэдээлэл алга`, "Эдгээр сарын утгыг өгнө үү");
    if (x.thin) add("Үнэлэх боломжгүй", x.name, `${x.achievement_reason}: биелэлтийг тооцоогүй`, "Бусад сарын мэдээлэл байгаа эсэх");
    if (x.check) add("Шалгах", x.name, x.note || "Эх мэдээлэл тодорхой бус", "Утгыг баталгаажуулна уу");
    if (x.target === 0 && x.better === "high" && !x.target_monthly) add("Шалгах", x.name, "Зорилт 0, «их нь сайн» гэж өгсөн", "Зорилт зөв эсэх, эсвэл «бага нь сайн» (осол, гомдол) үзүүлэлт эсэх");
  }
  const anyMissing = indicators.some((x) => x.missing_months.length), anyTm = indicators.some((x) => x.target_monthly), anyLevel = indicators.some((x) => x.target_type === "level");
  const period = periodText(c.year, months);
  let footnote = `Хамрах хугацаа: ${period} (${ncov} сар)` + (full ? ". " : `; жилийн зорилттой харьцуулахдаа хамарсан хугацааг анхаарна уу. `);
  if (anyMissing) footnote += "* тэмдэгтэй үзүүлэлтэд мэдээлэл ирээгүй сар байгаа тул дүн бүрэн бус. ";
  footnote += "Сарын хүснэгтэд «—» нь мэдээлэл ирээгүй, «·» нь хамрах хугацаанаас гадуурх сар.";
  if (anyLevel) footnote += " Сар бүрийн түвшний зорилттой үзүүлэлтийн биелэлт нь зорилтод хүрсэн сарын хувь.";
  if (anyTm) footnote += " Сарын төлөвлөгөөтэй үзүүлэлтийг зөвхөн гүйцэтгэлтэй саруудын төлөвлөгөөтэй харьцуулсан.";
  if (indicators.some((x) => x.thin)) footnote += " Хамарсан сарын талаас бага нь мэдээлэлтэй үзүүлэлтийг «үнэлэх боломжгүй» гэж тэмдэглэсэн.";
  const counts = {
    ind_count: indicators.length, ind_with_target: indicators.filter((x) => x.achievement !== null).length,
    ind_met: indicators.filter((x) => x.status === ST.met).length, ind_partial: indicators.filter((x) => x.status === ST.partial).length,
    ind_missed: indicators.filter((x) => x.status === ST.miss).length, ind_na: indicators.filter((x) => x.status === ST.na).length,
    issues_count: issues.length, missing_cells: indicators.reduce((s, x) => s + x.missing_months.length, 0), check_count: indicators.filter((x) => x.check).length,
  };
  const warnings = [...c._notes];
  if (!indicators.length) warnings.push("Үзүүлэлт өгөгдөөгүй байна.");
  if (!full) warnings.push(`Үзүүлэлт ${ncov} сарыг хамарсан. Жилийн зорилттой харьцуулсан биелэлтийг тайлбарлахдаа хамарсан сарыг дурд (нийлбэр үзүүлэлтэд онцгой).`);
  if (counts.missing_cells) warnings.push(`${counts.missing_cells} сар-үзүүлэлтийн мэдээлэл дутуу (* тэмдэгтэй). Нөхүүлэх эсвэл тайланд ил бич.`);
  if (counts.check_count) warnings.push("«Шалгах» тэмдэгтэй үзүүлэлт байна: баталгаажуулах жагсаалтад орсон.");
  return { org_name: c.org_name, unit_name: c.unit_name, year: c.year, prev_year: c.prev_year, period, months_covered: months, ncov, full, indicators, counts, issues, footnote, warnings };
}

module.exports = { normalizeMetrics, calculate, MN, AGG, ST, R4, numOrNull, periodText };
