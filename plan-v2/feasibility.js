// Санхүүгийн боломжийн шалгалт: төсөл алдагдалтай/зээлээ төлж чадахгүй гарвал
// Claude-аар бодит зах зээлийн түвшинд таамаглалыг хянуулж, дахин тооцно.
const { callJSON } = require("./claude");
const { normalize } = require("./intake");
const { analyse } = require("./model");

const metrics = (an) => ({
  npv: Math.round(an.npv), irr_pct: +(an.irr * 100).toFixed(1), payback_years: an.pb ? +an.pb.toFixed(2) : null,
  dscr: an.R.dscr.slice(0, 3).map(d => d === null ? null : +d.toFixed(2)),
  revenue: an.R.years.map(y => Math.round(y.rev)), ebitda: an.R.years.map(y => Math.round(y.ebitda)),
  net_income: an.R.years.map(y => Math.round(y.ni)), min_cash: Math.round(Math.min(...an.R.mc.map(x => x.cash))),
});
const viable = (an) => an.npv > 0 && an.R.dscr.slice(0, 3).every(d => d === null || d >= 1.2) && Math.min(...an.R.mc.map(x => x.cash)) >= 0;
// Хэт өөдрөг үр дүн: банк итгэхгүй, таамаглал бодитоос хол байх магадлалтай
const tooGood = (an) => an.irr > 0.40 || (an.pb !== null && an.pb < 2.5);
const score = (an) => (an.npv > 0 ? 1 : 0) + Math.min(...an.R.dscr.slice(0, 3).map(d => d ?? 3));

const SYSTEM = `Чи Монголын банкны зээлийн шинжээч, салбарын санхүүгийн зөвлөх. Бизнес төслийн санхүүгийн загварын таамаглал хэт бага/буруу тооцогдсоноос төсөл алдагдалтай гарсан байж болзошгүй. Таамаглалыг Монголын 2026 оны БОДИТ зах зээлийн түвшинд хянаж засна.
ДҮРЭМ:
1. Захиалагчийн яриандаа ТОДОРХОЙ хэлсэн тоог (зээлийн дүн, одоо байгаа хөрөнгө, үнэ, тоо толгой г.м.) ӨӨРЧЛӨХГҮЙ.
2. Таамагласан (assumed) утгуудыг бодит зах зээлийн түвшинд засна: үнэ, борлуулалтын хэмжээ, өртөг, тогтмол зардал.
3. Бизнесийн бүх орлогын эх үүсвэрийг тусга (жишээ нь мал аж ахуйд: мах/амьд мал борлуулалт, төллөлтөөр сүргийн өсөлт, сүү, арьс шир, бордоо; үйлдвэрт: дайвар бүтээгдэхүүн). Сүргийн өсөлт, хүчин чадлын ашиглалтыг жил бүр бодитоор өсгө.
4. Зээлийн бүтцийг төслийн мөчлөгт тааруулж болно: хугацаа 60 сар хүртэл, үндсэн төлбөрийн хөнгөлөлт 12 сар хүртэл (мал аж ахуй, газар тариалан, барилгын үе шаттай төсөлд ердийн).
5. Тоо зохиож хөөргөхгүй — бодит бус өндөр үнэ, хэт өөдрөг борлуулалт хэрэглэхгүй. Хэрэв бодит түвшинд ч төсөл ашиггүй бол тэгж үлдээж, шалтгаанаа тайлбарла.
6. Түгээмэл алдааг заавал шалга: захиалагч ажилтан авахгүй гэсэн ч staff-д цалин тооцсон эсэх (эзэмшигчийн хөдөлмөр зардал биш); мал, газрыг элэгдүүлсэн эсэх (depreciable: false болго); орлогын эх үүсвэр орхигдсон эсэх; тогтмол зардал хэт өндөр эсэх.
7. Өөрчилсөн зүйл бүрийг changes-д Монгол хэлээр, хуучин → шинэ утга, шалтгаантай нь бич.
Зөвхөн JSON буцаа. Бүтэн таамаглалыг бүү давт — ЗӨВХӨН өөрчлөх дээд түвшний талбаруудыг patch-д бүтнээр нь бич (жишээ нь "staff": [], "products": [...шинэчилсэн бүтэн жагсаалт], "loan": {...}):
{"patch": {...}, "changes": ["..."], "verdict": "viable|not_viable", "reason": "товч тайлбар"}`;

