// Бүлэг тус бүрийг ТУСДАА Claude дуудлагаар бичнэ. Хариу нь блокуудын JSON.
const { callJSON } = require("./claude");
const OUTLINE = require("./outline");

const STYLE = `Чи олон улсын түвшний бизнес төслийн зөвлөх. Монголын арилжааны банкинд өгөх бизнес төслийн хэсгийг АЛБАН БИЧГИЙН хэлээр бичнэ.
Дүрэм:
- 3-р биеэр, албан хэлээр ("Тус компани ... хэрэгжүүлнэ"). Ярианы үг ("аль хэдийн", "их сайн") хэрэглэхгүй. Англи үг холихгүй (NPV, IRR, EBITDA, SWOT зэрэг товчлолоос бусад).
- Тоо баримтыг ЗӨВХӨН өгөгдсөн "САНХҮҮГИЙН ТОО" болон "СУДАЛГААНЫ БАРИМТ"-аас ав. Өөрөө тоо зохиохгүй. Баримт байхгүй бол "тодорхой тоо олдсонгүй" гэж бич эсвэл чанарын үнэлгээ ашигла.
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
  const user = `ТӨСЛИЙН МЭДЭЭЛЭЛ:\n${JSON.stringify({ company: ctx.A.company, project: ctx.A.project }, null, 1)}
САНХҮҮГИЙН ТОО (кодоор тооцсон, эндээс иш тат):\n${JSON.stringify(ctx.facts)}
${facts.length ? "СУДАЛГААНЫ БАРИМТ:\n" + JSON.stringify(facts) : ""}
${ctx.conversation ? "ЗАХИАЛАГЧИЙН ӨГСӨН МЭДЭЭЛЭЛ (яриа):\n" + ctx.conversation.slice(0, 12000) : ""}

БИЧИХ ХЭСГҮҮД:\n${outlineFor(item)}`;
  const out = await callJSON({ system: STYLE, user, maxTokens: Number(process.env.PLAN_SECTION_MAX_TOKENS || 24000) });
  const sec = (out.sections || []).find(s => s.id === item.id) || (out.sections || [])[0];
  return sec ? sec.blocks || [] : [];
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
      catch (e) { console.warn(`[chapters] ${item.id} бичиж чадсангүй: ${e.message}`); result[item.id] = []; }
      done++; onProgress(`${item.id} (${done}/${order.length})`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
}
module.exports = { writeAll, writeSection };
