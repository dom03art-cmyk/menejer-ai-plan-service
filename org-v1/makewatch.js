// Make-ийн кредитийн хяналт: 3 цаг тутам Make API-аас энэ мөчлөгийн зарцуулалтыг шалгаж,
// 80%, 90%, 100%-д хүрэхэд админд (ADMIN_PSID) Messenger-ээр нэг удаа анхааруулна.
// Админ Messenger-т «кредит» гэж бичвэл одоогийн байдлыг шууд харуулна.
// Тохиргоо (Render env): MAKE_API_TOKEN (Make → Profile → API access, scope: organizations:read) — байхгүй бол ажиллахгүй.
//   MAKE_ORG_ID (анхдагч 8710669), MAKE_ZONE (анхдагч https://us2.make.com), MAKE_CREDIT_LIMIT (анхдагч 10000), MAKE_ALERT_STEPS (анхдагч 80,90,100)
const F = () => require("./flow");
const ADMIN = () => String(process.env.ADMIN_PSID || "");
const ORG = () => process.env.MAKE_ORG_ID || "8710669";
const ZONE = () => String(process.env.MAKE_ZONE || "https://us2.make.com").replace(/\/$/, "");
const LIMIT = () => Number(process.env.MAKE_CREDIT_LIMIT || 10000);
const STEPS = () => String(process.env.MAKE_ALERT_STEPS || "80,90,100").split(",").map(Number).filter((x) => x > 0).sort((a, b) => a - b);

async function api(path) {
  const r = await fetch(`${ZONE()}/api/v2${path}`, { headers: { Authorization: `Token ${process.env.MAKE_API_TOKEN}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Make API ${r.status}`);
  return r.json();
}
// Энэ мөчлөгийн (lastReset-ээс хойш) зарцуулсан кредит
async function usage() {
  const o = (await api(`/organizations/${ORG()}`)).organization || {};
  const u = await api(`/organizations/${ORG()}/usage`);
  const from = o.lastReset ? String(o.lastReset).slice(0, 10) : "";
  const days = (u.data || []).filter((d) => !from || String(d.date).slice(0, 10) >= from);
  const used = Math.round(days.reduce((s, d) => s + Number(d.centicredits || 0), 0) / 100);
  const last3 = days.slice(-3), perDay = last3.length ? Math.round(last3.reduce((s, d) => s + Number(d.centicredits || 0), 0) / 100 / last3.length) : 0;
  return { used, limit: LIMIT(), pct: Math.round((used / LIMIT()) * 100), cycle: from, nextReset: o.nextReset ? String(o.nextReset).slice(0, 10) : "", perDay };
}
const text = (u) => `Make кредит: ${u.used.toLocaleString("en-US")} / ${u.limit.toLocaleString("en-US")} (${u.pct}%)` +
  (u.nextReset ? `\nДахин эхлэх: ${u.nextReset}` : "") + (u.perDay ? `\nСүүлийн өдрүүдэд өдөрт ~${u.perDay} кредит` : "");

async function check() {
  if (!process.env.MAKE_API_TOKEN || !ADMIN()) return;
  try {
    const u = await usage(), c = await F()._client();
    let top = 0; // шинээр давсан хамгийн өндөр шат — нэг л мессеж
    for (const s of STEPS()) {
      if (u.pct < s) continue;
      const k = `makewatch:${u.cycle}:${s}`;
      const fresh = c ? await c.set(k, "1", { NX: true, EX: 40 * 86400 }) : !check.sent.has(k) && check.sent.add(k);
      if (fresh) top = s;
    }
    if (top) await F()._send(ADMIN(), `⚠️ ${text(u)}\n\n${top >= 100 ? "Сарын кредит дууслаа. Нэмэлт кредит автоматаар авах тохиргоо асаалттай бол бот үргэлжлэн ажиллана." : "Дуусахаас өмнө нэмэлт кредит эсвэл том багц хэрэгтэй эсэхийг шийдээрэй."}`);
  } catch (e) { console.warn("[makewatch]", e.message); }
}
check.sent = new Set();
async function reportText() {
  if (!process.env.MAKE_API_TOKEN) return "Make кредит шалгах тохиргоо хийгдээгүй (Render-т MAKE_API_TOKEN алга).";
  try { return "📊 " + text(await usage()); } catch (e) { return `Make кредит шалгаж чадсангүй: ${e.message}`; }
}
let timer = null;
function start() {
  if (timer || process.env.NODE_ENV === "test") return;
  setTimeout(check, 120000).unref?.();
  timer = setInterval(check, Number(process.env.MAKE_CHECK_MIN || 180) * 60000); timer.unref?.();
}
module.exports = { start, check, usage, reportText };
