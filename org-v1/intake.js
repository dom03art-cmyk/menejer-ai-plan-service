// Захиалагчийн яриа + материалын бүтэн текстээс тооцооны оролт гаргана. Тоог ЗӨВХӨН материалаас; AI тоо зохиохгүй (таамаглал бол assumed_fields-д тэмдэглэнэ).
//   planIntake({conversation, docs})   → { A, cfg }           (жилийн төлөвлөгөө)
//   reportIntake({conversation, docs, product}) → { A, m, digest } (хэлтсийн / захирлын тайлан)
const { callJSON, WRITER } = require("../plan-v2/claude");
const { chunk } = require("./rawtext");

const RULES = `Ерөнхий дүрэм:
- Тоо, нэр, огноог ЗӨВХӨН материал болон захиалагчийн ярианаас ав. Байхгүй тоог зохиохгүй: null үлдээ.
- Оноосон нэр (байгууллага, хэлтэс, хүн, бүтээгдэхүүн)-ийг яг бичигдсэнээр нь хуул, өөрчилж орчуулахгүй.
- Мөнгийг ₮-өөр бүхэл тоогоор (мянга, сая гэсэн нэгжийг тооцож хувирга: "1.5 тэрбум" → 1500000000). Тайлангийн үзүүлэлтийн хувийг хувиар нь (95.5% → 95.5) бич; зөвхөн жилийн төсвийн cfg-ийн хувь талбарт (si_rate, tax_rate, cost_pct, raise.pct, scenarios) бутархайгаар (12.5% → 0.125).
- Ажилтны хувийн мэдээлэл (регистр, утас, гэрийн хаяг, эрүүл мэнд)-ийг гаргахгүй.
- Зөвхөн JSON буцаа.`;

// ───────────────────────── Жилийн төлөвлөгөө ─────────────────────────
const PLAN_NOTES = `Чи байгууллагын материалаас ирэх жилийн төлөвлөгөөнд хэрэгтэй БАРИМТЫГ түүвэрлэгч. Материалын нэг хэсгийг өгнө. Зөвхөн энэ хэсэгт байгаа баримтыг гарга.
${RULES}
JSON: {"org":{"name":null,"type":"company|state|ngo|null","industry":null,"location":null,"mission":null,"vision":null,"values":[],"departments":[]},
"prior_goals":[{"goal":"","measure":"","plan":null,"actual":null,"note":""}],
"prior_finance":{"year":null,"income_total":null,"expense_total":null,"payroll_total":null,"result":null,"basis":"эх сурвалж"},
"income":[{"name":"","dept":null,"prior_amount":null,"price":null,"units":null,"unit":"","note":"","source":"файлын нэр"}],
"staff":[{"title":"","dept":null,"count":null,"gross":null,"note":""}],
"expenses":[{"name":"","dept":null,"group":null,"prior_annual":null,"monthly":null,"note":""}],
"plans_next":[{"name":"","dept":null,"budget":null,"when":"","note":""}],
"loans":[{"name":"","monthly_principal":null,"monthly_interest":null,"note":""}],
"cash":{"amount":null,"as_of":null},
"achievements":[],"problems":[],"stakeholders":[],"competitors":[],"other":[]}`;

