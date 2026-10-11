# org-v1 — байгууллагын жилийн төлөвлөгөө ба тайлангийн модуль (дотоод тодорхойлолт)

Render дээрх `menejer-ai-plan-service` (Node 22, CommonJS). Шинэ модуль `org-v1/` нь plan-v2, marketing-v1-тэй ижил загвартай.
ЗАРЧИМ: plan-v2, marketing-v1, server.js-ийн ажиллаж буй кодыг ӨӨРЧЛӨХГҮЙ (зөвхөн уншиж, require хийж ашиглана). Бүх тоог код тооцно, AI тоо зохиохгүй.
Хамаарал: plan-v2/claude.js (callJSON, FAST, WRITER), plan-v2/util.js (fbText, fbFile), plan-v2/xlsxCalc.js (computeWorkbook), plan-v2/files.js (extractBuffer), plan-v2/guard.js, plan-v2/store.js-ийн Redis загвар.
Бүх текст, алдааны мессеж монгол хэлээр. Мөнгө "1 500 000 ₮" хэлбэрээр.

## Бүтээгдэхүүн (product)
- `plan`  — байгууллагын жилийн төлөвлөгөө, төсөв (60–80 хуудас Word+PDF, томьёотой Excel төсөв)
- `report_dept` — хэлтэс, албан тушаалын ажлын тайлан (10–20 хуудас + үзүүлэлтийн Excel)
- `report_dir` — гүйцэтгэх захирлын (ТУЗ-д) тайлан (20–35 хуудас + Excel)
Үнэ: org-v1/quote.js (priceFor, countFile) — материалын "тооцооны хуудас"-аар шатлалтай. Төлбөрөөс өмнө материалын АГУУЛГЫГ уншихгүй (AI дуудахгүй), зөвхөн тоолно.

## Урсгал
1. Make: үйлчилгээ сонгоход `POST /org/upload-link {psid, product}` → `{url}` (захиалагчид илгээнэ).
2. Захиалагч upload хуудсаар файлаа илгээнэ → сервер файлыг Redis-д (gzip, TTL 14 хоног) хадгалж, quote.js-аар тоолно. "Дууслаа" дарахад нийт тооцооны хуудас, үнийг Messenger-ээр мэдэгдэж, Make-ийн webhook (ORG_QUOTE_WEBHOOK)-д {psid, product, units, price, files} илгээнэ.
3. Төлбөр баталгаажсаны дараа Make `POST /org/jobs {psid, product, conversation}` → сервер хадгалсан файлуудыг plan-v2/files.js extractBuffer-оор текст болгоно, guard шалгаж, баримт бичиг гаргаж Messenger-ээр PDF, Word, Excel илгээнэ.
4. Унтраалга: `ORG_ENABLED=1` биш бол шинэ ажил хүлээж авахгүй (503). Бизнес төсөл боловсруулагдаж байвал түүнийг хүлээнэ (marketing-v1/index.js-ийн yieldToPlan шиг).

## Төсвийн тооцооны оролт (plan) — `cfg`
```
{ org_name, org_type: "company|state|ngo", year: 2027, opening_cash, seasonality: [12],
  income: [{ name, kind: "sales"|"amount", price, units_annual | units_monthly[12], unit_cost, cost_pct, annual | monthly[12], seasonality?[12], dept, prior, source }],
  staff: [{ title, dept, count, gross, start=1, end=12, new: bool }],
  raise: { month, pct } | null, si_rate (0.125 өгөгдмөл), tax_rate (0.10 өгөгдмөл; state/ngo 0), min_wage,
  expenses: [{ name, dept, group, monthly | annual | by_month[12] | pct_of_income, prior }],
  initiatives: [{ name, dept, owner, start, end, budget, capex: bool, life_years, kpi }],
  capex: [{ name, dept, month, amount, life_years }], existing_depreciation_monthly,
  loans: [{ name, monthly_principal, monthly_interest, start, end }],
  prior: { year, income_total, expense_total, payroll_total, result, basis } | null,
  scenarios: { pessimistic: { income: -0.15, cost: 0.05 }, optimistic: { income: 0.10, cost: 0 } } }
```
Дүрэм (annual_calc.py-ийн хялбаршуулсан хувилбар): 12 сар. Орлогын мөр бүрийг сараар (улирлын жин нийлбэр 12 байхаар хэвийн болгоно). Шууд зардал = units×unit_cost + орлого×cost_pct. Цалин = count×gross (start–end сард, raise.month-оос (1+pct)); НДШ = цалин×si_rate. Зардал: monthly / annual/12 / by_month / pct_of_income×сарын орлого. Төсөл: capex биш бол budget-ийг start–end сард тэнцүү хувааж зардалд; capex бол start сард хөрөнгө оруулалт (мөнгөн гарлага), элэгдэл = budget/(life_years×12) дараагийн сараас. Элэгдэл зөвхөн ашигт нөлөөлнө, мөнгөнд биш. Зээлийн хүү зардалд, үндсэн төлбөр мөнгөн гарлагад. Ашиг (татварын өмнө) = орлого − шууд − цалин − НДШ − зардал − төсөл(opex) − элэгдэл − хүү. Татвар = max(0, өссөн дүнгийн ашиг)×tax_rate − өмнө хуримтлуулсан (сар бүр). Мөнгөн урсгал: үлдэгдэл = өмнөх + орлого − (шууд+цалин+НДШ+зардал+opex төсөл+хүү+татвар) − capex − зээлийн үндсэн. Хувилбар: орлого×(1+income), тогтмол зардал×(1+cost), шууд зардал орлогыг дагана.
Гаралт: `{ months:[12 мөр], totals, by_dept, groups, kpis:{ bep_income, payroll_share, income_per_staff, gross_margin, min_cash, min_cash_month }, scenarios:{pessimistic,realistic,optimistic}, warnings:[] }`.

## Баримт бичиг
Блокийн формат marketing-v1-тэй ижил (p, h3, bullets, numbered, checklist, table, tip, box, chart{key}, flow, gantt). document.js/pdf.js-ийг marketing-v1-ээс хуулж, OUTLINE-ыг параметрээр авдаг болгоно.
