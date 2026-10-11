// Хэсэг тус бүрийг ТУСДАА Claude дуудлагаар бичнэ (plan-v2-той ижил зарчим). Хариу нь блокуудын JSON.
// Эхлээд "тойм" (blueprint) гаргаж бүх хэсэгт өгнө — бүлэг хооронд дүр, мессеж, кампанит ажлын нэр зөрөхгүй.
const { callJSON, FAST } = require("../plan-v2/claude");
const OUTLINE = require("./outline");

const STYLE = `Чи Монголын зах зээлийг сайн мэддэг маркетингийн зөвлөх. Захиалагчид зориулсан маркетингийн төлөвлөгөөний нэг хэсгийг бичнэ. Энэ баримт бол уншаад хадгалах тайлан биш, захиалагч өөрөө алхам алхмаар дагаж хэрэгжүүлэх ХӨТӨЧ. Захиалагч маркетингийн мэргэжилтэн биш байж болно.
Дүрэм:
- Цэвэр, ойлгомжтой монгол хэлээр, богино өгүүлбэрээр, "та" гэж хандаж бич. Мэргэжлийн англи товчлолыг (CAC, ROAS, LTV, CTR, USP, Persona, Reels, Messenger зэрэг) эхний удаа монгол тайлбартай нь бич, бусад англи үг холихгүй. Урт зураас (—) хэрэглэхгүй.
- ЗӨВХӨН МАРКЕТИНГ: үйлдвэрлэл, хүний нөөц, цалин, зээл, хөрөнгө оруулалт, санхүүгийн тайлан, хууль эрх зүйн орчин бичихгүй.
- Тоог ЗӨВХӨН "ТООЦООНЫ ТОО" болон "СУДАЛГААНЫ БАРИМТ"-аас ав. Өөрөө тоо зохиохгүй, тоог дугуйлж өөрчлөхгүй. Мөнгөн дүнг "1 500 000 ₮" хэлбэрээр бич. Судалгааны тоог дурдахдаа эх сурвалж, оныг нь хэл; нэг үзүүлэлтийн хэд хэдэн оны тоо байвал хамгийн сүүлийнхийг ав, хуучин оны тоог "ирэх/шинээр" гэж одоогийн мэт бүү бич. Баримт байхгүй бол "тодорхой тоо олдсонгүй" гэж шударгаар бич эсвэл "таамаглал" гэж тэмдэглэ.
- Зохиомол сэтгэгдэл, зохиомол хэрэглэгчийн ишлэл, зохиомол өрсөлдөгчийн нэр, зохиомол шагнал БИЧИХГҮЙ.
- Сонголт бүр "яагаад"-тай: суваг, үнэ, мессеж, төсвийн шийдвэр бүрийн шалтгааныг энэ бизнесийн тодорхой баримтаар тайлбарла. Өөр ямар ч бизнест хуулж тавьж болох ерөнхий өгүүлбэр бичихгүй: брэндийн нэр, бүтээгдэхүүн, үнэ, хэрэглэгчийн нөхцөл байдлаар тодорхой бич.
- "ТОЙМ"-д тогтоосон дүрийн нэр, онцлог давуу тал, гол мессеж, кампанит ажлын нэр, тулгуур сэдвийг ЯГ ТЭР ЧИГЭЭР нь ашигла. Бусад бүлгийг дурдахдаа дугаараар нь (жишээ нь "2.4") заа.
- Захиалагчийн өгсөн оноосон нэр (брэнд, компани, газар)-ийг яг тэр чигээр нь бич. Захиалагчийн хэлээгүй нөхцөл (үнэ, хямдрал, баталгаа, хүргэлт) зохиохгүй; шинэ санаа дэвшүүлбэл "санал" гэж тэмдэглэ, мэдэгдээгүй бол "[Захиалагч бөглөнө]".
- Баталж чадахгүй амлалт ("хамгийн шилдэг", "100% баталгаатай", зээл/эрүүл мэнд/орлогын үр дүнгийн баталгаа) бичихгүй. Өрсөлдөгчийг нэрлэж муулахгүй.
- Захиалагчийн хүн хүч, цаг, төсөвт бодитой төлөвлө. Хэрэгжүүлж чадахгүй хэмжээний ажил бүү төлөвлө.
- Заасан доод үгийн тоог ханга, гэхдээ 1.5 дахинаас хэтрүүлэхгүй. Хоосон оршил, давталтаар сунгахгүй, агуулгаар гүнзгийрүүл.
- ДАВТАЛТГҮЙ: нэг баримт, тоо, уриа, өрсөлдөгчийн үнийн харьцуулалтыг дэлгэрэнгүй тайлбарлах газар нь нэг: зах зээлийн тоо 2.2-т, өрсөлдөгч 2.3-т, зорилтот хэрэглэгч 3.2-т, уриа ба мессеж 3.6-д, тооцооны тоо 9-р бүлэгт. Бусад хэсэгт тэдгээрийг дахин тайлбарлахгүй, хэрэгтэй бол нэг өгүүлбэрээр дурдаад дугаараар нь иш тат ("3.6-д заасан уриа"). Зарын бэлэн текст (6.5)-д уриаг ашиглаж болно.
- Бусад хэсгийг дурдахдаа ЗӨВХӨН доорх БҮТЦИЙН ЖАГСААЛТАД байгаа дугаарыг хэрэглэ. Жагсаалтад байхгүй дугаар (жишээ нь 2.8, 2.9) зохиохгүй.
- Дотоод нэр, талбарын нэрийг (ТОЙМ, summary, facts, team.size, budget_share_pct, free_channels гэх мэт) текстэд ХЭЗЭЭ Ч бүү бич; "тоймд тодорхойлсон" гэх мэтээр дотоод материалыг уншигчид бүү дурд.
- Хэсгийн гарчгийг бүү давт (код тавина). Дэд гарчигт "h3". Кодоор оруулна гэсэн хүснэгт, графикийг давтаж бүү бич.
- "skill", "prompt", "JSON", "AI загвар" зэрэг дотоод үг бүү оруул.
БҮТЦИЙН ЖАГСААЛТ (бүлэг, хэсгийн дугаар):
${OUTLINE.filter(o => o.t && o.lvl <= 2).map(o => o.t).join("; ")}
Гаралт — ЗӨВХӨН JSON: {"sections":[{"id":"2.1","blocks":[ ... ]}]}
Блокийн төрлүүд:
{"type":"p","text":"догол мөр (**тод** зөвшөөрнө)"}
{"type":"h3","text":"дэд гарчиг"}
{"type":"bullets","items":["..."]}   {"type":"numbered","items":["..."]}   {"type":"checklist","items":["хийх ажил"]}
{"type":"table","caption":"нэр (байхгүй бол \\"\\")","headers":["..."],"rows":[["..."]],"widths":[30,70]}   (widths нь баганын хувь, заавал биш; толгойгүй хүснэгтэд headers-ийг хоосон мөрүүдээр ["",""]; нийт мөрийг "!"-ээр эхлүүл)
{"type":"tip","text":"онцлох тэмдэглэл, анхааруулга"}
{"type":"chart","chart_type":"bar|line|pie","title":"нэр (нэгжтэй)","labels":["..."],"series":[{"name":"...","values":[1,2]}],"source":"Эх сурвалж, он"}   (ЗӨВХӨН судалгааны баримтын тоогоор; pie бол нэг series)
{"type":"flow","title":"нэр","steps":["3-6 алхам, тус бүр 1-4 үг"]}
Зөвхөн заасан хэсэгт: "positioning", "gantt", "adset", "adtext", "calendar" (бүтцийг хэсгийн заавраас үз).`;