const PLAN_BUILD = `Чи байгууллагын жилийн төлөвлөгөө, төсвийн тооцооны оролт бэлтгэгч. Захиалагчийн яриа ба материалаас түүвэрлэсэн баримтаар A (байгууллагын мэдээлэл) ба cfg (төсвийн тооцооны оролт)-ийг гарга. Тооцоог код хийнэ, чи зөвхөн оролтыг бэлтгэнэ.
${RULES}
- Ирэх жилийн орлогыг өмнөх жилийн бодит дүн, гэрээ, захиалагчийн хэлсэн зорилтоос ав. Өсөлтийг зөвхөн захиалагч хэлсэн бол, эсвэл материалд үндэслэлтэй бол тусга; эс бөгөөс өмнөх жилийн түвшнээр (өсөлтгүй) аваад assumed_fields-д бич. Захиалагчийн хүссэн үр дүнд хүргэх гэж тоог хөөрөгдөхгүй.
- Мэдээлэлгүй зайлшгүй тоог (жишээ нь цалин мэдэгдэхгүй) хамгийн болгоомжтой түвшнээр таамаглаж, assumed_fields-д "юу, ямар утга, яагаад" гэж бич. Өмнөх жилийн (prior) тоог хэзээ ч таамаглахгүй.
- Хэлтсийн нэрийг материалд байгаагаар. Жижиг байгууллагад хэлтэс байхгүй бол чиг үүргээр (Удирдлага, Борлуулалт, Үйл ажиллагаа гэх мэт).
- org_type: компани → company, төрийн байгууллага → state, ТББ, сан, холбоо → ngo. state/ngo бол tax_rate 0.
- source талбарт эх сурвалжийг ("2026 оны тайлан.xlsx", "Захиалагчийн яриа", "Таамаглал") бич.
JSON:
{"A":{"org_name":"","org_type":"company","industry":"","location":"","founded":null,"mission":null,"vision":null,"values":[],"departments":[],"headcount":null,
 "prior_goals":[{"goal":"","measure":"","plan":"","actual":"","note":""}],"achievements":[],"problems":[],"stakeholders":[],"competitors":[],
 "priorities_hint":["захиалагчийн хэлсэн ирэх жилийн чиглэл"],"slogan":null,"missing_info":["захиалагч нөхөх ёстой мэдээлэл"],"assumed_fields":["таамагласан утга ба шалтгаан"]},
"cfg":{"org_name":"","org_type":"company","year":2027,"opening_cash":0,"seasonality":[1,1,1,1,1,1,1,1,1,1,1,1],
 "income":[{"name":"","kind":"sales|amount","unit":"","price":0,"units_annual":0,"unit_cost":0,"cost_pct":0,"annual":0,"seasonality":null,"dept":"","prior":null,"source":""}],
 "staff":[{"title":"","dept":"","count":1,"gross":0,"start":1,"end":12,"new":false}],
 "raise":null,"si_rate":0.125,"tax_rate":0.10,"min_wage":null,
 "expenses":[{"name":"","dept":"","group":"Үйл ажиллагааны|Захиргааны|Борлуулалт, маркетинг|Байр, ашиглалт|Бусад","monthly":0,"annual":null,"pct_of_income":null,"prior":null}],
 "initiatives":[{"name":"","dept":"","owner":"албан тушаал","start":1,"end":12,"budget":0,"capex":false,"life_years":null,"kpi":""}],
 "capex":[],"existing_depreciation_monthly":0,"loans":[],
 "prior":{"year":2026,"income_total":null,"expense_total":null,"payroll_total":null,"result":null,"basis":""},
 "scenarios":{"pessimistic":{"income":-0.15,"cost":0.05},"optimistic":{"income":0.10,"cost":0}}}}
kind "sales" бол price × units_annual (эсвэл units_monthly[12]); "amount" бол annual эсвэл monthly[12]. prior мэдээлэлгүй бол cfg.prior = null.`;

async function notesFrom(docs, system, log) {
  const parts = chunk(docs), out = [];
  for (const [i, p] of parts.entries()) {
    try { out.push(await callJSON({ system, user: `МАТЕРИАЛЫН ХЭСЭГ ${i + 1}/${parts.length}:\n${p}`, model: WRITER, maxTokens: 16000 })); log(`[org-intake] хэсэг ${i + 1}/${parts.length} уншлаа`); }
    catch (e) { if (/credit balance/i.test(e.message || "")) throw e; log(`[org-intake] хэсэг ${i + 1} уншиж чадсангүй: ${e.message}`); }
  }
  return out;
}

const DIRECT_LIMIT = Number(process.env.ORG_DIRECT_LIMIT || 120000);

