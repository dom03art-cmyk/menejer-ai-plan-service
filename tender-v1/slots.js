// Бүрдүүлэх материалын «нүд»-нүүд (slot). ТББ задалсны дараа тухайн тендерт зориулж үүснэ:
//   • field — бичих мэдээлэл (компани, гарын үсэг, хүчинтэй хугацаа, доод үнэ, тоон шалгуур г.м.) — код шалгана
//   • table — бараа бүрийн үнэ/загвар/хугацаа эсвэл үйлчилгээний төсөв — код шалгана
//   • file  — оролцогчийн баримт (гэрчилгээ, санхүүгийн тайлан, гэрээ, каталог...) — орох бүрт Claude (хямд загвар) шалгана
// Төлөв: green (зөв) | yellow (анхаарах) | red (дутуу/буруу) | empty (хоосон). kind: attach (өөрөө хавсаргаж болно) | data (маягтад орно) | fail (шаардлага хангахгүй)
const { fmt } = require("./engine/calc");
const MOCK = () => process.env.TENDER_MOCK === "1";

// ---------- нүд үүсгэх ----------
function buildSlots(base, fileSlots = [], extraFields = []) {
  const t = base.tender || {}, goods = base.meta && base.meta.type === "goods";
  const S = [];
  const F = (key, label, o = {}) => S.push({ key, kind: "field", group: o.group || "company", label, input: o.input || "text", required: o.required !== false, help: o.help || "", options: o.options, req_id: o.req_id });
  F("company.name", "Компанийн бүтэн нэр", { help: "Улсын бүртгэлийн гэрчилгээнд байгаагаар (жишээ: «Дом Арт Дизайн» ХХК)" });
  F("company.reg_no", "Регистрийн дугаар", { help: "7 оронтой тоо" });
  F("company.address", "Хаяг");
  F("company.phone", "Утас");
  F("company.email", "Имэйл", { required: false });
  F("company.vat_payer", "НӨАТ төлөгч мөн үү?", { input: "select", options: ["Тийм", "Үгүй"] });
  F("signatory.name", "Тендерт гарын үсэг зурах хүний овог нэр", { group: "sign" });
  F("signatory.position", "Албан тушаал", { group: "sign", help: "Захирал биш бол итгэмжлэл хавсаргана" });
  F("signatory.is_director", "Гүйцэтгэх захирал мөн үү?", { group: "sign", input: "select", options: ["Тийм", "Үгүй"] });
  F("validity_days", `Тендер хүчинтэй байх хугацаа (${t.validity_unit === "working_days" ? "ажлын өдөр" : "хоног"})`, { group: "offer", input: "number", help: `ТББ-д доод тал нь ${t.validity_days_min || 30}. Хоосон орхивол яг доод хэмжээгээр бичнэ.`, required: false });
  if (goods && (t.items || []).length) {
    S.push({ key: "prices", kind: "table", group: "offer", label: "Бараа бүрийн үнэ, загвар, хүргэх хугацаа", required: true,
      help: "Нэгж үнэ — татвар, тээврийг оруулалгүй. Загвар/үйлдвэрлэгч — нийлүүлэх барааны бодит нэр (техникийн саналд орно).",
      columns: [{ k: "unit_price", t: "Нэгж үнэ ₮", n: 1, req: 1 }, { k: "transport", t: "Тээвэр ₮", n: 1 }, { k: "tax", t: "Татвар ₮", n: 1 }, { k: "origin", t: "Гарал үүслийн улс", req: 1 }, { k: "model", t: "Загвар / үйлдвэрлэгч", req: 1 }, { k: "days", t: "Хүргэх хоног", n: 1, req: 1 }],
      rows: t.items.map((it) => ({ id: String(it.no), qty: Number(it.qty) || 0, label: `${it.no}. ${it.name} — ${fmt(it.qty)} ${it.unit || ""}${it.max_days ? ` (≤${it.max_days} хоног)` : ""}`, max_days: it.max_days || null })) });
  } else if (!goods) {
    S.push({ key: "service_budget", kind: "table", group: "offer", label: "Үйлчилгээний төсөв (зардлын мөр бүр)", required: true, free: true,
      help: "Жишээ: харуулын цалин, НДШ, хоол, хувцас, тоног төхөөрөмж, удирдлагын зардал, ашиг. Нийт нь таны санал болгох үнэ болно.",
      columns: [{ k: "name", t: "Зардлын нэр", req: 1 }, { k: "qty", t: "Тоо", n: 1, req: 1 }, { k: "unit", t: "Нэгж" }, { k: "unit_price", t: "Нэгж үнэ ₮", n: 1, req: 1 }], rows: [] });
  }
  if (t.auction) F("floor_price", "Доод үнэ (үнийн санал дуудах ажиллагаанд үүнээс доош буухгүй)", { group: "offer", input: "number", help: "Өртөг дээр хамгийн бага ашгаа нэмсэн дүн. Энэ тендер 2 цагийн цахим үнийн санал дуудах ажиллагаатай." });
  for (const nc of t.numeric_criteria || []) {
    const req = (t.requirements || []).find((r) => r.id === nc.req_id) || {};
    const years = nc.years && nc.years.length ? nc.years : [String(new Date().getFullYear() - 1)];
    for (const y of years) F(`metrics.${nc.req_id}.${y}`, `${nc.label || req.text || nc.req_id} — ${y} он (₮)`, { group: "metrics", input: "number", req_id: nc.req_id, required: nc.kind !== "any",
      help: `${nc.threshold === "offer" ? `Босго: санал болгох үнийн ${nc.pct || 100}%` : `Босго: ${nc.op === ">" ? "0-ээс их" : fmt(nc.threshold) + "₮"}`}${nc.kind === "any" ? " (аль нэг онд хангахад хангалттай)" : ""}. ${req.ref || ""}` });
  }
  for (const x of extraFields || []) if (x && x.key && !S.some((s) => s.key === x.key)) F(`extra.${x.key}`, x.label, { group: "other", input: x.input === "number" ? "number" : "textarea", required: !!x.required, help: x.help || "" });
  for (const x of fileSlots || []) if (x && x.key) S.push({ key: `file.${x.key}`, kind: "file", group: "docs", label: x.label, help: x.help || "", required: x.required !== false, req_id: x.req_id || null, multi: !!x.multi, checks: x.checks || {} });
  return S;
}

