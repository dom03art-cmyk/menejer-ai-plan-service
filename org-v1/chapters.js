// Хэсэг тус бүрийг ТУСДАА Claude дуудлагаар бичнэ (marketing-v1-тэй ижил зарчим). Хүснэгт, графикийн тоог код оруулна; AI зөвхөн тайлбар бичнэ.
const { callJSON } = require("../plan-v2/claude");
const { sanitize } = require("../marketing-v1/chapters");
const OUTLINES = require("./outlines");

const ROLE = {
  plan: "Чи Монголын байгууллагуудад жилийн төлөвлөгөө, төсөв боловсруулдаг туршлагатай зөвлөх. Байгууллагын ирэх жилийн төлөвлөгөөний нэг хэсгийг бичнэ. Энэ баримтыг удирдлага батлаад, хэлтсүүд жилийн турш дагаж ажиллана.",
  report_dept: "Чи Монголын байгууллагын хэлтэс, албан тушаалтны ажлын тайлан бичдэг туршлагатай мэргэжилтэн. Тайлагнагчийн (хэлтэс, нэгж) нэрийн өмнөөс удирдлагад тавих жилийн ажлын тайлангийн нэг хэсгийг бичнэ.",
  report_dir: "Чи Монголын компанийн гүйцэтгэх захиралд ТУЗ-д тавих жилийн тайлан бэлтгэдэг туршлагатай зөвлөх. Гүйцэтгэх захирлын нэрийн өмнөөс ТУЗ-д тавих тайлангийн нэг хэсгийг бичнэ.",
};

function style(product) {
  const outline = OUTLINES[product];
  const report = product !== "plan";
  return `${ROLE[product]}
Дүрэм:
- Албан ёсны, цэвэр, ойлгомжтой монгол хэлээр, богино өгүүлбэрээр бич. ${report ? "Тайлагнагчийн өмнөөс \"манай нэгж\", \"бид\" гэж бич." : "Байгууллагыг \"манай байгууллага\", \"бид\" гэж бич."} Англи үг холихгүй (KPI, SWOT, ТУЗ, НДШ зэрэг тогтсон товчлолыг эхний удаа тайлбартай нь). Урт зураас (—) хэрэглэхгүй.
- Тоог ЗӨВХӨН "ТООЦООНЫ ТОО"${report ? ", \"ҮЗҮҮЛЭЛТ\"" : ""}, "МАТЕРИАЛ", "СУДАЛГААНЫ БАРИМТ"-аас ав. Өөрөө тоо зохиохгүй, дугуйлж өөрчлөхгүй. Мөнгийг "1 500 000 ₮" хэлбэрээр. Судалгааны тоог дурдахдаа эх сурвалж, оныг нь хэл.
- Материалд байхгүй баримт, ажил, шийдвэр, нэр ЗОХИОХГҮЙ. Мэдээлэл дутуу бол ил хэл: "${report ? "[Тайлагнагч нөхнө]" : "[Байгууллага бөглөнө]"}" гэж тэмдэглэ. Шинэ санаа дэвшүүлбэл "санал" гэж тэмдэглэ.
- Оноосон нэр (байгууллага, хэлтэс, бүтээгдэхүүн, төсөл)-ийг материалд бичигдсэнээр нь бич. Ажилтны хувийн мэдээлэл (регистр, утас, эрүүл мэнд, гэр бүл)-ийг бичихгүй; хувь хүнийг нэрээр нь буруутгахгүй.
- Муу үр дүн, биелээгүй зорилтыг нуухгүй, шалтгааныг баримтаар тайлбарла. ${report ? "Бүтэн жил биш бол бүтэн жилийн зорилттой шууд харьцуулж дүгнэхгүй, хамрах хугацааг заа." : "Хүрэх боломжгүй зорилт тавихгүй; ТООЦООНЫ ТОО-ны анхааруулгыг (warnings) ашигла."}
- Сонголт, дүгнэлт бүр "яагаад"-тай, энэ байгууллагын тодорхой баримтаар. Өөр ямар ч байгууллагад хуулж тавьж болох ерөнхий өгүүлбэр бичихгүй.
- Заасан доод үгийн тоог ханга, гэхдээ 1.5 дахинаас хэтрүүлэхгүй. Хоосон оршил, давталтаар сунгахгүй.
- ДАВТАЛТГҮЙ: нэг баримтыг дэлгэрэнгүй тайлбарлах газар нь нэг. Бусад хэсэгт нэг өгүүлбэрээр дурдаад дугаараар нь иш тат ("4.3-т заасан").
- Бусад хэсгийг дурдахдаа ЗӨВХӨН доорх БҮТЦИЙН ЖАГСААЛТАД байгаа дугаарыг хэрэглэ.
- Дотоод нэр, талбарын нэр (facts, digest, totals, ТООЦООНЫ ТОО, МАТЕРИАЛЫН ТОЙМ, ҮЗҮҮЛЭЛТ гэх мэт)-ийг текстэд ХЭЗЭЭ Ч бүү бич; "тооцоогоор", "материалаас үзэхэд" гэж бич.
- Хэсгийн гарчгийг бүү давт (код тавина). Дэд гарчигт "h3". Кодоор оруулна гэсэн хүснэгт, графикийг давтаж бүү бич, харин тэдгээрээс юу харагдаж буйг тайлбарла.
- "skill", "prompt", "JSON", "AI загвар", "Claude" зэрэг дотоод үг бүү оруул.
БҮТЦИЙН ЖАГСААЛТ:
${outline.filter((o) => o.t && o.lvl <= 2).map((o) => o.t).join("; ")}
Гаралт — ЗӨВХӨН JSON: {"sections":[{"id":"2.1","blocks":[ ... ]}]}
Блокийн төрлүүд:
{"type":"p","text":"догол мөр (**тод** зөвшөөрнө)"}
{"type":"h3","text":"дэд гарчиг"}
{"type":"bullets","items":["..."]}   {"type":"numbered","items":["..."]}   {"type":"checklist","items":["..."]}
{"type":"table","caption":"нэр (байхгүй бол \\"\\")","headers":["..."],"rows":[["..."]],"widths":[30,70]}   (нийт мөрийг "!"-ээр эхлүүл)
{"type":"tip","text":"онцлох тэмдэглэл"}   {"type":"box","title":"","text":""}
{"type":"chart","chart_type":"bar|line|pie","title":"нэр (нэгжтэй)","labels":["..."],"series":[{"name":"...","values":[1,2]}],"source":"Эх сурвалж, он"}   (ЗӨВХӨН баримтын тоогоор)
{"type":"flow","title":"нэр","steps":["3-6 алхам"]}
{"type":"gantt","title":"нэр","periods":["1-р сар","..."],"tasks":[{"name":"","start":0,"length":3}]}   (start нь periods-ийн индекс)`;
}