async function planIntake({ conversation = "", docs = [], year }, log = console.log) {
  const total = docs.reduce((s, d) => s + d.text.length, 0);
  let material;
  if (total <= DIRECT_LIMIT) material = "МАТЕРИАЛ (бүтэн текст):\n" + docs.map(d => `=== Файл: ${d.name} ===\n${d.text}`).join("\n\n");
  else material = "МАТЕРИАЛААС ТҮҮВЭРЛЭСЭН БАРИМТ (хэсэг бүрээр):\n" + JSON.stringify(await notesFrom(docs, PLAN_NOTES, log));
  const Y = year || new Date().getFullYear() + 1;
  const r = await callJSON({ system: PLAN_BUILD, model: WRITER, maxTokens: 24000,
    user: `Төлөвлөх он: ${Y} (захиалагч өөр он хэлсэн бол түүнийг ав).\n\nЗАХИАЛАГЧИЙН ЯРИА:\n${String(conversation).slice(0, 20000) || "(байхгүй)"}\n\n${material}` });
  const A = r.A || {}, cfg = r.cfg || {};
  A.org_name = A.org_name || cfg.org_name || "Байгууллага"; cfg.org_name = cfg.org_name || A.org_name;
  cfg.org_type = cfg.org_type || A.org_type; A.org_type = cfg.org_type;
  if (!cfg.year) cfg.year = Y;
  if (cfg.org_type && cfg.org_type !== "company" && cfg.tax_rate === undefined) cfg.tax_rate = 0;
  A.missing_info = (A.missing_info || []).map(String).slice(0, 12); A.assumed_fields = (A.assumed_fields || []).map(String).slice(0, 30);
  A.brand = { name: A.org_name, slogan: A.slogan || "" };
  return { A, cfg };
}

// ───────────────────────── Тайлан ─────────────────────────
const REPORT_NOTES = (product) => `Чи ${product === "report_dir" ? "гүйцэтгэх захирлын ТУЗ-д тавих жилийн тайлан" : "хэлтэс, албан тушаалын ажлын тайлан"} бичихэд хэрэгтэй баримтыг материалаас түүвэрлэгч. Материалын нэг хэсгийг өгнө; зөвхөн энэ хэсэгт байгааг гарга.
${RULES}
ҮЗҮҮЛЭЛТ (indicators): тоогоор хэмжигдэх үр дүн бүр (борлуулалт, орлого, зардал, үйлчлүүлэгч, гүйцэтгэсэн ажлын тоо, хувь, хугацаа...). Сар бүрийн тоо байвал monthly[12]-д (1-р сар = индекс 0; мэдээлэлгүй сар null), зөвхөн нийт дүн байвал value. agg: sum (нийлбэр), avg (дундаж, хувь), last (сарын эцсийн үлдэгдэл, ажилтны тоо). better: "low" бол бага нь сайн (зардал, осол, гомдол, хугацаа). target — жилийн (эсвэл хамарсан хугацааны) зорилт, материалд бичигдсэн бол л; target_monthly[12] — сарын төлөвлөгөө байвал. target_type "level" — "сар бүр 30 хоногоос доош" гэх мэт түвшний зорилт. prev — өмнөх оны ижил үзүүлэлт. unit: "₮", "%", "хүн", "ш", "өдөр"… check: тоо эргэлзээтэй бол true, note-д шалтгаан.
ТОЙМ (digest): чиг үүрэг, хийсэн ажил (тодорхой баримттай), үр дүн, хийгдээгүй ажил ба шалтгаан, бэрхшээл, ТУЗ/удирдлагын шийдвэр ба биелэлт, төсөл, хөрөнгө оруулалт, эрсдэл, хүний нөөцийн өөрчлөлт, санхүүгийн тайлбар, ирэх жилийн санал.
meta.scope_org: энэ хэсэгт БАЙГУУЛЛАГЫН ХЭМЖЭЭНИЙ материал (байгууллагын санхүүгийн тайлан — баланс, орлого үр дүн, олон хэлтсийн нэгтгэсэн мэдээлэл, ТУЗ-ийн шийдвэр) байвал true, зөвхөн нэг нэгж, албан тушаалынх бол false.
JSON: {"meta":{"org_name":null,"unit_name":null,"reporter_title":null,"year":null,"months_covered":[],"scope_org":false},
"indicators":[{"name":"","unit":"","agg":"sum|avg|last","better":"high|low","category":"","monthly":null,"value":null,"target":null,"target_monthly":null,"target_type":null,"strict":false,"prev":null,"source":"файлын нэр, хуудас/хүснэгт","note":"","check":false}],
"digest":{"functions":[{"name":"чиг үүрэг","works":["хийсэн ажил, баримттай"],"results":[""],"not_done":["хийгдээгүй ажил — шалтгаан"]}],
 "achievements":[],"problems":[{"problem":"","cause":"","controllable":true}],"decisions":[{"decision":"","date":"","status":"","evidence":"","note":""}],
 "projects":[{"name":"","goal":"","spent":null,"progress":"","result":"","next":""}],"risks":[{"risk":"","impact":"","status":"","action":""}],
 "hr":[],"finance_notes":[],"proposals":[],"requests":[{"issue":"","request":"","reason":""}],"other":[]},
"issues":[{"type":"Зөрүү|Дутуу|Тодруулах","item":"","detail":"","question":""}]}`;

