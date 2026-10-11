// Байгууллагын жилийн төсвийн томьёотой Excel загвар — plancalc.js-ийн run()-ыг Excel томьёогоор давтана.
// (annual_calc.py / build_budget_xlsx.py-ийн Node хувилбар.) Баримт бичгийн урсгалаас ТУСДАА: энд алдаа гарвал Word/PDF-д нөлөөлөхгүй.
//   makeModel(A, cfg, res) → { buffer, ok, bad[], total, formulas }
//     1) томьёотой workbook үүсгэнэ  2) plan-v2/xlsxCalc.js-ээр бүх томьёог бодно
//     3) гол тоонуудыг plancalc.js-ийн тооцоотой тулгана — зөрвөл ok=false (файлыг захиалагчид өгөхгүй)
// Зөвхөн xlsxCalc-ийн дэмждэг функц: IF AND OR SUM MAX MIN SUMIF SUMPRODUCT. Тойрсон лавлагаагүй.
const { computeWorkbook } = require("../plan-v2/xlsxCalc");
const { normalizeCfg, MN, INIT_GROUP } = require("./plancalc");

const S_SUM = "Хураангуй", S_IN = "Таамаглал", S_INC = "Орлого", S_PAY = "Цалин", S_EXP = "Зардал", S_PL = "Нэгтгэл", S_DEP = "Хэлтсээр", S_ACT = "Гүйцэтгэл", S_HELP = "Заавар";
const NAVY = "FF1B2A4A", GOLD = "FFC9A227", INPUT = "FFFFF6D6", HEAD = "FFE9ECF3", TOTAL = "FFF3F0E4", GRAY = "FF666666";
const NUM = "#,##0;[Red]-#,##0", PCT = "0.0%", DEC = "0.0#", QTY = "#,##0.0";
const col = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - 1 - m) / 26; } return s; };
const q = (sheet) => `'${sheet}'!`;
// Сарын баганууд: тооцооны хуудсуудад D..O (4..15), P = жилийн дүн; Таамаглал хуудсанд I..T (9..20), U = нийлбэр
const MC = Array.from({ length: 12 }, (_, i) => col(4 + i)), TOTC = 16, TOT = col(TOTC);
const IC = Array.from({ length: 12 }, (_, i) => col(9 + i)), IU = "U";

