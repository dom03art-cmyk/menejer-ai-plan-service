// Санхүүгийн бүх хүснэгт, графикийг КОД үүсгэнэ — AI тоо бичихгүй.
const { f, m1, pc, payroll } = require("./fmt");
const { productUnit } = require("./model");
const yrH = ["1-р жил", "2-р жил", "3-р жил", "4-р жил", "5-р жил"];
const T = (caption, headers, rows, left) => ({ type: "table", caption, headers, rows, left });

function build(an) {
  const { A, R } = an, Y = R.years, BS = R.bs, CF = R.cfs, SC = R.sched;
  const total = R.capexTotal + A.init_inventory + R.launch + R.inkindTotal + (A.cash_equity || 0);
  const own = R.inkindTotal + (A.cash_equity || 0);
  const row = (label, fn) => [label, ...Y.map(y => m1(fn(y)))];
  const loanY = (y) => SC.slice(y * 12, y * 12 + 12);
  const pay = payroll(A.staff, A.er_si);
  const P = A.products.map(p => ({ ...p, u: productUnit(p) }));
  const orders1 = Object.values(Y[0].units).reduce((a, b) => a + b, 0);
  const X = {};

  X.summaryTable = [T("Төслийн ерөнхий мэдээлэл", ["Үзүүлэлт", "Утга"], [
    ["Төслийн нэр", A.project.title], ["Хэрэгжүүлэгч", A.company.name],
    ["Регистрийн дугаар", A.company.reg_no || "[Захиалагч бөглөнө]"], ["Хаяг", A.company.address || "[Захиалагч бөглөнө]"],
    ["Холбоо барих", `${A.company.contact_name || "[нэр]"}, ${A.company.phone || "[утас]"}`],
    ["Үндсэн үйл ажиллагаа", A.company.core_business || "—"], ["Төслийн хугацаа", `5 жил; зээл ${A.loan.months} сар`],
    ["Нийт төслийн өртөг", `${f(total)} ₮`], ["Хүсэж буй зээл", `${f(A.loan.amount)} ₮ (${pc(A.loan.amount / total)}) — ${A.project.funder || "банк"}`],
    ["Өөрийн хөрөнгө", `${f(own)} ₮ (${pc(own / total)})`], ["Зээлийн хүү (тооцоонд)", `Сарын ${(A.loan.rate_monthly * 100).toFixed(2)}%`],
    ["Сарын зээлийн төлбөр", SC.length ? ((A.loan.grace_months || 0) > 0 ? `Эхний ${A.loan.grace_months} сар: ${f(SC[0].pay)} ₮ (зөвхөн хүү); дараа нь: ${f(SC[A.loan.grace_months].pay)} ₮` : `${f(SC[0].pay)} ₮`) : "—"], ["NPV (20%)", `${f(an.npv)} ₮`], ["IRR", pc(an.irr)],
    ["Нөхөгдөх хугацаа", an.pb ? `${an.pb.toFixed(2)} жил` : "5+ жил"],
    ["DSCR (1/2/3-р жил)", R.dscr.slice(0, 3).map(d => d ? d.toFixed(2) : "—").join(" / ")],
  ], [1])];
  X.fundingTable = [T("Хөрөнгийн эх үүсвэр ба зарцуулалт", ["Ангилал", "Дүн (₮)", "Хувь"], [
    ["Үндсэн хөрөнгө (CAPEX)", f(R.capexTotal), pc(R.capexTotal / total)], ["Эргэлтийн хөрөнгө (анхны нөөц)", f(A.init_inventory), pc(A.init_inventory / total)],
    ...(R.launch > 0 ? [["Нээлтийн маркетинг / эргэлтийн мөнгө", f(R.launch), pc(R.launch / total)]] : []),
    ...(own > 0 ? [["Өөрийн хөрөнгийн оролцоо", f(own), pc(own / total)]] : []),
    ["!Нийт төслийн өртөг", f(total), "100%"]])];
  X.kpiTable = [T("Үндсэн үзүүлэлтүүд, сая ₮", ["Үзүүлэлт", ...yrH], [row("Борлуулалтын орлого", y => y.rev), row("Нийт ашиг", y => y.gross), row("EBITDA", y => y.ebitda), row("Цэвэр ашиг", y => y.ni), row("Зээлийн төлбөр", y => y.ds), ["DSCR", ...R.dscr.map(d => d ? d.toFixed(2) : "зээлгүй")]])];
  X.unitTable = [T("Нэгж бүтээгдэхүүний эдийн засаг (1-р жил, ₮)", ["Бүтээгдэхүүн", "Үнэ (НӨАТ-тэй)", "Цэвэр үнэ", "Өртөг", "Хүргэлт", "Нэгжийн ашиг", "Маржин"],
    P.map(p => [p.name, f(p.price), f(p.u.net), f(p.u.cogs), f(p.u.delivery), f(p.u.net - p.u.cogs - p.u.delivery), pc((p.u.net - p.u.cogs - p.u.delivery) / p.u.net)])),
    { type: "note", text: "Нэгжийн ашиг = Цэвэр үнэ − Өртөг − Хүргэлт. Маркетинг, төлбөрийн шимтгэл, тогтмол зардлыг 4-р бүлэгт тооцов." }];
  X.salesMonthly = [T("1-р жилийн сарын борлуулалтын таамаглал", ["Сар", ...P.map(p => p.name.split(" (")[0].slice(0, 18)), "Орлого (₮)"],
    [...R.months.slice(0, 12).map(m => [m.label, ...P.map(p => m.units[p.key] < 20 ? m.units[p.key].toFixed(1) : f(m.units[p.key])), f(m.rev)]),
      ["!Нийт", ...P.map(p => f(Y[0].units[p.key])), f(Y[0].rev)]])];
  X.salesYearly = [T("5 жилийн борлуулалт", ["Үзүүлэлт", ...yrH], [...P.map(p => [`${p.name} (тоо)`, ...Y.map(y => f(y.units[p.key]))]), ...P.map(p => [`${p.name} (сая ₮)`, ...Y.map(y => m1(y.rev_p[p.key]))]), row("!Нийт орлого (сая ₮)", y => y.rev)])];
  const S = an.scen, SK = ["Реалистик", "Консерватив", "Пессимистик"];
  X.scenarioTable = [T("Гурван хувилбарын харьцуулалт", ["Үзүүлэлт", "Реалистик", "Консерватив (−15%)", "Пессимистик (−30%)"], [
    ["1-р жилийн орлого (сая ₮)", ...SK.map(k => m1(S[k].rev[0]))], ["3-р жилийн орлого (сая ₮)", ...SK.map(k => m1(S[k].rev[2]))],
    ["1-р жилийн цэвэр ашиг (сая ₮)", ...SK.map(k => m1(S[k].ni[0]))], ["DSCR 1/2/3", ...SK.map(k => S[k].dscr.map(d => d ? d.toFixed(2) : "—").join(" / "))],
    ["NPV (сая ₮)", ...SK.map(k => m1(S[k].npv))], ["IRR", ...SK.map(k => pc(S[k].irr))]])];
  X.scenarioMonthly = [T("Гурван хувилбарын сарын орлого, мянган ₮ (36 сар)", ["Сар", ...SK], R.months.map((m, i) => [m.label, ...SK.map(k => f(S[k].mrev[i] / 1000))]))];
  X.bepText = [{ type: "box", title: "Ашигт ажиллагааны хугарлын цэг (1-р жил)", text: `Тогтмол зардал (элэгдэл, хүүг оролцуулан) ${m1(an.bep.fixed)} сая ₮ ÷ үндсэн бүтээгдэхүүний нэгжийн хувь нэмрийн ашиг ${f(an.bep.cm)} ₮ = ${f(an.bep.units)} ширхэг (${m1(an.bep.revenue)} сая ₮). Төлөвлөсөн орлого хугарлын цэгээс ${pc(1 - an.bep.revenue / Y[0].rev)}-иар өндөр.` }];
  X.payrollTable = [T("Цалингийн тооцоо (сарын, ₮)", ["Албан тушаал", "Тоо", "Үндсэн цалин", "Ажилтны НДШ", "ХХОАТ", "Гарт олгох", "Ажил олгогчийн НДШ", "Нийт зардал"],
    [...pay.rows.map(r => [`${r.title}${r.from_year > 1 ? ` (${r.from_year}-р жилээс)` : ""}`, r.count, f(r.gross), f(r.eeSi), f(r.it), f(r.net), f(r.erSi), f(r.total)]), ["!Нийт", "", f(pay.gross), "", "", "", "", f(pay.total)]]),
    { type: "note", text: `Ажил олгогчийн НДШ ${pc(A.er_si)}, ажилтны 11.5%, ХХОАТ 10%. Цалин жил бүр ${pc(A.fixed_growth, 0)}-иар өснө.` }];
  X.capexTable = [T("Үндсэн хөрөнгө (CAPEX)", ["Хөрөнгө", "Тоо", "Нэгжийн үнэ (₮)", "Нийт (₮)", "Хугацаа"], [...A.capex.map(c => [c.name, c.qty, f(c.unit_price), f(c.qty * c.unit_price), `${c.life} жил`]), ["!Нийт", "", "", f(R.capexTotal), ""]])];
  X.inkindTable = (A.inkind || []).length ? [T("Өөрийн хөрөнгийн оролцоо (эд хөрөнгөөр)", ["Хөрөнгө", "Үнэлгээ (₮)", "Хугацаа"], [...A.inkind.map(c => [c.name, f(c.value), `${c.life} жил`]), ["!Нийт", f(R.inkindTotal), ""]])] : [];
  X.opexTable = [T("Эргэлтийн хөрөнгө (OPEX)", ["Зүйл", "Дүн (₮)"], [["Түүхий эдийн анхны нөөц", f(A.init_inventory)], ...(R.launch > 0 ? [["Нээлтийн маркетинг / эргэлтийн мөнгө", f(R.launch)]] : []), ["!Нийт", f(A.init_inventory + R.launch)]])];
  X.assumptionTable = [T("Таамаглалын хуудас", ["Хувьсагч", "Утга", "Эх сурвалж"], [
    ...P.map(p => [`${p.name} — үнэ / өртөг`, `${f(p.price)} ₮ / ${f(p.u.cogs)} ₮`, (A.assumed_fields || []).some(s => s.includes(p.key)) ? "Таамаглал" : "Захиалагч"]),
    ["Үнийн / хувьсах / тогтмол зардлын өсөлт", `${pc(A.price_growth, 0)} / ${pc(A.varcost_growth, 0)} / ${pc(A.fixed_growth, 0)}`, "Инфляцын төлөв"],
    ["Маркетинг / төлбөрийн шимтгэл", `${pc(A.mkt_rate, 0)} / ${pc(A.pay_fee, 0)} орлогоос`, "Тооцоо"],
    ["Зээл", `${f(A.loan.amount)} ₮, ${A.loan.months} сар, сарын ${(A.loan.rate_monthly * 100).toFixed(2)}%`, (A.assumed_fields || []).includes("loan.rate_monthly") ? "Хүү — таамаглал" : "Захиалагч"],
    ["Хөнгөлөлтийн хувь / ААНОАТ", `${pc(A.disc, 0)} / ${pc(A.cit_eff, 0)}`, "Тооцоо / хууль"]], [1, 2]),
    ...((A.assumed_fields || []).length ? [{ type: "note", text: `Захиалагчаар баталгаажуулах таамаглал: ${A.assumed_fields.join("; ")}.` }] : [])];
  X.metricsTable = [T("Хөрөнгө оруулалтын үр ашиг", ["Үзүүлэлт", "Утга"], [["NPV (20%)", `${f(an.npv)} ₮`], ["IRR", pc(an.irr)], ["Нөхөгдөх хугацаа", an.pb ? `${an.pb.toFixed(2)} жил` : "5+ жил"],
    ...R.dscr.slice(0, 3).map((d, i) => [`DSCR ${i + 1}-р жил`, d ? d.toFixed(2) : "—"]), ["6 сарын хөнгөлөлттэй үеийн DSCR (1-р жил)", an.grace6 ? an.grace6.toFixed(2) : "—"],
    ["BEP (1-р жил)", `${m1(an.bep.revenue)} сая ₮`], ["ROI (5 жилийн дундаж цэвэр ашгаар)", pc(Y.reduce((a, y) => a + y.ni, 0) / 5 / R.inv0)]], [1])];
  X.fcfTable = [T("Цэвэр мөнгөн урсгал (сая ₮)", ["Үзүүлэлт", "0-р жил", ...yrH], [["Мөнгөн урсгал", ...R.fcf.map(m1)], ["Хуримтлагдсан", ...an.cum.map(m1)], ["Хөнгөлөгдсөн", ...R.fcf.map((c, i) => m1(c / Math.pow(1 + A.disc, i)))]])];
  X.sensTable = [T("Мэдрэмжийн шинжилгээ", ["Хувилбар", "Өөрчлөлт", "Цэвэр ашиг 1-р жил (сая)", "NPV (сая)", "IRR", "Payback", "DSCR 1-р жил"],
    an.sens.map(s => [s.name, s.change, m1(s.ni1), m1(s.npv), pc(s.irr), s.pb ? s.pb.toFixed(2) : "5+", s.dscr1 ? s.dscr1.toFixed(2) : "—"]), [1])];
  X.ratioTable = [T("Санхүүгийн харьцаа", ["Харьцаа", ...yrH], [["Нийт ашгийн маржин", ...Y.map(y => pc(y.gross / y.rev))], ["EBITDA маржин", ...Y.map(y => pc(y.ebitda / y.rev))], ["Цэвэр ашгийн маржин", ...Y.map(y => pc(y.ni / y.rev))],
    ["ROE", ...Y.map((y, i) => pc(y.ni / (BS[i + 1].eq + BS[i + 1].re)))], ["Өр ÷ Хөрөнгө", ...Y.map((y, i) => pc((BS[i + 1].loan_cur + BS[i + 1].loan_lt) / BS[i + 1].assets))]])];
  X.incomeTable = [T("Орлогын тайлан (сая ₮)", ["Үзүүлэлт", ...yrH], [row("Борлуулалтын орлого", y => y.rev), row("ББӨ", y => -y.cogs), row("!Нийт ашиг", y => y.gross), row("Хүргэлт", y => -y.deliv), row("Маркетинг", y => -y.mkt), row("Төлбөрийн шимтгэл", y => -y.fees), row("Тогтмол зардал", y => -y.fixed_tot), row("!EBITDA", y => y.ebitda), row("Элэгдэл", y => -y.dep), row("!EBIT", y => y.ebit), row("Хүүгийн зардал", y => -y.int), row("!Татварын өмнөх ашиг", y => y.pbt), row("ААНОАТ", y => -y.tax), row("!Цэвэр ашиг", y => y.ni)])];
  X.balanceTable = [T("Балансын тайлан, жилийн эцсээр (сая ₮)", ["Үзүүлэлт", "Эхлэл", ...yrH], [["Мөнгөн хөрөнгө", ...BS.map(b => m1(b.cash))], ["Бараа материал", ...BS.map(b => m1(b.inv))], ["Үндсэн хөрөнгө (цэвэр)", ...BS.map(b => m1(b.fa))], ["!НИЙТ ХӨРӨНГӨ", ...BS.map(b => m1(b.assets))],
    ["Богино хугацаат өр", ...BS.map(b => m1(b.loan_cur))], ["Урт хугацаат зээл", ...BS.map(b => m1(b.loan_lt))], ["Эздийн хөрөнгө", ...BS.map(b => m1(b.eq))], ["Хуримтлагдсан ашиг", ...BS.map(b => m1(b.re))], ["!ӨР ТӨЛБӨР + ӨМЧ", ...BS.map(b => m1(b.le))]])];
  X.cashTable = [T("Мөнгөн гүйлгээний тайлан (сая ₮)", ["Үзүүлэлт", ...yrH], [["Эхний үлдэгдэл", ...CF.map(c => m1(c.open))], ["!Үйл ажиллагааны цэвэр урсгал", ...CF.map(c => m1(c.op))], ["Хөрөнгө оруулалт", ...CF.map(c => m1(c.invest))], ["Зээлийн үндсэн төлбөр", ...CF.map(c => m1(c.fin))], ["!Эцсийн үлдэгдэл", ...CF.map(c => m1(c.close))]])];
  X.monthlyCashTable = [T("1-р жилийн сарын мөнгөн урсгал (мянган ₮)", ["Сар", "Орлого", "Хувьсах", "Тогтмол", "Зээл", "Цэвэр", "Үлдэгдэл"], R.mc.slice(0, 12).map(x => [x.label, f(x.rev / 1e3), f(x.variable / 1e3), f(x.fixed / 1e3), f(x.debt / 1e3), f(x.net / 1e3), f(x.cash / 1e3)])),
    { type: "note", text: `36 сарын хамгийн бага мөнгөн үлдэгдэл: ${m1(Math.min(...R.mc.map(x => x.cash)))} сая ₮.` }];
  X.loanYearTable = SC.length ? [T("Зээлийн эргэн төлөлт — жилээр (₮)", ["Жил", "Эхний үлдэгдэл", "Хүү", "Үндсэн", "Нийт", "Эцсийн үлдэгдэл"], [0, 1, 2, 3, 4].filter(y => loanY(y).length).map(y => { const s = loanY(y); return [`${y + 1}-р жил`, f(s[0].open), f(s.reduce((a, x) => a + x.int, 0)), f(s.reduce((a, x) => a + x.prin, 0)), f(s.reduce((a, x) => a + x.pay, 0)), f(Math.max(0, s[s.length - 1].close))]; }))] : [];
  X.loanMonthTable = SC.length ? [T("Зээлийн сарын хуваарь (₮)", ["Сар", "Эхний үлдэгдэл", "Хүү", "Үндсэн", "Нийт", "Эцсийн үлдэгдэл"], SC.map(s => [s.m, f(s.open), f(s.int), f(s.prin), f(s.pay), f(Math.max(0, s.close))]))] : [];
  X.cogsDetailTable = P.filter(p => Object.keys(p.materials).length > 1).map(p => T(`${p.name} — нэгжийн өртгийн задаргаа`, ["Орц", "Дүн (₮)", "Хувь"],
    [...Object.entries(p.materials).map(([k, v]) => [k, f(v), pc(v / (p.u.cogs + p.u.delivery))]), ["Шууд хөдөлмөр", f(p.u.labor), pc(p.u.labor / (p.u.cogs + p.u.delivery))], ["Хүргэлт", f(p.u.delivery), pc(p.u.delivery / (p.u.cogs + p.u.delivery))], ["!Нийт", f(p.u.cogs + p.u.delivery), "100%"]]));
  X.cogsYearTable = [T("Жилийн ББӨ-ийн бүтэц (сая ₮)", ["Үзүүлэлт", ...yrH], [row("Материал", y => y.mat), row("Шууд хөдөлмөр", y => y.labor), row("!ББӨ", y => y.cogs), ["ББӨ ÷ Орлого", ...Y.map(y => pc(y.cogs / y.rev))]])];
  const staffKey = "Цалин, НДШ (тогтмол ажилтан)";
  X.hrTable = [T("Хүний нөөцийн зардал (сая ₮)", ["Үзүүлэлт", ...yrH], [row("Тогтмол ажилчдын цалин, НДШ", y => y.fixed[staffKey]), row("Шууд хөдөлмөр (ББӨ-д)", y => y.labor), row("!Нийт", y => y.fixed[staffKey] + y.labor), ["Орлогод эзлэх хувь", ...Y.map(y => pc((y.fixed[staffKey] + y.labor) / y.rev))]])];
  const fk = [...new Set(Y.flatMap(y => Object.keys(y.fixed)))];
  X.fixedTable = [T("Тогтмол үйл ажиллагааны зардал (сая ₮)", ["Зардал", ...yrH], [...fk.map(k => row(k, y => y.fixed[k] || 0)), row("!Нийт", y => y.fixed_tot)])];
  X.depTable = [T("Элэгдлийн тооцоо (сая ₮)", ["Хөрөнгө", "Өртөг", ...yrH],
    [...A.capex.map(c => [c.name, m1(c.qty * c.unit_price), ...[0, 1, 2, 3, 4].map(y => y < c.life ? m1(c.qty * c.unit_price / c.life) : "—")]),
     ...(A.inkind || []).map(c => [c.name, m1(c.value), ...[0, 1, 2, 3, 4].map(y => y < c.life ? m1(c.value / c.life) : "—")]),
     ...(A.extra_capex || []).map(e => [`${e.name} (${e.year}-р жил)`, m1(e.amount), ...[1, 2, 3, 4, 5].map(y => y >= e.year && y < e.year + e.life ? m1(e.amount / e.life) : "—")]),
     ["!Нийт", "", ...Y.map(y => m1(y.dep))]])];
  X.guarantee = [{ type: "numbered", items: ["Төсөлд тусгасан мэдээлэл үнэн зөв болно.", "Зээлийг зөвхөн төсөлд заасан зориулалтаар зарцуулна.", "Үндсэн төлбөр, хүүг хуваарийн дагуу хугацаанд нь төлнө.", "Хууль тогтоомж, татвар, нийгмийн даатгалын хуулийг мөрдөнө.", "Банкны хяналт шалгалтад бүрэн хамрагдаж, тайлан тогтмол гаргана."] },
    T("Баталгаажуулалт", ["", "Албан тушаал", "Гарын үсэг", "Овог нэр", "Огноо"], [["Боловсруулсан", "Гүйцэтгэх захирал", "", "[.....]", "____.__.__"], ["Хянасан", "Ерөнхий нягтлан бодогч", "", "[.....]", "____.__.__"]], [1, 3]), { type: "note", text: "(Тамга)" }];
  X.docsList = [{ type: "numbered", items: ["Зээлийн хүсэлтийн маягт", "Улсын бүртгэлийн гэрчилгээ, дүрэм", "Захирлын томилгоо, иргэний үнэмлэх", "Сүүлийн 2 жилийн санхүүгийн тайлан", "Сүүлийн 6–12 сарын дансны хуулга", "Түрээсийн гэрээ (байгаа бол)", "Тоног төхөөрөмжийн үнийн санал", "Барьцаа хөрөнгийн гэрчилгээ, үнэлгээ", "Борлуулалтын нотолгоо (гэрээ, баримт)"] }];
  X.glossary = [T("Нэр томьёо", ["Нэр томьёо", "Тайлбар"], [["NPV", "Ирээдүйн мөнгөн урсгалын өнөөгийн үнэ цэнээс хөрөнгө оруулалтыг хассан дүн"], ["IRR", "NPV-г тэг болгох хөнгөлөлтийн хувь"], ["DSCR", "Зээлийн төлбөр төлөх боломжит мөнгө ÷ зээлийн төлбөр"], ["EBITDA", "Хүү, татвар, элэгдлийн өмнөх ашиг"], ["BEP", "Орлого зардалтай тэнцэх борлуулалт"], ["ББӨ", "Борлуулсан бүтээгдэхүүний өртөг"], ["TAM/SAM/SOM", "Нийт / хүрэх боломжит / эзлэх зах зээл"]], [1])];

  // Графикийн тохиргоо (charts.js-ээр PNG болгоно)
  const C = {};
  C.pl = { type: "bar", title: "Орлого, EBITDA, цэвэр ашиг (сая ₮)", labels: yrH, series: [["Орлого", Y.map(y => +(y.rev / 1e6).toFixed(1))], ["EBITDA", Y.map(y => +(y.ebitda / 1e6).toFixed(1))], ["Цэвэр ашиг", Y.map(y => +(y.ni / 1e6).toFixed(1))]] };
  C.scen = { type: "line", title: "Орлого — 3 хувилбар (сая ₮)", labels: yrH, series: SK.map(k => [k, S[k].rev.map(v => +(v / 1e6).toFixed(1))]) };
  C.season = { type: "bar", title: "1-р жилийн сарын орлого (сая ₮)", labels: R.months.slice(0, 12).map(m => m.label), series: [["Орлого", R.months.slice(0, 12).map(m => +(m.rev / 1e6).toFixed(1))]] };
  C.cum = { type: "bar", title: "Хуримтлагдсан мөнгөн урсгал (сая ₮)", labels: ["0", ...yrH], series: [["Хуримтлагдсан", an.cum.map(v => +(v / 1e6).toFixed(1))]] };
  C.mix = { type: "pie", title: "1-р жилийн орлогын бүтэц", labels: P.map(p => p.name.slice(0, 24)), series: [["", P.map(p => +(Y[0].rev_p[p.key] / 1e6).toFixed(1))]] };
  const p0 = P[0]; C.unitpie = { type: "pie", title: `${p0.name.slice(0, 30)} — өртгийн бүтэц`, labels: ["Материал", "Хөдөлмөр", "Хүргэлт"], series: [["", [p0.u.mat, p0.u.labor, p0.u.delivery]]] };

  // AI-д өгөх товч тоон мэдээлэл (AI тоо зохиохгүй, эндээс иш татна)
  const facts = {
    total_project: total, loan: A.loan, own_equity: own, monthly_payment_after_grace: SC.length ? Math.round(SC[Math.min(SC.length - 1, A.loan.grace_months || 0)].pay) : 0, grace_interest_only_payment: (A.loan.grace_months || 0) > 0 ? Math.round(SC[0].pay) : null,
    years: Y.map((y, i) => ({ year: i + 1, revenue: Math.round(y.rev), gross: Math.round(y.gross), ebitda: Math.round(y.ebitda), net_income: Math.round(y.ni), debt_service: Math.round(y.ds), dscr: R.dscr[i] ? +R.dscr[i].toFixed(2) : null, units: Object.fromEntries(Object.entries(y.units).map(([k, v]) => [k, Math.round(v)])), marketing: Math.round(y.mkt) })),
    npv: Math.round(an.npv), irr: +(an.irr * 100).toFixed(1), payback_years: an.pb ? +an.pb.toFixed(2) : null, bep_revenue_y1: Math.round(an.bep.revenue), grace6_dscr_y1: an.grace6 ? +an.grace6.toFixed(2) : null,
    scenarios: Object.fromEntries(SK.map(k => [k, { rev_y1: Math.round(S[k].rev[0]), dscr: S[k].dscr.map(d => d ? +d.toFixed(2) : null), npv: Math.round(S[k].npv) }])),
    sensitivity: an.sens.map(s => ({ case: s.name, change: s.change, dscr_y1: s.dscr1 ? +s.dscr1.toFixed(2) : null, npv: Math.round(s.npv) })),
    products: P.map(p => ({ key: p.key, name: p.name, price: p.price, net_price: Math.round(p.u.net), unit_cost: p.u.cogs, delivery: p.u.delivery, margin_pct: +((p.u.net - p.u.cogs - p.u.delivery) / p.u.net * 100).toFixed(1) })),
    staff: A.staff, capex: A.capex, orders_y1: Math.round(orders1), min_monthly_cash: Math.round(Math.min(...R.mc.map(x => x.cash))),
    assumed_fields: A.assumed_fields || [], missing_info: A.missing_info || [],
  };
  return { blocks: X, charts: C, facts };
}
module.exports = { build };