const keyOf = (s) => String(s || "").toLowerCase().replace(/[^a-zа-яөүё0-9]+/gi, "");
const nn = (x) => x !== null && x !== undefined && x !== "";
function mergeIndicators(list, issues) {
  const map = new Map();
  for (const x of list) {
    if (!x || !x.name) continue;
    const k = keyOf(x.name) + "|" + keyOf(x.unit);
    if (!map.has(k)) { map.set(k, { ...x, monthly: Array.isArray(x.monthly) ? x.monthly.slice(0, 12) : null }); continue; }
    const a = map.get(k);
    if (Array.isArray(x.monthly)) {
      if (!a.monthly) a.monthly = Array(12).fill(null);
      x.monthly.slice(0, 12).forEach((v, i) => {
        if (!nn(v)) return;
        if (!nn(a.monthly[i])) a.monthly[i] = v;
        else if (Number(a.monthly[i]) !== Number(v)) issues.push({ type: "Зөрүү", item: `${x.name}, ${i + 1}-р сар`, detail: `Материалд ${a.monthly[i]} ба ${v} гэсэн хоёр өөр тоо байна. Эхнийхийг ашиглав`, question: "Аль нь зөв бэ" });
      });
    }
    for (const f of ["value", "target", "prev"]) {
      if (!nn(x[f])) continue;
      if (!nn(a[f])) a[f] = x[f];
      else if (Number(a[f]) !== Number(x[f])) issues.push({ type: "Зөрүү", item: `${x.name} (${f === "target" ? "зорилт" : f === "prev" ? "өмнөх он" : "дүн"})`, detail: `${a[f]} ба ${x[f]} гэсэн өөр тоо. Эхнийхийг ашиглав`, question: "Аль нь зөв бэ" });
    }
    if (!a.target_monthly && Array.isArray(x.target_monthly)) a.target_monthly = x.target_monthly;
    for (const f of ["category", "target_type", "better", "agg"]) if (!a[f] && x[f]) a[f] = x[f];
    if (x.source && !String(a.source || "").includes(x.source)) a.source = [a.source, x.source].filter(Boolean).join("; ");
    if (x.note && !String(a.note || "").includes(x.note)) a.note = [a.note, x.note].filter(Boolean).join(" ");
    a.check = a.check || x.check;
  }
  return [...map.values()].map((x) => {
    const o = { ...x };
    // Хувийн үзүүлэлтийг бутархайгаар (0.955) өгсөн бол 95.5 болгоно — тайланд "1.0%" гэж гарахаас сэргийлнэ
    if (/%|хувь/i.test(String(o.unit || ""))) {
      const vals = [...(Array.isArray(o.monthly) ? o.monthly : []), o.value, o.target, o.prev, ...(Array.isArray(o.target_monthly) ? o.target_monthly : [])].filter(nn).map(Number).filter(Number.isFinite);
      if (vals.length && vals.every((v) => Math.abs(v) <= 1.5) && vals.some((v) => v !== 0 && Math.abs(v) < 1)) {
        const k = (v) => (nn(v) && Number.isFinite(Number(v)) ? Math.round(Number(v) * 1000) / 10 : v);
        if (Array.isArray(o.monthly)) o.monthly = o.monthly.map(k);
        if (Array.isArray(o.target_monthly)) o.target_monthly = o.target_monthly.map(k);
        for (const f of ["value", "target", "prev"]) if (nn(o[f])) o[f] = k(o[f]);
      }
      o.unit = "%";
    }
    if (o.monthly && o.monthly.every((v) => !nn(v))) o.monthly = null;
    if (o.monthly) delete o.value; else delete o.monthly;
    for (const f of ["target_monthly", "target_type"]) if (!o[f]) delete o[f];
    if (o.better !== "low") delete o.better;
    return o;
  }).filter((x) => x.monthly || nn(x.value));
}

