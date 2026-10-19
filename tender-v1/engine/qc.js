'use strict';
// Чанарын хяналт. level: 'block' — файл илгээхгүй; 'warn' — оролцогчид сануулна.
const { priceBreakdown, serviceBudget, budgetRatio, fmt } = require('./calc');

const norm = (s) => String(s || '').toLowerCase().replace(/[\s.,;:()«»"'\-–—/]+/g, ' ').trim();

function similarity(a, b) {
  // Үгийн давхцлын коэффициент (Jaccard)
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / new Set([...A, ...B]).size;
}

function runQC(data) {
  const { meta = {}, tender = {}, customer = {}, sections = {} } = data;
  const issues = [];
  const add = (level, code, msg) => issues.push({ level, code, msg });
  const isGoods = meta.type === 'goods';

  // 0. Тоон шалгуурыг кодоор шалгах (он тус бүр / аль нэг)
  const statusById = new Map((customer.requirement_status || []).map((s) => [s.req_id, s]));
  const numeric = [];
  // Санал болгох үнийг урьдчилж тооцно (босго нь «санал болгох үнээс %» байж болно)
  const pre = isGoods ? priceBreakdown(tender, customer) : serviceBudget(customer);
  for (const nc of tender.numeric_criteria || []) {
    const vals = (customer.metrics || {})[nc.req_id] || {};
    const years = nc.years || Object.keys(vals);
    const per = years.map((y) => ({ year: y, value: vals[y] == null ? null : Number(vals[y]) }));
    const known = per.filter((x) => x.value != null);
    let threshold = nc.threshold;
    let basis = '';
    if (nc.threshold === 'offer') {
      threshold = pre.total == null ? null : Math.round(pre.total * Number(nc.pct || 100)) / 100;
      basis = `санал болгох үнийн ${nc.pct || 100}%`;
    } else threshold = Number(threshold);
    const op = nc.op || '>=';
    const pass = (x) => (op === '>' ? x.value > threshold : x.value >= threshold);
    let result;
    if (threshold == null || Number.isNaN(threshold)) result = 'missing';
    else if (nc.kind === 'any') result = known.some(pass) ? 'ok' : (known.length < years.length ? 'missing' : 'fail');
    else result = known.length < years.length ? (known.some((x) => !pass(x)) ? 'fail' : 'missing') : (known.every(pass) ? 'ok' : 'fail');
    numeric.push({ req_id: nc.req_id, kind: nc.kind || 'each', op, threshold, basis, label: nc.label || '', per, result });
    const st = statusById.get(nc.req_id);
    const thrText = threshold == null ? '?' : (op === '>' ? `> ${fmt(threshold)}₮` : `${fmt(threshold)}₮`);
    if (st && st.status !== result) {
      add('block', 'STATUS_CONFLICT', `Шаардлага ${nc.req_id}: тэмдэглэсэн төлөв «${st.status}», кодын тооцоогоор «${result}» (босго ${thrText}${basis ? ' — ' + basis : ''}, ${nc.kind === 'any' ? 'аль нэг жил' : 'жил тус бүр'})`);
    }
    if (!st) {
      const failed = per.filter((x) => x.value != null && !pass(x)).map((x) => `${x.year}: ${fmt(x.value)}₮`);
      statusById.set(nc.req_id, { req_id: nc.req_id, status: result, note: result === 'fail' ? `Босго ${thrText} хангахгүй (${failed.join(', ')})` : 'Кодоор тооцсон' });
    }
  }

  // 1. Шаардлагын төлөв → Go/No-go
  let fail = 0, missing = 0, ok = 0, unknown = 0;
  for (const r of tender.requirements || []) {
    const s = statusById.get(r.id);
    if (!s) { unknown++; add('block', 'REQ_UNASSESSED', `Шаардлага «${r.text}» (${r.ref}) үнэлэгдээгүй`); continue; }
    if (s.status === 'fail') fail++;
    else if (s.status === 'missing') missing++;
    else if (s.status === 'ok') ok++;
    else add('block', 'REQ_BAD_STATUS', `Шаардлага ${r.id}: тодорхойгүй төлөв «${s.status}»`);
  }
  const decision = fail > 0 ? 'nogo' : missing > 0 ? 'conditional' : 'go';
  if (fail > 0) add('warn', 'NOGO', `${fail} шаардлага хангахгүй — тендерийн материалыг бүрэн бэлдэхгүй, зөвхөн дүгнэлт гаргана`);

  // 2. Үнэ
  let calc;
  if (isGoods) {
    calc = priceBreakdown(tender, customer);
    const itemNos = new Set((tender.items || []).map((i) => String(i.no)));
    for (const p of customer.prices || []) {
      if (!itemNos.has(String(p.item_no))) add('block', 'PRICE_UNKNOWN_ITEM', `Үнэд ТББ-д байхгүй бараа №${p.item_no} орсон`);
    }
    for (const r of calc.rows) {
      if (r.missing) add('block', 'PRICE_MISSING', `Бараа №${r.no} «${r.name}»-ийн үнэ өгөгдөөгүй`);
      else if (!(r.unit_price > 0)) add('block', 'PRICE_NONPOSITIVE', `Бараа №${r.no}-ийн нэгж үнэ 0 эсвэл сөрөг`);
      if (!r.origin && !r.missing) add('warn', 'ORIGIN_MISSING', `Бараа №${r.no}-ийн гарал үүслийн улс хоосон`);
    }
  } else {
    calc = serviceBudget(customer);
    if (!calc.complete) add('block', 'BUDGET_MISSING', 'Үйлчилгээ үзүүлэх төсөв өгөгдөөгүй');
  }

  const ratio = budgetRatio(calc.total, tender.budget);
  if (ratio != null) {
    if (ratio > 1) add('warn', 'OVER_BUDGET', `Санал болгох үнэ ${fmt(calc.total)}₮ нь төсөвт өртгөөс ${(ratio * 100 - 100).toFixed(1)}%-иар их — төсөвт өртгөөс давсан тендер шалгарах магадлал маш бага, үнээ дахин тооцно уу`);
    if (ratio < 0.8) {
      const has = Array.isArray(sections.low_price_explanation) && sections.low_price_explanation.length > 0;
      add(has ? 'warn' : 'block', 'LOW_PRICE', `Үнэ төсөвт өртгийн ${(ratio * 100).toFixed(1)}% (<80%) — үндэслэлийн тайлбар ${has ? 'бэлэн' : 'АЛГА'}`);
    }
  }
  if (customer.declared_total != null && calc.total != null && Math.abs(customer.declared_total - calc.total) > 0.5) {
    add('block', 'TOTAL_MISMATCH', `Оролцогчийн хэлсэн нийт дүн ${fmt(customer.declared_total)}₮ ≠ тооцоолсон ${fmt(calc.total)}₮`);
  }

  // 2б. Үнийн санал дуудах ажиллагаа (харьцуулалтын арга)
  let auction = null;
  if (tender.auction) {
    const floor = customer.floor_price == null ? null : Number(customer.floor_price);
    auction = { start: tender.auction.start, hours: tender.auction.hours, start_price: calc.total, floor,
      floor_ratio: floor && tender.budget ? floor / tender.budget : null, threshold80: tender.budget ? Math.round(tender.budget * 0.8) : null };
    if (floor == null) add('block', 'FLOOR_MISSING', 'Үнийн санал дуудах ажиллагаатай тендер — оролцогчийн доод үнэ (өртөг + хамгийн бага ашиг) өгөгдөөгүй');
    else {
      if (calc.total != null && floor > calc.total) add('block', 'FLOOR_ABOVE_START', `Доод үнэ ${fmt(floor)}₮ нь эхлэх үнэ ${fmt(calc.total)}₮-өөс их`);
      if (auction.threshold80 && floor < auction.threshold80) {
        const has = Array.isArray(sections.low_price_explanation) && sections.low_price_explanation.length > 0;
        add('warn', 'FLOOR_BELOW_80', `Доод үнэ төсөвт өртгийн ${(auction.floor_ratio * 100).toFixed(1)}% — ${fmt(auction.threshold80)}₮-өөс доош буувал үндэслэлийн тайлбар заавал${has ? ' (бэлэн)' : ' (одоогоор АЛГА — бэлтгэ)'}`);
      }
    }
  }

  // 2б2. Барилга угсралтын шинжтэй эсэх (төрөл нь «үйлчилгээ/бараа» байсан ч)
  const worksText = [(tender.name || ''), ...(tender.requirements || []).map((r) => r.text + ' ' + (r.evidence || '')), ...(meta.source_files || [])].join(' ');
  if (/БА\s*-\s*\d|барилга угсралт|угсралтын ажил|ажлын зураг|зураг төсөл|ажлын төсөв|шугам шинэчл|их засвар/i.test(worksText) || tender.works_like) {
    add('block', 'WORKS_LIKE', 'Тендер барилга угсралтын ажлын шинжтэй (барилгын тусгай зөвшөөрөл, ажлын зураг, төсөв). Энэ хувилбар ажил гүйцэтгэх тендерийн төсөв гаргахгүй — оролцогчийн төсөвчний гаргасан төсөвтэй байх, эсвэл зөвхөн шалгах жагсаалтаар хязгаарлах');
  }

  // 2в. ТББ-ийн зөрчил
  for (const x of tender.inconsistencies || []) add('warn', 'TBB_INCONSISTENCY', `ТББ-ийн зөрчил (${x.ref || ''}): ${x.text}`);
  if ((tender.inconsistencies || []).length && tender.opening && data.now) {
    // Тодруулгыг нээлтээс ажлын 5-аас доошгүй өдрийн өмнө гаргана (баярын өдрийг тооцоогүй)
    let d = new Date(data.now), wd = 0;
    const end = new Date(tender.opening);
    while (d < end) { d = new Date(d.getTime() + 864e5); const g = d.getDay(); if (g !== 0 && g !== 6 && d < end) wd++; }
    if (wd < 5) add('warn', 'CLARIFICATION_LATE', `Нээлт хүртэл ажлын ${wd} өдөр — тодруулга авах хугацаа (≥5 ажлын өдөр) өнгөрсөн байж болзошгүй`);
    else if (wd <= 6) add('warn', 'CLARIFICATION_URGENT', `Тодруулгын хүсэлтийг ӨНӨӨДӨР-МАРГААШ илгээнэ үү — нээлт хүртэл ажлын ${wd} өдөр үлдсэн (≥5 шаардлагатай)`);
  }

  // 3. Хүчинтэй хугацаа
  const vmin = Number(tender.validity_days_min || 30);
  if (customer.validity_days == null) add('block', 'VALIDITY_MISSING', 'Тендер хүчинтэй байх хоног тогтоогоогүй');
  else if (Number(customer.validity_days) < vmin) add('block', 'VALIDITY_SHORT', `Хүчинтэй хугацаа ${customer.validity_days} < шаардлагатай ${vmin}`);

  // 4. Нийлүүлэх хугацаа
  if (isGoods) {
    const prop = new Map((customer.proposed_delivery || []).map((d) => [String(d.item_no), d]));
    for (const it of tender.items || []) {
      const d = prop.get(String(it.no));
      if (!d) { add('block', 'DELIVERY_MISSING', `Бараа №${it.no}-ийн нийлүүлэх хугацааны санал алга`); continue; }
      if (it.max_days != null && d.days != null && Number(d.days) > Number(it.max_days)) {
        add('block', 'DELIVERY_LATE', `Бараа №${it.no}: санал ${d.days} хоног > зөвшөөрөгдөх ${it.max_days} хоног`);
      }
    }
  }

  // 5. Техникийн санал: хуулбар, хоосон
  if (isGoods) {
    const itemName = new Map((tender.items || []).map((i) => [String(i.no), i.name]));
    const offers = new Map((customer.tech_offer || []).map((o) => [`${o.item_no}|${o.spec_no}`, o]));
    for (const s of tender.tech_specs || []) {
      const o = offers.get(`${s.item_no}|${s.no}`);
      if (!o || !String(o.offered || '').trim()) {
        add('warn', 'TECH_MISSING', `Бараа №${s.item_no}, үзүүлэлт ${s.no}: санал болгож буй утга алга — [ДУТУУ] гэж тэмдэглэнэ`);
        continue;
      }
      const sim = similarity(s.requirement, o.offered);
      if (norm(s.requirement) === norm(o.offered) || sim >= 0.85) {
        // Богино тоон үзүүлэлтийг бодит бараа яг хангаж болно → анхааруулна. Шаардлагын хэллэг эсвэл урт текст хуулсан бол зогсооно.
        const reqLang = /(багагүй|доошгүй|дээш|илүүгүй|дүйцэх|эсвэл|байна|байх|шаардлага|тохиромжтой)/i.test(o.offered);
        const long = norm(o.offered).split(' ').length >= 8;
        if (reqLang || long) add('block', 'TECH_COPIED', `Бараа №${s.item_no}, үзүүлэлт ${s.no}: Захиалагчийн шаардлагыг хуулсан байж болзошгүй (давхцал ${(sim * 100).toFixed(0)}%) — бодит барааны үзүүлэлтийг бичнэ үү`);
        else add('warn', 'TECH_SAME_AS_REQ', `«${itemName.get(String(s.item_no)) || s.item_no}» — «${s.requirement}»: санал шаардлагатай яг ижил бичигдсэн, каталогт ийм утга байгааг шалгана уу`);
      }
      if (!String(o.evidence || '').trim()) add('warn', 'TECH_NO_EVIDENCE', `Бараа №${s.item_no}, үзүүлэлт ${s.no}: нотлох баримт заагаагүй`);
      if (o.compliance === 'Зөрүүтэй') {
        if (!String(o.note || '').trim()) add('block', 'TECH_DEVIATION_NO_NOTE', `Бараа №${s.item_no}, үзүүлэлт ${s.no}: зөрүүтэй боловч тайлбаргүй`);
        else add('warn', 'TECH_DEVIATION', `«${itemName.get(String(s.item_no)) || s.item_no}»: шаардлага «${s.requirement}», таных «${o.offered}» — татгалзах эрсдэлтэй`);
      }
    }
  }

  // 6. Компанийн мэдээлэл
  const c = customer.company || {};
  for (const k of ['name', 'reg_no', 'address']) if (!c[k]) add('block', 'COMPANY_' + k.toUpperCase(), `Компанийн «${k}» талбар хоосон`);
  const sg = customer.signatory || {};
  if (!sg.name || !sg.position) add('block', 'SIGNATORY', 'Гарын үсэг зурах этгээдийн нэр, албан тушаал алга');
  if (sg.name && sg.is_director === false) add('warn', 'POA', 'Гарын үсэг зурах хүн захирал биш — итгэмжлэл шаардлагатай');

  // 7. Хугацаа дөхсөн эсэх
  if (tender.deadline && data.now) {
    const hrs = (new Date(tender.deadline) - new Date(data.now)) / 36e5;
    if (hrs < 0) add('block', 'DEADLINE_PASSED', 'Тендер хүлээн авах хугацаа дууссан');
    else if (hrs < 48) add('warn', 'DEADLINE_NEAR', `Эцсийн хугацаа хүртэл ${Math.floor(hrs)} цаг үлдсэн`);
  }

  // 8. Үйлчилгээний аргачлал
  const needMeth = Array.isArray(tender.forms) ? tender.forms.some((f) => f.key === 'methodology') : !isGoods;
  if (needMeth && !(Array.isArray(sections.methodology) && sections.methodology.length)) {
    add('block', 'METHODOLOGY_MISSING', 'Ажлын хөтөлбөр, аргачлал бичигдээгүй (ТББ-д шаардсан)');
  }

  // 8б. Бүрдүүлэх баримтын слот, хүчинтэй хугацаа
  const docs = customer.documents || [];
  const deadline = tender.deadline ? new Date(tender.deadline) : null;
  for (const d of docs) {
    if (d.status === 'missing' && d.required !== false) add('warn', 'DOC_MISSING', `Баримт дутуу: ${d.name}`);
    if (d.expires && deadline) {
      const exp = new Date(d.expires);
      const days = Math.round((exp - deadline) / 864e5);
      if (days < 0) add('block', 'DOC_EXPIRED', `«${d.name}»-ийн хүчинтэй хугацаа (${d.expires}) тендерийн эцсийн хугацаанаас өмнө дуусна`);
      else if (days < 60) add('warn', 'DOC_EXPIRING', `«${d.name}»-ийн хүчинтэй хугацаа ${d.expires}-нд дуусна (тендерээс хойш ${days} хоног) — гэрээний хугацаанд шинэчлэх шаардлагатай байж болно`);
    }
  }

  // 8в. «Бид бэлтгэнэ» гэсэн амлалт бүр материалд байгаа эсэх
  const letterRefs = new Set((data.letters || []).map((l) => l.ref));
  const draftKeys = new Set((data.drafts || []).filter((d) => (d.sections || []).length).map((d) => d.key));
  for (const r of tender.requirements || []) {
    if (!r.produces) continue;
    let ok2 = true;
    if (r.produces === 'company_profile') ok2 = ((sections.company_profile) || []).length > 0;
    else if (r.produces === 'letter') ok2 = letterRefs.has(r.ref);
    else if (r.produces.startsWith('draft:')) ok2 = draftKeys.has(r.produces.slice(6));
    else if (r.produces === 'methodology') ok2 = ((sections.methodology) || []).length > 0;
    if (!ok2) add('block', 'PROMISE_UNMET', `«${r.text}» — бэлтгэнэ гэж тэмдэглэсэн боловч материалд алга (${r.produces})`);
  }

  // 8г. CV маягт шаардсан бол
  if ((tender.forms || []).some((f) => f.key === 'cv')) {
    const noCv = (customer.staff || []).filter((x) => !x.cv).map((x) => x.name);
    if (!(customer.staff || []).length) add('warn', 'CV_MISSING', 'ТББ ажилтны CV (товч намтар) шаардсан — ажилтны мэдээлэл ирээгүй');
    else if (noCv.length) add('warn', 'CV_MISSING', `ТББ ажилтны CV шаардсан — ${noCv.length} ажилтны төрсөн он, боловсрол, ажлын туршлагын дэлгэрэнгүй дутуу (${noCv.join(', ')})`);
  }

  // 9. Албан бичиг
  for (const l of data.letters || []) {
    if (!(l.paragraphs || []).length) add('block', 'LETTER_EMPTY', `Албан бичиг «${l.title}» хоосон`);
    if ((l.paragraphs || []).some((x) => x.includes('[ДУТУУ'))) add('warn', 'LETTER_PLACEHOLDER', `Албан бичиг «${l.title}»-д оролцогчийн нөхөх [ДУТУУ] хэсэг бий`);
  }

  const blocked = issues.some((i) => i.level === 'block');
  return { decision, counts: { ok, missing, fail, unknown }, calc, ratio, issues, blocked, numeric, auction, statusById };
}

module.exports = { runQC, similarity };
