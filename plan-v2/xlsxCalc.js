// Excel томьёоны жижиг тооцоологч — xlsxModel.js-ийн үүсгэсэн томьёонуудыг серверт (LibreOffice-гүйгээр) бодож,
// үр дүнг файлд хадгална (утас, Messenger-ийн урьдчилан харах хэсэгт тоо харагдана) ба системийн тооцоотой тулгахад ашиглана.
// Дэмжих: + - * / ^ & харьцуулалт, хуудас хоорондын лавлагаа, муж, IF AND OR MAX MIN SUM SUMIF SUMPRODUCT ROUND ROUNDUP COUNT IFERROR IRR
class XErr extends Error { }
const colNum = (s) => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };

function tokenize(src) {
  const t = []; let i = 0; const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === " ") { i++; continue; }
    if (ch === '"') { let j = i + 1, s = ""; while (j < n && src[j] !== '"') s += src[j++]; t.push({ k: "str", v: s }); i = j + 1; continue; }
    if (ch === "'") { let j = i + 1, s = ""; while (j < n && src[j] !== "'") s += src[j++]; if (src[j + 1] !== "!") throw new XErr("хуудасны нэрийн дараа ! алга"); t.push({ k: "sheet", v: s }); i = j + 2; continue; }
    if (/[0-9.]/.test(ch)) { const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i)); t.push({ k: "num", v: Number(m[0]) }); i += m[0].length; continue; }
    const ref = /^\$?([A-Z]{1,3})\$?([0-9]+)/.exec(src.slice(i));
    if (ref && !/^[A-Z]+\(/.test(src.slice(i))) { t.push({ k: "ref", c: colNum(ref[1]), r: Number(ref[2]) }); i += ref[0].length; continue; }
    const fn = /^[A-Z]+(?=\()/.exec(src.slice(i));
    if (fn) { t.push({ k: "fn", v: fn[0] }); i += fn[0].length; continue; }
    const op = /^(<=|>=|<>|[-+*/^&=<>(),:])/.exec(src.slice(i));
    if (op) { t.push({ k: "op", v: op[0] }); i += op[0].length; continue; }
    throw new XErr(`танигдаагүй тэмдэгт «${ch}»: ${src}`);
  }
  return t;
}

// AST
function parse(src) {
  const t = tokenize(src); let p = 0;
  const peek = (v) => t[p] && t[p].k === "op" && t[p].v === v;
  const eat = (v) => { if (!peek(v)) throw new XErr(`«${v}» хүлээгдэж байсан: ${src}`); p++; };
  const bin = (next, ops) => () => { let a = next(); while (t[p] && t[p].k === "op" && ops.includes(t[p].v)) { const o = t[p++].v; a = { k: "bin", o, a, b: next() }; } return a; };
  const primary = () => {
    const x = t[p++]; if (!x) throw new XErr(`дутуу томьёо: ${src}`);
    if (x.k === "num" || x.k === "str") return x;
    if (x.k === "op" && x.v === "(") { const e = cmp(); eat(")"); return e; }
    if (x.k === "fn") { eat("("); const args = []; if (!peek(")")) { args.push(cmp()); while (peek(",")) { p++; args.push(cmp()); } } eat(")"); return { k: "call", f: x.v, args }; }
    let sheet = null, r1 = x;
    if (x.k === "sheet") { sheet = x.v; r1 = t[p++]; }
    if (!r1 || r1.k !== "ref") throw new XErr(`лавлагаа хүлээгдэж байсан: ${src}`);
    if (peek(":")) { p++; const r2 = t[p++]; if (!r2 || r2.k !== "ref") throw new XErr(`мужийн төгсгөл алга: ${src}`); return { k: "range", sheet, r1: r1.r, c1: r1.c, r2: r2.r, c2: r2.c }; }
    return { k: "cell", sheet, r: r1.r, c: r1.c };
  };
  const unary = () => { if (peek("-")) { p++; return { k: "neg", a: unary() }; } if (peek("+")) { p++; return unary(); } return primary(); };
  const pow = bin(unary, ["^"]), mul = bin(pow, ["*", "/"]), add = bin(mul, ["+", "-"]), cat = bin(add, ["&"]);
  const cmp = bin(cat, ["=", "<>", "<", ">", "<=", ">="]);
  const ast = cmp(); if (p !== t.length) throw new XErr(`илүү тэмдэгт: ${src}`); return ast;
}