// ---------- код шалгалт (field, table) ----------
const num = (v) => { const n = Number(String(v ?? "").replace(/[\s,₮]/g, "")); return Number.isFinite(n) ? n : null; };
function checkField(slot, value, ctx) {
  const v = String(value ?? "").trim();
  if (!v) return slot.required ? { status: "red", kind: "data", msg: "Бөглөөгүй" } : { status: "empty", msg: "" };
  if (slot.input === "number" && num(v) === null) return { status: "red", kind: "data", msg: "Зөвхөн тоо бичнэ үү" };
  if (slot.key === "company.reg_no" && !/^\d{7}$/.test(v.replace(/\s/g, ""))) return { status: "yellow", msg: "Регистр ихэвчлэн 7 оронтой тоо байдаг — шалгана уу" };
  if (slot.key === "signatory.is_director" && v === "Үгүй") return { status: "yellow", kind: "attach", msg: "Захирал биш бол итгэмжлэл хавсаргах шаардлагатай" };
  if (slot.key === "validity_days") { const min = (ctx.tender || {}).validity_days_min || 30; if (num(v) < min) return { status: "red", kind: "data", msg: `ТББ-д доод тал нь ${min}` }; }
  if (slot.key === "floor_price") { const total = ctx.offerTotal; if (total && num(v) > total) return { status: "red", kind: "data", msg: `Санал болгох үнээс (${fmt(total)}₮) их байж болохгүй` }; const b = (ctx.tender || {}).budget; if (b && num(v) < b * 0.8) return { status: "yellow", msg: `Төсөвт өртгийн 80%-иас доош — хэт бага үнийн тайлбар шаардлагатай` }; }
  if (slot.key.startsWith("metrics.")) {
    const [, rid] = slot.key.split("."); const nc = ((ctx.tender || {}).numeric_criteria || []).find((n) => n.req_id === rid);
    if (nc) {
      const thr = nc.threshold === "offer" ? (ctx.offerTotal ? ctx.offerTotal * (nc.pct || 100) / 100 : null) : Number(nc.threshold);
      const ok = thr == null ? null : nc.op === ">" ? num(v) > thr : num(v) >= thr;
      if (ok === false) return nc.kind === "any" ? { status: "yellow", msg: `Энэ онд босго (${fmt(thr)}₮) хангахгүй — өөр онд хангавал болно` } : { status: "red", kind: "fail", msg: `Босго ${nc.op === ">" ? "0-ээс их" : fmt(thr) + "₮"} хангахгүй — тендерээс хасагдах эрсдэлтэй` };
      if (ok === null) return { status: "yellow", msg: "Санал болгох үнээ оруулсны дараа шалгагдана" };
    }
  }
  return { status: "green", msg: "" };
}
function checkTable(slot, rows, ctx) {
  rows = Array.isArray(rows) ? rows : [];
  const reqCols = slot.columns.filter((c) => c.req);
  const filled = (slot.free ? rows : slot.rows.map((r) => rows.find((x) => String(x.id) === r.id) || { id: r.id })).filter(Boolean);
  if (slot.free && !filled.length) return { status: "red", kind: "data", msg: "Төсвийн мөр оруулаагүй" };
  const missing = filled.filter((r) => reqCols.some((c) => r[c.k] == null || String(r[c.k]).trim() === ""));
  const late = slot.free ? [] : slot.rows.filter((sr) => { const r = filled.find((x) => String(x.id) === sr.id); return sr.max_days && r && num(r.days) > sr.max_days; });
  if (late.length) return { status: "red", kind: "data", msg: `Хүргэх хугацаа хэтэрсэн: ${late.map((x) => x.id).join(", ")}-р бараа` };
  if (missing.length) return { status: "red", kind: "data", msg: `${missing.length} мөр дутуу бөглөгдсөн` };
  return { status: "green", msg: "" };
}

