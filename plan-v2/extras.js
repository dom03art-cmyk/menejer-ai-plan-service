// Нэмэлт бүтцийн шаардлага (шинэ дугаартай бүлэг нээхгүй):
//   2.4 — хэрэгжүүлэх хувилбаруудын харьцуулалтын хүснэгт (сонгосон + 1–2 хувилбар, зөвхөн Бага/Дунд/Өндөр, тоогүй)
//   3.4 — төгсгөлд оролцогч талуудын хүснэгт (5+ мөр, нэр зохиохгүй)
//   3.6 — үе шат бүрийн төгсгөлд «Шийдвэрийн цэг» мөр (шалгуурын тоог КОД борлуулалтын таамаглалаас авна)
// AI бичсэн блокийг код шалгаж засна. Энд гарсан алдаа төслийг зогсоохгүй (chapters.js try/catch).
const { f, m1 } = require("./fmt");

const isTable = (b) => b && b.type === "table" && Array.isArray(b.rows) && Array.isArray(b.headers);
const txt = (b) => `${b.caption || ""} ${(b.headers || []).join(" ")}`;

// ───────────────────────── 3.6 Шийдвэрийн цэг ─────────────────────────
// Шалгуурын бүх тоо санхүүгийн загвараас: реалистик / консерватив (−15%) / пессимистик (−30%) борлуулалт.
function decisionPoints(an) {
  const R = an.R, S = an.scen || {}, mo = R.months || [];
  if (mo.length < 12 || !S["Консерватив"] || !S["Пессимистик"]) return [];
  const cum = (arr, n) => arr.slice(0, n).reduce((a, b) => a + b, 0);
  const real = mo.map((x) => x.rev), cons = S["Консерватив"].mrev, pess = S["Пессимистик"].mrev;
  const units1 = Object.values(mo[0].units || {}).reduce((a, b) => a + b, 0);
  const u = units1 < 20 ? units1.toFixed(1) : f(units1);
  return [
    { phase: "Бэлтгэл үе шат", when: `${mo[0].label} — борлуулалт эхлэхээс өмнө`,
      criterion: `Борлуулалт эхлэх эхний сарын реалистик таамаглалыг (нийт ${u} нэгж, ${m1(real[0])} сая ₮) хангах тоног төхөөрөмж, түүхий эдийн нөөц, хүний нөөц бүрдсэн бол борлуулалтыг эхлүүлнэ. Бүрдээгүй бол эхлэх хугацааг хойшлуулна.` },
    { phase: "Эхлүүлэх үе шат (1–3-р сар)", when: `${mo[2].label} сарын эцэс`,
      criterion: `Эхний 3 сарын хуримтлагдсан орлого реалистик таамаглал ${m1(cum(real, 3))} сая ₮-д хүрсэн бол дараагийн үе шатанд шилжинэ. Консерватив түвшин ${m1(cum(cons, 3))} сая ₮-өөс доош бол үнэ, борлуулалтын суваг, маркетингийн төлөвлөгөөг эргэн харна.` },
    { phase: "Тогтворжуулах үе шат (4–6-р сар)", when: `${mo[5].label} сарын эцэс`,
      criterion: `Эхний 6 сарын хуримтлагдсан орлого реалистик таамаглал ${m1(cum(real, 6))} сая ₮-д хүрсэн бол төлөвлөгөөг хэвээр үргэлжлүүлнэ. Консерватив түвшин ${m1(cum(cons, 6))} сая ₮-өөс доош бол зардлыг хянаж, пессимистик түвшин ${m1(cum(pess, 6))} сая ₮-өөс доош бол нэмэлт хөрөнгө оруулалт, ажилтан авалтыг хойшлуулна.` },
    { phase: "Бүрэн хүчин чадлын үе шат (7–12-р сар)", when: `${mo[11].label} сарын эцэс`,
      criterion: `1-р жилийн орлого реалистик таамаглал ${m1(R.years[0].rev)} сая ₮-д хүрсэн бол 2-р жилийн төлөвлөгөөг (реалистик таамаглал ${m1(R.years[1].rev)} сая ₮) хэрэгжүүлнэ. Консерватив түвшин ${m1(S["Консерватив"].rev[0])} сая ₮-өөс доош бол 2-р жилийн борлуулалтын зорилт, зардлын төсвийг шинэчилнэ.` },
  ];
}

