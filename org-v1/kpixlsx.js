// Хэлтэс, албан тушаалын тайлангийн үзүүлэлтийн томьёотой Excel (build_kpi_xlsx.py-ийн Node хувилбар).
// Баримт бичгийн урсгалаас ТУСДАА: энд алдаа гарвал Word/PDF-д нөлөөлөхгүй.
//   makeModel(meta, m, res) → { buffer, ok, bad[], total, formulas }
//     1) томьёотой workbook үүсгэнэ  2) plan-v2/xlsxCalc.js-ээр бүх томьёог бодно
//     3) дүн, биелэлт, төлөвийг kpicalc.js-ийн тооцоотой тулгана — зөрвөл ok=false (файлыг захиалагчид өгөхгүй)
// Зөвхөн xlsxCalc-ийн дэмждэг функц: IF OR SUM MAX COUNT ROUND SUMPRODUCT. Тойрсон лавлагаагүй.
// Томьёо: дүн (SUM / SUM÷COUNT / IF-ийн гинжээр сүүлийн утга), мэдээлэлтэй сар, түвшний зорилтод хүрсэн сар (SUMPRODUCT),
// биелэлт («бага нь сайн» бол урвуу), өмнөх жилтэй зөрүү, төлөв. Тогтмол утга (томьёо биш): сарын төлөвлөгөөтэй үзүүлэлтийн
// харьцуулах зорилт ба хүрсэн сар (саарал налуу тэмдэглэгээтэй) — сарын утгыг өөрчилбөл тайланг дахин гаргуулна.
const { computeWorkbook } = require("../plan-v2/xlsxCalc");
const { MN, AGG, ST } = require("./kpicalc");

const S_SUM = "Хураангуй", S_IND = "Үзүүлэлт", S_SRC = "Эх сурвалж", S_ISS = "Асуудал", S_HELP = "Заавар";
const NAVY = "FF1B2A4A", GOLD = "FFC9A227", INPUT = "FFFFF6D6", MISS = "FFFCE4D6", CHECK = "FFFFF2CC", HEAD = "FFE9ECF3", FIXED = "FFEDEDED", GRAY = "FF666666";
const PCT = "0.0%", INT = "#,##0", DEC1 = "#,##0.0", DEC2 = "#,##0.0#";
const col = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - 1 - m) / 26; } return s; };
// Үзүүлэлт хуудасны баганууд
const MC = Array.from({ length: 12 }, (_, i) => col(4 + i)); // D..O
const C = { name: 1, unit: 2, agg: 3, total: 16, target: 17, prev: 18, cnt: 19, met: 20, ach: 21, chg: 22, chgp: 23, status: 24 };
const L = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, col(v)]));
const R0 = 5, NCOV = "$B$3";

function numFmt(x) {
  if (x.unit === "₮") return { m: INT, t: INT };
  if (x.unit === "%") return { m: DEC1, t: DEC1 };
  const vals = [...x.monthly, x.total, x.target, x.prev].filter((v) => v !== null && v !== undefined);
  const allInt = vals.every((v) => Math.abs(v - Math.round(v)) < 1e-9);
  return { m: allInt ? INT : DEC2, t: allInt && x.agg !== "avg" ? INT : DEC2 };
}