function buildXlsx(A, cfg0, res) {
  const ExcelJS = require("exceljs");
  const c = normalizeCfg(cfg0), L = res.labels, Y = c.year, org = (A && A.org_name) || c.org_name, S = res.series;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Менежер AI"; wb.created = new Date(); wb.calcProperties = { fullCalcOnLoad: true };
  const checks = [];
  const chk = (sheet, r, cc, expected, label, tol = 1) => { if (typeof expected !== "number" || !Number.isFinite(expected)) return; checks.push({ sheet, addr: `${col(cc)}${r}`, expected, label, tol }); };

  const mk = (name, widths, freeze) => {
    const ws = wb.addWorksheet(name, { views: [freeze ? { state: "frozen", xSplit: freeze[0], ySplit: freeze[1], showGridLines: false } : { showGridLines: false }] });
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } };
    ws.headerFooter = { oddFooter: `&L&8${org.replace(/&/g, "&&")} — ${Y} оны төсөв&C&8${name}&R&8&P / &N` };
    return ws;
  };
  const font = (o = {}) => ({ name: "Times New Roman", size: 11, ...o });
  const title = (ws, text, sub) => {
    ws.getCell("A1").value = text; ws.getCell("A1").font = font({ size: 14, bold: true, color: { argb: NAVY } });
    if (sub) { ws.getCell("A2").value = sub; ws.getCell("A2").font = font({ italic: true, size: 10, color: { argb: GRAY } }); }
  };
  const head = (ws, r, labels, from = 1) => { labels.forEach((t, i) => {
    const cell = ws.getCell(r, from + i); cell.value = t; cell.font = font({ bold: true, color: { argb: "FFFFFFFF" } });
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle", wrapText: true };
  }); ws.getRow(r).height = 32; };
  const section = (ws, r, text, span = 8) => {
    const cell = ws.getCell(r, 1); cell.value = text; cell.font = font({ bold: true, color: { argb: NAVY } });
    for (let i = 1; i <= span; i++) { ws.getCell(r, i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } }; ws.getCell(r, i).border = { bottom: { style: "thin", color: { argb: GOLD } } }; }
  };
  const put = (ws, r, cc, v, fmt, o = {}) => {
    const cell = ws.getCell(r, cc); cell.value = v; cell.font = font({ ...(o.bold ? { bold: true } : {}), ...(o.font || {}) });
    if (fmt) cell.numFmt = fmt;
    if (o.input) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
    if (o.total) { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL } }; cell.border = { top: { style: "thin", color: { argb: "FF999999" } } }; }
    if (o.wrap) cell.alignment = { wrapText: true, vertical: "top" };
    return cell;
  };
  const f = (ws, r, cc, formula, fmt = NUM, o = {}) => { const cell = put(ws, r, cc, { formula }, fmt, o); if (!o.left) cell.alignment = { horizontal: "right" }; return cell; };
  const note = (ws, r, text, cc = 1) => { const cell = ws.getCell(r, cc); cell.value = text; cell.font = font({ italic: true, size: 9, color: { argb: GRAY } }); };
  const monthHead = (ws, r, left, extra = []) => {
    head(ws, r, [...left, ...MN, "Жилийн дүн", ...extra]);
    MC.forEach((cc, i) => { const cell = ws.getCell(r - 1, 4 + i); cell.value = i + 1; cell.font = font({ size: 8, color: { argb: "FFA6A6A6" } }); cell.alignment = { horizontal: "center" }; });
  };
  const sumRow = (ws, r, o = {}) => f(ws, r, TOTC, `SUM(${MC[0]}${r}:${MC[11]}${r})`, o.fmt || NUM, { bold: true, total: o.total });
  const totalRow = (ws, r, label, r1, r2, o = {}) => {
    put(ws, r, 1, label, null, { bold: true, total: true }); put(ws, r, 2, null, null, { total: true }); put(ws, r, 3, null, null, { total: true });
    MC.forEach((cc, i) => f(ws, r, 4 + i, r2 >= r1 ? `SUM(${cc}${r1}:${cc}${r2})` : "0", o.fmt || NUM, { bold: true, total: true }));
    sumRow(ws, r, { total: true, fmt: o.fmt });
  };
  const chkMonths = (sheet, r, arr, label, tol = 1) => { arr.forEach((v, i) => chk(sheet, r, 4 + i, v, `${label} / ${MN[i]}`, tol)); chk(sheet, r, TOTC, arr.reduce((a, b) => a + b, 0), `${label} / жил`, tol); };
  const label = (ws, r, cc, formula, o = {}) => f(ws, r, cc, formula, null, { ...o, left: true });

  const w0 = mk(S_SUM, [46, 20, 20, 20, 20, 20]);
  const wi = mk(S_IN, [42, 16, 14, 14, 13, 12, 15, 11, ...Array(12).fill(12), 14], [1, 0]);
  const wInc = mk(S_INC, [40, 16, 10, ...Array(12).fill(13), 16], [3, 4]);
  const wPay = mk(S_PAY, [34, 16, 10, ...Array(12).fill(13), 16], [3, 4]);
  const wExp = mk(S_EXP, [40, 16, 20, ...Array(12).fill(13), 16], [3, 4]);
  const wPl = mk(S_PL, [40, 2, 2, ...Array(12).fill(13), 16, 15, 15, 15, 15], [3, 4]);
  const wD = mk(S_DEP, [24, 12, 17, 17, 17, 20, 17, 17, 10]);
  const wA = mk(S_ACT, [38, 2, 2, ...Array(12).fill(13), 16], [3, 4]);
  const wh = mk(S_HELP, [26, 100]);
  const T$ = q(S_IN);

  // ───────────── 1. ТААМАГЛАЛ (оролт) ─────────────
  title(wi, `${org} — ${Y} оны төсвийн таамаглал`, "Шар нүд = оролт. Шар нүдийг өөрчлөхөд бусад бүх хуудас автоматаар дахин тооцогдоно.");
  let r = 4; section(wi, r, "Ерөнхий үзүүлэлт", 3); r++; head(wi, r, ["Үзүүлэлт", "Утга", "Тайлбар"]); r++;
  const P = {};
  const params = [
    ["si", "Ажил олгогчийн НДШ-ийн хувь", c.si_rate, PCT, ""], ["tax", "Орлогын албан татварын хувь", c.tax_rate, PCT, c.org_type === "company" ? "" : "Төрийн байгууллага, ТББ-д ихэвчлэн 0"],
    ["cash", "Жилийн эхний мөнгөн хөрөнгө (₮)", c.opening_cash, NUM, ""], ["dep", "Одоо байгаа хөрөнгийн сарын элэгдэл (₮)", c.existing_depreciation_monthly, NUM, ""],
    ["raiseM", "Цалин нэмэгдэх сар (нэмэгдэхгүй бол 13)", c.raise ? c.raise.month : 13, "0", ""], ["raiseP", "Цалингийн нэмэгдлийн хувь", c.raise ? c.raise.pct : 0, PCT, ""],
    ["minw", "Хөдөлмөрийн хөлсний доод хэмжээ (₮)", c.min_wage || 0, NUM, "Мэдээлэл: цалинг үүнтэй тулгана"],
    ["inc", "Орлогын коэффициент (бодит = 1)", 1, DEC, "Жишээ нь 0.85 = орлого 15% буурна (шууд зардал дагана)"],
    ["cost", "Тогтмол зардлын коэффициент (бодит = 1)", 1, DEC, "Үйл ажиллагааны ба төслийн зардлыг үржүүлнэ (орлогын хувиар тооцдог зардлаас бусад)"],
  ];
  for (const [k, lbl, v, fmt, nt] of params) { put(wi, r, 1, lbl); put(wi, r, 2, v, fmt, { input: true }); if (nt) note(wi, r, nt, 3); P[k] = `${T$}$B$${r}`; r++; }

  r++; section(wi, r, "Улирлын жин (орлогыг сараар хуваах)", 21); r++;
  head(wi, r, ["Үзүүлэлт", "", "", "", "", "", "", "", ...MN, "Нийлбэр"]); r++;
  const SEAS = r;
  put(wi, r, 1, "Улирлын жин (нийлбэр 12 байхад ойлгомжтой)");
  c.seasonality.forEach((v, i) => put(wi, r, 9 + i, v, DEC, { input: true }));
  f(wi, r, 21, `SUM(I${r}:T${r})`, DEC, { bold: true }); r++;
  note(wi, r, "Жилийн дүнг сараар хуваахдаа: сарын дүн = жилийн дүн × тухайн сарын жин ÷ жингийн нийлбэр."); r++;

  r++; section(wi, r, `${L.income_src}`, 21); r++;
  head(wi, r, [L.income_src, "Нэгж", "Төрөл", "Нэгжийн үнэ (₮)", "Нэгжийн өртөг (₮)", "Шууд зардлын хувь", "Жилийн тоо / дүн", "Хэмжих нэгж", ...MN, "Нийлбэр"]); wi.getRow(r).height = 44; r++;
  const INC0 = r;
  const incomeIn = c.income.length ? c.income : [{ name: "(орлого оруулаагүй)", dept: "Нийтлэг", kind: "amount", price: 1, unit_cost: 0, cost_pct: 0, annual: 0, monthly: null, seasonality: null, unit: "" }];
  for (const ln of incomeIn) {
    const sales = ln.kind === "sales";
    put(wi, r, 1, ln.name, null, { input: true }); put(wi, r, 2, ln.dept, null, { input: true }); put(wi, r, 3, sales ? "Тоо × үнэ" : "Дүн");
    put(wi, r, 4, sales ? ln.price : 1, NUM, { input: sales }); put(wi, r, 5, sales ? ln.unit_cost : 0, NUM, { input: sales }); put(wi, r, 6, ln.cost_pct, PCT, { input: true });
    put(wi, r, 7, ln.monthly ? null : ln.annual, NUM, { input: true }); put(wi, r, 8, sales ? (ln.unit || "нэгж") : "₮");
    IC.forEach((cc, i) => {
      if (ln.monthly) put(wi, r, 9 + i, ln.monthly[i], sales ? "#,##0.##" : NUM, { input: true });
      else if (ln.seasonality) put(wi, r, 9 + i, ln.seasonality[i], DEC, { input: true });
      else f(wi, r, 9 + i, `${cc}$${SEAS}`, DEC);
    });
    f(wi, r, 21, `SUM(I${r}:T${r})`, ln.monthly ? NUM : DEC, { bold: true }); r++;
  }
  const INC1 = r - 1;
  note(wi, r, "«Жилийн тоо / дүн» бөглөсөн бол I–T баганад жин (хуваарь) байна. Хоосон бол I–T баганад сар бүрийн тоо хэмжээ (эсвэл дүн)-г шууд оруулна."); r++;

  r++; section(wi, r, "Орон тоо, цалин", 7); r++;
  head(wi, r, ["Албан тушаал", "Нэгж", "Орон тоо", "Сарын үндсэн цалин (₮)", "Эхлэх сар", "Дуусах сар", "Шинэ орон тоо (1/0)"]); wi.getRow(r).height = 44; r++;
  const ST0 = r;
  const staffIn = c.staff.length ? c.staff : [{ title: "(орон тоо оруулаагүй)", dept: "Нийтлэг", count: 0, gross: 0, start: 1, end: 12, new: false }];
  for (const s of staffIn) {
    put(wi, r, 1, s.title, null, { input: true }); put(wi, r, 2, s.dept, null, { input: true }); put(wi, r, 3, s.count, "0.##", { input: true });
    put(wi, r, 4, s.gross, NUM, { input: true }); put(wi, r, 5, s.start, "0", { input: true }); put(wi, r, 6, s.end, "0", { input: true }); put(wi, r, 7, s.new ? 1 : 0, "0", { input: true }); r++;
  }
  const ST1 = r - 1;

  r++; section(wi, r, "Үйл ажиллагааны зардал", 21); r++;
  head(wi, r, ["Зардал", "Нэгж", "Бүлэг", "Тооцох арга", "Орлогын хувь", "", "", "", ...MN, "Нийлбэр"]); r++;
  const EX0 = r;
  const expIn = c.expenses.length ? c.expenses : [{ name: "(зардал оруулаагүй)", dept: "Нийтлэг", group: "Үйл ажиллагааны зардал", mode: "monthly", pct_of_income: null, m: Array(12).fill(0) }];
  const MODE = { pct_of_income: "Орлогын хувиар", by_month: "Сар бүрээр", monthly: "Сар бүр ижил", annual: "Жилийн дүн ÷ 12" };
  for (const e of expIn) {
    const isP = e.pct_of_income !== null;
    put(wi, r, 1, e.name, null, { input: true }); put(wi, r, 2, e.dept, null, { input: true }); put(wi, r, 3, e.group, null, { input: true }); put(wi, r, 4, MODE[e.mode]);
    put(wi, r, 5, isP ? e.pct_of_income : null, PCT, { input: true });
    IC.forEach((cc, i) => put(wi, r, 9 + i, isP ? null : e.m[i], NUM, { input: !isP }));
    f(wi, r, 21, `SUM(I${r}:T${r})`, NUM, { bold: true }); r++;
  }
  const EX1 = r - 1;
  note(wi, r, "«Орлогын хувь» бөглөсөн мөрийн зардал = тухайн сарын нийт орлого × хувь (I–T баганын тоог үл тооцно). Хоосон бол I–T баганын сарын дүнг авна."); r++;

  r++; section(wi, r, "Төсөл, хөтөлбөр, санаачилга", 9); r++;
  head(wi, r, ["Төсөл, хөтөлбөр", "Нэгж", "Хариуцагч", "Эхлэх сар", "Дуусах сар", "Төсөв (₮)", "Хөрөнгө оруулалт (1/0)", "Ашиглах жил", "Хэмжих үзүүлэлт"]); wi.getRow(r).height = 44; r++;
  const IN0 = r;
  const initIn = c.initiatives.length ? c.initiatives : [{ name: "(төсөл оруулаагүй)", dept: "Нийтлэг", owner: "", start: 1, end: 12, budget: 0, capex: false, life_years: 5, kpi: "" }];
  for (const it of initIn) {
    put(wi, r, 1, it.name, null, { input: true }); put(wi, r, 2, it.dept, null, { input: true }); put(wi, r, 3, it.owner || "", null, { input: true });
    put(wi, r, 4, it.start, "0", { input: true }); put(wi, r, 5, it.end, "0", { input: true }); put(wi, r, 6, it.budget, NUM, { input: true });
    put(wi, r, 7, it.capex ? 1 : 0, "0", { input: true }); put(wi, r, 8, it.life_years, "0.#", { input: true }); put(wi, r, 9, it.kpi || "", null, { input: true }); r++;
  }
  const IN1 = r - 1;
  note(wi, r, "Хөрөнгө оруулалт = 1 бол төсөв эхлэх сард нэг удаа хөрөнгө оруулалт болж гарна, элэгдэл дараа сараас. 0 бол төсөв эхлэх–дуусах сард тэнцүү хуваагдаж зардалд орно."); r++;

  r++; section(wi, r, "Бусад хөрөнгө оруулалт", 5); r++;
  head(wi, r, ["Хөрөнгө оруулалт", "Нэгж", "Сар", "Дүн (₮)", "Ашиглах жил"]); r++;
  const CX0 = r;
  const capIn = c.capex.length ? c.capex : [{ name: "(хөрөнгө оруулалтгүй)", dept: "Нийтлэг", month: 1, amount: 0, life_years: 5 }];
  for (const x of capIn) {
    put(wi, r, 1, x.name, null, { input: true }); put(wi, r, 2, x.dept, null, { input: true }); put(wi, r, 3, x.month, "0", { input: true });
    put(wi, r, 4, x.amount, NUM, { input: true }); put(wi, r, 5, x.life_years, "0.#", { input: true }); r++;
  }
  const CX1 = r - 1;

  r++; section(wi, r, "Зээл", 5); r++;
  head(wi, r, ["Зээл", "Сарын үндсэн төлбөр (₮)", "Сарын хүү (₮)", "Эхлэх сар", "Дуусах сар"]); r++;
  const LO0 = r;
  const loanIn = c.loans.length ? c.loans : [{ name: "(зээлгүй)", monthly_principal: 0, monthly_interest: 0, start: 1, end: 12 }];
  for (const l of loanIn) {
    put(wi, r, 1, l.name, null, { input: true }); put(wi, r, 2, l.monthly_principal, NUM, { input: true }); put(wi, r, 3, l.monthly_interest, NUM, { input: true });
    put(wi, r, 4, l.start, "0", { input: true }); put(wi, r, 5, l.end, "0", { input: true }); r++;
  }
  const LO1 = r - 1;
  note(wi, r, "Шинэ зээлийн орлогыг загвар тооцохгүй: шаардлагатай бол «Жилийн эхний мөнгөн хөрөнгө»-д нэмнэ.");
  const Tr = (cc, row) => `${T$}$${cc}$${row}`, Trng = (cc, a, b) => `${T$}$${cc}$${a}:$${cc}$${b}`;

  // ───────────── 2. ОРЛОГО ─────────────
  title(wInc, `${L.income} — ${Y} он`, "Бүх нүд томьёо — «Таамаглал» хуудаснаас тооцогдоно.");
  monthHead(wInc, 4, ["Тоо хэмжээ / дүн", "Нэгж", "Хэмжих нэгж"]);
  r = 5; const Q0 = r;
  incomeIn.forEach((ln, k) => {
    const t = INC0 + k;
    label(wInc, r, 1, `${T$}A${t}`); label(wInc, r, 2, `${T$}B${t}`); label(wInc, r, 3, `${T$}H${t}`);
    MC.forEach((cc, i) => f(wInc, r, 4 + i, `IF(${Tr("G", t)}="",${T$}${IC[i]}${t},IF(${Tr("U", t)}=0,0,${Tr("G", t)}*${T$}${IC[i]}${t}/${Tr("U", t)}))*${P.inc}`, ln.kind === "sales" ? QTY : NUM));
    sumRow(wInc, r, { fmt: ln.kind === "sales" ? QTY : NUM });
    if (res.lines.income[k]) chkMonths(S_INC, r, res.lines.income[k].qty, `${ln.name} тоо`, 0.01);
    r++;
  });
  r += 2; monthHead(wInc, r, [`${L.income} (₮)`, "Нэгж", ""]); r++;
  const RV0 = r;
  incomeIn.forEach((ln, k) => {
    const t = INC0 + k, qr = Q0 + k;
    label(wInc, r, 1, `${T$}A${t}`); label(wInc, r, 2, `${T$}B${t}`);
    MC.forEach((cc, i) => f(wInc, r, 4 + i, `${cc}${qr}*${Tr("D", t)}`));
    sumRow(wInc, r);
    if (res.lines.income[k]) chkMonths(S_INC, r, res.lines.income[k].income, `${ln.name} орлого`);
    r++;
  });
  const RV1 = r - 1, INC_T = r; totalRow(wInc, r, "Нийт", RV0, RV1); chkMonths(S_INC, r, S.income, "Нийт орлого"); r++;
  r += 2; monthHead(wInc, r, [`${L.direct} (₮)`, "Нэгж", ""]); r++;
  const DR0 = r;
  incomeIn.forEach((ln, k) => {
    const t = INC0 + k, qr = Q0 + k, rv = RV0 + k;
    label(wInc, r, 1, `${T$}A${t}`); label(wInc, r, 2, `${T$}B${t}`);
    MC.forEach((cc, i) => f(wInc, r, 4 + i, `${cc}${qr}*${Tr("E", t)}+${cc}${rv}*${Tr("F", t)}`));
    sumRow(wInc, r);
    if (res.lines.income[k]) chkMonths(S_INC, r, res.lines.income[k].direct, `${ln.name} шууд зардал`);
    r++;
  });
  const DR1 = r - 1, DIR_T = r; totalRow(wInc, r, "Нийт", DR0, DR1); chkMonths(S_INC, r, S.direct, "Нийт шууд зардал");
  note(wInc, r + 2, "Шууд зардал = тоо хэмжээ × нэгжийн өртөг + орлого × шууд зардлын хувь.");

  // ───────────── 3. ЦАЛИН ─────────────
  title(wPay, `Орон тоо, цалин — ${Y} он`, "Бүх нүд томьёо. Цалинг «Таамаглал» хуудасны орон тоо, цалин, эхлэх/дуусах сар, нэмэгдлээр тооцно.");
  monthHead(wPay, 4, ["Албан тушаал", "Нэгж", "Орон тоо"]);
  r = 5; const SP0 = r;
  staffIn.forEach((s, k) => {
    const t = ST0 + k;
    label(wPay, r, 1, `${T$}A${t}`); label(wPay, r, 2, `${T$}B${t}`); f(wPay, r, 3, `${T$}C${t}`, "0.##");
    MC.forEach((cc, i) => f(wPay, r, 4 + i, `IF(AND(${cc}$3>=${Tr("E", t)},${cc}$3<=${Tr("F", t)}),${Tr("C", t)}*${Tr("D", t)}*IF(${cc}$3>=${P.raiseM},1+${P.raiseP},1),0)`));
    sumRow(wPay, r);
    if (res.lines.staff[k]) chk(S_PAY, r, TOTC, res.lines.staff[k].total, `${s.title} жилийн цалин`);
    r++;
  });
  const SP1 = r - 1, PAY_T = r; totalRow(wPay, r, "Үндсэн цалин (нийт)", SP0, SP1); chkMonths(S_PAY, r, S.payroll, "Цалин"); r++;
  const SI_R = r; put(wPay, r, 1, "Ажил олгогчийн НДШ", null, { bold: true });
  MC.forEach((cc, i) => f(wPay, r, 4 + i, `${cc}${PAY_T}*${P.si}`)); sumRow(wPay, r); chkMonths(S_PAY, r, S.si, "НДШ"); r++;
  const PS_R = r; put(wPay, r, 1, "Цалин + НДШ", null, { bold: true, total: true });
  MC.forEach((cc, i) => f(wPay, r, 4 + i, `${cc}${PAY_T}+${cc}${SI_R}`, NUM, { bold: true, total: true })); sumRow(wPay, r, { total: true }); r++;
  const HC_R = r; put(wPay, r, 1, "Орон тоо (тухайн сард)", null, { bold: true });
  MC.forEach((cc, i) => f(wPay, r, 4 + i, `SUMPRODUCT((${Trng("E", ST0, ST1)}<=${cc}$3)*(${Trng("F", ST0, ST1)}>=${cc}$3)*${Trng("C", ST0, ST1)})`, "0.##"));
  f(wPay, r, TOTC, `SUM(${MC[0]}${r}:${MC[11]}${r})/12`, "0.0", { bold: true });
  S.headcount.forEach((v, i) => chk(S_PAY, r, 4 + i, v, `Орон тоо / ${MN[i]}`, 0.001)); chk(S_PAY, r, TOTC, res.totals.headcount_avg, "Дундаж орон тоо", 0.001);
  note(wPay, r + 2, "«Орон тоо» мөрийн жилийн баганад дундаж орон тоо. Цалингийн нэмэгдэл «Таамаглал» хуудсанд заасан сараас бүх ажилтанд үйлчилнэ.");

  // ───────────── 4. ЗАРДАЛ ─────────────
  title(wExp, `Үйл ажиллагааны зардал, хөрөнгө оруулалт — ${Y} он`, "Бүх нүд томьёо — «Таамаглал» хуудаснаас тооцогдоно.");
  monthHead(wExp, 4, ["Зардал", "Нэгж", "Бүлэг"]);
  r = 5; const E0 = r;
  expIn.forEach((e, k) => {
    const t = EX0 + k;
    label(wExp, r, 1, `${T$}A${t}`); label(wExp, r, 2, `${T$}B${t}`); label(wExp, r, 3, `${T$}C${t}`);
    MC.forEach((cc, i) => f(wExp, r, 4 + i, `IF(${Tr("E", t)}="",${T$}${IC[i]}${t}*${P.cost},${Tr("E", t)}*'${S_INC}'!${cc}$${INC_T})`));
    sumRow(wExp, r);
    if (res.lines.expenses[k]) chkMonths(S_EXP, r, res.lines.expenses[k].monthly, e.name);
    r++;
  });
  const E1 = r - 1, I0 = r;
  initIn.forEach((it, k) => {
    const t = IN0 + k;
    label(wExp, r, 1, `"Төсөл: "&${T$}A${t}`); label(wExp, r, 2, `${T$}B${t}`); put(wExp, r, 3, INIT_GROUP);
    MC.forEach((cc, i) => f(wExp, r, 4 + i, `IF(AND(${Tr("G", t)}<>1,${cc}$3>=${Tr("D", t)},${cc}$3<=${Tr("E", t)}),${Tr("F", t)}/(${Tr("E", t)}-${Tr("D", t)}+1),0)*${P.cost}`));
    sumRow(wExp, r);
    if (res.lines.initiatives[k]) chkMonths(S_EXP, r, res.lines.initiatives[k].monthly, `Төсөл ${it.name}`);
    r++;
  });
  const I1 = r - 1;
  const OPEX_T = r; totalRow(wExp, r, "Үйл ажиллагааны зардал", E0, E1); chkMonths(S_EXP, r, S.opex, "Үйл ажиллагааны зардал"); r++;
  const INIT_T = r; totalRow(wExp, r, "Төсөл, хөтөлбөрийн зардал", I0, I1); chkMonths(S_EXP, r, S.initiative_opex, "Төслийн зардал"); r++;
  const ALL_T = r; totalRow(wExp, r, "Нийт зардал (үйл ажиллагаа + төсөл)", E0, I1); r++;
  const VAR_R = r; put(wExp, r, 1, "Үүнээс орлогын хувиар тооцсон (хувьсах)");
  MC.forEach((cc, i) => f(wExp, r, 4 + i, `SUMPRODUCT((${Trng("E", EX0, EX1)}<>"")*${cc}$${E0}:${cc}$${E1})`)); sumRow(wExp, r); chkMonths(S_EXP, r, S.var_opex, "Хувьсах зардал"); r++;

  r += 2; monthHead(wExp, r, ["Зардлын бүлэг", "", ""]); r++;
  const groupNames = Object.keys(res.groups);
  for (const g of expIn.map((e) => e.group).concat(initIn.length ? [INIT_GROUP] : [])) if (!groupNames.includes(g)) groupNames.push(g);
  const G0 = r;
  for (const g of groupNames) {
    put(wExp, r, 1, g);
    MC.forEach((cc, i) => f(wExp, r, 4 + i, `SUMIF($C$${E0}:$C$${I1},$A${r},${cc}$${E0}:${cc}$${I1})`));
    sumRow(wExp, r);
    if (res.groups[g]) chkMonths(S_EXP, r, res.groups[g].monthly, `Бүлэг ${g}`);
    r++;
  }
  totalRow(wExp, r, "Нийт", G0, r - 1); r++;

  r += 2; monthHead(wExp, r, ["Хөрөнгө оруулалт (₮)", "Нэгж", "Сар"]); r++;
  const C0 = r, capRows = [];
  initIn.forEach((it, k) => {
    const t = IN0 + k;
    label(wExp, r, 1, `${T$}A${t}`); label(wExp, r, 2, `${T$}B${t}`); f(wExp, r, 3, `${T$}D${t}`, "0");
    MC.forEach((cc, i) => f(wExp, r, 4 + i, `IF(AND(${Tr("G", t)}=1,${cc}$3=${Tr("D", t)}),${Tr("F", t)},0)`));
    sumRow(wExp, r); capRows.push({ r, kind: "init", t }); r++;
  });
  capIn.forEach((x, k) => {
    const t = CX0 + k;
    label(wExp, r, 1, `${T$}A${t}`); label(wExp, r, 2, `${T$}B${t}`); f(wExp, r, 3, `${T$}C${t}`, "0");
    MC.forEach((cc, i) => f(wExp, r, 4 + i, `IF(${cc}$3=${Tr("C", t)},${Tr("D", t)},0)`));
    sumRow(wExp, r); capRows.push({ r, kind: "cap", t }); r++;
  });
  const C1 = r - 1, CAP_T = r; totalRow(wExp, r, "Нийт хөрөнгө оруулалт", C0, C1); chkMonths(S_EXP, r, S.capex, "Хөрөнгө оруулалт"); r++;
  r += 2; monthHead(wExp, r, ["Элэгдэл (₮)", "", ""]); r++;
  const D0 = r;
  for (const x of capRows) {
    label(wExp, r, 1, `A${x.r}`);
    MC.forEach((cc, i) => f(wExp, r, 4 + i, x.kind === "init"
      ? `IF(AND(${Tr("G", x.t)}=1,${cc}$3>${Tr("D", x.t)}),${Tr("F", x.t)}/${Tr("H", x.t)}/12,0)`
      : `IF(${cc}$3>${Tr("C", x.t)},${Tr("D", x.t)}/${Tr("E", x.t)}/12,0)`));
    sumRow(wExp, r); r++;
  }
  put(wExp, r, 1, "Одоо байгаа хөрөнгийн элэгдэл"); MC.forEach((cc, i) => f(wExp, r, 4 + i, `${P.dep}`)); sumRow(wExp, r); r++;
  const DEP_T = r; totalRow(wExp, r, "Нийт элэгдэл", D0, r - 1); chkMonths(S_EXP, r, S.depreciation, "Элэгдэл");
  note(wExp, r + 2, "Элэгдлийг худалдан авсны дараа сараас шулуун шугамаар тооцно. Элэгдэл ашигт нөлөөлнө, мөнгөн урсгалд нөлөөлөхгүй.");

  // ───────────── 5. НЭГТГЭЛ (орлого-зардал ба мөнгөн урсгал) ─────────────
  title(wPl, `${org} — ${Y} оны нэгтгэсэн төсөв ба мөнгөн урсгал`, "Бүх мөр бусад хуудаснаас томьёогоор бодогдоно. Энэ хуудсанд гараар тоо оруулахгүй.");
  monthHead(wPl, 4, ["Үзүүлэлт (₮)", "", ""], ["I улирал", "II улирал", "III улирал", "IV улирал"]);
  const plRows = [["income", L.income, true], ["direct", L.direct], ["gross", L.gross, true], ["payroll", "Цалин"], ["si", "Ажил олгогчийн НДШ"], ["opex", "Үйл ажиллагааны зардал"],
    ["initiative_opex", "Төсөл, хөтөлбөрийн зардал"], ["depreciation", "Элэгдэл"], ["op", L.op, true], ["interest", "Зээлийн хүү"], ["ebt", L.pre, true], ["tax", "Орлогын албан татвар"], ["net", L.result, true]];
  const RW = {}; plRows.forEach(([k], i) => { RW[k] = 5 + i; });
  const loanSP = (cc, field) => `SUMPRODUCT((${Trng("D", LO0, LO1)}<=${cc}$3)*(${Trng("E", LO0, LO1)}>=${cc}$3)*${Trng(field, LO0, LO1)})`;
  for (const [k, lbl, bold] of plRows) {
    const rr = RW[k]; put(wPl, rr, 1, lbl, null, { bold, total: bold });
    MC.forEach((cc, i) => {
      const fm = {
        income: `'${S_INC}'!${cc}${INC_T}`, direct: `'${S_INC}'!${cc}${DIR_T}`, gross: `${cc}${RW.income}-${cc}${RW.direct}`, payroll: `'${S_PAY}'!${cc}${PAY_T}`, si: `'${S_PAY}'!${cc}${SI_R}`,
        opex: `'${S_EXP}'!${cc}${OPEX_T}`, initiative_opex: `'${S_EXP}'!${cc}${INIT_T}`, depreciation: `'${S_EXP}'!${cc}${DEP_T}`,
        op: `${cc}${RW.gross}-${cc}${RW.payroll}-${cc}${RW.si}-${cc}${RW.opex}-${cc}${RW.initiative_opex}-${cc}${RW.depreciation}`,
        interest: loanSP(cc, "C"), ebt: `${cc}${RW.op}-${cc}${RW.interest}`,
        tax: `MAX(0,SUM($D${RW.ebt}:${cc}${RW.ebt}))*${P.tax}` + (i ? `-SUM($D${RW.tax}:${MC[i - 1]}${RW.tax})` : ""), net: `${cc}${RW.ebt}-${cc}${RW.tax}`,
      }[k];
      f(wPl, rr, 4 + i, fm, NUM, { bold, total: bold });
    });
    sumRow(wPl, rr, { total: bold });
    for (let qq = 0; qq < 4; qq++) f(wPl, rr, 17 + qq, `SUM(${MC[qq * 3]}${rr}:${MC[qq * 3 + 2]}${rr})`, NUM, { bold, total: bold });
    chkMonths(S_PL, rr, S[k], lbl);
  }
  r = RW.net + 3;
  section(wPl, r, "Мөнгөн урсгал", 16); r++;
  monthHead(wPl, r + 1, ["Үзүүлэлт (₮)", "", ""]); r += 2;
  const cfRows = [["open", "Эхний үлдэгдэл", true], ["in", "Мөнгөн орлого", true], ["direct", L.direct], ["payroll", "Цалин"], ["si", "Ажил олгогчийн НДШ"], ["opex", "Үйл ажиллагааны зардал"],
    ["initiative_opex", "Төсөл, хөтөлбөрийн зардал"], ["interest", "Зээлийн хүү"], ["tax", "Орлогын албан татвар"], ["capex", "Хөрөнгө оруулалт"], ["principal", "Зээлийн үндсэн төлбөр"],
    ["out", "Нийт мөнгөн зарлага", true], ["close", "Эцсийн үлдэгдэл", true]];
  const CR = {}; cfRows.forEach(([k], i) => { CR[k] = r + i; });
  for (const [k, lbl, bold] of cfRows) {
    const rr = CR[k]; put(wPl, rr, 1, lbl, null, { bold, total: bold });
    MC.forEach((cc, i) => {
      const fm = {
        open: i === 0 ? P.cash : `${MC[i - 1]}${CR.close}`, in: `${cc}${RW.income}`, direct: `${cc}${RW.direct}`, payroll: `${cc}${RW.payroll}`, si: `${cc}${RW.si}`, opex: `${cc}${RW.opex}`,
        initiative_opex: `${cc}${RW.initiative_opex}`, interest: `${cc}${RW.interest}`, tax: `${cc}${RW.tax}`, capex: `'${S_EXP}'!${cc}${CAP_T}`, principal: loanSP(cc, "B"),
        out: `SUM(${cc}${CR.direct}:${cc}${CR.principal})`, close: `${cc}${CR.open}+${cc}${CR.in}-${cc}${CR.out}`,
      }[k];
      f(wPl, rr, 4 + i, fm, NUM, { bold, total: bold });
    });
    if (k === "open") f(wPl, rr, TOTC, `D${rr}`, NUM, { bold: true, total: true });
    else if (k === "close") f(wPl, rr, TOTC, `O${rr}`, NUM, { bold: true, total: true });
    else sumRow(wPl, rr, { total: bold });
  }
  chkMonths(S_PL, CR.out, S.cash_out, "Мөнгөн зарлага"); chkMonths(S_PL, CR.principal, S.loan_principal, "Зээлийн үндсэн төлбөр");
  S.cash.forEach((v, i) => chk(S_PL, CR.close, 4 + i, v, `Мөнгөн үлдэгдэл / ${MN[i]}`)); chk(S_PL, CR.close, TOTC, res.totals.closing_cash, "Жилийн эцсийн мөнгө");
  S.cash_open.forEach((v, i) => chk(S_PL, CR.open, 4 + i, v, `Эхний үлдэгдэл / ${MN[i]}`));
  note(wPl, CR.close + 2, "Орлого, зардал тухайн сардаа мөнгөөр орж гарна гэж тооцов (авлага, өглөг, нөөцийн хөдөлгөөн ороогүй). Татварыг жилийн өссөн дүнгээр сар бүр хуримтлуулна: алдагдалтай сард хасах тэмдэгтэй гарч болно.");
  const PL = (k, cc = TOT) => `'${S_PL}'!$${cc}$${RW[k]}`;

  // ───────────── 6. ХЭЛТСЭЭР ─────────────
  title(wD, `Нэгж, хэлтсийн төсөв — ${Y} он`, "Нэгжийн нэр «Таамаглал» хуудасны «Нэгж» баганатай яг ижил бичигдсэн байх ёстой.");
  head(wD, 4, ["Нэгж", "Орон тоо (жилийн эцэст)", "Орлого (₮)", "Шууд зардал (₮)", "Цалин + НДШ (₮)", "Үйл ажиллагааны ба төслийн зардал (₮)", "Хөрөнгө оруулалт (₮)", "Нийт төсөв (₮)", "Хувь"]); wD.getRow(4).height = 44;
  const depts = res.depts.length ? res.depts.slice() : ["Нийтлэг"];
  const N0 = 5, NT = N0 + depts.length;
  depts.forEach((d, k) => {
    const rr = N0 + k; put(wD, rr, 1, d);
    f(wD, rr, 2, `SUMPRODUCT((${Trng("B", ST0, ST1)}=A${rr})*(${Trng("F", ST0, ST1)}>=12)*${Trng("C", ST0, ST1)})`, "0.##");
    f(wD, rr, 3, `SUMIF('${S_INC}'!$B$${RV0}:$B$${RV1},A${rr},'${S_INC}'!$${TOT}$${RV0}:$${TOT}$${RV1})`);
    f(wD, rr, 4, `SUMIF('${S_INC}'!$B$${DR0}:$B$${DR1},A${rr},'${S_INC}'!$${TOT}$${DR0}:$${TOT}$${DR1})`);
    f(wD, rr, 5, `SUMIF('${S_PAY}'!$B$${SP0}:$B$${SP1},A${rr},'${S_PAY}'!$${TOT}$${SP0}:$${TOT}$${SP1})*(1+${P.si})`);
    f(wD, rr, 6, `SUMIF('${S_EXP}'!$B$${E0}:$B$${I1},A${rr},'${S_EXP}'!$${TOT}$${E0}:$${TOT}$${I1})`);
    f(wD, rr, 7, `SUMIF('${S_EXP}'!$B$${C0}:$B$${C1},A${rr},'${S_EXP}'!$${TOT}$${C0}:$${TOT}$${C1})`);
    f(wD, rr, 8, `D${rr}+E${rr}+F${rr}+G${rr}`, NUM, { bold: true });
    f(wD, rr, 9, `IF($H$${NT}=0,0,H${rr}/$H$${NT})`, PCT);
    const x = res.by_dept[d]; if (!x) return;
    [[2, x.headcount], [3, x.income], [4, x.direct], [5, x.payroll], [6, x.opex], [7, x.capex], [8, x.cost]].forEach(([cc, v]) => chk(S_DEP, rr, cc, v, `${d} / ${cc}`));
  });
  put(wD, NT, 1, "Нийт", null, { bold: true, total: true });
  for (let cc = 2; cc <= 8; cc++) f(wD, NT, cc, `SUM(${col(cc)}${N0}:${col(cc)}${NT - 1})`, cc === 2 ? "0.##" : NUM, { bold: true, total: true });
  f(wD, NT, 9, `IF(H${NT}=0,0,1)`, PCT, { bold: true, total: true });
  note(wD, NT + 2, "Нийт төсөв = шууд зардал + цалин, НДШ + үйл ажиллагааны ба төслийн зардал + хөрөнгө оруулалт. Элэгдэл, хүү, татвар байгууллагын түвшинд тооцогдоно.");

  // ───────────── 7. ГҮЙЦЭТГЭЛ ─────────────
  title(wA, `Төлөвлөгөө ба гүйцэтгэл — ${Y} он`, "Сар дуусах бүрд «Гүйцэтгэл» мөрийн шар нүдэнд бодит дүнгээ оруулна. Зөрүү, биелэлтийн хувь, өссөн дүн автоматаар гарна.");
  monthHead(wA, 4, ["Үзүүлэлт (₮)", "", ""]); wA.getCell(4, TOTC).value = "Өссөн дүн";
  const items = [[L.income, (cc) => `'${S_PL}'!${cc}${RW.income}`, true]];
  if (res.totals.direct) items.push([L.direct, (cc) => `'${S_PL}'!${cc}${RW.direct}`, true]);
  items.push(["Цалин + НДШ", (cc) => `'${S_PAY}'!${cc}${PS_R}`, true], ["Үйл ажиллагааны ба төслийн зардал", (cc) => `'${S_EXP}'!${cc}${ALL_T}`, true],
    ["Хөрөнгө оруулалт", (cc) => `'${S_EXP}'!${cc}${CAP_T}`, true], [L.result, (cc) => `'${S_PL}'!${cc}${RW.net}`, true], ["Мөнгөн хөрөнгийн эцсийн үлдэгдэл", (cc) => `'${S_PL}'!${cc}${CR.close}`, false]);
  r = 5;
  for (const [lbl, fn, cum] of items) {
    put(wA, r, 1, lbl, null, { bold: true, total: true }); for (let cc = 2; cc <= TOTC; cc++) put(wA, r, cc, null, null, { total: true });
    [["  Төлөвлөгөө", 1], ["  Гүйцэтгэл", 2], ["  Зөрүү (гүйцэтгэл − төлөвлөгөө)", 3], ["  Биелэлт", 4]].forEach(([t, o]) => put(wA, r + o, 1, t));
    MC.forEach((cc, i) => {
      f(wA, r + 1, 4 + i, fn(cc)); put(wA, r + 2, 4 + i, null, NUM, { input: true });
      f(wA, r + 3, 4 + i, `IF(${cc}${r + 2}="","",${cc}${r + 2}-${cc}${r + 1})`);
      f(wA, r + 4, 4 + i, `IF(OR(${cc}${r + 2}="",${cc}${r + 1}=0),"",${cc}${r + 2}/${cc}${r + 1})`, PCT);
    });
    if (cum) {
      f(wA, r + 1, TOTC, `SUMPRODUCT((D${r + 2}:O${r + 2}<>"")*D${r + 1}:O${r + 1})`, NUM, { bold: true });
      f(wA, r + 2, TOTC, `SUM(D${r + 2}:O${r + 2})`, NUM, { bold: true });
      f(wA, r + 3, TOTC, `P${r + 2}-P${r + 1}`, NUM, { bold: true });
      f(wA, r + 4, TOTC, `IF(P${r + 1}=0,"",P${r + 2}/P${r + 1})`, PCT, { bold: true });
    }
    r += 6;
  }
  note(wA, r, "«Өссөн дүн» баганын төлөвлөгөө нь зөвхөн гүйцэтгэл оруулсан саруудын төлөвлөгөөний нийлбэр. Зардлын мөрөнд зөрүү эерэг бол хэтрэлт.");

  // ───────────── 8. ХУРААНГУЙ ─────────────
  title(w0, `${org} — ${Y} оны төсвийн хураангуй`, "Гол үзүүлэлтүүд бусад хуудаснаас томьёогоор бодогдоно.");
  r = 4; section(w0, r, "Гол үзүүлэлт", 3); r++; head(w0, r, ["Үзүүлэлт", "Утга", "Тайлбар"]); r++;
  const K = {};
  const kpi = (key, lbl, formula, fmt, nt, exp, tol = 1) => { put(w0, r, 1, lbl); f(w0, r, 2, formula, fmt); put(w0, r, 3, nt || "").font = font({ size: 9, color: { argb: GRAY } }); K[key] = `$B$${r}`; chk(S_SUM, r, 2, exp, lbl, tol); r++; };
  const Tt = res.totals, KP = res.kpis;
  kpi("inc", L.income + " (₮)", PL("income"), NUM, "", Tt.income);
  kpi("dir", L.direct + " (₮)", PL("direct"), NUM, "", Tt.direct);
  kpi("pay", "Цалин + НДШ (₮)", `${PL("payroll")}+${PL("si")}`, NUM, "", Tt.payroll_total);
  kpi("opx", "Үйл ажиллагааны зардал (₮)", PL("opex"), NUM, "", Tt.opex);
  kpi("ini", "Төсөл, хөтөлбөрийн зардал (₮)", PL("initiative_opex"), NUM, "", Tt.initiative_opex);
  kpi("dep", "Элэгдэл (₮)", PL("depreciation"), NUM, "", Tt.depreciation);
  kpi("int", "Зээлийн хүү (₮)", PL("interest"), NUM, "", Tt.interest);
  kpi("tax", "Орлогын албан татвар (₮)", PL("tax"), NUM, "", Tt.tax);
  kpi("cost", "Нийт зардал (₮)", `${K.dir}+${K.pay}+${K.opx}+${K.ini}+${K.dep}+${K.int}+${K.tax}`, NUM, "Хөрөнгө оруулалт, зээлийн үндсэн төлбөрөөс бусад", Tt.total_cost);
  kpi("net", L.result + " (₮)", PL("net"), NUM, "", Tt.net);
  kpi("nm", L.margin, `IF(${K.inc}=0,"—",${K.net}/${K.inc})`, PCT, "", KP.net_margin ?? undefined, 0.0005);
  kpi("gm", "Шууд зардлын дараах ашгийн хувь", `IF(${K.inc}=0,"—",(${K.inc}-${K.dir})/${K.inc})`, PCT, "", KP.gross_margin ?? undefined, 0.0005);
  kpi("ps", "Цалин, НДШ-ийн орлогод эзлэх хувь", `IF(${K.inc}=0,"—",${K.pay}/${K.inc})`, PCT, "", KP.payroll_share ?? undefined, 0.0005);
  kpi("ips", "Нэг ажилтанд ногдох орлого (₮)", `IF('${S_PAY}'!$${TOT}$${HC_R}=0,"—",${K.inc}/'${S_PAY}'!$${TOT}$${HC_R})`, NUM, "Жилийн дүн ÷ дундаж орон тоо", KP.income_per_staff ?? undefined);
  const varE = `'${S_EXP}'!$${TOT}$${VAR_R}`;
  const fixedF = `(${K.pay}+${K.opx}-${varE}+${K.ini}+${K.dep}+${K.int})`, varP = `((${K.dir}+${varE})/${K.inc})`;
  kpi("bep", "Алдагдалгүй ажиллах орлого (₮)", `IF(${K.inc}=0,"—",IF(${varP}>=1,"—",${fixedF}/(1-${varP})))`, NUM, "Тогтмол зардал ÷ (1 − хувьсах зардлын хувь)", KP.bep_any ?? undefined);
  kpi("cap", "Хөрөнгө оруулалт (₮)", `'${S_EXP}'!$${TOT}$${CAP_T}`, NUM, "", Tt.capex);
  kpi("open", "Жилийн эхний мөнгөн үлдэгдэл (₮)", P.cash, NUM, "", c.opening_cash);
  kpi("close", "Жилийн эцсийн мөнгөн үлдэгдэл (₮)", `'${S_PL}'!$O$${CR.close}`, NUM, "", Tt.closing_cash);
  kpi("min", "Хамгийн бага мөнгөн үлдэгдэл (₮)", `MIN('${S_PL}'!$D$${CR.close}:$O$${CR.close})`, NUM, `Тооцоогоор ${KP.min_cash_label}ын эцэст`, Tt.min_cash);
  kpi("hc0", "Орон тоо (1-р сар)", `'${S_PAY}'!$D$${HC_R}`, "0.##", "", Tt.headcount_start, 0.001);
  kpi("hc1", "Орон тоо (12-р сар)", `'${S_PAY}'!$O$${HC_R}`, "0.##", "", Tt.headcount_end, 0.001);

  r++; section(w0, r, "Улирлаар", 5); r++; head(w0, r, ["Үзүүлэлт (₮)", "I улирал", "II улирал", "III улирал", "IV улирал"]); r++;
  for (const [k, lbl] of [["income", L.income], ["net", L.result]]) {
    put(w0, r, 1, lbl); const qv = [0, 1, 2, 3].map((qq) => S[k].slice(qq * 3, qq * 3 + 3).reduce((a, b) => a + b, 0));
    for (let qq = 0; qq < 4; qq++) { f(w0, r, 2 + qq, `'${S_PL}'!$${col(17 + qq)}$${RW[k]}`); chk(S_SUM, r, 2 + qq, qv[qq], `${lbl} ${qq + 1}-р улирал`); }
    r++;
  }

  r++; section(w0, r, "Гурван хувилбар (системийн тооцоо, тогтмол утга)", 4); r++;
  head(w0, r, ["Үзүүлэлт", "Гутранги", "Бодит", "Өөдрөг"]); r++;
  const SC = res.scenarios;
  for (const [lbl, key] of [[L.income, "income"], ["Нийт зардал", "cost"], [L.result, "net"], ["Жилийн эцсийн мөнгөн үлдэгдэл", "closing_cash"], ["Хамгийн бага мөнгөн үлдэгдэл", "min_cash"]]) {
    put(w0, r, 1, lbl); ["pessimistic", "realistic", "optimistic"].forEach((s, j) => put(w0, r, 2 + j, Math.round(SC[s][key]), NUM)); r++;
  }
  note(w0, r, `Гутранги: орлого ${(c.scenarios.pessimistic.income * 100).toFixed(0)}%, тогтмол зардал +${(c.scenarios.pessimistic.cost * 100).toFixed(0)}%. Өөдрөг: орлого +${(c.scenarios.optimistic.income * 100).toFixed(0)}%. Өөрөө турших бол «Таамаглал» хуудасны коэффициентийг өөрчилнө.`); r += 2;
  if ((res.warnings || []).length) {
    section(w0, r, "Анхааруулга (тооцооны үед)", 4); r++;
    for (const w of res.warnings) { const cell = put(w0, r, 1, "• " + w, null, { wrap: true }); w0.mergeCells(r, 1, r, 4); w0.getRow(r).height = 32; cell.font = font({ size: 10 }); r++; }
    r++;
  }
  const yel = put(w0, r, 1, "Шар нүд = оролт («Таамаглал», «Гүйцэтгэл» хуудсанд). Бусад нүд томьёогоор автоматаар тооцогдоно.", null, { input: true, bold: true }); w0.mergeCells(r, 1, r, 4); yel.alignment = { wrapText: true };

  // ───────────── 9. ЗААВАР ─────────────
  title(wh, `${org} — ${Y} оны төсвийн загварыг ашиглах заавар`);
  [["Шар нүд", "Оролт. Зөвхөн шар нүдийг өөрчилнө. Бусад нүд томьёотой тул гараар дарж бичихгүй."],
    [S_SUM, "Гол үзүүлэлт, улирлын дүн, гурван хувилбар, анхааруулга."],
    [S_IN, "Бүх оролт: НДШ, татварын хувь, эхний мөнгө, цалингийн нэмэгдэл, улирлын жин, орлогын эх үүсвэр, орон тоо, зардал, төсөл, хөрөнгө оруулалт, зээл."],
    [S_INC, "Эх үүсвэр бүрийн сарын тоо хэмжээ, орлого, шууд зардал."], [S_PAY, "Албан тушаал бүрийн сарын цалин, НДШ, орон тоо."],
    [S_EXP, "Үйл ажиллагааны зардал, төслийн зардал, зардлын бүлэг, хөрөнгө оруулалт, элэгдэл."],
    [S_PL, "Сар, улирлын нэгтгэсэн төсөв (орлого − зардал = үр дүн) ба мөнгөн урсгал."], [S_DEP, "Нэгж, хэлтэс бүрийн төсөв ба эзлэх хувь."],
    [S_ACT, "Сар бүр бодит дүнгээ оруулж төлөвлөгөөтэй харьцуулна. Сарын хяналтын уулзалтад ашиглана."],
    ["Мөр нэмэх", "«Таамаглал» хуудсанд шинэ мөр нэмбэл бусад хуудасны томьёо түүнийг хамрахгүй. Одоо байгаа мөрийг өөрчилж ашиглах, эсвэл бидэнд хандана уу."],
    ["Хувилбар турших", "«Таамаглал» хуудасны «Орлогын коэффициент»-ийг 0.85, «Тогтмол зардлын коэффициент»-ийг 1.05 болговол гутранги хувилбараар бүх хуудас дахин тооцогдоно."],
    ["Тайлбар", "Энэ загвар нь төлөвлөлтийн хэрэгсэл. НӨАТ, авлага, өглөг тооцоонд ороогүй. Татвар, НДШ-ийн хувийг нягтлан бодогчтой нягтална."]]
    .forEach(([a, b], i) => { const ra = 3 + i; put(wh, ra, 1, a, null, { bold: true, input: i === 0 }); const cell = put(wh, ra, 2, b, null, { wrap: true }); wh.getRow(ra).height = 30; cell.alignment = { wrapText: true, vertical: "top" }; });

  return { wb, checks };
}