const DIGEST_MERGE = `Чи тайлангийн материалаас хэсэг хэсгээр түүвэрлэсэн тоймуудыг НЭГТГЭГЧ. Давхардлыг арилгаж, ижил чиг үүргийг нэг дор нэгтгэ, баримтыг хасахгүй, шинэ баримт нэмэхгүй. Чиг үүрэг 3–8 байхаар бүлэглэ (материалд байгаа нэршлээр). Ижил бүтэцтэй JSON буцаа: {"functions":[...],"achievements":[],"problems":[],"decisions":[],"projects":[],"risks":[],"hr":[],"finance_notes":[],"proposals":[],"requests":[],"other":[]}`;

async function reportIntake({ conversation = "", docs = [], product = "report_dept" }, log = console.log) {
  const system = REPORT_NOTES(product);
  const convDoc = String(conversation || "").trim() ? [{ name: "Захиалагчийн яриа", text: String(conversation).slice(0, 20000) }] : [];
  const notes = await notesFrom([...convDoc, ...docs], system, log);
  if (!notes.length) throw new Error("Материалаас мэдээлэл уншиж чадсангүй");
  const issues = notes.flatMap((n) => n.issues || []);
  const meta = {};
  for (const n of notes) for (const [k, v] of Object.entries(n.meta || {})) if (!nn(meta[k]) || (Array.isArray(meta[k]) && !meta[k].length)) meta[k] = v;
  const months = [...new Set(notes.flatMap((n) => (n.meta && n.meta.months_covered) || []).map(Number).filter((x) => x >= 1 && x <= 12))].sort((a, b) => a - b);
  const indicators = mergeIndicators(notes.flatMap((n) => n.indicators || []), issues);
  let digest = notes.length === 1 ? notes[0].digest || {} : null;
  if (!digest) {
    try { digest = await callJSON({ system: DIGEST_MERGE, model: WRITER, maxTokens: 20000, user: JSON.stringify(notes.map((n) => n.digest || {})).slice(0, 180000) }); }
    catch (e) { if (/credit balance/i.test(e.message || "")) throw e; log(`[org-intake] тойм нэгтгэж чадсангүй, шууд залгав: ${e.message}`);
      digest = {}; for (const n of notes) for (const [k, v] of Object.entries(n.digest || {})) digest[k] = [...(digest[k] || []), ...(Array.isArray(v) ? v : [v])]; }
  }
  if (!months.length) { // хамрах сар заагаагүй бол сарын тоотой хамгийн сүүлийн сар хүртэл
    const last = Math.max(0, ...indicators.filter((x) => x.monthly).map((x) => x.monthly.reduce((mx, v, i) => (nn(v) ? i + 1 : mx), 0)));
    for (let i = 1; i <= last; i++) months.push(i);
  }
  const year = Number(meta.year) || new Date().getFullYear();
  const m = { org_name: meta.org_name || "Байгууллага", unit_name: product === "report_dir" ? "" : (meta.unit_name || ""), year, months_covered: months.length ? months : undefined, indicators, issues: issues.slice(0, 30) };
  const orgWide = product === "report_dept" && notes.some((n) => n.meta && (n.meta.scope_org === true || n.meta.scope_org === "true"));
  const A = { org_name: m.org_name, unit_name: meta.unit_name || "", reporter_title: meta.reporter_title || "", year, org_wide: orgWide, brand: { name: m.org_name, slogan: "" }, missing_info: [], assumed_fields: [] };
  log(`[org-intake] ${indicators.length} үзүүлэлт, ${issues.length} тодруулах зүйл`);
  return { A, m, digest };
}

module.exports = { planIntake, reportIntake, mergeIndicators };
