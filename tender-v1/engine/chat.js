'use strict';
// Захиалагчид Messenger-ээр илгээх товч жагсаалт. Тоо, төлвийг qc-ээс авна (Claude бичихгүй).
const { fmt } = require('./calc');

const MAX = 1900; // Messenger-ийн нэг мессежийн хязгаараас бага

function chatSummary(data, qc) {
  const t = data.tender, c = data.customer;
  const reqs = t.requirements || [];
  const st = qc.statusById;
  const L = [];

  const head = {
    go: '✅ Та энэ тендерт оролцох шаардлага хангаж байна.',
    conditional: '⚠️ Доорх зүйлсийг бүрдүүлбэл оролцох боломжтой.',
    nogo: '❌ Одоогийн байдлаар энэ тендерийн шаардлага хангахгүй байна.',
  }[qc.decision];
  L.push(`«${t.name}»`, head);

  if (qc.decision === 'nogo') {
    reqs.filter((r) => (st.get(r.id) || {}).status === 'fail').forEach((r) => {
      const s = st.get(r.id);
      L.push(`• ${r.text}${s.note ? ` — ${s.note}` : ''}`);
    });
    const alt = reqs.map((r) => st.get(r.id)).filter((s) => s && s.status === 'fail' && s.action).map((s) => s.action);
    if (alt.length) L.push('', 'Боломжит арга:', ...alt.map((a) => `• ${a}`));
    return clip(L);
  }

  // Дутуу: шаардлага бүрт нэг мөр. Баримт шаардлагатай холбогдсон (req_id) бол шаардлагын «хийх ажил»-аар нэгтгэнэ.
  const missing = [];
  const covered = new Set();
  reqs.forEach((r) => {
    const s = st.get(r.id);
    const linked = (c.documents || []).filter((d) => d.req_id === r.id && d.status === 'missing');
    if ((s && s.status === 'missing') || linked.length) {
      missing.push((s && s.action) || linked.map((d) => d.name).join(', ') || r.text);
      linked.forEach((d) => covered.add(d.key || d.name));
    }
  });
  (c.documents || []).filter((d) => d.status === 'missing' && d.required !== false && !covered.has(d.key || d.name))
    .forEach((d) => missing.push(d.name));
  // Сайжруулах: анхааруулга (дутуу баримтаас бусад)
  const improve = [];
  const skip = new Set(['DOC_MISSING', 'NOGO', 'TBB_INCONSISTENCY']);
  if ((t.inconsistencies || []).length) skip.add('CLARIFICATION_LATE');
  for (const i of qc.issues) if (i.level === 'warn' && !skip.has(i.code)) improve.push(shorten(i));
  const nInc = (t.inconsistencies || []).length;
  const hasLetter = ((data.sections || {}).clarification_letter || []).length > 0;
  const late = qc.issues.some((i) => i.code === 'CLARIFICATION_LATE');
  if (nInc) {
    if (late) improve.push(`Тендерийн баримтад ${nInc} зөрчил байна; тодруулга авах хугацаа өнгөрсөн тул зөрчил тус бүрийг яаж шийдсэнийг шалгах жагсаалтаас харна уу`);
    else if (hasLetter) improve.push(`Тендерийн баримтад ${nInc} зөрчил илэрсэн — тодруулгын хүсэлтийн төслийг шалгах жагсаалтад бэлтгэсэн, хугацаандаа илгээнэ үү`);
    else improve.push(`Тендерийн баримтад ${nInc} зөрчил илэрсэн — шалгах жагсаалтаас харна уу`);
  }

  if (missing.length) { L.push('', `📌 Дутуу (${missing.length}):`); missing.forEach((m, i) => L.push(`${i + 1}. ${m}`)); }
  if (improve.length) { L.push('', `✏️ Анхаарах (${improve.length}):`); improve.forEach((m, i) => L.push(`${i + 1}. ${m}`)); }

  const F = [];
  if (qc.calc.total != null) F.push('', `💰 Санал болгох үнэ: ${fmt(qc.calc.total)}₮ (төсөвт өртгийн ${(qc.ratio * 100).toFixed(1)}%)`);
  if (qc.auction && qc.auction.floor != null) F.push(`↘️ Үнийн санал дуудахад ${fmt(qc.auction.floor)}₮-өөс доош бүү буу`);
  if (t.deadline) F.push(`⏰ Эцсийн хугацаа: ${t.deadline.replace('T', ' ').slice(0, 16)} — 1 өдрийн өмнө илгээгээрэй`);
  return clip(L, F);
}

function shorten(i) {
  const m = i.msg;
  if (i.code === 'CLARIFICATION_LATE') return 'Тодруулга авах хугацаа (нээлтээс ажлын 5 өдрийн өмнө) өнгөрсөн';
  if (i.code === 'DOC_EXPIRING') return m.replace(/ — .*$/, ' — шинэчлэх хугацаагаа шалгаарай');
  if (i.code === 'LETTER_PLACEHOLDER') return m.replace('оролцогчийн нөхөх [ДУТУУ] хэсэг бий', 'нөхөх утга бий ([ДУТУУ] гэж тэмдэглэсэн)');
  if (i.code === 'TECH_MISSING') return m.replace(' — [ДУТУУ] гэж тэмдэглэнэ', ' — барааны баримтаас утгыг илгээнэ үү');
  return m;
}

function clip(lines, foot = []) {
  // Үнэ, хугацаа (foot) заавал үлдэнэ; багтахгүй бол зөвхөн жагсаалтыг мөрөөр нь таслана
  const tail = foot.join('\n');
  const more = '\n… (үлдсэнийг шалгах жагсаалт файлаас харна уу)';
  const room = MAX - tail.length - more.length - 1;
  let body = lines.join('\n');
  if (body.length > room) {
    const kept = [];
    let len = 0;
    for (const l of lines) { if (len + l.length + 1 > room) break; kept.push(l); len += l.length + 1; }
    body = kept.join('\n') + more;
  }
  return tail ? body + '\n' + tail : body;
}

module.exports = { chatSummary };