// Нийт санал болгох үнэ (босго шалгахад)
function offerTotal(slots, values) {
  const v = values || {};
  if (v.prices && Array.isArray(v.prices.value)) {
    const items = (slots.find((s) => s.key === "prices") || {}).rows || [];
    return v.prices.value.reduce((a, r) => { const it = items.find((x) => x.id === String(r.id)); return a + (num(r.unit_price) || 0) * ((it && it.qty) || 0) + (num(r.transport) || 0) + (num(r.tax) || 0); }, 0) || null;
  }
  if (v.service_budget && Array.isArray(v.service_budget.value)) return v.service_budget.value.reduce((a, r) => a + (num(r.qty) || 0) * (num(r.unit_price) || 0), 0) || null;
  return null;
}

// ---------- файл шалгалт (Claude, хямд загвар) ----------
const FILE_SYS = `Чи тендерийн баримт шалгагч. Оролцогчийн оруулсан файлыг тухайн нүдний шаардлагатай тулгаж, ЗӨВХӨН JSON хариул.
- matches: энэ файл нүдэнд шаардсан баримт мөн эсэх (өөр баримт бол false).
- readable: уншигдах эсэх (бүдэг, хагас зураг бол false).
- company_name, reg_no: баримтад бичигдсэн байгууллагын нэр, регистр (байвал, яг байгаагаар).
- valid_until: хүчинтэй хугацаа дуусах огноо YYYY-MM-DD (байвал). issued: олгосон огноо.
- years: баримтад хамаарах он(ууд), values: гол тоонууд (жишээ {"борлуулалт_2024": 120000000, "цэвэр_ашиг_2024": 5000000, "мөнгөн_хөрөнгө": ...}).
- facts: материал бэлтгэхэд хэрэгтэй гол мэдээлэл 1–8 мөрөөр (гэрээний нэр, захиалагч, дүн, хугацаа; барааны загвар, үзүүлэлт; ажилтны нэр, мэргэжил г.м.). Тоог яг байгаагаар.
- problems: асуудлууд (богино, монголоор). Баримт зохиохгүй, таамаглахгүй.
{"matches":true,"readable":true,"doc_type":"","company_name":"","reg_no":"","valid_until":"","issued":"","years":[],"values":{},"facts":[],"problems":[]}`;

