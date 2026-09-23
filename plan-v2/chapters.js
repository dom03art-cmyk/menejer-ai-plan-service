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
{"type":"note","text":"Эх сурвалж: ..."}`;

function outlineFor(group) {
  return OUTLINE.filter(o => o.group === group && (o.words || o.guide))
    .map(o => `- id "${o.id}" — ${o.t}: доод тал нь ${o.words || 100} үг. ${o.guide || ""}${o.attach ? " [Код оруулах: " + o.attach.join(", ") + "]" : ""}`).join("\n");
}

async function writeGroup(group, ctx) {
  const facts = ctx.research ? [...(group === "ch2a" ? ctx.research.macro : []), ...(["ch2b", "ch1", "ch2c", "ch5"].includes(group) ? ctx.research.market : []), ...(group === "ch1" ? ctx.research.macro.slice(0, 10) : [])] : [];
  const user = `ТӨСЛИЙН МЭДЭЭЛЭЛ:\n${JSON.stringify({ company: ctx.A.company, project: ctx.A.project }, null, 1)}
САНХҮҮГИЙН ТОО (кодоор тооцсон, эндээс иш тат):\n${JSON.stringify(ctx.facts)}
${facts.length ? "СУДАЛГААНЫ БАРИМТ:\n" + JSON.stringify(facts) : ""}
${ctx.conversation ? "ЗАХИАЛАГЧИЙН ӨГСӨН МЭДЭЭЛЭЛ (яриа):\n" + ctx.conversation.slice(0, 12000) : ""}

БИЧИХ ХЭСГҮҮД:\n${outlineFor(group)}`;
  const out = await callJSON({ system: STYLE, user, maxTokens: 16000 });
  const map = {};
  for (const s of out.sections || []) map[s.id] = s.blocks || [];
  return map;
}

// Бүлгүүдийг хязгаартай зэрэгцээгээр бичнэ (rate limit-ээс сэргийлж)
async function writeAll(ctx, concurrency = Number(process.env.PLAN_CONCURRENCY || 2), onProgress = () => { }) {
  const order = ["ch2a", "ch2b", "ch2c", "ch3", "ch4", "ch5", "ch1"]; // хураангуйг хамгийн сүүлд
  const result = {}; let idx = 0;
  async function worker() {
    while (idx < order.length) {
      const g = order[idx++];
      if (g === "ch1") while (Object.keys(result).length < order.length - 1) await new Promise(r => setTimeout(r, 1000));
      result[g] = await writeGroup(g, ctx); onProgress(g);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return Object.assign({}, ...Object.values(result));
}
module.exports = { writeAll, writeGroup };