async function toBuffer(wb) { return Buffer.from(await wb.xlsx.writeBuffer()); }
const addrRC = (addr) => { const m = /^([A-Z]+)(\d+)$/.exec(addr); let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return [Number(m[2]), n]; };

async function makeModel(A, cfg, res) {
  const { wb, checks } = buildXlsx(A, cfg, res);
  const calc = computeWorkbook(wb);
  const bad = calc.errors.map((e) => ({ sheet: e.sheet, addr: e.addr, label: "томьёоны алдаа", got: e.error }));
  let nonzero = 0;
  for (const ch of checks) {
    let v; try { v = calc.value(ch.sheet, ...addrRC(ch.addr)); } catch (e) { v = e.message; }
    if (v === null || v === undefined || v === "") v = 0;
    const tol = Math.max(ch.tol ?? 1, Math.abs(ch.expected) * 1e-9);
    if (!(typeof v === "number" && Math.abs(v - ch.expected) <= tol)) bad.push({ ...ch, got: v }); else if (Math.abs(ch.expected) > 1) nonzero++;
  }
  const buffer = await toBuffer(wb);
  return { buffer, ok: bad.length === 0 && nonzero >= 20, bad, total: checks.length, formulas: calc.count };
}

module.exports = { buildXlsx, makeModel, toBuffer };
