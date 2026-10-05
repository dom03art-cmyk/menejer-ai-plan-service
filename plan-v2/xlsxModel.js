// Томьёотой Excel санхүүгийн загвар — model.js-ийн run()-ыг Excel томьёогоор давтана.
// Үндсэн төсөл бичих урсгалаас ТУСДАА: энд алдаа гарсан ч PDF/Word-д нөлөөлөхгүй.
//   makeModel(A, an) → { buffer, ok, bad[], total }
//     1) томьёотой workbook үүсгэнэ  2) xlsxCalc.js-ээр бүх томьёог бодож үр дүнг нүдэнд хадгална
//     3) гол тоонуудыг системийн тооцоотой (model.js) тулгана — нэг ч тоо зөрвөл ok=false (файлыг захиалагчид өгөхгүй)
//   recalc(buffer) → LibreOffice-оор дахин тооцоолуулах (зөвхөн туршилтад; серверт шаардлагагүй)
const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");
const { productUnit, run, npv: npvFn, irr: irrFn, payback: paybackFn } = require("./model");
const { computeWorkbook } = require("./xlsxCalc");

const S_SUM = "Хураангуй", S_IN = "Таамаглал", S_COST = "Нэгжийн өртөг", S_CAP = "Хөрөнгө оруулалт", S_LOAN = "Зээл", S_IS = "Орлогын тайлан", S_CF = "Мөнгөн гүйлгээ, баланс", S_KPI = "Үр ашиг", S_MC = "Сарын мөнгөн урсгал", S_SENS = "Мэдрэмж";
const NAVY = "FF1B2A4A", GOLD = "FFC9A227", INPUT = "FFFFF6D6", HEAD = "FFE9ECF3", TOTAL = "FFF3F0E4";
const NUM = "#,##0;[Red]-#,##0", PCT = "0.0%", DEC = "0.00";
const col = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - 1 - m) / 26; } return s; };
const q = (sheet) => `'${sheet}'!`;
const YC = [2, 3, 4, 5, 6]; // тайлангийн хуудсуудад 1–5-р жил = B..F багана

