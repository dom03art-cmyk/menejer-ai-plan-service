// Бүлэг тус бүрийг ТУСДАА Claude дуудлагаар бичнэ. Хариу нь блокуудын JSON.
const { callJSON } = require("./claude");
const OUTLINE = require("./outline");

const STYLE = `Чи олон улсын түвшний бизнес төслийн зөвлөх. Монголын арилжааны банкинд өгөх бизнес төслийн хэсгийг АЛБАН БИЧГИЙН хэлээр бичнэ.
Дүрэм:
- 3-р биеэр, албан хэлээр ("Тус компани ... хэрэгжүүлнэ"). Ярианы үг ("аль хэдийн", "их сайн") хэрэглэхгүй. Англи үг холихгүй (NPV, IRR, EBITDA, SWOT зэрэг товчлолоос бусад).
- Тоо баримтыг ЗӨВХӨН өгөгдсөн "САНХҮҮГИЙН ТОО" болон "СУДАЛГААНЫ БАРИМТ"-аас ав. Өөрөө тоо зохиохгүй. Баримт байхгүй бол "тодорхой тоо олдсонгүй" гэж бич эсвэл чанарын үнэлгээ ашигла.
- Англи нэр томьёог Монголоор бич, хаалтанд англи орчуулга БҮҮ нэм (жишээ нь "grace period" биш "үндсэн төлбөрийн хөнгөлөлтийн хугацаа", "payback" биш "нөхөгдөх хугацаа", "collateral" биш "барьцаа хөрөнгө"). Захиалагчийн өгсөн оноосон нэр (компани, газар, брэнд)-ийг яг тэр чигээр нь бич.
- Санхүүжилтийн бүтцийг "САНХҮҮГИЙН ТОО"-ны loan_share_pct, own_share_pct, working_capital_reserve-ээс ав. Зээлийн хувь 80%-иас их бол зээлийн эрсдэлийг бууруулах арга хэмжээг (барьцаа хөрөнгө, нэмэлт өөрийн оролцоо, үе шаттай санхүүжилт) дурд. IRR 40%-иас их бол үр дүнг хэт магтахгүй, консерватив хувилбар ба таамаглалын эрсдэлийг онцол.
- Хэсэг бүрт заасан доод үгийн тоог ХАНГА. Хураангуйлж товчлохыг ХОРИГЛОНО — дэлгэрэнгүй, гүнзгий, тоо баримттай бич.
- Хэсгийн гарчгийг (өгөгдсөн id-ийн гарчиг) бүү давт — код өөрөө тавина. Дэд гарчиг хэрэгтэй бол "h3" блок ашигла.
- Санхүүгийн хүснэгтүүдийг код оруулна гэж заасан бол тэдгээрийг давтаж бүү бич, зөвхөн тайлбар, дүгнэлт бич.
- "skill", "prompt", "JSON", "AI" гэх мэт дотоод үг текстэд бүү оруул.
Гаралт — ЗӨВХӨН JSON:
{"sections":[{"id":"2.1.1","blocks":[ ... ]}]}
Блокийн төрлүүд:
{"type":"p","text":"догол мөр (**тод** зөвшөөрнө)"}
{"type":"h3","text":"дэд гарчиг"}
{"type":"bullets","items":["..."]}
{"type":"numbered","items":["..."]}
{"type":"table","caption":"Хүснэгтийн нэр","headers":["..."],"rows":[["..."]]}   (нийт мөрийг "!"-ээр эхлүүлнэ; нүдэнд олон мөр бол \\n)
{"type":"box","title":"...","text":"..."}
{"type":"note","text":"Эх сурвалж: ..."}
{"type":"chart","chart_type":"bar|line|pie","title":"График нэр (нэгжтэй)","labels":["2022","2023"],"series":[{"name":"...","values":[1.2,3.4]}],"source":"Эх сурвалж, он"}   (ЗӨВХӨН өгөгдсөн судалгаа/санхүүгийн тоогоор; pie бол нэг series)
{"type":"flow","title":"Бүдүүвчийн нэр","steps":["Алхам 1","Алхам 2","..."]}   (3-8 алхам, алхам бүр 2-6 үг)
{"type":"org","title":"Бүтцийн нэр","head":"Гүйцэтгэх захирал","units":[{"name":"Хэлтэс","roles":["Албан тушаал (тоо)"]}]}`;