const DP_LABEL = "Шийдвэрийн цэг";
function applyDecisionPoints(blocks, dps) {
  if (!dps || !dps.length) return blocks;
  const out = blocks.map((b) => (isTable(b) ? { ...b, rows: b.rows.map((r) => [...r]) } : b));
  // хуваарийн хүснэгт: «Хугацаа» баганатай эсвэл хамгийн олон мөртэй хүснэгт
  const tables = out.filter(isTable);
  let t = tables.find((b) => /хугацаа|огноо/i.test((b.headers || []).join(" "))) || tables.sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!t) {
    t = { type: "table", caption: "Хэрэгжүүлэх үе шат ба шийдвэрийн цэг", headers: ["Дараалал", "Хугацаа", "Хариуцах эзэн", "Үр дүн, шалгуур"], rows: dps.map((d) => [`!${d.phase}`, "", "", ""]) };
    out.push(t);
  }
  const n = Math.max(2, t.headers.length);
  const mk = (d) => {
    const c = Array(n).fill("");
    c[0] = `!${DP_LABEL} — ${d.phase}`;
    if (n >= 4) { c[1] = d.when; c[2] = "Төслийн удирдлага"; c[n - 1] = d.criterion; }
    else if (n === 3) { c[1] = d.when; c[2] = d.criterion; }
    else c[1] = `${d.when}: ${d.criterion}`;
    return c;
  };
  // AI өөрөө бичсэн шийдвэрийн цэгийн мөрүүдийг хасна — тоог зөвхөн код тавина
  let rows = t.rows.filter((r) => !r.some((c) => String(c ?? "").includes(DP_LABEL)));
  const heads = rows.map((r, i) => (String(r[0] ?? "").trim().startsWith("!") ? i : -1)).filter((i) => i >= 0);
  if (heads.length >= 2) {
    const k = heads.length, res = [];
    for (let p = 0; p < k; p++) {
      const end = p + 1 < k ? heads[p + 1] : rows.length;
      res.push(...rows.slice(p === 0 ? 0 : heads[p], end));
      if (p < k - 1) { if (p < dps.length - 1) res.push(mk(dps[p])); }
      else for (let j = Math.min(p, dps.length - 1); j < dps.length; j++) res.push(mk(dps[j])); // сүүлийн үе шат: үлдсэн бүх цэг
    }
    rows = res;
  } else {
    rows = [...rows, ...dps.map(mk)]; // үе шатын гарчиггүй бол хүснэгтийн төгсгөлд
  }
  t.rows = rows;
  if (n === 4) t.widths = [0.26, 0.15, 0.17, 0.42]; // шалгуурын багана өргөн
  const note = "Шийдвэрийн цэгийн шалгуурыг 3.3-р хэсгийн борлуулалтын реалистик, консерватив (−15%), пессимистик (−30%) таамаглалаас авав.";
  if (!out.some((b) => b.type === "note" && String(b.text || "").includes("Шийдвэрийн цэгийн шалгуур"))) out.splice(out.indexOf(t) + 1, 0, { type: "note", text: note });
  return out;
}