function buildXlsx(A, an, opt = {}) {
  const ExcelJS = require("exceljs");
  const st = { vol: 1, price: 1, mat: 1, fixed: 1, ...(opt.stress || {}) };
  const stressed = st.vol !== 1 || st.price !== 1 || st.mat !== 1 || st.fixed !== 1;
  const R = stressed ? run(A, { vol_mult: st.vol, price_mult: st.price, mat_mult: st.mat, fixed_mult: st.fixed }) : an.R;
  const E = { npv: npvFn(A.disc, R.fcf), irr: irrFn(R.fcf), pb: paybackFn(R.fcf), cum: [] }; R.fcf.reduce((a, c) => { E.cum.push(a + c); return a + c; }, 0);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Менежер AI"; wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  const checks = [];
  const chk = (sheet, addr, expected, label) => checks.push({ sheet, addr, expected, label });

  const mk = (name, widths) => {
    const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = Math.round(w * 1.12); });
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
    ws.headerFooter = { oddFooter: `&L&8${(A.company?.name || "").replace(/&/g, "&&")} — санхүүгийн загвар&C&8${name}&R&8&P / &N` };
    return ws;
  };
  const font = (o = {}) => ({ name: "Times New Roman", size: 11, ...o });
  const title = (ws, text, sub) => {
    ws.getCell("A1").value = text; ws.getCell("A1").font = font({ size: 14, bold: true, color: { argb: NAVY } });
    if (sub) { ws.getCell("A2").value = sub; ws.getCell("A2").font = font({ italic: true, color: { argb: "FF666666" } }); }
  };
  const head = (ws, r, labels, from = 1) => labels.forEach((t, i) => {
    const c = ws.getCell(r, from + i); c.value = t; c.font = font({ bold: true, color: { argb: "FFFFFFFF" } });
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle", wrapText: true };
  });
  const section = (ws, r, text, span = 6) => {
    const c = ws.getCell(r, 1); c.value = text; c.font = font({ bold: true, color: { argb: NAVY } });
    for (let i = 1; i <= span; i++) { ws.getCell(r, i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } }; ws.getCell(r, i).border = { bottom: { style: "thin", color: { argb: GOLD } } }; }
  };
  const put = (ws, r, c, v, fmt, o = {}) => {
    const cell = ws.getCell(r, c); cell.value = v; cell.font = font(o.bold ? { bold: true } : {});
    if (fmt) cell.numFmt = fmt;
    if (o.input) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
    if (o.total) { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL } }; cell.border = { top: { style: "thin", color: { argb: "FF999999" } } }; }
    return cell;
  };
  const f = (ws, r, c, formula, fmt = NUM, o = {}) => { const cell = put(ws, r, c, { formula }, fmt, o); cell.alignment = { horizontal: "right" }; return cell; };
  const label = (ws, r, text, o = {}) => { const c = ws.getCell(r, 1); c.value = text; c.font = font(o.bold ? { bold: true } : {}); if (o.total) { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL } }; c.border = { top: { style: "thin", color: { argb: "FF999999" } } }; } };
  const ref = (sheet, r, c, abs = true) => `${q(sheet)}${abs ? "$" : ""}${col(c)}${abs ? "$" : ""}${r}`;

  const w0 = mk(S_SUM, [48, 22, 22, 40]); // эхний хуудас — агуулгыг төгсгөлд бөглөнө

  // ───────────────────────── 1. ТААМАГЛАЛ ─────────────────────────
  const wi = mk(S_IN, [44, 16, 12, 16, 14, 14, 13, 13, 13, 13, 13]);
  title(wi, "Санхүүгийн загвар — Таамаглал", `${A.company?.name || ""} · ${A.project?.title || ""}`);
  wi.getCell("A3").value = "Шар өнгөтэй нүднүүд оролт. Тэдгээрийг өөрчлөхөд бусад бүх хуудас автоматаар дахин тооцогдоно.";
  wi.getCell("A3").font = font({ italic: true });
  section(wi, 5, "Ерөнхий таамаглал", 3); head(wi, 6, ["Үзүүлэлт", "Утга", ""]);
  const P = {}; // параметрийн нүдний үнэмлэхүй хаяг
  const params = [
    ["loan", "Зээлийн дүн (₮)", A.loan.amount || 0, NUM], ["months", "Зээлийн хугацаа (сар)", A.loan.months || 0, "0"],
    ["rate", "Зээлийн хүү (сарын)", A.loan.rate_monthly || 0, "0.00%"], ["grace", "Үндсэн төлбөрөөс чөлөөлөгдөх хугацаа (сар)", A.loan.grace_months || 0, "0"],
    ["cash_eq", "Өөрийн хөрөнгө — мөнгөөр (₮)", A.cash_equity || 0, NUM], ["init_inv", "Түүхий эдийн анхны нөөц (₮)", A.init_inventory || 0, NUM],
    ["cit", "Орлогын албан татварын бодит хувь", A.cit_eff, PCT], ["disc", "Хөнгөлөлтийн хувь (NPV)", A.disc, PCT],
    ["pg", "Борлуулах үнийн жилийн өсөлт", A.price_growth, PCT], ["vg", "Хувьсах зардлын жилийн өсөлт", A.varcost_growth, PCT],
    ["fg", "Тогтмол зардлын жилийн өсөлт", A.fixed_growth, PCT], ["payfee", "Төлбөрийн шимтгэл (орлогоос)", A.pay_fee, PCT],
    ["mkt", "Маркетингийн зардал (орлогоос)", A.mkt_rate, PCT], ["ersi", "Ажил олгогчийн НДШ", A.er_si ?? 0.135, PCT], ["vat", "НӨАТ", 0.10, PCT],
    ["cont", "Нөөц төсөв (гэнэтийн зардал) — шинэ үндсэн хөрөнгийн хувь", R.contRate || 0, PCT],
  ];
  params.forEach(([k, lab, v, fmt], i) => { const r = 7 + i; label(wi, r, lab); put(wi, r, 2, Number(v) || 0, fmt, { input: true }); P[k] = ref(S_IN, r, 2); });
  let r = 7 + params.length;
  const rateRow = 7 + params.findIndex((x) => x[0] === "rate");
  f(wi, rateRow, 3, `${P.rate}*12`, "0.0%"); put(wi, rateRow, 4, "← жилийн хүү");
  r++;
  section(wi, r, "Стресс тест — хувилбар шалгах (100% = суурь хувилбар)", 3); r++; head(wi, r, ["Үзүүлэлт", "Үржүүлэгч", ""]); r++;
  [["s_vol", "Борлуулалтын тоо хэмжээ", st.vol], ["s_price", "Борлуулах үнэ", st.price], ["s_mat", "Материалын өртөг", st.mat], ["s_fixed", "Тогтмол зардал", st.fixed]]
    .forEach(([k, lab, v]) => { label(wi, r, lab); put(wi, r, 2, v, "0%", { input: true }); P[k] = ref(S_IN, r, 2); r++; });
  put(wi, r, 1, "Жишээ: борлуулалт 20% буурахыг шалгах бол «Борлуулалтын тоо хэмжээ»-г 80% болгоно.").font = font({ italic: true, color: { argb: "FF666666" } });
  r += 2;

  // Бүтээгдэхүүн
  section(wi, r, "Бүтээгдэхүүн, үйлчилгээ", 11); r++;
  head(wi, r, ["Нэр", "Борлуулах үнэ (₮)", "НӨАТ орсон (1/0)", "Материал (₮/нэгж)", "Шууд хөдөлмөр (₮)", "Хүргэлт (₮)", "Тоо: 1-р жил", "2-р жил", "3-р жил", "4-р жил", "5-р жил"]); r++;
  const pr0 = r, np = A.products.length;
  // ───── Нэгжийн өртөг хуудас (материалын задаргаа)
  const wc = mk(S_COST, [6, 40, 40, 16]);
  title(wc, "Нэгж бүтээгдэхүүний материалын өртгийн задаргаа", "Нэг нэгжид ногдох материал (₮). Дүнг өөрчлөхөд Таамаглал хуудасны «Материал» автоматаар шинэчлэгдэнэ.");
  head(wc, 4, ["№", "Бүтээгдэхүүн", "Орц, материал", "Дүн (₮)"]);
  let cr = 5;
  A.products.forEach((p, i) => {
    const ents = Object.entries(p.materials || {}); if (!ents.length) ents.push(["Материал", 0]);
    for (const [nm, v] of ents) { put(wc, cr, 1, i + 1, "0"); put(wc, cr, 2, p.name); put(wc, cr, 3, nm); put(wc, cr, 4, Number(v) || 0, NUM, { input: true }); cr++; }
  });
  const costLast = cr - 1 + 30; // хэрэглэгч мөр нэмэх зай
  A.products.forEach((p, i) => {
    const rr = pr0 + i, u = productUnit(p);
    put(wi, rr, 1, p.name); put(wi, rr, 2, p.price, NUM, { input: true }); put(wi, rr, 3, p.vat_included === false ? 0 : 1, "0", { input: true });
    f(wi, rr, 4, `SUMIF(${q(S_COST)}$A$5:$A$${costLast},${i + 1},${q(S_COST)}$D$5:$D$${costLast})`); chk(S_IN, `D${rr}`, u.mat, `материал ${p.name}`);
    put(wi, rr, 5, p.labor || 0, NUM, { input: true }); put(wi, rr, 6, p.delivery || 0, NUM, { input: true });
    p.volumes.forEach((v, y) => put(wi, rr, 7 + y, v, NUM, { input: true }));
  });
  const prN = pr0 + np - 1; r = prN + 2;
  const pRange = (c) => `${q(S_IN)}$${col(c)}$${pr0}:$${col(c)}$${prN}`;

  // Ажилчид
  section(wi, r, "Тогтмол ажилчид", 4); r++; head(wi, r, ["Албан тушаал", "Тоо", "Эхлэх жил", "Сарын үндсэн цалин (₮)"]); r++;
  const st0 = r; const staff = A.staff && A.staff.length ? A.staff : [{ title: "—", count: 0, gross: 0, from_year: 1 }];
  staff.forEach((s, i) => { put(wi, r + i, 1, s.title || `Ажилтан ${i + 1}`); put(wi, r + i, 2, s.count || 0, "0", { input: true }); put(wi, r + i, 3, s.from_year || 1, "0", { input: true }); put(wi, r + i, 4, s.gross || 0, NUM, { input: true }); });
  const stN = st0 + staff.length - 1; r = stN + 2;
  const sRange = (c) => `${q(S_IN)}$${col(c)}$${st0}:$${col(c)}$${stN}`;

  // Тогтмол зардал
  section(wi, r, "Сарын тогтмол зардал", 2); r++; head(wi, r, ["Зардал", "Сард (₮)"]); r++;
  const fx0 = r; const fixed = Object.entries(A.fixed_monthly || {}); if (!fixed.length) fixed.push(["—", 0]);
  fixed.forEach(([k, v], i) => { put(wi, r + i, 1, k); put(wi, r + i, 2, Number(v) || 0, NUM, { input: true }); });
  const fxN = fx0 + fixed.length - 1; r = fxN + 2;

  // Улирлын хэлбэлзэл
  section(wi, r, "Борлуулалтын улирлын жин (үйл ажиллагаа эхэлснээс 1–12 дахь сар)", 2); r++; head(wi, r, ["Сар", "Жин"]); r++;
  const se0 = r; A.season.forEach((w, i) => { put(wi, r + i, 1, `${i + 1}-р сар`); put(wi, r + i, 2, w, DEC, { input: true }); });
  const seN = se0 + 11; const seSum = `SUM(${q(S_IN)}$B$${se0}:$B$${seN})`;
  wi.views = [{ state: "frozen", ySplit: 3, showGridLines: false }];

  // ───────────────────────── 2. ХӨРӨНГӨ ОРУУЛАЛТ ─────────────────────────
  const wk = mk(S_CAP, [42, 10, 16, 18, 12, 15, 15, 15, 15, 15, 14]);
  title(wk, "Хөрөнгө оруулалт, элэгдэл", "Элэгдлийг шулуун шугамын аргаар тооцно.");
  const depCols = [6, 7, 8, 9, 10];
  wk.getCell("F3").value = "Жил →"; depCols.forEach((c, y) => put(wk, 3, c, y + 1, "0", { bold: true }));
  const yr = (c) => `${col(c)}$3`;
  r = 5; section(wk, r, "Шинээр авах үндсэн хөрөнгө (CAPEX)", 10); r++;
  head(wk, r, ["Хөрөнгө", "Тоо", "Нэгж үнэ (₮)", "Нийт (₮)", "Ашиглах жил", "Элэгдэл: 1-р жил", "2-р жил", "3-р жил", "4-р жил", "5-р жил"]); r++;
  const cx0 = r; const capex = A.capex && A.capex.length ? A.capex : [{ name: "—", qty: 0, unit_price: 0, life: 5 }];
  capex.forEach((c, i) => {
    const rr = r + i; put(wk, rr, 1, c.name); put(wk, rr, 2, c.qty, "0", { input: true }); put(wk, rr, 3, c.unit_price, NUM, { input: true });
    f(wk, rr, 4, `B${rr}*C${rr}`); put(wk, rr, 5, c.life, "0", { input: true });
    depCols.forEach((cc) => f(wk, rr, cc, `IF(AND($E${rr}>0,${yr(cc)}<=$E${rr}),$D${rr}/$E${rr},0)`));
  });
  const cxN = cx0 + capex.length - 1; r = cxN + 1;
  label(wk, r, "Дүн (нөөц төсөвгүй)"); f(wk, r, 4, `SUM(D${cx0}:D${cxN})`);
  const CAPEX_BASE = ref(S_CAP, r, 4); chk(S_CAP, `D${r}`, R.capexBase ?? R.capexTotal, "CAPEX суурь"); r++;
  label(wk, r, "Нөөц төсөв (гэнэтийн зардал) — өөрийн хөрөнгөөс"); f(wk, r, 4, `${CAPEX_BASE}*${P.cont}`);
  depCols.forEach((cc) => f(wk, r, cc, `${P.cont}*SUM(${col(cc)}${cx0}:${col(cc)}${cxN})`));
  const CONT = ref(S_CAP, r, 4), CONT_ROW = r; chk(S_CAP, `D${r}`, R.contingency || 0, "нөөц төсөв"); r++;
  label(wk, r, "Нийт CAPEX", { total: true, bold: true }); f(wk, r, 4, `D${r - 2}+D${r - 1}`, NUM, { total: true, bold: true });
  const CAPEX = ref(S_CAP, r, 4); chk(S_CAP, `D${r}`, R.capexTotal, "нийт CAPEX"); r += 2;

  section(wk, r, "Одоо эзэмшиж буй хөрөнгө (өөрийн оролцоо, эд хөрөнгөөр)", 11); r++;
  head(wk, r, ["Хөрөнгө", "", "", "Үнэлгээ (₮)", "Ашиглах жил", "Элэгдэл: 1-р жил", "2-р жил", "3-р жил", "4-р жил", "5-р жил", "Элэгдэл тооцох (1/0)"]); r++;
  const ik0 = r; const inkind = (A.inkind || []).length ? A.inkind : [{ name: "—", value: 0, life: 5 }];
  inkind.forEach((c, i) => {
    const rr = r + i; put(wk, rr, 1, c.name); put(wk, rr, 4, c.value || 0, NUM, { input: true }); put(wk, rr, 5, c.life || 0, "0", { input: true });
    put(wk, rr, 11, c.depreciable === false ? 0 : 1, "0", { input: true });
    depCols.forEach((cc) => f(wk, rr, cc, `IF(AND($K${rr}=1,$E${rr}>0,${yr(cc)}<=$E${rr}),$D${rr}/$E${rr},0)`));
  });
  const ikN = ik0 + inkind.length - 1; r = ikN + 1;
  label(wk, r, "Нийт (эд хөрөнгөөр)", { total: true, bold: true }); f(wk, r, 4, `SUM(D${ik0}:D${ikN})`, NUM, { total: true, bold: true });
  const INKIND = ref(S_CAP, r, 4); chk(S_CAP, `D${r}`, R.inkindTotal, "нийт эд хөрөнгө"); r += 2;

  section(wk, r, "Дараа жилүүдийн нэмэлт хөрөнгө оруулалт", 10); r++;
  head(wk, r, ["Хөрөнгө", "Авах жил", "", "Дүн (₮)", "Ашиглах жил", "Элэгдэл: 1-р жил", "2-р жил", "3-р жил", "4-р жил", "5-р жил"]); r++;
  const ex0 = r; const extra = (A.extra_capex || []).length ? A.extra_capex : [{ name: "—", year: 0, amount: 0, life: 1 }];
  extra.forEach((e, i) => {
    const rr = r + i; put(wk, rr, 1, e.name || "—"); put(wk, rr, 2, e.year || 0, "0", { input: true }); put(wk, rr, 4, e.amount || 0, NUM, { input: true }); put(wk, rr, 5, e.life || 1, "0", { input: true });
    depCols.forEach((cc) => f(wk, rr, cc, `IF(AND($E${rr}>0,${yr(cc)}>=$B${rr},${yr(cc)}<$B${rr}+$E${rr}),$D${rr}/$E${rr},0)`));
  });
  const exN = ex0 + extra.length - 1; r = exN + 2;
  label(wk, r, "Нийт элэгдэл", { total: true, bold: true });
  depCols.forEach((cc, y) => { f(wk, r, cc, `SUM(${col(cc)}${cx0}:${col(cc)}${cxN})+${col(cc)}${CONT_ROW}+SUM(${col(cc)}${ik0}:${col(cc)}${ikN})+SUM(${col(cc)}${ex0}:${col(cc)}${exN})`, NUM, { total: true, bold: true }); chk(S_CAP, `${col(cc)}${r}`, R.years[y].dep, `элэгдэл ${y + 1}`); });
  const DEP_ROW = r; r++;
  label(wk, r, "Тухайн жилийн нэмэлт хөрөнгө оруулалт");
  depCols.forEach((cc, y) => { f(wk, r, cc, `SUMIF($B$${ex0}:$B$${exN},${yr(cc)},$D$${ex0}:$D$${exN})`); chk(S_CAP, `${col(cc)}${r}`, R.years[y].capex_extra, `нэмэлт CAPEX ${y + 1}`); });
  const EXTRA_ROW = r; r += 2;

  section(wk, r, "Хөрөнгийн эх үүсвэр ба зарцуулалт", 4); r++;
  const fund = [];
  const frow = (lab, formula, o = {}) => { label(wk, r, lab, o); f(wk, r, 4, formula, NUM, o); fund.push(r); return ref(S_CAP, r++, 4); };
  frow("Эх үүсвэр: зээл", P.loan); frow("Эх үүсвэр: өөрийн хөрөнгө (мөнгөөр)", P.cash_eq); frow("Эх үүсвэр: өөрийн хөрөнгө (нөөц төсөвт)", CONT); frow("Эх үүсвэр: өөрийн хөрөнгө (эд хөрөнгөөр)", INKIND);
  const SRC = frow("Нийт эх үүсвэр", `${P.loan}+${P.cash_eq}+${CONT}+${INKIND}`, { total: true, bold: true }); r++;
  frow("Зарцуулалт: шинэ үндсэн хөрөнгө", CAPEX_BASE); frow("Зарцуулалт: нөөц төсөв (гэнэтийн зардал)", CONT); frow("Зарцуулалт: түүхий эдийн анхны нөөц", P.init_inv);
  const RESERVE = frow("Зарцуулалт: эргэлтийн мөнгөний нөөц", `MAX(0,${P.loan}+${P.cash_eq}-${CAPEX_BASE}-${P.init_inv})`);
  chk(S_CAP, RESERVE.split("!")[1].replace(/\$/g, ""), R.reserve, "эргэлтийн нөөц");
  frow("Зарцуулалт: одоо байгаа эд хөрөнгө", INKIND);
  frow("Нийт зарцуулалт", `${CAPEX}+${P.init_inv}+${RESERVE}+${INKIND}`, { total: true, bold: true });
  void SRC;

  // ───────────────────────── 3. ЗЭЭЛ ─────────────────────────
  const wl = mk(S_LOAN, [10, 8, 18, 16, 16, 16, 18, 4, 12, 16, 16, 16]);
  title(wl, "Зээлийн эргэн төлөлтийн хуваарь", "Тэнцүү төлбөрийн (аннуитет) арга. Таамаглал хуудаснаас дүн, хүү, хугацааг авна.");
  label(wl, 3, "Сарын тэнцүү төлбөр (₮)", { bold: true });
  f(wl, 3, 3, `IF(OR(${P.loan}=0,${P.months}=0,${P.months}<=${P.grace}),0,IF(${P.rate}>0,${P.loan}*${P.rate}/(1-(1+${P.rate})^-(${P.months}-${P.grace})),${P.loan}/(${P.months}-${P.grace})))`, NUM, { bold: true });
  const PAY = "$C$3";
  head(wl, 5, ["Сар", "Жил", "Эхний үлдэгдэл", "Хүү", "Үндсэн төлбөр", "Нийт төлбөр", "Эцсийн үлдэгдэл"]);
  const NR = Math.max(180, A.loan.months || 0), l0 = 6, lN = l0 + NR - 1;
  for (let m = 1; m <= NR; m++) {
    const rr = l0 + m - 1;
    put(wl, rr, 1, m, "0"); f(wl, rr, 2, `ROUNDUP(A${rr}/12,0)`, "0");
    f(wl, rr, 3, m === 1 ? `IF(${P.months}>0,${P.loan},0)` : `G${rr - 1}`);
    f(wl, rr, 4, `IF(A${rr}<=${P.months},C${rr}*${P.rate},0)`);
    f(wl, rr, 5, `IF(A${rr}>${P.months},0,IF(A${rr}=${P.months},C${rr},IF(A${rr}<=${P.grace},0,${PAY}-D${rr})))`);
    f(wl, rr, 6, `D${rr}+E${rr}`); f(wl, rr, 7, `C${rr}-E${rr}`);
    const s = R.sched[m - 1];
    if (m <= 3 || m === (A.loan.months || 0)) { chk(S_LOAN, `D${rr}`, s ? s.int : 0, `зээлийн хүү сар ${m}`); chk(S_LOAN, `E${rr}`, s ? s.prin : 0, `зээлийн үндсэн сар ${m}`); }
  }
  head(wl, 5, ["Жил", "Хүү", "Үндсэн төлбөр", "Нийт төлбөр"], 9);
  for (let y = 1; y <= 6; y++) {
    const rr = 5 + y; put(wl, rr, 9, y, "0");
    f(wl, rr, 10, `SUMIF($B$${l0}:$B$${lN},I${rr},$D$${l0}:$D$${lN})`); f(wl, rr, 11, `SUMIF($B$${l0}:$B$${lN},I${rr},$E$${l0}:$E$${lN})`); f(wl, rr, 12, `J${rr}+K${rr}`);
  }
  const LINT = (y) => ref(S_LOAN, 5 + y, 10), LPRIN = (y) => ref(S_LOAN, 5 + y, 11);
  wl.views = [{ state: "frozen", ySplit: 5, showGridLines: false }];

  // ───────────────────────── 4. ОРЛОГЫН ТАЙЛАН ─────────────────────────
  const ws = mk(S_IS, [46, 17, 17, 17, 17, 17]);
  title(ws, "Орлогын тайлан (₮)", "5 жилийн төсөөлөл. Бүх нүд томьёогоор тооцогдоно.");
  head(ws, 4, ["Үзүүлэлт", "1-р жил", "2-р жил", "3-р жил", "4-р жил", "5-р жил"]);
  label(ws, 3, "Жилийн дугаар"); YC.forEach((c, y) => put(ws, 3, c, y + 1, "0"));
  const yn = (c) => `${col(c)}$3`;
  const IS = {}; r = 5;
  const line = (key, lab, fn, getter, o = {}) => {
    label(ws, r, lab, o); YC.forEach((c, y) => { f(ws, r, c, fn(c, y), o.fmt || NUM, o); if (getter) chk(S_IS, `${col(c)}${r}`, getter(R.years[y], y), `${lab} ${y + 1}`); });
    IS[key] = r; return r++;
  };
  section(ws, r, "Борлуулалтын орлого (НӨАТ-гүй)", 6); r++;
  const rev0 = r;
  A.products.forEach((p, i) => {
    const pr = pr0 + i;
    line(`rev_${i}`, p.name, (c, y) => `${ref(S_IN, pr, 7 + y)}*${ref(S_IN, pr, 2)}/(1+IF(${ref(S_IN, pr, 3)}=1,${P.vat},0))*(1+${P.pg})^(${yn(c)}-1)*${P.s_vol}*${P.s_price}`, (Y) => Y.rev_p[p.key]);
  });
  line("rev", "Борлуулалтын орлого — нийт", (c) => `SUM(${col(c)}${rev0}:${col(c)}${r - 1})`, (Y) => Y.rev, { total: true, bold: true });
  r++; section(ws, r, "Борлуулсан бүтээгдэхүүний өртөг (ББӨ)", 6); r++;
  line("mat", "Материал", (c, y) => `SUMPRODUCT(${pRange(7 + y)},${pRange(4)})*(1+${P.vg})^(${yn(c)}-1)*${P.s_vol}*${P.s_mat}`, (Y) => Y.mat);
  line("labor", "Шууд хөдөлмөр", (c, y) => `SUMPRODUCT(${pRange(7 + y)},${pRange(5)})*(1+${P.vg})^(${yn(c)}-1)*${P.s_vol}`, (Y) => Y.labor);
  line("cogs", "ББӨ — нийт", (c) => `${col(c)}${IS.mat}+${col(c)}${IS.labor}`, (Y) => Y.cogs, { total: true, bold: true });
  line("gross", "Нийт ашиг", (c) => `${col(c)}${IS.rev}-${col(c)}${IS.cogs}`, (Y) => Y.gross, { total: true, bold: true });
  r++; section(ws, r, "Үйл ажиллагааны зардал", 6); r++;
  line("deliv", "Хүргэлт", (c, y) => `SUMPRODUCT(${pRange(7 + y)},${pRange(6)})*(1+${P.vg})^(${yn(c)}-1)*${P.s_vol}`, (Y) => Y.deliv);
  line("fees", "Төлбөрийн шимтгэл", (c) => `${col(c)}${IS.rev}*${P.payfee}`, (Y) => Y.fees);
  line("mkt", "Маркетинг", (c) => `${col(c)}${IS.rev}*${P.mkt}`, (Y) => Y.mkt);
  const fixStart = r;
  line("staff", "Цалин, НДШ (тогтмол ажилтан)", (c) => `SUMPRODUCT((${sRange(3)}<=${yn(c)})*${sRange(2)}*${sRange(4)})*(1+${P.ersi})*12*(1+${P.fg})^(${yn(c)}-1)*${P.s_fixed}`, (Y) => Y.fixed["Цалин, НДШ (тогтмол ажилтан)"]);
  fixed.forEach(([k], i) => line(`fx_${i}`, k, (c) => `${ref(S_IN, fx0 + i, 2)}*12*(1+${P.fg})^(${yn(c)}-1)*${P.s_fixed}`, (Y) => (k in Y.fixed ? Y.fixed[k] : 0)));
  line("fixed", "Тогтмол зардал — нийт", (c) => `SUM(${col(c)}${fixStart}:${col(c)}${r - 1})`, (Y) => Y.fixed_tot, { total: true, bold: true });
  line("ebitda", "EBITDA (хүү, татвар, элэгдлийн өмнөх ашиг)", (c) => `${col(c)}${IS.gross}-${col(c)}${IS.deliv}-${col(c)}${IS.fees}-${col(c)}${IS.mkt}-${col(c)}${IS.fixed}`, (Y) => Y.ebitda, { total: true, bold: true });
  line("dep", "Элэгдэл", (c, y) => ref(S_CAP, DEP_ROW, depCols[y]), (Y) => Y.dep);
  line("ebit", "Үйл ажиллагааны ашиг (EBIT)", (c) => `${col(c)}${IS.ebitda}-${col(c)}${IS.dep}`, (Y) => Y.ebit, { total: true, bold: true });
  line("int", "Зээлийн хүүгийн зардал", (c, y) => LINT(y + 1), (Y) => Y.int);
  line("pbt", "Татварын өмнөх ашиг", (c) => `${col(c)}${IS.ebit}-${col(c)}${IS.int}`, (Y) => Y.pbt, { total: true, bold: true });
  line("tax", "Орлогын албан татвар", (c) => `MAX(0,${col(c)}${IS.pbt})*${P.cit}`, (Y) => Y.tax);
  line("ni", "ЦЭВЭР АШИГ", (c) => `${col(c)}${IS.pbt}-${col(c)}${IS.tax}`, (Y) => Y.ni, { total: true, bold: true });
  r++; section(ws, r, "Харьцаа", 6); r++;
  line("gm", "Нийт ашгийн маржин", (c) => `IF(${col(c)}${IS.rev}=0,0,${col(c)}${IS.gross}/${col(c)}${IS.rev})`, null, { fmt: PCT });
  line("em", "EBITDA маржин", (c) => `IF(${col(c)}${IS.rev}=0,0,${col(c)}${IS.ebitda}/${col(c)}${IS.rev})`, null, { fmt: PCT });
  line("nm", "Цэвэр ашгийн маржин", (c) => `IF(${col(c)}${IS.rev}=0,0,${col(c)}${IS.ni}/${col(c)}${IS.rev})`, null, { fmt: PCT });
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 4, showGridLines: false }];
  const I = (key, c) => ref(S_IS, IS[key], c, false).replace(/\$/g, "");

  // ───────────────────────── 5. МӨНГӨН ГҮЙЛГЭЭ, БАЛАНС ─────────────────────────
  const wf = mk(S_CF, [46, 17, 17, 17, 17, 17, 17]);
  title(wf, "Мөнгөн гүйлгээний тайлан ба баланс (₮)");
  // Баланс: B = эхлэл, C..G = 1–5-р жил.  Мөнгөн гүйлгээ: C..G
  const BC = [3, 4, 5, 6, 7];
  head(wf, 4, ["Мөнгөн гүйлгээ", "", "1-р жил", "2-р жил", "3-р жил", "4-р жил", "5-р жил"]);
  const CF = {}; r = 5;
  const cfl = (key, lab, fn, getter, o = {}) => { label(wf, r, lab, o); BC.forEach((c, y) => { f(wf, r, c, fn(c, y), NUM, o); if (getter) chk(S_CF, `${col(c)}${r}`, getter(y), `${lab} ${y + 1}`); }); CF[key] = r; return r++; };
  const isc = (key, y) => I(key, YC[y]);
  cfl("inv_end", "Бараа материалын нөөц (жилийн эцэст)", (c, y) => `${isc("mat", y)}/12*1.5`, (y) => R.years[y].inv_end);
  cfl("dinv", "Нөөцийн өсөлт", (c, y) => (y === 0 ? `${col(c)}${CF.inv_end}-${P.init_inv}` : `${col(c)}${CF.inv_end}-${col(c - 1)}${CF.inv_end}`), (y) => R.cfs[y].dinv);
  cfl("open", "Мөнгөн хөрөнгийн эхний үлдэгдэл", (c, y) => (y === 0 ? `${P.loan}-${CAPEX_BASE}-${P.init_inv}+${P.cash_eq}` : `${col(c - 1)}${r + 4}`), (y) => R.cfs[y].open);
  cfl("op", "Үйл ажиллагааны цэвэр мөнгөн урсгал", (c, y) => `${isc("ni", y)}+${isc("dep", y)}-${col(c)}${CF.dinv}`, (y) => R.cfs[y].op);
  cfl("invest", "Хөрөнгө оруулалтын урсгал", (c, y) => `-${ref(S_CAP, EXTRA_ROW, depCols[y])}`, (y) => R.cfs[y].invest);
  cfl("fin", "Зээлийн үндсэн төлбөр", (c, y) => `-${LPRIN(y + 1)}`, (y) => R.cfs[y].fin);
  cfl("close", "Мөнгөн хөрөнгийн эцсийн үлдэгдэл", (c) => `${col(c)}${CF.open}+${col(c)}${CF.op}+${col(c)}${CF.invest}+${col(c)}${CF.fin}`, (y) => R.cfs[y].close, { total: true, bold: true });
  r += 2;
  head(wf, r, ["Баланс (жилийн эцсээр)", "Эхлэл", "1-р жил", "2-р жил", "3-р жил", "4-р жил", "5-р жил"]); r++;
  const BS = {}; const ALLC = [2, ...BC];
  const bsl = (key, lab, fn, o = {}) => { label(wf, r, lab, o); ALLC.forEach((c, i) => { f(wf, r, c, fn(c, i), NUM, o); if (key in R.bs[0]) chk(S_CF, `${col(c)}${r}`, R.bs[i][key], `${lab} ${i}`); }); BS[key] = r; return r++; };
  // i = 0 эхлэл, 1..5 жил (y = i-1)
  bsl("cash", "Мөнгөн хөрөнгө", (c, i) => (i === 0 ? `${P.loan}-${CAPEX_BASE}-${P.init_inv}+${P.cash_eq}` : `${col(c)}${CF.close}`));
  bsl("inv", "Бараа материал", (c, i) => (i === 0 ? P.init_inv : `${col(c)}${CF.inv_end}`));
  bsl("fa", "Үндсэн хөрөнгө (цэвэр)", (c, i) => (i === 0 ? `${CAPEX}+${INKIND}` : `${col(c - 1)}${r}+${ref(S_CAP, EXTRA_ROW, depCols[i - 1])}-${isc("dep", i - 1)}`));
  bsl("assets", "НИЙТ ХӨРӨНГӨ", (c) => `${col(c)}${BS.cash}+${col(c)}${BS.inv}+${col(c)}${BS.fa}`, { total: true, bold: true });
  // зээлийн үлдэгдэл (туслах мөр)
  label(wf, r, "Зээлийн нийт үлдэгдэл"); ALLC.forEach((c, i) => f(wf, r, c, i === 0 ? P.loan : `${col(c - 1)}${r}-${LPRIN(i)}`)); const LB = r++;
  bsl("loan_cur", "Зээлийн богино хугацаат хэсэг (дараагийн 12 сар)", (c, i) => LPRIN(i + 1));
  bsl("loan_lt", "Зээлийн урт хугацаат хэсэг", (c) => `MAX(0,${col(c)}${LB}-${col(c)}${BS.loan_cur})`);
  bsl("eq", "Эздийн оруулсан хөрөнгө", () => `${INKIND}+${P.cash_eq}+${CONT}`);
  bsl("re", "Хуримтлагдсан ашиг", (c, i) => (i === 0 ? "0" : `${col(c - 1)}${r}+${isc("ni", i - 1)}`));
  bsl("le", "НИЙТ ЭХ ҮҮСВЭР", (c) => `${col(c)}${BS.loan_cur}+${col(c)}${BS.loan_lt}+${col(c)}${BS.eq}+${col(c)}${BS.re}`, { total: true, bold: true });
  label(wf, r, "Шалгалт (хөрөнгө − эх үүсвэр = 0)"); ALLC.forEach((c, i) => { f(wf, r, c, `ROUND(${col(c)}${BS.assets}-${col(c)}${BS.le},0)`); chk(S_CF, `${col(c)}${r}`, 0, `балансын зөрүү ${i}`); }); r++;
  wf.views = [{ state: "frozen", xSplit: 1, showGridLines: false }];
  const C = (key, y) => `${q(S_CF)}${col(BC[y])}${CF[key]}`;

  // ───────────────────────── 6. ҮР АШИГ ─────────────────────────
  const wm = mk(S_KPI, [46, 17, 17, 17, 17, 17, 17]);
  title(wm, "Хөрөнгө оруулалтын үр ашиг", "NPV, IRR, нөхөгдөх хугацаа, зээл төлөх чадвар (DSCR).");
  head(wm, 4, ["Чөлөөт мөнгөн урсгал (₮)", "0-р жил", "1-р жил", "2-р жил", "3-р жил", "4-р жил", "5-р жил"]);
  const K = [2, 3, 4, 5, 6, 7];
  label(wm, 5, "Жил"); K.forEach((c, i) => put(wm, 5, c, i, "0"));
  label(wm, 6, "Чөлөөт мөнгөн урсгал", { bold: true });
  K.forEach((c, i) => {
    const fm = i === 0 ? `-(${CAPEX}+${P.init_inv}+${RESERVE})`
      : `${isc("ebitda", i - 1)}-${isc("tax", i - 1)}-${ref(S_CAP, EXTRA_ROW, depCols[i - 1])}-${C("dinv", i - 1)}${i === 5 ? `+${C("inv_end", 4)}+${RESERVE}` : ""}`;
    f(wm, 6, c, fm, NUM, { bold: true }); chk(S_KPI, `${col(c)}6`, R.fcf[i], `FCF ${i}`);
  });
  label(wm, 7, "Хуримтлагдсан урсгал"); K.forEach((c, i) => { f(wm, 7, c, i === 0 ? `${col(c)}6` : `${col(c - 1)}7+${col(c)}6`); chk(S_KPI, `${col(c)}7`, E.cum[i], `хуримтлагдсан ${i}`); });
  label(wm, 8, "Хөнгөлөгдсөн урсгал"); K.forEach((c) => f(wm, 8, c, `${col(c)}6/(1+${P.disc})^${col(c)}5`));
  label(wm, 9, "Нөхөгдөх жил (туслах)"); K.slice(1).forEach((c) => f(wm, 9, c, `IF(AND(${col(c)}7>=0,${col(c - 1)}7<0),${col(c)}5-1+(-${col(c - 1)}7/${col(c)}6),"")`, DEC));
  section(wm, 11, "Үндсэн үзүүлэлт", 3);
  label(wm, 12, "Цэвэр өнөөгийн үнэ цэнэ — NPV (₮)", { bold: true }); f(wm, 12, 2, `SUM(B8:G8)`, NUM, { bold: true }); chk(S_KPI, "B12", E.npv, "NPV");
  label(wm, 13, "Өгөөжийн дотоод хувь — IRR", { bold: true }); f(wm, 13, 2, `IFERROR(IRR(B6:G6),"тооцох боломжгүй")`, PCT, { bold: true });
  if (E.irr > -0.5 && E.irr < 1) chk(S_KPI, "B13", E.irr, "IRR"); // хэт өндөр/сөрөг үед Excel-ийн IRR өөр язгуур олж болзошгүй тул шалгахгүй
  label(wm, 14, "Хөрөнгө оруулалт нөхөгдөх хугацаа (жил)", { bold: true }); f(wm, 14, 2, `IF(COUNT(C9:G9)=0,"5-аас дээш жил",MIN(C9:G9))`, DEC, { bold: true });
  if (E.pb != null && E.cum[0] < 0) chk(S_KPI, "B14", E.pb, "нөхөгдөх хугацаа");
  section(wm, 16, "Зээл төлөх чадвар", 6);
  head(wm, 17, ["Үзүүлэлт", "1-р жил", "2-р жил", "3-р жил", "4-р жил", "5-р жил"]);
  label(wm, 18, "Зээлийн төлбөр (хүү + үндсэн)"); YC.forEach((c, y) => { f(wm, 18, c, `${LINT(y + 1)}+${LPRIN(y + 1)}`); chk(S_KPI, `${col(c)}18`, R.years[y].ds, `зээлийн төлбөр ${y + 1}`); });
  label(wm, 19, "DSCR = (EBITDA − татвар) ÷ зээлийн төлбөр", { bold: true });
  YC.forEach((c, y) => { f(wm, 19, c, `IF(${col(c)}18>0,(${isc("ebitda", y)}-${isc("tax", y)})/${col(c)}18,"зээлгүй")`, DEC, { bold: true }); if (R.dscr[y] != null) chk(S_KPI, `${col(c)}19`, R.dscr[y], `DSCR ${y + 1}`); });
  label(wm, 20, "DSCR — хамгийн бага", { bold: true }); f(wm, 20, 2, `IF(COUNT(B19:F19)=0,"зээлгүй",MIN(B19:F19))`, DEC, { bold: true });
  { const d = R.dscr.filter((x) => x != null); if (d.length) chk(S_KPI, "B20", Math.min(...d), "DSCR хамгийн бага"); }
  put(wm, 20, 3, "Банкууд ихэвчлэн 1.2-оос дээш байхыг шаарддаг.").font = font({ italic: true, color: { argb: "FF666666" } });

  // Санхүүгийн харьцаанууд
  section(wm, 22, "Санхүүгийн харьцаа", 6);
  head(wm, 23, ["Үзүүлэлт", "1-р жил", "2-р жил", "3-р жил", "4-р жил", "5-р жил"]);
  const B = (key, y) => `${q(S_CF)}${col(BC[y])}${BS[key]}`, LBc = (y) => `${q(S_CF)}${col(BC[y])}${LB}`;
  const ratio = (rr, lab, fn, fmt = DEC) => { label(wm, rr, lab); YC.forEach((c, y) => f(wm, rr, c, fn(y), fmt)); };
  ratio(24, "Хүү төлөх чадвар (EBIT ÷ хүү)", (y) => `IF(${isc("int", y)}>0,${isc("ebit", y)}/${isc("int", y)},"зээлгүй")`);
  ratio(25, "Зээлийн үлдэгдэл ÷ EBITDA", (y) => `IF(${isc("ebitda", y)}>0,${LBc(y)}/${isc("ebitda", y)},"—")`);
  ratio(26, "Зээл ÷ өөрийн хөрөнгө", (y) => `IF(${B("eq", y)}+${B("re", y)}>0,${LBc(y)}/(${B("eq", y)}+${B("re", y)}),"—")`);
  ratio(27, "Өөрийн хөрөнгийн эзлэх хувь (нийт хөрөнгөд)", (y) => `IF(${B("assets", y)}>0,(${B("eq", y)}+${B("re", y)})/${B("assets", y)},0)`, PCT);
  ratio(28, "Эргэлтийн харьцаа (мөнгө + нөөц ÷ 12 сарын зээлийн төлбөр)", (y) => `IF(${B("loan_cur", y)}>0,(${B("cash", y)}+${B("inv", y)})/${B("loan_cur", y)},"—")`);
  ratio(29, "Өөрийн хөрөнгийн өгөөж (ROE)", (y) => `IF(${B("eq", y)}+${B("re", y)}>0,${isc("ni", y)}/(${B("eq", y)}+${B("re", y)}),0)`, PCT);
  ratio(30, "Нийт хөрөнгийн өгөөж (ROA)", (y) => `IF(${B("assets", y)}>0,${isc("ni", y)}/${B("assets", y)},0)`, PCT);

  // Алдагдалгүй цэг (үндсэн бүтээгдэхүүнээр)
  const u1 = productUnit(A.products[0]), cm1 = u1.net - u1.cogs - u1.delivery - u1.net * (A.pay_fee + A.mkt_rate), fx1 = R.years[0].fixed_tot + R.years[0].dep + R.years[0].int;
  section(wm, 32, `Алдагдалгүй цэг — «${A.products[0].name}»-ээр илэрхийлсэн (1-р жил)`, 3);
  const p1 = pr0;
  label(wm, 33, "Нэгжийн цэвэр үнэ (НӨАТ-гүй)"); f(wm, 33, 2, `${ref(S_IN, p1, 2)}/(1+IF(${ref(S_IN, p1, 3)}=1,${P.vat},0))`);
  label(wm, 34, "Нэгжийн хувь нэмрийн ашиг"); f(wm, 34, 2, `B33-${ref(S_IN, p1, 4)}-${ref(S_IN, p1, 5)}-${ref(S_IN, p1, 6)}-B33*(${P.payfee}+${P.mkt})`); chk(S_KPI, "B34", cm1, "хувь нэмрийн ашиг");
  label(wm, 35, "Тогтмол зардал + элэгдэл + хүү (1-р жил)"); f(wm, 35, 2, `${isc("fixed", 0)}+${isc("dep", 0)}+${isc("int", 0)}`); chk(S_KPI, "B35", fx1, "BEP тогтмол");
  label(wm, 36, "Алдагдалгүй цэг (ширхэг/нэгж)", { bold: true }); f(wm, 36, 2, `IF(B34>0,B35/B34,"хүрэхгүй")`, NUM, { bold: true }); if (cm1 > 0) chk(S_KPI, "B36", fx1 / cm1, "BEP нэгж");
  label(wm, 37, "Алдагдалгүй цэг (орлого, ₮)", { bold: true }); f(wm, 37, 2, `IF(B34>0,B36*B33,"хүрэхгүй")`, NUM, { bold: true });

  // ───────────────────────── 7. САРЫН МӨНГӨН УРСГАЛ (36 сар) ─────────────────────────
  const wq = mk(S_MC, [8, 8, 12, 16, 16, 16, 16, 16, 16, 18]);
  title(wq, "Сарын мөнгөн урсгал — эхний 3 жил (₮)", "Жилийн дүнг улирлын жингээр саруудад хуваарилна.");
  head(wq, 4, ["№", "Жил", "Сар", "Орлого", "Хувьсах зардал", "Тогтмол зардал", "Татвар", "Зээлийн төлбөр", "Цэвэр урсгал", "Мөнгөний үлдэгдэл"]);
  const smi = A.start_month_index ?? 10;
  for (let i = 0; i < 36; i++) {
    const rr = 5 + i, y = Math.floor(i / 12), mi = i % 12, yc = col(YC[y]);
    const w = `(${ref(S_IN, se0 + mi, 2)}/${seSum})`;
    const calM = (smi + mi) % 12, calY = A.start_year + Math.floor((smi + mi + y * 12) / 12);
    put(wq, rr, 1, i + 1, "0"); put(wq, rr, 2, y + 1, "0"); put(wq, rr, 3, `${calY}.${String(calM + 1).padStart(2, "0")}`);
    f(wq, rr, 4, `${q(S_IS)}${yc}${IS.rev}*${w}`);
    f(wq, rr, 5, `(${q(S_IS)}${yc}${IS.cogs}+${q(S_IS)}${yc}${IS.deliv}+${q(S_IS)}${yc}${IS.fees}+${q(S_IS)}${yc}${IS.mkt})*${w}`);
    f(wq, rr, 6, `${q(S_IS)}${yc}${IS.fixed}/12`);
    f(wq, rr, 7, `${q(S_IS)}${yc}${IS.tax}*${w}`);
    f(wq, rr, 8, `${q(S_LOAN)}F${l0 + i}`);
    f(wq, rr, 9, `D${rr}-E${rr}-F${rr}-G${rr}-H${rr}`);
    f(wq, rr, 10, i === 0 ? `${q(S_CF)}B${BS.cash}+I${rr}` : `J${rr - 1}+I${rr}`, NUM, { bold: true });
    const m = R.mc[i]; if (m && (i % 6 === 0 || i === 35)) { chk(S_MC, `I${rr}`, m.net, `сарын цэвэр ${i + 1}`); chk(S_MC, `J${rr}`, m.cash, `сарын үлдэгдэл ${i + 1}`); }
  }
  wq.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];

  // ───────────────────────── 8. МЭДРЭМЖ (тоон утга) ─────────────────────────
  const wx = mk(S_SENS, [34, 26, 20, 20, 12, 14, 14]);
  title(wx, "Хувилбар ба мэдрэмжийн шинжилгээ", "Төсөл боловсруулах үеийн тоон утга (томьёогүй). Өөрөө хувилбар шалгах бол Таамаглал хуудасны «Стресс тест» хэсгийг ашиглана.");
  head(wx, 4, ["Хувилбар", "Өөрчлөлт", "Цэвэр ашиг 1-р жил (₮)", "NPV (₮)", "IRR", "Нөхөгдөх (жил)", "DSCR 1-р жил"]);
  an.sens.forEach((s, i) => { const rr = 5 + i; put(wx, rr, 1, s.name); put(wx, rr, 2, s.change); put(wx, rr, 3, s.ni1, NUM); put(wx, rr, 4, s.npv, NUM); put(wx, rr, 5, s.irr, PCT); put(wx, rr, 6, s.pb == null ? "5+" : s.pb, DEC); put(wx, rr, 7, s.dscr1 == null ? "зээлгүй" : s.dscr1, DEC); });
  r = 5 + an.sens.length + 2;
  head(wx, r, ["Гурван хувилбар", "Борлуулалтын тоо", "Орлого 1-р жил (₮)", "NPV (₮)", "IRR", "Нөхөгдөх (жил)", "DSCR 1-р жил"]); r++;
  for (const [nm, ch] of [["Реалистик", "100%"], ["Консерватив", "−15%"], ["Пессимистик", "−30%"]]) {
    const s = an.scen[nm]; if (!s) continue;
    put(wx, r, 1, nm); put(wx, r, 2, ch); put(wx, r, 3, s.rev[0], NUM); put(wx, r, 4, s.npv, NUM); put(wx, r, 5, s.irr, PCT); put(wx, r, 6, s.pb == null ? "5+" : s.pb, DEC); put(wx, r, 7, s.dscr[0] == null ? "зээлгүй" : s.dscr[0], DEC); r++;
  }

  // ───────────────────────── 0. ХУРААНГУЙ (эхний хуудас) ─────────────────────────
  w0.getCell("A1").value = "САНХҮҮГИЙН ЗАГВАР"; w0.getCell("A1").font = font({ size: 18, bold: true, color: { argb: NAVY } });
  w0.getCell("A2").value = A.project?.title || ""; w0.getCell("A2").font = font({ size: 12, bold: true });
  const info = [["Төсөл хэрэгжүүлэгч", A.company?.name], ["Байршил", A.project?.location || A.company?.address], ["Санхүүжүүлэгч", A.project?.funder], ["Загвар үүсгэсэн огноо", new Date().toISOString().slice(0, 10)], ["Мөнгөн нэгж", "төгрөг (₮)"]];
  info.forEach(([k, v], i) => { put(w0, 4 + i, 1, k); put(w0, 4 + i, 2, v || "—", null, { bold: true }); });
  let z = 10; section(w0, z, "Гол үзүүлэлт", 3); z++;
  const kv = (lab, formula, fmt = NUM, note) => { put(w0, z, 1, lab); f(w0, z, 2, formula, fmt, { bold: true }); if (note) put(w0, z, 3, note).font = font({ italic: true, color: { argb: "FF666666" } }); return z++; };
  kv("Нийт хөрөнгө оруулалт (эх үүсвэр)", SRC);
  kv("  үүнээс: зээл", P.loan); kv("  үүнээс: өөрийн хөрөнгө (мөнгө + эд хөрөнгө)", `${P.cash_eq}+${CONT}+${INKIND}`);
  kv("  үүнд: нөөц төсөв (гэнэтийн зардал)", CONT);
  kv("Өөрийн оролцооны хувь", `IF(${SRC}>0,(${P.cash_eq}+${CONT}+${INKIND})/${SRC},0)`, PCT);
  kv("Зээлийн хугацаа (сар)", P.months, "0"); kv("Зээлийн жилийн хүү", `${P.rate}*12`, "0.0%"); kv("Сарын тэнцүү төлбөр", `${q(S_LOAN)}$C$3`);
  z++;
  kv("Борлуулалтын орлого — 1-р жил", isc("rev", 0)); kv("Цэвэр ашиг — 1-р жил", isc("ni", 0)); kv("EBITDA маржин — 1-р жил", isc("em", 0), PCT);
  kv("Борлуулалтын орлого — 5-р жил", isc("rev", 4)); kv("Цэвэр ашиг — 5-р жил", isc("ni", 4));
  z++;
  kv("Цэвэр өнөөгийн үнэ цэнэ (NPV)", `${q(S_KPI)}B12`); kv("Өгөөжийн дотоод хувь (IRR)", `${q(S_KPI)}B13`, PCT);
  kv("Хөрөнгө оруулалт нөхөгдөх хугацаа (жил)", `${q(S_KPI)}B14`, DEC); kv("DSCR — хамгийн бага", `${q(S_KPI)}B20`, DEC, "1.2-оос дээш байвал зохимжтой");
  z++; section(w0, z, "Загварын өөрийн шалгалт", 3); z++;
  kv("Баланс тэнцэж байгаа эсэх", `IF(AND(MAX(${q(S_CF)}B${BS.le + 1}:G${BS.le + 1})=0,MIN(${q(S_CF)}B${BS.le + 1}:G${BS.le + 1})=0),"ЗӨВ","АЛДАА")`, null);
  kv("Эх үүсвэр зарцуулалтаа хүрч байгаа эсэх", `IF(${P.loan}+${P.cash_eq}-${CAPEX_BASE}-${P.init_inv}>=0,"ЗӨВ","ДУТУУ — эх үүсвэр нэмэх шаардлагатай")`, null);
  kv("Сарын мөнгөн үлдэгдэл сөрөг болохгүй эсэх (36 сар)", `IF(MIN(${q(S_MC)}J5:J40)>=0,"ЗӨВ","АНХААР — мөнгөн үлдэгдэл сөрөг болж байна")`, null);
  kv("Стресс тест идэвхтэй эсэх", `IF(AND(${P.s_vol}=1,${P.s_price}=1,${P.s_mat}=1,${P.s_fixed}=1),"Үгүй — суурь хувилбар","ТИЙМ — үржүүлэгч өөрчлөгдсөн")`, null);
  z++; section(w0, z, "Хуудсуудын тайлбар", 3); z++;
  const yellow = w0.getCell(z, 1); yellow.value = "Шар нүд = оролт (өөрчилж болно). Бусад нүд томьёогоор автоматаар тооцогдоно."; yellow.font = font({ bold: true }); yellow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } }; z++;
  [[S_IN, "Бүх оролт: үнэ, тоо хэмжээ, цалин, тогтмол зардал, зээлийн нөхцөл, стресс тест"], [S_COST, "Нэгж бүтээгдэхүүний материалын задаргаа"], [S_CAP, "Үндсэн хөрөнгө, элэгдэл, эх үүсвэр ба зарцуулалт"], [S_LOAN, "Зээлийн сарын эргэн төлөлтийн хуваарь"],
    [S_IS, "5 жилийн орлогын тайлан"], [S_CF, "Мөнгөн гүйлгээний тайлан, баланс"], [S_KPI, "NPV, IRR, нөхөгдөх хугацаа, DSCR, харьцаанууд, алдагдалгүй цэг"], [S_MC, "Эхний 36 сарын мөнгөн урсгал"], [S_SENS, "Хувилбар, мэдрэмжийн шинжилгээ (тоон утга)"]]
    .forEach(([nm, d]) => { put(w0, z, 1, nm, null, { bold: true }); put(w0, z, 2, d); z++; });
  z++; put(w0, z, 1, "Энэхүү загвар нь захиалагчийн өгсөн мэдээлэл болон салбарын дундаж таамаглалд үндэслэсэн төсөөлөл бөгөөд бодит үр дүн өөр байж болно.").font = font({ italic: true, size: 9, color: { argb: "FF666666" } });

  return { wb, checks };
}

