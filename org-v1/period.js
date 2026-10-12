// Тайлан, төлөвлөгөөний хугацаа: жил / хагас жил / улирал / сар.
// Захиалагч Messenger-ээр сонгоно: { type: "year" | "half" | "quarter" | "month", n }.
// "year" (эсвэл сонголтгүй) бол хуучин жилийн урсгал огт өөрчлөгдөхгүй — make() null буцаана.
const ROMAN = ["I", "II", "III", "IV"];
const TYPES = { half: 2, quarter: 4, month: 12 };

function valid(p) {
  if (!p || typeof p !== "object") return false;
  if (p.type === "year") return true;
  const max = TYPES[p.type], n = Number(p.n);
  return !!max && Number.isInteger(n) && n >= 1 && n <= max;
}
const clean = (p) => (valid(p) ? (p.type === "year" ? { type: "year" } : { type: p.type, n: Number(p.n) }) : null);

function monthsOf(p) {
  if (p.type === "half") return p.n === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12];
  if (p.type === "quarter") return [1, 2, 3].map((k) => (p.n - 1) * 3 + k);
  if (p.type === "month") return [p.n];
  return Array.from({ length: 12 }, (_, i) => i + 1);
}

// Нэр, тийн ялгалын хэлбэрүүд
function names(p) {
  if (p.type === "half") return { label: `${p.n}-р хагас жил`, gen: `${p.n}-р хагас жилийн`, unit: "хагас жил", unitGen: "хагас жилийн", unitDat: "хагас жилд", short: `${p.n}-р хагас` };
  if (p.type === "quarter") return { label: `${ROMAN[p.n - 1]} улирал`, gen: `${ROMAN[p.n - 1]} улирлын`, unit: "улирал", unitGen: "улирлын", unitDat: "улиралд", short: `${ROMAN[p.n - 1]} улирал` };
  if (p.type === "month") return { label: `${p.n}-р сар`, gen: `${p.n}-р сарын`, unit: "сар", unitGen: "сарын", unitDat: "сард", short: `${p.n}-р сар` };
  return { label: "жил", gen: "жилийн", unit: "жил", unitGen: "жилийн", unitDat: "жилд", short: "Жил" };
}

// Монголын цагаар өнөөдрийн он, сар
function nowUB() { const d = new Date(Date.now() + 8 * 3600e3); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; }

// Төлөвлөгөө: хугацаа энэ сараас эхэлж байгаа эсвэл хараахан эхлээгүй бол энэ он, эхэлчихсэн бол ирэх он
function planYear(p, now = nowUB()) { return monthsOf(p)[0] >= now.m ? now.y : now.y + 1; }
// Тайлан: хугацаа эхэлсэн бол энэ он, эхлээгүй бол өнгөрсөн он (материалд он байвал түүнийг авна)
function reportYear(p, now = nowUB()) { return monthsOf(p)[0] <= now.m ? now.y : now.y - 1; }

function next(p, year) {
  if (p.type === "year") return { type: "year", year: year + 1 };
  const max = TYPES[p.type];
  return p.n < max ? { type: p.type, n: p.n + 1, year } : { type: p.type, n: 1, year: year + 1 };
}

// Бүрэн хэлбэр (жил биш хугацаанд)
function make(p0, year) {
  const p = clean(p0);
  if (!p || p.type === "year") return null;
  const ms = monthsOf(p), nm = names(p);
  const range = ms.length === 1 ? `${ms[0]}-р сар` : `${ms[0]}–${ms[ms.length - 1]}-р сар`;
  const full = p.type === "month" ? `${year} оны ${p.n}-р сар` : `${year} оны ${nm.label} (${range})`;
  const periods = p.type === "month" ? ["1-р долоо хоног", "2-р долоо хоног", "3-р долоо хоног", "4-р долоо хоног"] : ms.map((m) => `${m}-р сар`);
  const nx = next(p, year), nxn = names(nx);
  const nextFull = nx.type === "month" ? `${nx.year} оны ${nx.n}-р сар` : `${nx.year} оны ${nxn.label}`;
  return { ...p, year, months: ms, range, full, periods, nextFull, ...nm, title: `${year} ОНЫ ${nm.gen.toUpperCase()}` };
}