// ───────────────────────── 2.4 Хувилбаруудын харьцуулалт ─────────────────────────
const RATING = /(?<![А-Яа-яӨөҮүЁё])(Бага|Дундаж|Дунд|Өндөр)(?![А-Яа-яӨөҮүЁё])/i;
const cap = (s) => { const w = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); return w === "Дундаж" ? "Дунд" : w; };
function cleanRatingCell(c) {
  let s = String(c ?? "").trim();
  const m = RATING.exec(s);
  if (!m) return { text: s.replace(/\d[\d.,]*\s*(сая|тэрбум|мянган|₮|төгрөг|хувь|%|сар|жил|өдөр|хоног)?/gi, "").replace(/\s{2,}/g, " ").trim(), rated: false };
  const rating = cap(m[1]);
  let rest = s.slice(m.index + m[0].length).replace(/^\s*[—–\-:,.(]*\s*/, "").replace(/\)\s*$/, "").trim();
  if (/\d/.test(rest)) rest = ""; // тоотой тайлбарыг бүхэлд нь хасна — тоо зохиохгүй
  return { text: rest ? `${rating} — ${rest}` : rating, rated: true };
}
const findOptions = (blocks) => blocks.find((b) => isTable(b) && /хувилбар/i.test(txt(b)));
// → { ok, blocks }: хүснэгтийг цэвэрлэж, шаардлага хангасан эсэхийг буцаана
function checkOptions(blocks) {
  const t = findOptions(blocks);
  if (!t) return { ok: false, reason: "хүснэгт алга", blocks };
  const nAlt = t.headers.length - 2; // эхний багана = шалгуур, 2 дахь = сонгосон
  let rated = 0, total = 0;
  const rows = t.rows.map((r) => r.map((c, i) => { if (i === 0) return String(c ?? "").replace(/\d[\d.,]*\s*(сая|тэрбум|мянган|₮|төгрөг|хувь|%)/gi, "").replace(/\s{2,}/g, " ").trim(); const x = cleanRatingCell(c); total++; if (x.rated) rated++; return x.text; }));
  const headers = t.headers.map((h, i) => { const s = String(h ?? "").replace(/\d[\d.,]*\s*(сая|тэрбум|мянган|₮|төгрөг|хувь|%)/gi, "").replace(/\s{2,}/g, " ").trim(); return i === 1 && !/сонгосон/i.test(s) ? `Сонгосон хувилбар: ${s}` : s; });
  const fixed = { ...t, caption: t.caption || "Хэрэгжүүлэх хувилбаруудын харьцуулалт", headers, rows };
  const ok = nAlt >= 1 && nAlt <= 2 && rows.length >= 4 && total > 0 && rated / total >= 0.9;
  return { ok, reason: ok ? "" : `багана ${t.headers.length}, мөр ${rows.length}, үнэлгээтэй нүд ${rated}/${total}`, blocks: blocks.map((b) => (b === t ? fixed : b)) };
}
const OPTIONS_NOTE = "Үнэлгээ нь чанарын харьцуулалт (Бага / Дунд / Өндөр) бөгөөд тоон тооцоог 4-р бүлэгт зөвхөн сонгосон хувилбараар хийв.";
function withOptionsNote(blocks) {
  const t = findOptions(blocks); if (!t || blocks.some((b) => b.type === "note" && String(b.text || "").startsWith("Үнэлгээ нь чанарын"))) return blocks;
  const out = [...blocks]; out.splice(out.indexOf(t) + 1, 0, { type: "note", text: OPTIONS_NOTE }); return out;
}
const OPTIONS_PROMPT = `ХУВИЛБАРЫН ХҮСНЭГТ: Энэ бизнесийг хэрэгжүүлэх хувилбаруудын харьцуулалтын НЭГ хүснэгт бич.
- headers: ["Шалгуур", "Сонгосон хувилбар: <товч нэр>", "Хувилбар 2: <товч нэр>"] (хүсвэл 4 дэх багана "Хувилбар 3: <товч нэр>"). Сонгосон хувилбар нь төсөлд тусгагдсан арга зам; бусад нь бодит өөр арга зам (гадны гүйцэтгэгчээр хийлгэх, үе шаттай жижгээр эхлэх, түрээслэх г.м.).
- 6–8 мөр шалгуур: анхны хөрөнгө оруулалтын хэрэгцээ, хэрэгжүүлэх хугацаа, үйл ажиллагааны зардал, чанарын хяналт, хэрэгжүүлэлтийн эрсдэл, зах зээлд тохирох байдал, өргөжих боломж.
- Нүд бүр ЗӨВХӨН "Бага", "Дунд", "Өндөр"-ийн аль нэгээр эхэлнэ; хүсвэл " — " товч чанарын тайлбар. ТОО, ХУВЬ, МӨНГӨН ДҮН ОГТ бичихгүй.
Зөвхөн JSON: {"sections":[{"id":"2.4","blocks":[{"type":"table","caption":"Хэрэгжүүлэх хувилбаруудын харьцуулалт","headers":[...],"rows":[[...]]},{"type":"p","text":"Сонгосон хувилбарыг яагаад сонгосон тухай тоогүй 2–3 өгүүлбэр."}]}]}`;

