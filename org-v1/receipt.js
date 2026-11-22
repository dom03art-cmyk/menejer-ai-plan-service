// Төлбөр хүлээж буй захиалагчийн илгээсэн зураг үнэхээр төлбөрийн баримт мөн эсэхийг шалгана.
// Алдаа гарвал (татаж чадаагүй, AI алдаа) баримт гэж үзнэ — жинхэнэ баримт хэзээ ч алга болохгүй.
// RECEIPT_CHECK=0 бол шалгалтыг унтраана.
const { callJSON, FAST } = require("../plan-v2/claude");
const SYS = `Зургийг ангил: энэ нь мөнгө шилжүүлсэн/төлсөн баримт мөн үү?
Баримт: банкны апп эсвэл интернэт банкны гүйлгээний дэлгэц, QPay/SocialPay/дижитал хэтэвчний төлбөрийн дэлгэц, дансны хуулга, кассын/ATM баримт, гүйлгээ амжилттай гэсэн мэдэгдэл.
Баримт биш: бүтээгдэхүүн, бараа, хүн, сэлфи, фэйсбүүк/инстаграм пост, reel, зар, мэм, бичиг баримт, ярианы дэлгэц, лого гэх мэт.
Эргэлзээтэй бол receipt:true. Зөвхөн JSON: {"receipt":true} эсвэл {"receipt":false}`;
const NOT_MSG = "Таны илгээсэн зураг төлбөрийн баримт биш бололтой 🙏 Төлбөрөө төлсөн бол банкны гүйлгээний баримтын зургийг (screenshot) илгээнэ үү.";
async function isReceipt(url) {
  if (!url || process.env.RECEIPT_CHECK === "0" || process.env.ORG_MOCK === "1") return true;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return true;
    const type = String(r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) return true;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4.5 * 1024 * 1024) return true;
    const out = await callJSON({ model: FAST, maxTokens: 100, tries: 2, system: SYS,
      user: [{ type: "image", source: { type: "base64", media_type: type, data: buf.toString("base64") } }, { type: "text", text: "Ангил." }] });
    return !(out && out.receipt === false);
  } catch (e) { console.warn("[receipt] шалгаж чадсангүй:", e.message); return true; }
}
module.exports = { isReceipt, NOT_MSG };