const STYLES = {};
const styleFor = (p) => (STYLES[p] = STYLES[p] || style(p));

function researchFor(item, r) {
  if (!r) return [];
  const all = [...(r.macro || []), ...(r.law || []), ...(r.sector || [])];
  if (item.group === "3" || item.group === "summary") return all;
  if (item.group === "7") return all.filter((f) => ["law", "wage", "tax"].includes(f.topic));
  if (item.group === "8" || item.group === "11") return all.filter((f) => ["macro", "law", "wage", "tax"].includes(f.topic));
  if (item.group === "4") return (r.sector || []);
  return [];
}

const RAW_CTX = Number(process.env.ORG_RAW_CTX || 80000);
function cachedCtx(ctx) {
  const p = ctx.product, A = ctx.A;
  const prof = p === "plan"
    ? { org_name: A.org_name, org_type: A.org_type, industry: A.industry, location: A.location, founded: A.founded, mission: A.mission, vision: A.vision, values: A.values, departments: A.departments, headcount: A.headcount,
        prior_goals: A.prior_goals, achievements: A.achievements, problems: A.problems, stakeholders: A.stakeholders, competitors: A.competitors, priorities_hint: A.priorities_hint, missing_info: A.missing_info, assumed: A.assumed_fields }
    : { org_name: A.org_name, unit_name: A.unit_name, reporter_title: A.reporter_title, year: A.year };
  return `${p === "plan" ? "БАЙГУУЛЛАГЫН МЭДЭЭЛЭЛ" : "ТАЙЛАГНАГЧ"}:\n${JSON.stringify(prof)}
ТООЦООНЫ ТОО${p === "plan" ? "" : " / ҮЗҮҮЛЭЛТ"} (кодоор тооцсон, тоог зөвхөн эндээс ав):\n${JSON.stringify(ctx.facts)}
${ctx.digest ? "МАТЕРИАЛЫН ТОЙМ:\n" + JSON.stringify(ctx.digest).slice(0, 60000) + "\n" : ""}${ctx.conversation ? "ЗАХИАЛАГЧИЙН ЯРИА:\n" + String(ctx.conversation).slice(0, 12000) + "\n" : ""}МАТЕРИАЛ (захиалагчийн файлууд${ctx.raw.length > RAW_CTX ? ", эхний хэсэг" : ""}):\n${ctx.raw.slice(0, RAW_CTX)}`;
}