const num = (v) => { if (typeof v === "number") return v; if (v === null || v === undefined || v === "") return 0; if (typeof v === "boolean") return v ? 1 : 0; const n = Number(v); if (Number.isNaN(n)) throw new XErr("#VALUE!"); return n; };
const isArr = Array.isArray;
const flat = (v) => (isArr(v) ? v : [v]);
function elementwise(a, b, fn) {
  if (!isArr(a) && !isArr(b)) return fn(a, b);
  const n = Math.max(isArr(a) ? a.length : 1, isArr(b) ? b.length : 1);
  if ((isArr(a) && a.length !== n) || (isArr(b) && b.length !== n)) throw new XErr("мужийн хэмжээ таарахгүй");
  return Array.from({ length: n }, (_, i) => fn(isArr(a) ? a[i] : a, isArr(b) ? b[i] : b));
}
const OPS = {
  "+": (a, b) => num(a) + num(b), "-": (a, b) => num(a) - num(b), "*": (a, b) => num(a) * num(b),
  "/": (a, b) => { const d = num(b); if (d === 0) throw new XErr("#DIV/0!"); return num(a) / d; },
  "^": (a, b) => { const r = Math.pow(num(a), num(b)); if (!Number.isFinite(r)) throw new XErr("#NUM!"); return r; },
  "&": (a, b) => String(a ?? "") + String(b ?? ""),
  "=": (a, b) => cmpv(a, b) === 0, "<>": (a, b) => cmpv(a, b) !== 0, "<": (a, b) => cmpv(a, b) < 0, ">": (a, b) => cmpv(a, b) > 0, "<=": (a, b) => cmpv(a, b) <= 0, ">=": (a, b) => cmpv(a, b) >= 0,
};
function cmpv(a, b) {
  if (a === null || a === undefined) a = typeof b === "string" ? "" : 0;
  if (b === null || b === undefined) b = typeof a === "string" ? "" : 0;
  if (typeof a === "boolean") a = a ? 1 : 0; if (typeof b === "boolean") b = b ? 1 : 0;
  if (typeof a === typeof b) return a < b ? -1 : a > b ? 1 : 0;
  return typeof a === "number" ? -1 : 1; // Excel: тоо < текст
}
const nums = (args) => args.flatMap(flat).filter((v) => typeof v === "number");
function irr(cf) {
  const npv = (r) => cf.reduce((a, c, i) => a + c / Math.pow(1 + r, i), 0);
  const dnpv = (r) => cf.reduce((a, c, i) => a - i * c / Math.pow(1 + r, i + 1), 0);
  if (!(cf.some((c) => c > 0) && cf.some((c) => c < 0))) throw new XErr("#NUM!");
  // Excel-тэй адил: 10%-аас эхлэх Ньютоны арга
  let x = 0.1;
  for (let i = 0; i < 60; i++) { const fx = npv(x), d = dnpv(x); if (!Number.isFinite(fx) || !d) break; const nx = x - fx / d; if (!(nx > -0.999999)) break; if (Math.abs(nx - x) < 1e-12) return nx; x = nx; }
  if (Number.isFinite(x) && x > -0.99 && Math.abs(npv(x)) < 1e-6 * Math.abs(cf[0] || 1)) return x;
  // нөөц: систем (model.js)-тэй ижил хоёр хуваах арга
  let lo = -0.99, hi = 10; if (npv(hi) > 0) throw new XErr("#NUM!");
  for (let i = 0; i < 300; i++) { const mid = (lo + hi) / 2; npv(mid) > 0 ? lo = mid : hi = mid; }
  return (lo + hi) / 2;
}

