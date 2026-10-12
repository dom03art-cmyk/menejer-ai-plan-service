// Тайлан, төлөвлөгөөний засвар.
//  - Хүргэсэн баримтын төлөвийг (оролт, бичсэн хэсгүүд) Redis-д хадгална: orgsnap:<psid>:<product>
//  - Сүүлийн захиалгын бүртгэл (засварын эрх тоолох): orglast:<psid>
//  - Засварын төлөвлөгч: аль хэсгийг дахин бичих, ямар тоог засах (patch) — кодоор хэрэгжүүлнэ.
// REDIS_URL байхгүй бол процессын санах ойд (туршилт).
const zlib = require("zlib");
const { callJSON, WRITER } = require("../plan-v2/claude");
const TTL = Number(process.env.ORG_SNAP_TTL_DAYS || 30) * 86400;
const mem = new Map();
let ready = null;
function client() {
  if (!process.env.REDIS_URL) return Promise.resolve(null);
  if (!ready) {
    const { createClient } = require("redis");
    const c = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 10000, reconnectStrategy: (n) => Math.min(n * 500, 5000) } });
    c.on("error", (e) => console.warn("[org-rev]", e.message));
    ready = c.connect().then(() => c).catch((e) => { console.warn("[org-rev] Redis алга:", e.message); ready = null; return null; });
  }
  return ready;
}
async function put(key, obj) {
  const v = zlib.gzipSync(JSON.stringify(obj)).toString("base64");
  const c = await client(); if (c) await c.set(key, v, { EX: TTL }); else mem.set(key, v);
}
async function get(key) {
  const c = await client(); const v = c ? await c.get(key) : mem.get(key);
  return v ? JSON.parse(zlib.gunzipSync(Buffer.from(v, "base64")).toString("utf8")) : null;
}
const saveSnap = (psid, product, snap) => put(`orgsnap:${psid}:${product}`, { ...snap, savedAt: Date.now() }).catch((e) => console.warn("[org-rev] хадгалж чадсангүй:", e.message));
const loadSnap = (psid, product) => get(`orgsnap:${psid}:${product}`).catch(() => null);
const getLast = (psid) => get(`orglast:${psid}`).catch(() => null);
const setLast = (psid, v) => put(`orglast:${psid}`, v).catch(() => { });

// Нэмэлт засварын үнэ (1 дэх засвар үнэгүй)
const REV_PRICE = { report_dept: 19900, plan_dept: 19900, report_dir: 29900, plan: 29900 };

const PLANNER = `Чи байгууллагын тайлан, төлөвлөгөөний засварын төлөвлөгч. Захиалагчийн засварын хүсэлтийг уншаад ЗӨВХӨН JSON буцаа.
1) actionable: хүсэлтэд тодорхой өөрчлөлт (засах, нэмэх, хасах, тоо солих, хэлбэр өөрчлөх) байвал true. "Баярлалаа", "за", "ойлголоо" гэх мэт өөрчлөлтгүй мессеж бол false.
2) in_scope: засвар энэ баримтын (байгууллага, нэгж, сэдэв) хүрээнд бол true. Огт өөр байгууллага, өөр төрлийн баримт (жишээ нь бизнес төсөл) хүсвэл false.
3) sections: текстийг нь дахин бичих хэсгүүдийн id (зөвхөн өгсөн жагсаалтаас). Ерөнхий хүсэлт бол хамгийн хамааралтайг сонго.
4) patch: тоо, нэр засах шаардлагатай бол л (үгүй бол null). Захиалагчийн хэлсэн тоог яг тэр чигээр нь ав, өөрөө тоо зохиохгүй. Оноосон нэрийг захиалагч өөрөө хүсээгүй бол өөрчлөхгүй.
   - "A": {"org_name"?, "unit_name"?, "reporter_title"?} — нэр засах.
   - Тайлан, хэлтсийн төлөвлөгөөнд "indicators": [{"name": "ОДОО БАЙГАА нэрээр нь", "value"?, "target"?, "monthly"?: [12 утга, мэдээлэлгүй сар null], "prev"?, "unit"?, "remove"?: true}] — шинэ үзүүлэлт бол шинэ нэр, бүх талбартай.
   - Байгууллагын төлөвлөгөөнд "cfg": {"opening_cash"?, "si_rate"?, "tax_rate"?, "min_wage"?, "income"?: [{"name", ...өөрчлөх талбар}], "staff"?: [{"title", ...}], "expenses"?: [{"name", ...}], "initiatives"?: [{"name", ...}], "capex"?: [{"name", ...}], "loans"?: [{"name", ...}]} — мөрийг нэрээр нь олж зөвхөн заасан талбарыг солино; шинэ нэр бол нэмэгдэнэ; {"name": "...", "remove": true} бол хасна.
5) note: юу өөрчлөхийг монгол хэлээр 1 өгүүлбэр.
JSON: {"actionable": true, "in_scope": true, "sections": ["2.1"], "patch": null, "note": ""}`;