function outlineFor(item) {
  return [item]
    .map(o => `- id "${o.id}" — ${o.t}: доод тал нь ${o.words || 100} үг. ${o.guide || ""}${o.attach ? " [Код оруулах: " + o.attach.join(", ") + "]" : ""}`).join("\n");
}

// Нэг дуудлагад НЭГ хэсэг бичнэ — хариу max_tokens-д хүрч таслагдахаас сэргийлнэ.
function factsFor(group, ctx) {
  if (!ctx.research) return [];
  const r = ctx.research;
  if (group === "ch2a") return r.macro;
  if (group === "ch1") return [...r.macro.slice(0, 10), ...r.market];
  if (["ch2b", "ch2c", "ch3", "ch5"].includes(group)) return r.market;
  return [];
}

async function writeSection(item, ctx) {
  const facts = factsFor(item.group, ctx);
  // Бүх хэсэгт ижил контекстийг prompt cache-д хадгална (system-ийн хэсэг) — 36 дуудлага дахин бүтэн үнээр уншихгүй.
  const cached = `ТӨСЛИЙН МЭДЭЭЛЭЛ:\n${JSON.stringify({ company: ctx.A.company, project: ctx.A.project }, null, 1)}
САНХҮҮГИЙН ТОО (кодоор тооцсон, эндээс иш тат):\n${JSON.stringify(ctx.facts)}
${facts.length ? "СУДАЛГААНЫ БАРИМТ:\n" + JSON.stringify(facts) : ""}
${ctx.conversation ? "ЗАХИАЛАГЧИЙН ӨГСӨН МЭДЭЭЛЭЛ (яриа):\n" + ctx.conversation.slice(0, 12000) : ""}`;
  let user = `БИЧИХ ХЭСГҮҮД:\n${outlineFor(item)}`;
  if (ctx.revision) {
    // Засвар: өмнөх хувилбарыг үндэс болгож, зөвхөн хүсэлтэд хамаарах хэсгийг өөрчилнө, санхүүгийн тоог шинэ тооноос авна
    user += `\n\nЗАСВАРЫН ХҮСЭЛТ (заавал тусга):\n${ctx.revision.request}\n\nЭНЭ ХЭСГИЙН ӨМНӨХ ХУВИЛБАР (блокууд):\n${JSON.stringify(ctx.revision.previous || []).slice(0, 30000)}\n\nӨмнөх хувилбарыг үндэс болгож, засварын хүсэлтэд хамаарах агуулгыг шинэчил. Хүсэлтэд хамааралгүй сайн агуулгыг хадгал. Бүх тоог дээрх "САНХҮҮГИЙН ТОО"-оос дахин шалгаж, зөрсөн тоог шинэчил. Хэсгийг бүтнээр нь (доод үгийн тоог хангаж) буцаа.`;
  }
  const out = await callJSON({ system: STYLE, cached, user, maxTokens: Number(process.env.PLAN_SECTION_MAX_TOKENS || 24000) });
  const sec = (out.sections || []).find(s => s.id === item.id) || (out.sections || [])[0];
  return sec ? cleanBlocks(sec.blocks || []) : [];
}

// Англи нэр томьёог Монгол болгох (оноосон нэрэнд хүрэхгүй: зөвхөн мэдэгдэж буй нэр томьёо, жижиг үсгээр бичсэн хаалтан дахь англи үг)
const EN_TERMS = ["grace period", "payback period", "payback", "collateral", "season", "place", "product", "price", "promotion", "people", "process", "physical evidence",
  "cash flow", "break-even", "break even", "working capital", "net present value", "internal rate of return", "debt service coverage ratio", "feasibility", "stakeholder", "stakeholders",
  "target market", "market share", "customer segment", "value proposition", "benchmark", "occupancy", "occupancy rate", "revenue", "profit", "strengths", "weaknesses", "opportunities", "threats", "capital expenditure", "operating expenses"];
