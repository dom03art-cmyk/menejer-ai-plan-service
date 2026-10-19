# tender.json — engine-ийн оролтын гэрээ

Claude ТББ болон оролцогчийн (манай харилцагчийн) мэдээллээс энэ JSON-ийг бөглөнө. **Тоог (нийт дүн, хувь, үсгэн бичлэг) Claude бичихгүй** — engine тооцно. Мэдэхгүй утгыг `null` эсвэл хоосон үлдээ, таамаглаж бөглөхгүй. Бүрэн жишээ: `scripts/samples/goods-test.json`, `scripts/samples/services-test.json`.

```
meta:      type: "goods" | "services"   (ажил → энэ skill хамаарахгүй)
           test: true зөвхөн туршилтад; standard_version: ТББ-ийн хувилбар; source_files: []
now:       ISO огноо-цаг (хугацаа дөхсөнийг шалгахад)
tender:    (БҮГД ТББ-ЭЭС — заалтын дугаартай)
  procuring_entity, name, number, method, lot{no,name}, budget (₮, тоо), funding
  deadline, opening (ISO, +08:00), clarification{contact,email,ref}
  validity_days_min (ӨХ-д заагаагүй бол 30)
  bid_security{required, amount, ref}, performance_security{required, pct, ref}
  incoterms, delivery_place
  items[]:      {no, name, qty, unit, max_days | window}          — барааны жагсаалт, яг хуулна
  tech_specs[]: {item_no, no, requirement}                         — III бүлгийн мөр бүр
  requirements[]: {id, category, text, ref, evidence}              — шалгах жагсаалтын мөр бүр
  contract{warranty, liquidated_damages, payment, advance}         — ГТН
  validity_unit: "working_days" | хоосон (хоног)
  auction{start, hours}                     — харьцуулалтын аргын үнийн санал дуудах ажиллагаа
  forms[]{key, no, name}                    — ТББ-ийн V бүлгийн маягтууд (нэр, дугаар яг)
  numeric_criteria[]{req_id, label, kind: each|any, years[], threshold: тоо|"offer", pct, op: ">="|">"}
                     — threshold "offer" = санал болгох үнийн pct%; op ">" = «ашигтай» (> 0)
  inconsistencies[]{text, ref, suggestion}  — ТББ-ийн зөрчил
  requirements[].category: general|esystem|financial|experience|staff|equipment|license|tech|security|other
  requirements[].produces: company_profile | letter | methodology | draft:<key>  — бид бэлтгэх баримт (engine шалгана)
  works_like: true           — барилгын шинжтэйг гараар тэмдэглэх (engine мөн автоматаар таньна)
customer:  (БҮГД ЗАХИАЛАГЧААС)
  company{name, reg_no, address, phone, email, vat_payer}
  signatory{name, position, is_director}
  submission_date, validity_days, discount (null = санал болгохгүй)
  declared_total (оролцогч өөрөө нийт дүн хэлсэн бол — engine тулгана)
  goods:    prices[]{item_no, origin, unit_price, transport, tax, domestic}
            proposed_delivery[]{item_no, days, text}
            tech_offer[]{item_no, spec_no, offered, compliance: Нийцнэ|Давсан|Зөрүүтэй, evidence, note}
  services: service_budget[]{name, qty, unit, unit_price}
            staff[]{position, name, education, total_years, position_years, cv{birth_year, profession, years_in_company, duties, education[], experience[]}}
            equipment[]{name, capacity, qty, ownership}
  floor_price                (auction үед заавал — оролцогчийн доод үнэ)
  metrics{ req_id: { "2024": тоо, "2025": тоо } }   — numeric_criteria-д
  documents[]{key, name, category, req_id, status: uploaded|missing|esystem, expires, file, note, required}  — бүрдүүлэх баримт (req_id — холбогдох шаардлага)
  requirement_status[]{req_id, status: ok|missing|fail, note, action}
  contracts_similar[]{name, client, client_contact, number, start, end, amount, location, role}
  contracts_ongoing[]{name, client, amount, start, remaining, end}
sections:  (Claude-ийн бичих текст)
  summary[]                 — дүгнэлтийн 1–3 догол мөр
  risks[]                   — гэрээний нөхцөлийн эрсдэл
  low_price_explanation[]   — <80% үед, зөвхөн оролцогчийн бодит шалтгаанаар
  methodology[]{heading, paragraphs[]}  — үйлчилгээ
  schedule[]{task, start, end, owner}   — үйлчилгээ
  clarification_letter[]    — ТББ-ийн зөрчил байвал тодруулгын хүсэлтийн текст
  company_profile[]{heading, paragraphs[]}  — байгууллагын танилцуулга
letters[]{title, ref, paragraphs[]}      — оролцогчийн өөрийн албан бичиг, мэдэгдэл (ref = шаардлагын ref)
drafts[]{key, file, title, sections[]{heading, paragraphs[]}}  — оролцогч батлах баримтын ТӨСӨЛ (жишээ child_policy)
attachments[]{no, name, ref, status}    — хавсралтын жагсаалт
```