async function plan({ request, outline, A, m, cfg, product }) {
  const items = outline.filter((o) => o.group !== "static" && (o.words || o.guide)).map((o) => `${o.id} — ${o.t.replace(/^\S+ /, "")}`);
  const current = product === "plan"
    ? { opening_cash: cfg.opening_cash, si_rate: cfg.si_rate, tax_rate: cfg.tax_rate, income: (cfg.income || []).map((x) => ({ name: x.name, kind: x.kind, annual: x.annual, units_annual: x.units_annual, price: x.price, monthly: x.monthly, units_monthly: x.units_monthly })),
        staff: (cfg.staff || []).map((x) => ({ title: x.title, count: x.count, gross: x.gross, start: x.start, end: x.end })), expenses: (cfg.expenses || []).map((x) => ({ name: x.name, monthly: x.monthly, annual: x.annual, pct_of_income: x.pct_of_income })),
        initiatives: (cfg.initiatives || []).map((x) => ({ name: x.name, budget: x.budget, start: x.start, end: x.end })), capex: cfg.capex || [], loans: cfg.loans || [] }
    : { indicators: (m.indicators || []).map((x) => ({ name: x.name, unit: x.unit, value: x.value, target: x.target, monthly: x.monthly, prev: x.prev })) };
  const out = await callJSON({ system: PLANNER, model: WRITER, maxTokens: 8000,
    user: `ЗАСВАРЫН ХҮСЭЛТ:\n${String(request).slice(0, 4000)}\n\nБАЙГУУЛЛАГА: ${JSON.stringify({ org_name: A.org_name, unit_name: A.unit_name, reporter_title: A.reporter_title })}\n\nОДООГИЙН ТОО:\n${JSON.stringify(current).slice(0, 40000)}\n\nХЭСГҮҮДИЙН ЖАГСААЛТ:\n${items.join("\n")}` });
  const valid = new Set(outline.filter((o) => o.group !== "static").map((o) => o.id));
  return { actionable: out.actionable !== false, inScope: out.in_scope !== false, sections: (out.sections || []).map(String).filter((id) => valid.has(id)), patch: out.patch && typeof out.patch === "object" ? out.patch : null, note: String(out.note || "") };
}

// Мөрийг нэрээр нь олж засах / нэмэх / хасах
function mergeList(list, items, key) {
  const out = (list || []).map((x) => ({ ...x }));
  for (const it of items || []) {
    if (!it || !it[key]) continue;
    const i = out.findIndex((x) => String(x[key]).trim().toLowerCase() === String(it[key]).trim().toLowerCase());
    if (it.remove) { if (i >= 0) out.splice(i, 1); continue; }
    const { remove, ...rest } = it;
    if (i >= 0) out[i] = { ...out[i], ...rest }; else out.push(rest);
  }
  return out;
}
function applyPatch(patch, { A, m, cfg }) {
  if (!patch) return { A, m, cfg, changed: false };
  let changed = false;
  if (patch.A && typeof patch.A === "object") for (const k of ["org_name", "unit_name", "reporter_title"]) if (patch.A[k]) { A = { ...A, [k]: String(patch.A[k]) }; changed = true; if (m && k !== "reporter_title") m = { ...m, [k]: String(patch.A[k]) }; if (cfg && k === "org_name") cfg = { ...cfg, org_name: String(patch.A[k]) }; }
  if (m && Array.isArray(patch.indicators) && patch.indicators.length) { m = { ...m, indicators: mergeList(m.indicators, patch.indicators, "name") }; changed = true; }
  if (cfg && patch.cfg && typeof patch.cfg === "object") {
    const c = { ...cfg };
    for (const k of ["opening_cash", "si_rate", "tax_rate", "min_wage", "existing_depreciation_monthly"]) if (patch.cfg[k] !== undefined && patch.cfg[k] !== null) c[k] = patch.cfg[k];
    for (const [k, key] of [["income", "name"], ["staff", "title"], ["expenses", "name"], ["initiatives", "name"], ["capex", "name"], ["loans", "name"]]) if (Array.isArray(patch.cfg[k])) c[k] = mergeList(c[k], patch.cfg[k], key);
    cfg = c; changed = true;
  }
  return { A, m, cfg, changed };
}

module.exports = { saveSnap, loadSnap, getLast, setLast, plan, applyPatch, mergeList, REV_PRICE };