const BLUEPRINT = `Чи маркетингийн стратегич. Өгөгдсөн мэдээллээр төлөвлөгөөний ТОЙМ-ыг гарга. Энэ тоймыг бүх бүлэг дагаж бичнэ, тиймээс тодорхой, тогтвортой нэршил хэрэглэ. Тоо зохиохгүй. Кампанит ажлуудыг "ТООЦООНЫ ТОО"-ны суваг бүрд яг нэг нэгээр, сувгийн нэртэй нь холбож нэрлэ.
Зөвхөн JSON:
{"core_insight":"гол саад бэрхшээл ба боломж, 2 өгүүлбэр","usp":"нэг өгүүлбэр","positioning":"байрлалын мэдэгдэл","key_message":"гол мессеж, нэг өгүүлбэр",
"pillars":["тулгуур мессеж 1","2","3"],"personas":[{"name":"таних нэр","who":"хэн бэ","priority":true,"message":"хэлэх гол мессеж"}],
"voice":["аясын 5 үг"],"never_say":["хэрэглэхгүй амлалт, үг"],
"campaigns":[{"channel":"тооцооны сувгийн нэр","name":"кампанит ажлын нэр","goal":"","audience":"","angle":"зарын өнцөг"}],
"free_channels":["төлбөргүй суваг, арга"],"content_pillars":[{"name":"","share_pct":0}],
"materials":[{"name":"хэрэглэл","priority":"Заавал|Дараа|Боломжтой бол","cost":0}],
"phases":[{"name":"Бэлтгэл","when":""}],"main_risk":"хамгийн анхаарах эрсдэл","first_30_days":["5 гол ажил"]}
materials-ийн cost: зөвхөн "ТООЦООНЫ ТОО"-ны тогтмол зардалд байгаа мөнгөн зардлыг (нэрээр нь тааруулж) бич, бусад нь 0.`;