function sniffImg(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.slice(0, 4).toString() === "RIFF") return "image/webp";
  return null;
}
async function fileContent(f, buf) {
  const n = String(f.name || "").toLowerCase();
  if (/\.pdf$/.test(n) || /pdf/.test(f.mime || "")) return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }];
  const img = sniffImg(buf); if (img) return [{ type: "image", source: { type: "base64", media_type: img, data: buf.toString("base64") } }];
  if (/\.docx$/.test(n)) return [{ type: "text", text: (await require("mammoth").extractRawText({ buffer: buf })).value.slice(0, 60000) }];
  if (/\.(xlsx|xls|xlsm)$/.test(n)) { const X = require("xlsx"), wb = X.read(buf, { type: "buffer" }); return [{ type: "text", text: wb.SheetNames.map((s) => `# ${s}\n` + X.utils.sheet_to_csv(wb.Sheets[s])).join("\n").slice(0, 60000) }]; }
  return [{ type: "text", text: buf.toString("utf8").slice(0, 60000) }];
}

async function readFileForSlot(slot, f, buf) {
  if (MOCK()) return require("./test/mock").respond("FILE", { slot, name: f.name, text: buf.toString("utf8") });
  const { callJSON, FAST } = require("../plan-v2/claude");
  const content = [...(await fileContent(f, buf)), { type: "text", text: `Нүд: «${slot.label}»${slot.help ? ` (${slot.help})` : ""}. Файлын нэр: ${f.name}. Шалгаад JSON бич.` }];
  return callJSON({ system: FILE_SYS, user: content, model: process.env.TENDER_CHECK_MODEL || FAST, maxTokens: 2500 });
}