const OPT_SYSTEM = `Чи Монголын банкны зээлийн шинжээч, салбарын санхүүгийн зөвлөх. Бизнес төслийн санхүүгийн үр дүн хэт өндөр гарсан (IRR 40%-иас их эсвэл хөрөнгө оруулалт 2.5 жилээс богино хугацаанд нөхөгдөж байна). Ийм үр дүнд банк итгэдэггүй — ихэвчлэн хөрөнгө оруулалт (барилга, тоног төхөөрөмж) хэт бага, эсвэл борлуулалт, үнэ, ачаалал хэт өндөр, зардал орхигдсоноос болдог.
ДҮРЭМ:
1. Захиалагчийн яриандаа ТОДОРХОЙ хэлсэн тоог (зээлийн дүн, үнэ, хүчин чадал, хөрөнгийн үнэ, өрөө/суудлын тоо г.м.) ӨӨРЧЛӨХГҮЙ. Зээлийн дүн, өөрийн хөрөнгө (loan.amount, cash_equity, inkind)-ийг ӨӨРЧЛӨХГҮЙ.
2. Зөвхөн таамагласан (assumed_fields-д байгаа эсвэл захиалагч хэлээгүй) утгуудыг Монголын 2026 оны бодит түвшинтэй харьцуул: барилгын м2-ийн өртөг, тоног төхөөрөмжийн үнэ, ачааллын хувь (ялангуяа эхний жилүүдэд), борлуулалтын хэмжээ, ажилтны тоо, цалин, тогтмол зардал (засвар үйлчилгээ, даатгал, цахилгаан, түлш, түрээс г.м.).
3. Хэт өөдрөг утгыг бодит түвшинд засна. Орхигдсон зардлыг нэм. Зорилго бол үр дүнг дарах биш — БОДИТ, банкны шинжээчийн шалгалтад тэсвэрлэх тоо.
4. CAPEX нэмэгдвэл capex + init_inventory нь loan.amount + cash_equity-ээс хэтрэхгүй байх.
5. Бүх таамаглал бодит бөгөөд үр дүн өндөр хэвээр байвал patch = null буцаа.
6. Өөрчилсөн зүйл бүрийг changes-д Монгол хэлээр, хуучин → шинэ утга, шалтгаантай нь бич.
Зөвхөн JSON буцаа. ЗӨВХӨН өөрчлөх дээд түвшний талбаруудыг patch-д бүтнээр нь бич:
{"patch": {...}|null, "changes": ["..."], "reason": "товч тайлбар"}`;

// Хэт өөдрөг үр дүнг нэг удаа хянуулна. Алдаа гарвал эсвэл үр дүн муудвал анхныхаа хэвээр үлдэнэ.
async function realism(best, research, conversation, log) {
  try {
    const user = `ОДООГИЙН ТААМАГЛАЛ:\n${JSON.stringify(best.A)}\n\nҮР ДҮН: ${JSON.stringify(metrics(best.an))}\n\nЗАХИАЛАГЧИЙН ЯРИА:\n${(conversation || "").slice(0, 10000)}\n\nСУДАЛГААНЫ БАРИМТ:\n${JSON.stringify([...(research.market || []), ...(research.macro || [])].slice(0, 30))}`;
    const out = await callJSON({ system: OPT_SYSTEM, user, maxTokens: 32000 });
    const patch = out && out.patch;
    if (!patch || typeof patch !== "object" || !Object.keys(patch).length) { log("бодит байдлын шалгалт: өөрчлөлтгүй"); return best; }
    // Санхүүжилтийн бүтцийг (зээл, өөрийн хөрөнгө) энэ шатанд өөрчлөхгүй
    delete patch.loan; delete patch.cash_equity; delete patch.inkind; delete patch.company; delete patch.project;
    const A2 = normalize({ ...best.A, ...patch, assumed_fields: [...new Set([...(best.A.assumed_fields || []), ...(patch.assumed_fields || [])])] });
    const an2 = analyse(A2);
    log(`бодит байдлын шалгалт: IRR ${(best.an.irr * 100).toFixed(1)}% → ${(an2.irr * 100).toFixed(1)}%, DSCR1 ${best.an.R.dscr[0]} → ${an2.R.dscr[0]}`);
    if (!viable(an2) || !an2.balanceOk || an2.irr >= best.an.irr) { log("бодит байдлын шалгалт: үр дүн хүлээн авах нөхцөл хангаагүй — анхныхаар үлдээв"); return best; }
    return { A: A2, an: an2, changes: [...best.changes, ...(out.changes || [])], reason: best.reason || out.reason };
  } catch (e) { log(`бодит байдлын шалгалт алгасав: ${e.message}`); return best; }
}

async function review(A, an, research, conversation, log) {
  let best = { A, an, changes: [] };
  for (let round = 1; round <= 2 && !viable(best.an); round++) {
    const user = `ОДООГИЙН ТААМАГЛАЛ:\n${JSON.stringify(best.A)}\n\nҮР ДҮН: ${JSON.stringify(metrics(best.an))}\n\nЗАХИАЛАГЧИЙН ЯРИА:\n${(conversation || "").slice(0, 10000)}\n\nСУДАЛГААНЫ БАРИМТ:\n${JSON.stringify([...(research.market || []), ...(research.macro || [])].slice(0, 30))}`;
    let out;
    try { out = await callJSON({ system: SYSTEM, user, maxTokens: 32000 }); } catch (e) { log(`feasibility алдаа: ${e.message}`); break; }
    const patch = out && (out.patch || out.assumptions);
    if (!patch) break;
    let A2; try { A2 = normalize({ ...best.A, ...patch, loan: { ...best.A.loan, ...(patch.loan || {}) }, assumed_fields: [...new Set([...(best.A.assumed_fields || []), ...(patch.assumed_fields || [])])] }); } catch (e) { log(`feasibility normalize алдаа: ${e.message}`); break; }
    const an2 = analyse(A2);
    log(`feasibility ${round}: NPV ${Math.round(best.an.npv)} → ${Math.round(an2.npv)}, DSCR1 ${best.an.R.dscr[0]} → ${an2.R.dscr[0]}`);
    if (score(an2) > score(best.an)) best = { A: A2, an: an2, changes: [...best.changes, ...(out.changes || [])], reason: out.reason };
    else break;
  }
  if (viable(best.an) && tooGood(best.an) && process.env.PLAN_REALISM_CHECK !== "0") best = await realism(best, research, conversation, log);
  best.viable = viable(best.an);
  return best;
}
module.exports = { review, viable, metrics, tooGood };