function profile(A) {
  return { subject_type: A.subject_type, brand: A.brand, team: A.team, location: A.location, sales_channel: A.sales_channel, goal: A.goal, start_date: A.start_date,
    current: A.current, audience: A.audience, competitors: A.competitors, customer_voice: A.customer_voice, ad_history: A.ad_history, missing_info: A.missing_info, assumed_fields: A.assumed_fields, scale: A.scale };
}
const SUBJECT = {
  product: "Субъект: БҮТЭЭГДЭХҮҮН/ҮЙЛЧИЛГЭЭ. Зорилго борлуулалт. Гол хэмжүүр: захиалга, CAC, ROAS.",
  organization: "Субъект: БАЙГУУЛЛАГА. Зорилго нэр хүнд, итгэл, танигдалт; оролцогч талууд (үйлчлүүлэгч, түнш, ажил горилогч, олон нийт). 7P-г байгууллагын түвшинд тайлбарла. PR, хэвлэлийн харилцаа, ажил олгогчийн брэндийг оруул. Гол хэмжүүр: хүрэлт, лавлагаа, дурдалт.",
  person: "Субъект: ХУВЬ ХҮН (хувийн брэнд). Зорилго танигдах, итгэл олох, үзэгчтэй болох. DNA-д хувийн түүх, мэргэшил, юу ярихгүй вэ. 7P-г хувь хүнд тайлбарла (бүтээгдэхүүн = мэдлэг, үйлчилгээ, контент). Хэрэглэлд bio, профайл зураг, нэг хуудас танилцуулга. Гол хэмжүүр: дагагч, хүрэлт, шууд мессеж.",
};

function researchFor(group, r) {
  if (!r) return [];
  if (group === "analysis" || group === "summary") return [...(r.market || []), ...(r.competitors || [])];
  if (["dna", "strategy", "mix", "ads", "materials", "appendix"].includes(group)) return (r.competitors || []).concat((r.market || []).filter(f => ["digital", "season", "audience"].includes(f.topic)));
  if (group === "calendar") return (r.market || []).filter(f => f.topic === "season");
  return [];
}