// Claude-ийн уншсан үр дүн + код шалгалт → төлөв
function judgeFile(slot, r, ctx) {
  const probs = [...(r.problems || [])];
  if (r.readable === false) return { status: "red", kind: "attach", msg: "Уншигдахгүй байна — тод хувийг оруулна уу", facts: r.facts || [] };
  if (r.matches === false) return { status: "red", kind: "attach", msg: `Энэ нүдэнд таарахгүй баримт байна${r.doc_type ? ` (${r.doc_type})` : ""}`, facts: [] };
  const dl = ctx.deadline ? new Date(ctx.deadline) : new Date();
  if (r.valid_until && /^\d{4}-\d{2}-\d{2}/.test(r.valid_until)) {
    const exp = new Date(r.valid_until);
    if (exp < dl) return { status: "red", kind: "attach", msg: `Хүчинтэй хугацаа ${r.valid_until}-нд дууссан/тендерээс өмнө дуусна — шинэчилсэн хувийг оруулна уу`, facts: r.facts || [] };
    if ((exp - dl) / 864e5 < 60) probs.push(`Хүчинтэй хугацаа ${r.valid_until}-нд дуусна (гэрээний хугацаанд шинэчлэх шаардлагатай байж болно)`);
  }
  const cn = String(ctx.companyName || "").toLowerCase().replace(/[«»"' ]|ххк|ххк|llc/gi, ""), rn = String(r.company_name || "").toLowerCase().replace(/[«»"' ]|ххк|llc/gi, "");
  if (cn && rn && !rn.includes(cn) && !cn.includes(rn)) probs.push(`Баримт дээрх нэр «${r.company_name}» таны оруулсан компанийн нэртэй таарахгүй`);
  if (ctx.regNo && r.reg_no && String(r.reg_no).replace(/\D/g, "") !== String(ctx.regNo).replace(/\D/g, "")) probs.push(`Регистр ${r.reg_no} таарахгүй`);
  return probs.length ? { status: "yellow", msg: probs.slice(0, 3).join("; "), facts: r.facts || [] } : { status: "green", msg: r.doc_type || "", facts: r.facts || [] };
}

// Бүх нүдний төлвийг дахин тооцно (file — хадгалсан үр дүнгээр)
function evaluate(slots, values, ctx) {
  const out = {}; const total = offerTotal(slots, values);
  const c = { ...ctx, offerTotal: total, companyName: values["company.name"] && values["company.name"].value, regNo: values["company.reg_no"] && values["company.reg_no"].value };
  for (const s of slots) {
    const v = values[s.key] || {};
    if (s.kind === "field") out[s.key] = checkField(s, v.value, c);
    else if (s.kind === "table") out[s.key] = checkTable(s, v.value, c);
    else {
      const files = v.files || [];
      if (!files.length) out[s.key] = s.required ? { status: "red", kind: "attach", msg: "Файл оруулаагүй" } : { status: "empty", msg: "" };
      else { const ord = { red: 3, yellow: 2, green: 1 }; const worst = files.map((f) => judgeFile(s, f.read || {}, c)).sort((a, b) => ord[b.status] - ord[a.status])[0]; out[s.key] = worst; }
    }
  }
  return { status: out, offerTotal: total };
}

// Нүднүүдийн утгыг хөдөлгүүрийн «бөглөсөн маягт» болгон (Claude B1/B2-д өгөх текст)
function formText(slots, values, status) {
  const L = [];
  for (const s of slots) {
    const v = values[s.key] || {}, st = (status || {})[s.key] || {};
    const mark = { green: "✔", yellow: "⚠", red: "✘", empty: "—" }[st.status] || "—";
    if (s.kind === "field") L.push(`${mark} ${s.label}: ${v.value ?? "(бөглөөгүй)"}${st.msg ? ` [${st.msg}]` : ""}`);
    else if (s.kind === "table") { L.push(`${mark} ${s.label}:`); for (const r of v.value || []) L.push("   " + JSON.stringify(r)); if (!(v.value || []).length) L.push("   (бөглөөгүй)"); }
    else { L.push(`${mark} ${s.label}${s.req_id ? ` (шаардлага ${s.req_id})` : ""}: ${(v.files || []).length ? "" : "ФАЙЛ АЛГА — оролцогч өөрөө хавсаргана"}${st.msg ? ` [${st.msg}]` : ""}`);
      for (const f of v.files || []) { const r = f.read || {}; L.push(`   • ${f.name}${r.valid_until ? `, хүчинтэй ${r.valid_until}` : ""}${r.company_name ? `, ${r.company_name}` : ""}`); for (const x of r.facts || []) L.push(`     - ${x}`); if (r.values && Object.keys(r.values).length) L.push(`     - тоо: ${JSON.stringify(r.values)}`); } }
  }
  return L.join("\n");
}

// Улаан нүдийг ангилна (материал гаргахын өмнөх сануулга)
function reds(slots, status) {
  const R = { attach: [], data: [], fail: [] };
  for (const s of slots) { const st = status[s.key]; if (st && st.status === "red") (R[st.kind] || R.data).push({ key: s.key, label: s.label, msg: st.msg }); }
  return R;
}

module.exports = { buildSlots, checkField, checkTable, offerTotal, readFileForSlot, judgeFile, evaluate, formText, reds, num };