## Engine-ийн гаралт
`01_Шалгах_жагсаалт` (docx+pdf), `02_Тендерийн_материал` (docx+pdf), `03_Үнийн_задаргаа.xlsx`, `chat.txt` (оролцогчид чатаар илгээх товч жагсаалт), `04_…_ТӨСӨЛ.docx` (drafts байвал), `qc.json`.

## Engine-ийн шалгалт (qc.js)
| Код | Түвшин | Нөхцөл |
|---|---|---|
| REQ_UNASSESSED | зогсооно | Шаардлага үнэлэгдээгүй |
| NOGO | — | ❌ байвал зөвхөн шалгах жагсаалт гарна |
| PRICE_MISSING / PRICE_UNKNOWN_ITEM | зогсооно | Үнэ дутуу / ТББ-д байхгүй бараа |
| LOW_PRICE | тайлбаргүй бол зогсооно | Төсөвт өртгийн <80% |
| OVER_BUDGET | анхааруулна | >100% |
| TOTAL_MISMATCH | зогсооно | declared_total ≠ тооцоо |
| VALIDITY_SHORT / MISSING | зогсооно | Хүчинтэй хугацаа доод хэмжээнээс бага |
| DELIVERY_LATE / MISSING | зогсооно | Нийлүүлэх хугацаа хэтэрсэн / алга |
| TECH_COPIED | зогсооно | Санал = Захиалагчийн шаардлага (≥85% давхцал) ба шаардлагын хэллэг («-аас багагүй», «дүйцэх»…) эсвэл ≥8 үг |
| TECH_SAME_AS_REQ | анхааруулна | Богино тоон үзүүлэлт яг ижил — каталогт байгааг шалгах |
| TECH_DEVIATION | анхааруулна | «Зөрүүтэй» үзүүлэлт — чатад барааны нэртэй гарна |
| TECH_DEVIATION_NO_NOTE | зогсооно | «Зөрүүтэй» боловч тайлбаргүй |
| TECH_MISSING / TECH_NO_EVIDENCE | анхааруулна | [ДУТУУ] гэж тэмдэглэнэ |
| COMPANY_* / SIGNATORY | зогсооно | Компанийн мэдээлэл дутуу |
| DEADLINE_PASSED / NEAR | зогсооно / анхааруулна | |
| METHODOLOGY_MISSING | зогсооно | Үйлчилгээ |
| STATUS_CONFLICT | зогсооно | Тэмдэглэсэн төлөв ≠ кодоор тооцсон тоон шалгуур |
| FLOOR_MISSING / FLOOR_ABOVE_START | зогсооно | Үнийн санал дуудах ажиллагааны доод үнэ алга / эхлэх үнээс их |
| FLOOR_BELOW_80 | анхааруулна | Доод үнэ төсөвт өртгийн 80%-иас доош |
| TBB_INCONSISTENCY | анхааруулна | ТББ-ийн зөрчил |
| CLARIFICATION_URGENT / LATE | анхааруулна | Тодруулга авах хугацаа (≥5 ажлын өдөр) дөхсөн / өнгөрсөн |
| LETTER_EMPTY / LETTER_PLACEHOLDER | зогсооно / анхааруулна | Албан бичиг хоосон / [ДУТУУ] хэсэгтэй |
| DOC_EXPIRED / DOC_EXPIRING | зогсооно / анхааруулна | Баримтын хугацаа тендерээс өмнө дуусна / 60 хоногийн дотор |
| DOC_MISSING | анхааруулна | Шаардлагатай слот хоосон |
| WORKS_LIKE | зогсооно | Барилга угсралтын шинжтэй (БА- зөвшөөрөл, ажлын зураг/төсөв, шугам шинэчлэх, их засвар) |
| PROMISE_UNMET | зогсооно | `produces` гэж тэмдэглэсэн баримт материалд алга |
| CV_MISSING | анхааруулна | ТББ CV маягт шаардсан, ажилтны cv дутуу |
| Excel тулгалт | зогсооно | LibreOffice-оор бодсон Excel-ийн нийт ≠ кодын тооцоо |