async function makeBlueprint(ctx) {
  return callJSON({ system: BLUEPRINT, maxTokens: 12000,
    user: `${SUBJECT[ctx.A.subject_type]}\n\nЗАХИАЛАГЧИЙН МЭДЭЭЛЭЛ:\n${JSON.stringify(profile(ctx.A))}\n\nТООЦООНЫ ТОО:\n${JSON.stringify({ channels: ctx.facts.channels.map(c => ({ name: c.name, budget_share_pct: c.budget_share_pct })), fixed_costs: ctx.facts.fixed_costs, months: ctx.facts.months, summary: ctx.facts.summary })}\n\nСУДАЛГААНЫ БАРИМТ:\n${JSON.stringify(researchFor("analysis", ctx.research)).slice(0, 14000)}\n\nЯРИА:\n${String(ctx.conversation || "").slice(0, 10000)}` });
}

async function writeSection(item, ctx) {
  const facts = researchFor(item.group, ctx.research);
  const cached = `${SUBJECT[ctx.A.subject_type]}
ЗАХИАЛАГЧИЙН МЭДЭЭЛЭЛ:\n${JSON.stringify(profile(ctx.A))}
ТОЙМ (бүх бүлэгт мөрдөх):\n${JSON.stringify(ctx.blueprint || {})}
ТООЦООНЫ ТОО (кодоор тооцсон, тоог зөвхөн эндээс ав):\n${JSON.stringify(ctx.facts)}
${ctx.conversation ? "ЗАХИАЛАГЧИЙН ӨГСӨН МЭДЭЭЛЭЛ (яриа):\n" + String(ctx.conversation).slice(0, 12000) : ""}`;
  const user = `${facts.length ? "СУДАЛГААНЫ БАРИМТ:\n" + JSON.stringify(facts).slice(0, 16000) + "\n\n" : ""}БИЧИХ ХЭСЭГ:\n- id "${item.id}" — ${item.t}: доод тал нь ${item.words || 100} үг. ${item.guide || ""}${item.attach ? " [Код оруулах: " + item.attach.join(", ") + "]" : ""}${item.id === "8.3" ? `\nКалендарийн 1-р өдөр: ${ctx.A.start_date}.` : ""}`;
  const out = await callJSON({ system: STYLE, cached, user, maxTokens: item.maxTokens || Number(process.env.MKT_SECTION_MAX_TOKENS || 20000) });
  const sec = (out.sections || []).find(s => String(s.id) === item.id) || (out.sections || [])[0];
  let blocks = sec && Array.isArray(sec.blocks) ? sec.blocks.filter(b => b && b.type) : [];
  if (item.id === "6.5") blocks = await fixAdCopy(blocks);
  return sanitize(blocks);
}

// Дотоод талбарын нэр, "тойм" гэх мэт үгийг текстээс КОД цэвэрлэнэ (прамт дүрэм алдсан ч уншигчид харагдахгүй).
const JARGON = /\s*\((?:[^()]*\b(?:summary|facts|team\.\w+|[a-z]+_[a-z_]+|blueprint)\b[^()]*)\)/gi;
function clean(t) {
  return String(t).replace(JARGON, "").replace(/ТОЙМ(?:-?[дт]|-?оор|-?ын)?\s+(тодорхойлсон|заасан|тогтоосон)/g, "энэ төлөвлөгөөнд $1")
    .replace(/(?<![А-Яа-яӨөҮүЁё])ТОЙМ[А-Яа-яӨөҮүЁё-]*/g, "төлөвлөгөө").replace(/\b(?:summary|budget_share_pct|free_channels|team\.size)\b/g, "").replace(/ {2,}/g, " ").replace(/(^|[.!?]\s+)энэ төлөвлөгөөнд/g, "$1Энэ төлөвлөгөөнд");
}
function sanitize(x) {
  if (typeof x === "string") return clean(x);
  if (Array.isArray(x)) return x.map(sanitize);
  if (x && typeof x === "object") { const o = {}; for (const [k, v] of Object.entries(x)) o[k] = (k === "type" || k === "chart_type") ? v : sanitize(v); return o; }
  return x;
}