// Бүтцийн гарчгийг хугацаанд тааруулна (жилийн урсгалд дуудагдахгүй)
function adaptOutline(outline, P) {
  if (!P) return outline;
  const U = (s) => s.toUpperCase(), cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const rules = [
    [/ӨНГӨРСӨН ЖИЛИЙН|ӨНГӨРСӨН ОНЫ/g, "ӨМНӨХ ХУГАЦААНЫ"],
    [/ДАРАА ЖИЛИЙН/g, "ДАРААГИЙН " + U(P.unitGen)],
    [/ЖИЛИЙН ТӨСӨВ/g, U(P.unitGen) + " ТӨСӨВ"],
    [/Ирэх жилийн|Ирэх оны/g, "Ирэх " + P.unitGen],
    [/Ирэх жилд/g, "Ирэх " + P.unitDat],
    [/^(\S+ )Жилийн/, `$1${cap(P.unitGen)}`],
  ];
  return outline.map((o) => {
    if (!o.t) return o;
    let t = o.t;
    for (const [re, to] of rules) t = t.replace(re, to);
    if (/Улирлын гол үр дүн/.test(t) && P.type === "quarter") t = t.replace("Улирлын гол үр дүн", "Сар бүрийн гол үр дүн");
    if (/Улирлын гол үр дүн/.test(t) && P.type === "month") t = t.replace("Улирлын гол үр дүн", "Долоо хоног бүрийн гол үр дүн");
    return t === o.t ? o : { ...o, t };
  });
}

// AI бичигчид өгөх хугацааны дүрэм
function note(product, P) {
  if (!P) return "";
  const plan = product === "plan" || product === "plan_dept";
  if (plan) return `ТӨЛӨВЛӨГӨӨНИЙ ХУГАЦАА: ${P.full}. Энэ бол ${P.gen} төлөвлөгөө (жилийн биш). Бүх ажил, зорилт, хуваарь, хариуцагчийн хугацааг зөвхөн энэ хугацаанд (${P.range}) багтаа. Зааварт "12 сар", "жилийн", "ирэх жил", "ирэх он" гэж байвал энэ хугацаагаар орлуулж ойлго (жишээ нь "Сар бүрийн гол ажил" хүснэгт ${P.type === "month" ? "долоо хоногоор 4 мөр" : P.months.length + " мөр"}). Gantt блокийн periods = ${JSON.stringify(P.periods)}. Зорилтыг энэ хугацаанд хүрэх түвшнээр тавь: жилийн зорилт, жилийн дүнг шууд хуулахгүй. Хугацааг "${P.full}" гэж бич.\n\n`;
  return `ТАЙЛАНТ ХУГАЦАА: ${P.full}. Энэ бол ${P.gen} тайлан (жилийн биш). Зөвхөн энэ хугацааны ажил, үр дүнг дүгнэ; материалд өөр хугацааны мэдээлэл байвал зөвхөн харьцуулалтад ашигла. Зааварт "жилийн", "ирэх жил", "дараа жил" гэж байвал "${P.unitGen}", "дараагийн ${P.unit} (${P.nextFull})" гэж ойлгож бич. Жилийн зорилттой харьцуулахдаа хамарсан хугацааг заа. Хугацааг "${P.full}" гэж бич.\n\n`;
}

// Тайлбар текст (Messenger-т): хугацааны богино нэр
const shortText = (p0) => { const p = clean(p0); return !p ? "" : p.type === "year" ? "Жилийн" : names(p).label; };

module.exports = { valid, clean, make, monthsOf, names, next, planYear, reportYear, adaptOutline, note, shortText, nowUB, ROMAN };