async function writeSection(item, ctx) {
  if (!ctx._cached) ctx._cached = cachedCtx(ctx);
  const facts = researchFor(item, ctx.research);
  const scope = ctx.product === "report_dept" && ctx.A.org_wide ? `ХАМРАХ ХҮРЭЭ: Материалд байгууллагын хэмжээний мэдээлэл (санхүүгийн тайлан, олон хэлтэс, ТУЗ-ийн шийдвэр) байгаа ч энэ бол ЗӨВХӨН «${ctx.A.unit_name || "тайлагнагч нэгж"}»-ийн ажлын тайлан. Байгууллагын санхүүгийн үр дүнг шинжлэх, ТУЗ-ийн шийдвэрийн биелэлт, бусад хэлтсийн ажлыг дүгнэх, ТУЗ-д шийдүүлэх асуудал бичихгүй; зөвхөн энэ нэгжид хамаарах баримтыг ашигла.\n\n` : "";
  const user = scope + `${facts.length ? "СУДАЛГААНЫ БАРИМТ:\n" + JSON.stringify(facts).slice(0, 14000) + "\n\n" : ""}БИЧИХ ХЭСЭГ:\n- id "${item.id}" — ${item.t}: доод тал нь ${item.words || 100} үг. ${item.guide || ""}${item.attach ? " [Код оруулах: " + item.attach.join(", ") + "]" : ""}`;
  const out = await callJSON({ system: styleFor(ctx.product), cached: ctx._cached, user, maxTokens: item.maxTokens || Number(process.env.ORG_SECTION_MAX_TOKENS || 16000) });
  const sec = (out.sections || []).find((s) => String(s.id) === item.id) || (out.sections || [])[0];
  return fixText(sanitize(sec && Array.isArray(sec.blocks) ? sec.blocks.filter((b) => b && b.type) : []));
}

// Илүүдэл "\\" тэмдэгт (JSON-ий escape алдаа) зэргийг цэвэрлэнэ
const fixText = (x) => typeof x === "string" ? x.replace(/\\+(?=\s|$|[.,;:)])/g, "").replace(/\\n/g, "\n")
  : Array.isArray(x) ? x.map(fixText) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === "type" ? v : fixText(v)])) : x;

async function writeAll(ctx, concurrency = Number(process.env.ORG_CONCURRENCY || 3), onProgress = () => { }) {
  const items = OUTLINES[ctx.product].filter((o) => o.group !== "static" && (o.words || o.guide));
  const order = [...items.filter((o) => o.group !== "summary"), ...items.filter((o) => o.group === "summary")];
  const firstSum = order.findIndex((o) => o.group === "summary");
  const result = {}; let idx = 0, done = 0, fatal = null;
  async function worker() {
    while (idx < order.length && !fatal) {
      const i = idx++, item = order[i];
      if (firstSum >= 0 && i >= firstSum) while (done < firstSum && !fatal) await new Promise((r) => setTimeout(r, 1000));
      try { result[item.id] = await writeSection(item, ctx); }
      catch (e) { console.warn(`[org-chapters] ${item.id} бичиж чадсангүй: ${e.message}`); result[item.id] = []; if (/credit balance/i.test(e.message || "")) { fatal = e; idx = order.length; } }
      done++; onProgress(`${item.id} (${done}/${order.length})`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (fatal) throw fatal;
  for (const item of order.filter((o) => !(result[o.id] || []).length)) {
    try { result[item.id] = await writeSection(item, ctx); onProgress(`${item.id} (дахин бичсэн)`); }
    catch (e) { if (/credit balance/i.test(e.message || "")) throw e; }
  }
  const still = order.filter((o) => !(result[o.id] || []).length).map((o) => o.id);
  if (still.length > Math.max(2, Math.floor(order.length * 0.1))) throw new Error(`Хоосон хэсэг хэт олон (${still.join(", ")}) — дутуу баримт илгээхгүй`);
  return result;
}

// Claude дуудахгүй туршилт
function writeAllMock(ctx) {
  const out = {};
  for (const o of OUTLINES[ctx.product]) if (o.group !== "static" && (o.words || o.guide)) {
    const b = [{ type: "p", text: `**${o.id}:** ` + "Энэ бол угсралтыг шалгах туршилтын догол мөр. ".repeat(Math.max(2, Math.round((o.words || 100) / 40))) },
      { type: "table", caption: "Туршилтын хүснэгт", headers: ["Үзүүлэлт", "Утга"], rows: [["Нэг", "1 500 000 ₮"], ["!Нийт", "1 500 000 ₮"]] }];
    if (o.id === "9.1") b.push({ type: "gantt", title: "Жилийн зураглал", periods: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"], tasks: [{ name: "Бэлтгэл", start: 0, length: 2 }, { name: "Төсөл", start: 2, length: 8 }] });
    if (o.id === "4.5") b.push({ type: "flow", title: "Уялдаа", steps: ["Хүн", "Үйл ажиллагаа", "Харилцагч", "Санхүү"] });
    out[o.id] = b;
  }
  return out;
}

module.exports = { writeAll, writeSection, writeAllMock, style: styleFor };
