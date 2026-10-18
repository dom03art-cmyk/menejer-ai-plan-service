// Борлуулалтын юүлүүрийн тулгалт — зөвхөн захиалагчийн хэлсэн тоогоор.
// Санхүүгийн тооцоог ӨӨРЧЛӨХГҮЙ: зөвхөн нэмэлт хүснэгт, анхааруулга гаргана.
const num = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : null; };

// intake-ийн funnel талбарыг цэвэрлэнэ. Хувийг 0–1 болгоно (20 → 0.2).
function clean(F) {
  if (!F || typeof F !== "object") return null;
  let conv = num(F.conv_rate);
  if (conv !== null && conv > 1) conv = conv <= 100 ? conv / 100 : null;
  const out = { monthly_contacts: num(F.monthly_contacts), conv_rate: conv, avg_ticket: num(F.avg_ticket) };
  return out.monthly_contacts || out.conv_rate || out.avg_ticket ? out : null;
}

// grossY1 — 1-р жилийн орлого НӨАТ-тэй үнээр (захиалагчийн дундаж худалдан авалттай харьцуулахад)
function analyze(F, grossY1) {
  const c = clean(F);
  if (!c || !(grossY1 > 0)) return null;
  const r = { ...c, planned_revenue_y1: Math.round(grossY1) };
  if (c.avg_ticket) {
    r.purchases_needed_y1 = Math.ceil(grossY1 / c.avg_ticket);
    r.purchases_needed_monthly = Math.ceil(r.purchases_needed_y1 / 12);
    if (c.conv_rate) {
      r.contacts_needed_y1 = Math.ceil(r.purchases_needed_y1 / c.conv_rate);
      r.contacts_needed_monthly = Math.ceil(r.contacts_needed_y1 / 12);
    }
    if (c.monthly_contacts && c.conv_rate) {
      r.funnel_revenue_y1 = Math.round(c.monthly_contacts * 12 * c.conv_rate * c.avg_ticket);
      r.plan_vs_funnel = +(grossY1 / r.funnel_revenue_y1).toFixed(2);
    }
  }
  if (r.plan_vs_funnel != null) {
    const d = r.plan_vs_funnel - 1;
    r.verdict = d > 0.3
      ? `Төлөвлөсөн 1-р жилийн орлого одоогийн хандалт, худалдан авалтын хувиар тооцсон дүнгээс ${Math.round(d * 100)}%-иар өндөр. Энэ зөрүүг маркетингаар хандалтыг нэмэгдүүлэх эсвэл худалдан авалтын хувийг сайжруулах замаар нөхөх шаардлагатай; таамаглалыг бодитой эсэхийг шалгана уу.`
      : d < -0.3
        ? `Төлөвлөсөн 1-р жилийн орлого одоогийн хандалтаар тооцсон дүнгээс ${Math.round(-d * 100)}%-иар бага — борлуулалтын таамаглал консерватив байна.`
        : "Төлөвлөсөн 1-р жилийн орлого одоогийн хандалт, худалдан авалтын хувиар тооцсон дүнтэй нийцэж байна (±30%-ийн дотор).";
  } else if (r.contacts_needed_monthly) {
    r.verdict = `Төлөвлөсөн орлогод хүрэхэд сард дунджаар ${r.contacts_needed_monthly.toLocaleString("en-US")} хүн хандах шаардлагатай. Одоогийн хандалтын тоог бүртгэж, энэ зорилттой тулгана уу.`;
  } else if (r.purchases_needed_monthly) {
    r.verdict = `Төлөвлөсөн орлогод хүрэхэд сард дунджаар ${r.purchases_needed_monthly.toLocaleString("en-US")} худалдан авалт шаардлагатай.`;
  }
  return r.verdict ? r : null;
}

module.exports = { clean, analyze };