// Зарын текстийн тэмдэгтийн хязгаарыг КОД шалгана: headline 40, тайлбар 30. Хэтэрснийг нэг удаа богиносгуулж, болохгүй бол хасна.
const HL = 40, DL = 30;
async function fixAdCopy(blocks) {
  const bad = [];
  blocks.forEach((b, bi) => { if (b.type !== "adset") return;
    (b.headlines || []).forEach((h, i) => { if (String(h).length > HL) bad.push({ bi, kind: "headlines", i, max: HL, text: String(h) }); });
    (b.descriptions || []).forEach((d, i) => { if (String(d).length > DL) bad.push({ bi, kind: "descriptions", i, max: DL, text: String(d) }); }); });
  if (bad.length) {
    try {
      const fx = await callJSON({ model: FAST, maxTokens: 4000, system: "Монгол зарын мөр бүрийг утгыг нь хадгалж, заасан тэмдэгтийн хязгаарт (зайтайгаа) багтаан дахин бич. Шинэ амлалт, тоо нэмэхгүй. Зөвхөн JSON: {\"lines\":[\"...\"]} — оролтын дарааллаар.",
        user: JSON.stringify(bad.map(x => ({ max: x.max, text: x.text }))) });
      (fx.lines || []).forEach((t, k) => { const x = bad[k]; if (x && typeof t === "string" && t.length <= x.max && t.trim()) blocks[x.bi][x.kind][x.i] = t.trim(); });
    } catch (e) { if (/credit balance/i.test(e.message || "")) throw e; }
  }
  for (const b of blocks) if (b.type === "adset") {
    b.headlines = (b.headlines || []).map(String).filter(h => h.length <= HL);
    b.descriptions = (b.descriptions || []).map(String).filter(d => d.length <= DL);
  }
  return blocks;
}

// Хэсгүүдийг хязгаартай зэрэгцээгээр бичнэ; хураангуй, дүгнэлт (summary) хамгийн сүүлд.
async function writeAll(ctx, concurrency = Number(process.env.MKT_CONCURRENCY || 3), onProgress = () => { }) {
  const items = OUTLINE.filter(o => o.group !== "static" && (o.words || o.guide));
  const order = [...items.filter(o => o.group !== "summary"), ...items.filter(o => o.group === "summary")];
  const firstSum = order.findIndex(o => o.group === "summary");
  const result = {}; let idx = 0, done = 0, fatal = null;
  async function worker() {
    while (idx < order.length && !fatal) {
      const i = idx++, item = order[i];
      if (i >= firstSum) while (done < firstSum && !fatal) await new Promise(r => setTimeout(r, 1000));
      try { result[item.id] = await writeSection(item, ctx); }
      catch (e) { console.warn(`[mkt-chapters] ${item.id} бичиж чадсангүй: ${e.message}`); result[item.id] = []; if (/credit balance/i.test(e.message || "")) { fatal = e; idx = order.length; } }
      done++; onProgress(`${item.id} (${done}/${order.length})`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (fatal) throw fatal;
  for (const item of order.filter(o => !(result[o.id] || []).length)) {
    try { result[item.id] = await writeSection(item, ctx); onProgress(`${item.id} (дахин бичсэн)`); }
    catch (e) { console.warn(`[mkt-chapters] ${item.id} дахин бичиж чадсангүй: ${e.message}`); if (/credit balance/i.test(e.message || "")) throw e; }
  }
  const still = order.filter(o => !(result[o.id] || []).length).map(o => o.id);
  if (still.length > 3) throw new Error(`Хоосон хэсэг хэт олон (${still.join(", ")}) — дутуу төлөвлөгөө илгээхгүй`);
  return result;
}
module.exports = { writeAll, writeSection, makeBlueprint, fixAdCopy, sanitize };