const EN_REPLACE = [[/\bgrace period\b/gi, "хөнгөлөлтийн хугацаа"], [/\bgrace\b(?=\s*\d)/gi, "хөнгөлөлтийн хугацаа"], [/\bpayback period\b/gi, "нөхөгдөх хугацаа"], [/\bpayback\b/gi, "нөхөгдөх хугацаа"],
  [/\bcash flow\b/gi, "мөнгөн урсгал"], [/\bbreak-even\b/gi, "хугарлын цэг"], [/\bworking capital\b/gi, "эргэлтийн хөрөнгө"], [/\bcollateral\b/gi, "барьцаа хөрөнгө"]];
function cleanStr(t) {
  let s = t.replace(/\s*\(([A-Za-z][A-Za-z \-']*)\)/g, (m, inner) => {
    const w = inner.trim().toLowerCase();
    if (EN_TERMS.includes(w) || /^[a-z][a-z \-']*$/.test(inner.trim())) return "";
    return m;
  });
  for (const [re, to] of EN_REPLACE) s = s.replace(re, to);
  return s;
}
const SKIP_KEYS = new Set(["type", "chart_type", "key", "id"]);
function cleanVal(v, k) {
  if (typeof v === "string") return SKIP_KEYS.has(k) ? v : cleanStr(v);
  if (Array.isArray(v)) return v.map(x => cleanVal(x, k));
  if (v && typeof v === "object") { const o = {}; for (const [kk, vv] of Object.entries(v)) o[kk] = cleanVal(vv, kk); return o; }
  return v;
}
function cleanBlocks(blocks) {
  try { return blocks.map(b => cleanVal(b)); } catch (e) { return blocks; }
}

// Хэсгүүдийг хязгаартай зэрэгцээгээр бичнэ; хураангуй (ch1) хамгийн сүүлд
async function writeAll(ctx, concurrency = Number(process.env.PLAN_CONCURRENCY || 3), onProgress = () => { }) {
  const items = OUTLINE.filter(o => o.group !== "static" && (o.words || o.guide));
  const order = [...items.filter(o => o.group !== "ch1"), ...items.filter(o => o.group === "ch1")];
  const firstCh1 = order.findIndex(o => o.group === "ch1");
  const result = {}; let idx = 0, done = 0;
  async function worker() {
    while (idx < order.length) {
      const i = idx++, item = order[i];
      if (i >= firstCh1) while (done < firstCh1) await new Promise(r => setTimeout(r, 1000));
      try { result[item.id] = await writeSection(item, ctx); }
      catch (e) { console.warn(`[chapters] ${item.id} бичиж чадсангүй: ${e.message}`); result[item.id] = []; if (/credit balance/i.test(e.message)) { idx = order.length; throw e; } }
      done++; onProgress(`${item.id} (${done}/${order.length})`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  // Хоосон үлдсэн хэсгүүдийг нэг удаа дахин бичүүлнэ
  const empty = order.filter(o => !(result[o.id] || []).length);
  for (const item of empty) {
    try { result[item.id] = await writeSection(item, ctx); onProgress(`${item.id} (дахин бичсэн)`); }
    catch (e) { console.warn(`[chapters] ${item.id} дахин бичиж чадсангүй: ${e.message}`); if (/credit balance/i.test(e.message)) throw e; }
  }
  const still = order.filter(o => !(result[o.id] || []).length).map(o => o.id);
  if (still.length > 2) throw new Error(`Хоосон хэсэг хэт олон (${still.join(", ")}) — дутуу төсөл илгээхгүй`);
  return result;
}
module.exports = { writeAll, writeSection, cleanBlocks, cleanStr };