// ───────────────────────── 3.4 Оролцогч талууд ─────────────────────────
const findStake = (blocks) => blocks.find((b) => isTable(b) && /оролцогч тал/i.test(txt(b)));
const norm = (s) => String(s || "").toLowerCase().replace(/[«»"'“”.,()\-–—\s]+/g, "");
// Оноосон нэрийн хэв маяг: «…», "… ХХК/ХК/ББСБ…", хүний нэр "Б.Болд"
const NAME_RE = [/«([^»]{2,60})»/g, /((?:[А-ЯӨҮЁA-Z][\wа-яөүёА-ЯӨҮЁ\-]*\s){1,3})(?:ХХК|ХК|ТӨХК|ББСБ|ХЗХ|ТББ|LLC)(?![а-яөүё])/g, /([А-ЯӨҮЁ]\.\s?[А-ЯӨҮЁ][а-яөүё]{2,})/g];
function inventedNames(table, allowedText) {
  const ok = norm(allowedText), bad = [];
  for (const r of table.rows) for (const c of r) for (const re of NAME_RE) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(String(c ?? "")))) { const name = m[1].trim(); if (name.length >= 2 && !ok.includes(norm(name))) bad.push(name); }
  }
  return [...new Set(bad)];
}
function checkStake(blocks, ctx) {
  const t = findStake(blocks);
  if (!t) return { ok: false, reason: "хүснэгт алга" };
  const allowed = JSON.stringify({ c: ctx.A && ctx.A.company, p: ctx.A && ctx.A.project }) + " " + (ctx.conversation || "");
  const bad = inventedNames(t, allowed);
  if (t.rows.length < 5) return { ok: false, reason: `мөр ${t.rows.length} < 5` };
  if (bad.length) return { ok: false, reason: `төслийн мэдээлэлд байхгүй нэр: ${bad.join(", ")}` };
  return { ok: true, reason: "" };
}
// Хүснэгтийг хэсгийн хамгийн төгсгөлд байрлуулна
function stakeToEnd(blocks) {
  const t = findStake(blocks); if (!t) return blocks;
  const rest = blocks.filter((b) => b !== t && !(b.type === "h3" && /оролцогч тал/i.test(String(b.text || ""))));
  return [...rest, { type: "h3", text: "Оролцогч талууд" }, { ...t, caption: t.caption || "Оролцогч талууд" }];
}
// AI шаардлага хангаагүй үед: кодоор үүсгэсэн, нэр зохиогоогүй хүснэгт
function fallbackStake(ctx) {
  const A = ctx.A || {}, jobs = (A.staff || []).reduce((s, x) => s + (Number(x.count) || 0), 0);
  const co = (A.company && A.company.name) || "Төсөл хэрэгжүүлэгч", fu = A.project && A.project.funder;
  const bank = !A.project || A.project.funder_type !== "investor";
  return { type: "table", caption: "Оролцогч талууд", headers: ["Оролцогч тал", "Төсөлд гүйцэтгэх үүрэг", "Хүлээлт, сонирхол", "Харилцах хэлбэр, давтамж"], rows: [
    [`${co} (хэрэгжүүлэгч)`, "Төслийг удирдан хэрэгжүүлж, үр дүнг бүрэн хариуцна", "Төслийг хугацаандаа, төсөвтөө багтаан хэрэгжүүлж, тогтвортой ашигт ажиллагаанд хүрэх", "Удирдлагын долоо хоног тутмын хурал, сар бүрийн гүйцэтгэлийн тайлан"],
    [fu ? `${fu} (санхүүжүүлэгч)` : "Санхүүжүүлэгч байгууллага", bank ? "Зээлийн санхүүжилт олгож, зориулалтын дагуу зарцуулалтад хяналт тавина" : "Хөрөнгө оруулалт хийж, гүйцэтгэлд хяналт тавина", bank ? "Зээл хуваарийн дагуу эргэн төлөгдөх, барьцаа хөрөнгийн баталгаа" : "Хөрөнгө оруулалтын өгөөж, ил тод тайлагнал", "Улирал тутмын санхүүгийн тайлан, шаардлагатай үед газар дээрх үзлэг"],
    [jobs ? `Ажилтнууд (${jobs} ажлын байр)` : "Ажилтнууд", "Үйлдвэрлэл, үйлчилгээ, борлуулалтыг өдөр тутам гүйцэтгэнэ", "Тогтвортой ажлын байр, цагтаа олгогдох цалин, аюулгүй ажлын нөхцөл", "Өдөр тутмын ажлын уулзалт, сар бүрийн гүйцэтгэлийн үнэлгээ"],
    ["Хэрэглэгчид, худалдан авагчид", "Бүтээгдэхүүн, үйлчилгээг худалдан авч, санал хүсэлтээ өгнө", "Чанартай бүтээгдэхүүн, тогтвортой үнэ, цагтаа хүргэлт", "Борлуулалтын суваг, санал хүсэлтийн тогтмол судалгаа"],
    ["Түүхий эд, тоног төхөөрөмжийн нийлүүлэгчид", "Түүхий эд, тоног төхөөрөмж, сэлбэгийг гэрээний дагуу нийлүүлнэ", "Тогтмол захиалга, төлбөр хугацаандаа хийгдэх", "Гэрээ, захиалга бүрийн тулгалт, улирал тутмын үнэлгээ"],
    ["Татварын алба, нийгмийн даатгалын байгууллага", "Татвар, шимтгэлийн тайланг хүлээн авч, хууль тогтоомжийн хэрэгжилтэд хяналт тавина", "Татвар, нийгмийн даатгалын шимтгэл хугацаандаа төлөгдөх", "Сар, улирлын тайлан"],
    ["Орон нутгийн захиргаа, мэргэжлийн хяналтын байгууллага", "Үйл ажиллагааны зөвшөөрөл, стандарт, аюулгүй байдлын шаардлагыг хянана", "Хууль, стандартын шаардлага хангасан, орон нутагт ээлтэй үйл ажиллагаа", "Зөвшөөрөл сунгах үед болон төлөвлөгөөт шалгалтаар"],
  ] };
}
const STAKE_PROMPT = `ОРОЛЦОГЧ ТАЛУУДЫН ХҮСНЭГТ: Төслийн оролцогч талуудын НЭГ хүснэгт бич.
- headers: ["Оролцогч тал", "Төсөлд гүйцэтгэх үүрэг", "Хүлээлт, сонирхол", "Харилцах хэлбэр, давтамж"]; 5–8 мөр: хэрэгжүүлэгч, санхүүжүүлэгч, ажилтнууд, хэрэглэгчид, нийлүүлэгчид, төрийн байгууллага, орон нутаг.
- НЭР ЗОХИОХГҮЙ: зөвхөн ТӨСЛИЙН МЭДЭЭЛЭЛ-д байгаа компани, санхүүжүүлэгчийн нэрийг ашигла. Бусад талыг ерөнхий нэрээр бич ("Түүхий эдийн нийлүүлэгчид" гэх мэт). Хүний нэр, шинэ байгууллагын нэр бүү бич.
Зөвхөн JSON: {"sections":[{"id":"3.4","blocks":[{"type":"table","caption":"Оролцогч талууд","headers":[...],"rows":[[...]]}]}]}`;