async function toBuffer(wb) { return Buffer.from(await wb.xlsx.writeBuffer()); }

// (Зөвхөн туршилтад) LibreOffice-оор нээж дахин хадгалснаар бүх томьёог бие даан тооцоолуулна
function recalc(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xlsx-"));
  try {
    const src = path.join(dir, "in.xlsx"), outDir = path.join(dir, "out");
    fs.writeFileSync(src, buffer); fs.mkdirSync(outDir);
    execFileSync("soffice", [`-env:UserInstallation=file://${path.join(dir, "profile")}`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", outDir, src], { stdio: "ignore", timeout: 180000 });
    return fs.readFileSync(path.join(outDir, "in.xlsx"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const addrRC = (addr) => { const m = /^([A-Z]+)(\d+)$/.exec(addr); let c = 0; for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64); return [Number(m[2]), c]; };
const close = (v, exp) => typeof v === "number" && (Math.abs(v - exp) <= Math.max(1, Math.abs(exp) * 1e-6) || (Math.abs(exp) < 50 && Math.abs(v - exp) < 1e-4));

// Гол функц: файл үүсгээд, томьёог бодож, системийн тооцоотой тулгана. Зөрүүтэй бол ok=false (файлыг захиалагчид өгөхгүй).
async function makeModel(A, an, opt = {}) {
  const { wb, checks } = buildXlsx(A, an, opt);
  const calc = computeWorkbook(wb);
  const bad = calc.errors.map((e) => ({ sheet: e.sheet, addr: e.addr, label: "томьёоны алдаа", got: e.error }));
  let nonzero = 0;
  for (const c of checks) {
    let v; try { v = calc.value(c.sheet, ...addrRC(c.addr)); } catch (e) { v = e.message; }
    if (v === null || v === undefined) v = 0;
    if (!close(v, c.expected)) bad.push({ ...c, got: v }); else if (Math.abs(c.expected) > 1) nonzero++;
  }
  const buffer = await toBuffer(wb);
  return { buffer, ok: bad.length === 0 && nonzero > 20, bad, total: checks.length, formulas: calc.count };
}

module.exports = { buildXlsx, toBuffer, recalc, makeModel };