function buildXlsx(meta, m, res) {
  const ExcelJS = require("exceljs");
  meta = meta || {};
  const org = meta.org_name || res.org_name, unitName = meta.unit_name || res.unit_name || "", Y = res.year, ind = res.indicators, cov = new Set(res.months_covered);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Менежер AI"; wb.created = new Date(); wb.calcProperties = { fullCalcOnLoad: true };
  const checks = [];
  const chk = (sheet, r, cc, expected, label, tol = 1e-6) => { if (expected === undefined || (typeof expected === "number" && !Number.isFinite(expected))) return; checks.push({ sheet, addr: `${col(cc)}${r}`, expected, label, tol }); };

  const mk = (name, widths, freeze) => {
    const ws = wb.addWorksheet(name, { views: [freeze ? { state: "frozen", xSplit: freeze[0], ySplit: freeze[1], showGridLines: false } : { showGridLines: false }] });
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } };
    ws.headerFooter = { oddFooter: `&L&8${(org + (unitName ? " — " + unitName : "")).replace(/&/g, "&&")}&C&8${name}&R&8&P / &N` };
    return ws;
  };
  const font = (o = {}) => ({ name: "Times New Roman", size: 11, ...o });
  const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const thin = { style: "thin", color: { argb: "FFBFBFBF" } }, BORDER = { left: thin, right: thin, top: thin, bottom: thin };
  const title = (ws, text, sub) => {
    ws.getCell("A1").value = text; ws.getCell("A1").font = font({ size: 14, bold: true, color: { argb: NAVY } });
    if (sub) { ws.getCell("A2").value = sub; ws.getCell("A2").font = font({ italic: true, size: 10, color: { argb: GRAY } }); }
  };
  const head = (ws, r, labels, from = 1) => { labels.forEach((t, i) => {
    const cell = ws.getCell(r, from + i); cell.value = t; cell.font = font({ bold: true, color: { argb: "FFFFFFFF" } }); cell.fill = fill(NAVY); cell.border = BORDER;
    cell.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle", wrapText: true };
  }); ws.getRow(r).height = 36; };
  const section = (ws, r, text, span) => {
    const cell = ws.getCell(r, 1); cell.value = text; cell.font = font({ bold: true, color: { argb: NAVY } });
    for (let i = 1; i <= span; i++) { ws.getCell(r, i).fill = fill(HEAD); ws.getCell(r, i).border = { bottom: { style: "thin", color: { argb: GOLD } } }; }
  };
  const put = (ws, r, cc, v, fmt, o = {}) => {
    const cell = ws.getCell(r, cc); cell.value = v === undefined ? null : v; cell.font = font({ ...(o.bold ? { bold: true } : {}), ...(o.font || {}) }); cell.border = BORDER;
    if (fmt) cell.numFmt = fmt;
    if (o.fill) cell.fill = fill(o.fill);
    if (o.wrap) cell.alignment = { wrapText: true, vertical: "top" };
    if (o.center) cell.alignment = { horizontal: "center" };
    return cell;
  };
  const f = (ws, r, cc, formula, fmt, o = {}) => { const cell = put(ws, r, cc, { formula }, fmt, o); cell.alignment = { horizontal: o.left ? "left" : o.center ? "center" : "right" }; return cell; };
  const note = (ws, r, text, cc = 1) => { const cell = ws.getCell(r, cc); cell.value = text; cell.font = font({ italic: true, size: 9, color: { argb: GRAY } }); };

  const w0 = mk(S_SUM, [40, 18, 20, 14, 18]);
  const wi = mk(S_IND, [36, 10, 12, ...Array(12).fill(11), 15, 15, 14, 11, 11, 11, 14, 10, 17], [3, 4]);
  const ws = mk(S_SRC, [36, 14, 54, 16, 14, 40]);
  const wq = mk(S_ISS, [6, 16, 30, 46, 46, 34]);
  const wh = mk(S_HELP, [26, 100]);

  // ───────────── ҮЗҮҮЛЭЛТ ─────────────
  title(wi, `${org}${unitName ? " — " + unitName : ""}: үзүүлэлт, ${res.period}`,
    "Шар нүд = оролт (сар бүрийн утга, зорилт, өмнөх жил). Улбар шар = хамрах хугацаанд мэдээлэл ирээгүй сар (хоосон = мэдээлэлгүй, 0 = тэг). Саарал = тайлангийн тооцооны тогтмол утга. Бусад нүд томьёо.");
  put(wi, 3, 1, "Хамарсан сарын тоо", null, { bold: true }); put(wi, 3, 2, res.ncov, "0", { fill: INPUT, center: true });
  MC.forEach((cc, i) => { const cell = wi.getCell(3, 4 + i); cell.value = i + 1; cell.font = font({ size: 8, color: { argb: "FFA6A6A6" } }); cell.alignment = { horizontal: "center" }; });
  head(wi, 4, ["Үзүүлэлт", "Нэгж", "Тооцох арга", ...MN, "Гүйцэтгэл", "Зорилт", `${res.prev_year} он`, "Мэдээлэлтэй сар", "Зорилтод хүрсэн сар", "Биелэлт", "Өөрчлөлт", "Өсөлт", "Төлөв"]);
  ind.forEach((x, k) => {
    const r = R0 + k, nf = numFmt(x), rng = `${MC[0]}${r}:${MC[11]}${r}`, base = x.check ? CHECK : null;
    const P = `${L.total}${r}`, Q = `${L.target}${r}`, Rv = `${L.prev}${r}`, S = `${L.cnt}${r}`, Tm = `${L.met}${r}`, U = `${L.ach}${r}`;
    put(wi, r, C.name, x.name + (x.check ? " (шалгах)" : ""), null, { fill: base, wrap: true });
    put(wi, r, C.unit, x.unit || "", null, { fill: base, center: true });
    put(wi, r, C.agg, x.kind === "monthly" ? AGG[x.agg] : x.kind === "value" ? "Нэг утга" : "Мэдээлэлгүй", null, { fill: base });
    MC.forEach((cc, i) => {
      const v = x.kind === "monthly" ? x.monthly[i] : null;
      put(wi, r, 4 + i, v, nf.m, { fill: x.kind === "monthly" && v === null && cov.has(i + 1) ? MISS : INPUT });
    });
    // Гүйцэтгэл
    if (x.kind === "monthly") {
      const fm = x.agg === "sum" ? `IF(COUNT(${rng})=0,"",SUM(${rng}))` : x.agg === "avg" ? `IF(COUNT(${rng})=0,"",SUM(${rng})/COUNT(${rng}))` : lastChain(r);
      f(wi, r, C.total, fm, nf.t, { bold: true });
      f(wi, r, C.cnt, `COUNT(${rng})`, "0", { center: true });
      chk(S_IND, r, C.cnt, x.months_with_data, `${x.name} / мэдээлэлтэй сар`);
    } else put(wi, r, C.total, x.kind === "value" ? x.total : null, nf.t, { bold: true, fill: INPUT });
    chk(S_IND, r, C.total, x.total, `${x.name} / гүйцэтгэл`);
    // Зорилт, өмнөх жил
    if (x.target_monthly) put(wi, r, C.target, x.target, nf.t, { fill: FIXED, font: { italic: true } });
    else put(wi, r, C.target, x.target, nf.t, { fill: INPUT });
    put(wi, r, C.prev, x.prev, nf.t, { fill: INPUT });
    // Зорилтод хүрсэн сар
    if (x.target_type === "level") {
      const op = x.better === "high" ? (x.strict ? ">" : ">=") : (x.strict ? "<" : "<=");
      f(wi, r, C.met, `IF(${Q}="","",SUMPRODUCT((${rng}<>"")*(${rng}${op}${Q})))`, "0", { center: true });
      chk(S_IND, r, C.met, x.months_met ? x.months_met.met : null, `${x.name} / хүрсэн сар`);
    } else if (x.target_monthly && x.months_met) put(wi, r, C.met, x.months_met.met, "0", { fill: FIXED, font: { italic: true }, center: true });
    else put(wi, r, C.met, null);
    // Биелэлт
    let ach;
    if (x.target_type === "level") ach = `IF(OR(${Q}="",${S}=0),"",IF(${S}*2<${NCOV},"",${Tm}/${S}))`;
    else {
      const core = x.better === "high" ? `IF(${Q}=0,"",${P}/${Q})` : `IF(${Q}=0,IF(${P}=0,1,0),IF(${P}=0,1,${Q}/${P}))`;
      const thinC = x.kind !== "monthly" ? null : x.target_monthly ? `${x.measured}*2<${NCOV}` : `${S}*2<${NCOV}`;
      ach = `IF(OR(${P}="",${Q}=""),"",${thinC ? `IF(${thinC},"",${core})` : core})`;
    }
    f(wi, r, C.ach, ach, PCT, { bold: true });
    chk(S_IND, r, C.ach, x.achievement, `${x.name} / биелэлт`);
    f(wi, r, C.chg, `IF(OR(${P}="",${Rv}=""),"",${P}-${Rv})`, nf.t);
    chk(S_IND, r, C.chg, x.change_vs_prev, `${x.name} / өөрчлөлт`, 1e-6 * Math.max(1, Math.abs(x.total || 0)));
    f(wi, r, C.chgp, `IF(OR(${P}="",${Rv}=""),"",IF(${Rv}=0,"",(${P}-${Rv})/MAX(${Rv},-${Rv})))`, PCT);
    chk(S_IND, r, C.chgp, x.change_pct, `${x.name} / өсөлт`);
    f(wi, r, C.status, `IF(${U}="","${ST.na}",IF(ROUND(${U},4)>=1,"${ST.met}",IF(ROUND(${U},4)>=0.8,"${ST.partial}","${ST.miss}")))`, null, { center: true, bold: true });
    chk(S_IND, r, C.status, x.status, `${x.name} / төлөв`);
  });
  const RN = R0 + Math.max(ind.length, 1) - 1;
  let r = RN + 2;
  for (const t of [
    "Гүйцэтгэл: «Нийлбэр» = SUM, «Дундаж» = SUM ÷ COUNT (зөвхөн мэдээлэлтэй сар), «Эцсийн утга» = хамгийн сүүлийн мэдээлэлтэй сарын утга.",
    "Биелэлт: их нь сайн бол гүйцэтгэл ÷ зорилт; бага нь сайн (гарсан ажилтан, осол, хугацаа) бол зорилт ÷ гүйцэтгэл. Хамарсан сарын талаас бага нь мэдээлэлтэй бол «Үнэлэх боломжгүй».",
    "Сар бүрийн түвшний зорилт: биелэлт = зорилтод хүрсэн сар ÷ мэдээлэлтэй сар. Сарын төлөвлөгөөтэй үзүүлэлтийн зорилт (саарал) нь гүйцэтгэлтэй саруудын төлөвлөгөөний дүн.",
    "Төлөв: ≥100% Биелсэн, 80–99.9% Хэсэгчлэн, <80% Биелээгүй.", res.footnote]) { note(wi, r, t); r++; }

  // ───────────── ХУРААНГУЙ ─────────────
  const CN = res.counts;
  title(w0, `${org}${unitName ? " — " + unitName : ""}: үзүүлэлтийн хураангуй`, `${res.period}. Тоонууд «${S_IND}» хуудаснаас томьёогоор бодогдоно.`);
  r = 4; section(w0, r, "Ерөнхий мэдээлэл", 5); r++;
  [["Байгууллага", org], ["Нэгж", unitName || "—"], ["Хамрах хугацаа", res.period]].forEach(([a, b]) => { put(w0, r, 1, a); put(w0, r, 2, b); r++; });
  put(w0, r, 1, "Хамарсан сарын тоо"); f(w0, r, 2, `'${S_IND}'!${NCOV}`, "0"); chk(S_SUM, r, 2, res.ncov, "хамарсан сар"); r++;
  r++; section(w0, r, "Үзүүлэлтийн биелэлт", 5); r++;
  const U0 = `'${S_IND}'!$${L.ach}$${R0}:$${L.ach}$${RN}`, X0 = `'${S_IND}'!$${L.status}$${R0}:$${L.status}$${RN}`;
  const cnt = (lbl, fm, exp) => { put(w0, r, 1, lbl); f(w0, r, 2, fm, "0"); chk(S_SUM, r, 2, exp, lbl); r++; };
  put(w0, r, 1, "Үзүүлэлтийн тоо"); put(w0, r, 2, CN.ind_count, "0"); r++;
  cnt("Зорилттой харьцуулсан", `COUNT(${U0})`, CN.ind_with_target);
  cnt(`${ST.met} (≥100%)`, `SUMPRODUCT((${X0}="${ST.met}")*1)`, CN.ind_met);
  cnt(`${ST.partial} (80–99.9%)`, `SUMPRODUCT((${X0}="${ST.partial}")*1)`, CN.ind_partial);
  cnt(`${ST.miss} (<80%)`, `SUMPRODUCT((${X0}="${ST.miss}")*1)`, CN.ind_missed);
  cnt(ST.na, `SUMPRODUCT((${X0}="${ST.na}")*1)`, CN.ind_na);
  put(w0, r, 1, "Баталгаажуулах, нөхөх зүйл"); put(w0, r, 2, CN.issues_count, "0"); note(w0, r, `«${S_ISS}» хуудсанд`, 3); r++;
  r++; section(w0, r, "Үзүүлэлт бүрээр", 5); r++;
  head(w0, r, ["Үзүүлэлт", "Гүйцэтгэл", "Зорилт", "Биелэлт", "Төлөв"]); r++;
  ind.forEach((x, k) => {
    const src = (c) => `'${S_IND}'!${c}${R0 + k}`, nf = numFmt(x);
    put(w0, r, 1, x.name + (x.unit ? ` (${x.unit})` : ""), null, { wrap: true });
    f(w0, r, 2, `IF(${src(L.total)}="","",${src(L.total)})`, nf.t); chk(S_SUM, r, 2, x.total, `${x.name} / гүйцэтгэл (хураангуй)`);
    f(w0, r, 3, `IF(${src(L.target)}="","",${src(L.target)})`, nf.t);
    f(w0, r, 4, `IF(${src(L.ach)}="","",${src(L.ach)})`, PCT, { bold: true }); chk(S_SUM, r, 4, x.achievement, `${x.name} / биелэлт (хураангуй)`);
    f(w0, r, 5, src(L.status), null, { center: true }); chk(S_SUM, r, 5, x.status, `${x.name} / төлөв (хураангуй)`);
    r++;
  });
  r++;
  for (const w of res.warnings) { const cell = w0.getCell(r, 1); cell.value = "• " + w; cell.font = font({ size: 10 }); cell.alignment = { wrapText: true, vertical: "top" }; w0.mergeCells(r, 1, r, 5); w0.getRow(r).height = 30; r++; }

  // ───────────── ЭХ СУРВАЛЖ ─────────────
  title(ws, "Үзүүлэлт бүрийн эх сурвалж", "Тоо бүр эх сурвалжтай. Эх сурвалжгүй тоог баталгаатай гэж үзэхгүй.");
  head(ws, 4, ["Үзүүлэлт", "Тооцох арга", "Эх сурвалж", "Дутуу сар", "Төлөв", "Тайлбар"]);
  ind.forEach((x, k) => {
    const st = x.check ? "Шалгах" : !x.source ? "Эх сурвалжгүй" : x.kind === "none" ? "Мэдээлэлгүй" : x.missing_months.length ? "Дутуу" : x.kind === "value" ? "Нэг утга" : "Бүрэн";
    [x.name, x.kind === "monthly" ? AGG[x.agg] : x.kind === "value" ? "Нэг утга" : "—", x.source || "Эх сурвалж заагаагүй", x.missing_months.join(", ") || "—", st,
      [x.target_note, x.note].filter(Boolean).join("; ")].forEach((v, j) => put(ws, 5 + k, j + 1, v, null, { wrap: true, fill: st === "Бүрэн" || st === "Нэг утга" ? null : CHECK }));
  });

  // ───────────── АСУУДАЛ ─────────────
  title(wq, "Баталгаажуулах, нөхөх зүйлс", "Хариугаа сүүлийн (шар) баганад бичнэ үү. Хариу ирвэл тайланг шинэчилнэ.");
  head(wq, 4, ["№", "Төрөл", "Юу", "Тайлбар", "Асуулт", "Хариу"]);
  if (!res.issues.length) put(wq, 5, 1, "Асуудал бүртгэгдээгүй.", null, { font: { italic: true } });
  res.issues.forEach((q, i) => { [i + 1, q.type, q.item, q.detail, q.question].forEach((v, j) => put(wq, 5 + i, j + 1, v, null, { wrap: true })); put(wq, 5 + i, 6, null, null, { fill: INPUT }); });

  // ───────────── ЗААВАР ─────────────
  title(wh, "Үзүүлэлтийн файлыг ашиглах заавар");
  [["Шар нүд", "Оролт: сар бүрийн утга, зорилт, өмнөх жилийн дүн. Бусад нүд томьёотой тул гараар дарж бичихгүй."],
    ["Хоосон ба 0", "Хоосон нүд = мэдээлэл алга. 0 = тухайн сард тэг байсан нь баттай. Мэдээлэлгүй сарыг 0 гэж бүү бөглө: дундаж, биелэлт буруу гарна."],
    ["Улбар шар нүд", "Хамрах хугацаанд мэдээлэл ирээгүй сар. Нөхвөл гүйцэтгэл, биелэлт, төлөв автоматаар шинэчлэгдэнэ."],
    ["Саарал нүд", "Тайлангийн тооцооны тогтмол утга (сарын төлөвлөгөөтэй үзүүлэлтийн харьцуулах зорилт). Сарын утга өөрчлөгдвөл тайланг дахин гаргуулна."],
    [S_SUM, "Нийт үзүүлэлтийн тоо, биелэлтийн төлөвөөр ангилсан тоо, үзүүлэлт бүрийн гүйцэтгэл ба биелэлт."],
    [S_IND, "Үзүүлэлт бүрийн сар бүрийн утга, гүйцэтгэл, зорилт, биелэлт, өмнөх жилтэй харьцуулалт. «Хамарсан сарын тоо» (B3) нь «үнэлэх боломжгүй» гэх босгыг тодорхойлно."],
    [S_SRC, "Тоо бүрийн эх сурвалж, дутуу сар."], [S_ISS, "Баталгаажуулах, нөхөх зүйлс. Хариугаа шар баганад бичнэ."],
    ["Дараа жил", "Энэ файлыг сар бүр бөглөж үргэлжлүүлэн ашиглаж болно: мөр, баганыг устгахгүй, зөвхөн шар нүдийг бөглөнө."]]
    .forEach(([a, b], i) => { const ra = 3 + i; put(wh, ra, 1, a, null, { bold: true, fill: i === 0 ? INPUT : i === 2 ? MISS : i === 3 ? FIXED : null }); put(wh, ra, 2, b, null, { wrap: true }); wh.getRow(ra).height = 30; });

  return { wb, checks };
}
// «Эцсийн утга»: O-оос D рүү эхний мэдээлэлтэй сарын утга (LOOKUP-гүйгээр, IF-ийн гинжээр)
function lastChain(r) { let fm = `""`; for (const cc of MC) fm = `IF(${cc}${r}<>"",${cc}${r},${fm})`; return fm; }

async function toBuffer(wb) { return Buffer.from(await wb.xlsx.writeBuffer()); }
const addrRC = (addr) => { const m = /^([A-Z]+)(\d+)$/.exec(addr); let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return [Number(m[2]), n]; };

async function makeModel(meta, m, res) {
  const { wb, checks } = buildXlsx(meta, m, res);
  const calc = computeWorkbook(wb);
  const bad = calc.errors.map((e) => ({ sheet: e.sheet, addr: e.addr, label: "томьёоны алдаа", got: e.error }));
  for (const ch of checks) {
    let v; try { v = calc.value(ch.sheet, ...addrRC(ch.addr)); } catch (e) { v = "ERR:" + e.message; }
    const e = ch.expected;
    let same;
    if (e === null) same = v === null || v === undefined || v === "";
    else if (typeof e === "number") same = typeof v === "number" && Math.abs(v - e) <= Math.max(ch.tol, Math.abs(e) * 1e-9);
    else same = String(v) === String(e);
    if (!same) bad.push({ ...ch, got: v });
  }
  const buffer = await toBuffer(wb);
  return { buffer, ok: bad.length === 0 && checks.length > 0, bad, total: checks.length, formulas: calc.count };
}

module.exports = { buildXlsx, makeModel, toBuffer };