// ───────────────────────── Нэгтгэсэн шалгалт ─────────────────────────
// gen(prompt, id) → блокуудын жагсаалт (chapters.js-ээс өгнө; нэг богино нэмэлт дуудлага)
async function postProcess(id, blocks, ctx, gen, log = () => { }) {
  if (id === "3.6") return applyDecisionPoints(blocks, ctx.facts && ctx.facts.decision_points);
  if (id === "2.4") {
    let c = checkOptions(blocks);
    if (!c.ok && gen) {
      log(`2.4 хувилбарын хүснэгт шаардлага хангаагүй (${c.reason}) — дахин бичүүлж байна`);
      const extra = await gen(OPTIONS_PROMPT, "2.4").catch(() => []);
      const base = c.blocks.filter((b) => b !== findOptions(c.blocks) && !(b.type === "h3" && /хувилбар/i.test(String(b.text || ""))));
      const c2 = checkOptions([...base, { type: "h3", text: "Хэрэгжүүлэх хувилбаруудын харьцуулалт" }, ...extra.filter((b) => isTable(b) || b.type === "p")]);
      if (c2.ok) c = c2; else { log(`2.4 хувилбарын хүснэгт дахин бичсэн ч шаардлага хангаагүй (${c2.reason}) — хүснэгтгүй үлдээв`); return base; }
    }
    return c.ok ? withOptionsNote(c.blocks) : c.blocks.filter((b) => b !== findOptions(c.blocks));
  }
  if (id === "3.4") {
    let c = checkStake(blocks, ctx), out = blocks;
    if (!c.ok && gen) {
      log(`3.4 оролцогч талуудын хүснэгт шаардлага хангаагүй (${c.reason}) — дахин бичүүлж байна`);
      const extra = await gen(STAKE_PROMPT, "3.4").catch(() => []);
      const t = extra.find(isTable);
      if (t) { const cand = [...blocks.filter((b) => b !== findStake(blocks)), { ...t, caption: "Оролцогч талууд" }]; const c2 = checkStake(cand, ctx); if (c2.ok) { out = cand; c = c2; } }
    }
    if (!c.ok) { log(`3.4 оролцогч талууд: кодын загвар хүснэгтийг ашиглав (${c.reason})`); out = [...blocks.filter((b) => b !== findStake(blocks)), fallbackStake(ctx)]; }
    return stakeToEnd(out);
  }
  return blocks;
}

module.exports = { decisionPoints, applyDecisionPoints, checkOptions, checkStake, fallbackStake, stakeToEnd, postProcess, inventedNames, cleanRatingCell, OPTIONS_PROMPT, STAKE_PROMPT };
