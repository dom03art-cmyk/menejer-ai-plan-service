// Шатлалтай үнэ: ТББ-ийн (төлбөрөөс өмнө илгээсэн) файлын нийт хуудсаар. Агуулгыг уншихгүй — зөвхөн тоолно (org-v1/quote.countFile).
// TENDER_TIERS="100:149900,200:179900,300:199900" — «хуудас хүртэл:үнэ». Сүүлийн шатаас их бол хүлээж авахгүй.
// Оролцогчийн баримт (төлбөрийн дараа) үнэд нөлөөлөхгүй, нийт TENDER_BIDDER_MAX_PAGES (120) хуудас хүртэл.
const { countFile } = require("../org-v1/quote");
const fmtMoney = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "₮";

function tiers() {
  return String(process.env.TENDER_TIERS || "100:149900,200:179900,300:199900").split(",")
    .map((x) => x.split(":").map(Number)).filter(([p, v]) => p > 0 && v > 0).sort((a, b) => a[0] - b[0])
    .map(([upto, price]) => ({ upto, price }));
}
const maxPages = () => tiers().slice(-1)[0].upto;
const bidderMax = () => Number(process.env.TENDER_BIDDER_MAX_PAGES || 120);

// Нэг файлын хуудас (зураг = 1). Уншиж чадахгүй бол { error }
async function pagesOf({ buf, name, mime }) {
  const c = await countFile({ buf, name, mime });
  if (c.error) return { error: c.error };
  return { pages: Math.max(1, Number(c.pages) || Number(c.units) || 1), scan: /скан/.test(c.note || "") ? c.note : "" };
}
const sumPages = (files, phase) => files.filter((f) => f.phase === phase).reduce((s, f) => s + (Number(f.pages) || 1), 0);

// → { pages, price, tierText, over }
function quote(pages) {
  const T = tiers(), t = T.find((x) => pages <= x.upto);
  if (!t) return { pages, price: null, over: true, tierText: `${T.slice(-1)[0].upto}-аас олон хуудас` };
  const i = T.indexOf(t), from = i ? T[i - 1].upto + 1 : 1;
  return { pages, price: t.price, over: false, tierText: `${from}–${t.upto} хуудас` };
}
const tierLines = () => tiers().map((t, i, T) => `• ${i ? T[i - 1].upto + 1 : 1}–${t.upto} хуудас: ${fmtMoney(t.price)}`).join("\n");

module.exports = { tiers, maxPages, bidderMax, pagesOf, sumPages, quote, tierLines, fmtMoney };
