// Messenger руу мессеж, товч, файл илгээх. TENDER_MOCK=1 эсвэл туршилтад OUTBOX-д цуглуулна (Facebook руу илгээхгүй).
const { fbText, fbFile } = require("../plan-v2/util");
const GRAPH = "https://graph.facebook.com/v21.0/me/messages";
const OUTBOX = [];
const dry = () => process.env.TENDER_MOCK === "1" || process.env.TENDER_DRY === "1";
const ADMIN = () => process.env.ADMIN_PSID;

async function send(psid, text, buttons) {
  if (!psid) return;
  if (dry()) { OUTBOX.push({ psid, text: String(text), buttons: (buttons || []).map((b) => b[0]) }); return; }
  const token = process.env.FB_PAGE_TOKEN; if (!token) return;
  if (String(text).length > 1990 || !buttons || !buttons.length) {
    // урт текстийг хэсэглэж, товчийг сүүлийн хэсэгт
    if (!buttons || !buttons.length) return fbText(psid, text);
    const { splitText } = require("../plan-v2/util"); const parts = splitText(text, 1900);
    for (const p of parts.slice(0, -1)) await fbText(psid, p);
    text = parts[parts.length - 1];
  }
  const msg = { text: String(text).slice(0, 1990), quick_replies: buttons.slice(0, 13).map(([title, payload]) => ({ content_type: "text", title: title.slice(0, 20), payload })) };
  const r = await fetch(`${GRAPH}?access_token=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: msg }) }).catch((e) => ({ ok: false, text: async () => e.message }));
  if (!r.ok) console.warn("[tender] fb", r.status, await r.text());
}
async function sendFile(psid, buf, filename, mime) {
  if (dry()) { OUTBOX.push({ psid, file: filename, bytes: buf.length }); return; }
  return fbFile(psid, buf, filename, mime);
}
async function sendImage(psid, url) {
  if (dry()) { OUTBOX.push({ psid, image: url }); return; }
  const token = process.env.FB_PAGE_TOKEN; if (!token || !psid || !url) return;
  await fetch(`${GRAPH}?access_token=${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: { attachment: { type: "image", payload: { url, is_reusable: false } } } }) }).catch(() => { });
}
const admin = (text, buttons) => (ADMIN() ? send(ADMIN(), text, buttons).catch(() => { }) : Promise.resolve());
const fmtMoney = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "₮";

module.exports = { send, sendFile, sendImage, admin, fmtMoney, OUTBOX };
