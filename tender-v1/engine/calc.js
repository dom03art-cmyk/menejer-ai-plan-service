'use strict';
// Тендерийн тоон тооцоо. Claude тоо бичихгүй — бүх дүнг энд тооцно.

const UNITS_ATTR = ['', 'нэг', 'хоёр', 'гурван', 'дөрвөн', 'таван', 'зургаан', 'долоон', 'найман', 'есөн'];
const TENS_ATTR = ['', 'арван', 'хорин', 'гучин', 'дөчин', 'тавин', 'жаран', 'далан', 'наян', 'ерэн'];
const SCALES = ['', 'мянган', 'сая', 'тэрбум', 'их наяд'];

function groupWords(n) {
  // 0..999, дараа нь нэр үг (төгрөг, мянга...) орох тул холбох хэлбэрээр
  const out = [];
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  if (h) out.push(UNITS_ATTR[h], 'зуун');
  if (t) out.push(TENS_ATTR[t]);
  if (u) out.push(UNITS_ATTR[u]);
  return out;
}

/** Бүхэл төгрөгийг үсгээр: 12450000 → "арван хоёр сая дөрвөн зуун тавин мянган" */
function amountToWords(amount) {
  let n = Math.round(Number(amount));
  if (!Number.isFinite(n) || n < 0) throw new Error('amountToWords: буруу дүн ' + amount);
  if (n === 0) return 'тэг';
  const groups = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const words = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    words.push(...groupWords(groups[i]));
    if (SCALES[i]) words.push(SCALES[i]);
  }
  return words.join(' ');
}

function fmt(n) {
  const v = Math.round(Number(n) * 100) / 100;
  const [i, d] = v.toFixed(2).split('.');
  const s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return d === '00' ? s : s + ',' + d;
}

const round2 = (x) => Math.round(x * 100) / 100;

/** Барааны үнийн задаргаа: G = D*F, J = G+H+I */
function priceBreakdown(tender, customer) {
  const prices = new Map((customer.prices || []).map((p) => [String(p.item_no), p]));
  const rows = [];
  for (const item of tender.items || []) {
    const p = prices.get(String(item.no));
    const unit = p ? Number(p.unit_price) : null;
    const transport = p ? Number(p.transport || 0) : 0;
    const tax = p ? Number(p.tax || 0) : 0;
    const subtotal = unit == null ? null : round2(item.qty * unit);
    rows.push({
      no: item.no, name: item.name, qty: item.qty, unit: item.unit,
      origin: p ? p.origin || '' : '',
      domestic: p ? !!p.domestic : false,
      unit_price: unit, subtotal, transport, tax,
      total: subtotal == null ? null : round2(subtotal + transport + tax),
      missing: !p || p.unit_price == null,
    });
  }
  const complete = rows.every((r) => !r.missing);
  const total = complete ? round2(rows.reduce((a, r) => a + r.total, 0)) : null;
  return { rows, total, complete };
}

/** Үйлчилгээний төсөв: мөр бүр qty*unit_price */
function serviceBudget(customer) {
  const rows = (customer.service_budget || []).map((r, i) => ({
    no: i + 1, name: r.name, qty: Number(r.qty), unit: r.unit,
    unit_price: Number(r.unit_price), total: round2(Number(r.qty) * Number(r.unit_price)),
  }));
  return { rows, total: round2(rows.reduce((a, r) => a + r.total, 0)), complete: rows.length > 0 };
}

function budgetRatio(total, budget) {
  if (!total || !budget) return null;
  return total / budget;
}

module.exports = { amountToWords, fmt, priceBreakdown, serviceBudget, budgetRatio, round2 };