// get(sheetName, row, col) → нүдний түүхий утга ({formula} объект эсвэл утга)
function makeEvaluator(getRaw) {
  const memo = new Map(), busy = new Set();
  const cellVal = (sheet, r, c) => {
    const key = `${sheet}!${r},${c}`;
    if (memo.has(key)) { const m = memo.get(key); if (m instanceof XErr) throw m; return m; }
    const raw = getRaw(sheet, r, c);
    let v = raw;
    if (raw && typeof raw === "object" && "formula" in raw) {
      if (busy.has(key)) throw new XErr(`тойрсон лавлагаа ${key}`);
      busy.add(key);
      try { v = ev(parse(raw.formula), sheet); if (isArr(v)) v = v[0]; }
      catch (e) { busy.delete(key); if (e instanceof XErr) { memo.set(key, e); } throw e; }
      busy.delete(key);
    } else if (raw && typeof raw === "object") v = raw.result ?? raw.text ?? null;
    memo.set(key, v); return v;
  };
  const ev = (n, sheet) => {
    switch (n.k) {
      case "num": case "str": return n.v;
      case "neg": { const a = ev(n.a, sheet); return isArr(a) ? a.map((x) => -num(x)) : -num(a); }
      case "bin": return elementwise(ev(n.a, sheet), ev(n.b, sheet), OPS[n.o]);
      case "cell": return cellVal(n.sheet || sheet, n.r, n.c);
      case "range": { const out = []; for (let r = Math.min(n.r1, n.r2); r <= Math.max(n.r1, n.r2); r++) for (let c = Math.min(n.c1, n.c2); c <= Math.max(n.c1, n.c2); c++) out.push(cellVal(n.sheet || sheet, r, c)); return out; }
      case "call": {
        const A = n.args, e = (i) => ev(A[i], sheet);
        switch (n.f) {
          case "IF": { let c = e(0); if (isArr(c)) c = c[0]; return (typeof c === "string" ? c !== "" : !!num(c)) ? e(1) : (A.length > 2 ? e(2) : false); }
          case "IFERROR": try { return e(0); } catch (x) { if (x instanceof XErr) return e(1); throw x; }
          case "AND": return A.every((_, i) => flat(e(i)).every((v) => !!num(v)));
          case "OR": return A.some((_, i) => flat(e(i)).some((v) => !!num(v)));
          case "SUM": return nums(A.map((_, i) => e(i))).reduce((a, b) => a + b, 0);
          case "MAX": { const v = nums(A.map((_, i) => e(i))); return v.length ? Math.max(...v) : 0; }
          case "MIN": { const v = nums(A.map((_, i) => e(i))); return v.length ? Math.min(...v) : 0; }
          case "COUNT": return nums(A.map((_, i) => e(i))).length;
          case "ROUND": { const m = Math.pow(10, num(A.length > 1 ? e(1) : 0)), x = num(e(0)); return Math.sign(x) * Math.round(Math.abs(x) * m) / m; }
          case "ROUNDUP": { const m = Math.pow(10, num(A.length > 1 ? e(1) : 0)), x = num(e(0)); return Math.sign(x) * Math.ceil(Math.abs(x) * m - 1e-9) / m; }
          case "SUMIF": { const rg = flat(e(0)), crit = e(1), sr = flat(e(2)); if (rg.length !== sr.length) throw new XErr("SUMIF мужийн хэмжээ"); let s = 0; rg.forEach((v, i) => { if (v !== null && v !== undefined && v !== "" && cmpv(v, crit) === 0 && typeof sr[i] === "number") s += sr[i]; }); return s; }
          case "SUMPRODUCT": { let acc = null; A.forEach((_, i) => { const v = flat(e(i)).map((x) => (typeof x === "number" ? x : typeof x === "boolean" ? (x ? 1 : 0) : 0)); acc = acc ? elementwise(acc, v, (a, b) => a * b) : v; }); return flat(acc).reduce((a, b) => a + b, 0); }
          case "IRR": return irr(nums([e(0)]));
          default: throw new XErr(`дэмжигдээгүй функц ${n.f}`);
        }
      }
      default: throw new XErr("AST");
    }
  };
  return { cellVal };
}

// exceljs workbook-ийн бүх томьёог бодож, үр дүнг нүдэнд хадгална. Алдаа гарсан нүдний жагсаалтыг буцаана.
function computeWorkbook(wb) {
  const sheets = new Map(wb.worksheets.map((ws) => [ws.name, ws]));
  const getRaw = (sheet, r, c) => { const ws = sheets.get(sheet); if (!ws) throw new XErr(`хуудас олдсонгүй: ${sheet}`); const row = ws.findRow(r); const cell = row && row.findCell(c); return cell ? cell.value : null; };
  const evl = makeEvaluator(getRaw); const errors = []; let count = 0;
  for (const ws of wb.worksheets) ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (cell, c) => {
    const v = cell.value; if (!(v && typeof v === "object" && "formula" in v)) return;
    try { let res = evl.cellVal(ws.name, r, c); if (typeof res === "boolean") res = res ? 1 : 0; cell.value = { formula: v.formula, result: res === null || res === undefined ? 0 : res }; count++; }
    catch (e) { if (!(e instanceof XErr)) throw e; errors.push({ sheet: ws.name, addr: cell.address, error: e.message }); }
  }));
  return { count, errors, value: (sheet, r, c) => evl.cellVal(sheet, r, c) };
}

module.exports = { computeWorkbook, parse, makeEvaluator, XErr };
