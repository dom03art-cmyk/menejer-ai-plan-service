// Санхүүгийн боломжийн шалгалт: төсөл алдагдалтай/зээлээ төлж чадахгүй гарвал
// Claude-аар бодит зах зээлийн түвшинд таамаглалыг хянуулж, дахин тооцно.
const { callJSON } = require("./claude");
const { normalize } = require("./intake");
const { analyse } = require("./model");

const metrics = (an) => ({
  npv: Math.round(an.npv), irr_pct: +(an.irr * 100).toFixed(1),
  dscr: an.R.dscr.slice(0, 3).map(d => d === null ? null : +d.toFixed(2)),
  revenue: an.R.years.map(y => Math.round(y.rev)), ebitda: an.R.years.map(y => Math.round(y.ebitda)),
  net_income: an.R.years.map(y => Math.round(y.ni)), min_cash: Math.round(Math.min(...an.R.mc.map(x => x.cash))),
});
const viable = (an) => an.npv > 0 && an.R.dscr.slice(0, 3).every(d => d === null || d >= 1.2) && Math.min(...an.R.mc.map(x => x.cash)) >= 0;
const score = (an) => (an.npv > 0 ? 1 : 0) + Math.min(...an.R.dscr.slice(0, 3).map(d => d ?? 3));

const SYSTEM = `Чи Монголын банкны зээлийн шинжээч, салбарын санхүүгийн зөвлөх. Бизнес төслийн санхүүгийн загварын таамаглал хэт бага/буруу тооцогдсоноос төсөл алдагдалтай гарсан байж болзошгүй. Таамаглалыг Монголын 2026 оны БОДИТ зах зээлийн түвшинд хянаж засна.
ДҮРЭМ:
1. Захиалагчийн яриандаа ТОДОРХОЙ хэлсэн тоог (зээлийн дүн, одоо байгаа хөрөнгө, үнэ, тоо толгой г.м.) ӨӨРЧЛӨХГҮЙ.
2. Таамагласан (assumed) утгуудыг бодит зах зээлийн түвшинд засна: үнэ, борлуулалтын хэмжээ, өртөг, тогтмол зардал.
3. Бизнесийн бүх орлогын эх үүсвэрийг тусга (жишээ нь мал аж ахуйд: мах/амьд мал борлуулалт, төллөлтөөр сүргийн өсөлт, сүү, арьс шир, бордоо; үйлдвэрт: дайвар бүтээгдэхүүн). Сүргийн өсөлт, хүчин чадлын ашиглалтыг жил бүр бодитоор өсгө.
4. Зээлийн бүтцийг төслийн мөчлөгт тааруулж болно: хугацаа 60 сар хүртэл, үндсэн төлбөрийн хөнгөлөлт 12 сар хүртэл (мал аж ахуй, газар тариалан, барилгын үе шаттай төсөлд ердийн).
5. Тоо зохиож хөөргөхгүй — бодит бус өндөр үнэ, хэт өөдрөг борлуулалт хэрэглэхгүй. Хэрэв бодит түвшинд ч төсөл ашиггүй бол тэгж үлдээж, шалтгаанаа тайлбарла.
6. Өөрчилсөн зүйл бүрийг changes-д Монгол хэлээр, хуучин → шинэ утга, шалтгаантай нь бич.
Зөвхөн JSON буцаа: {"assumptions": {...бүтэн шинэчилсэн таамаглалын объект, ижил бүтэцтэй...}, "changes": ["..."], "verdict": "viable|not_viable", "reason": "товч тайлбар"}`;

async function review(A, an, research, conversation, log) {
  let best = { A, an, changes: [] };
  for (let round = 1; round <= 2 && !viable(best.an); round++) {
    const user = `ОДООГИЙН ТААМАГЛАЛ:\n${JSON.stringify(best.A)}\n\nҮР ДҮН: ${JSON.stringify(metrics(best.an))}\n\nЗАХИАЛАГЧИЙН ЯРИА:\n${(conversation || "").slice(0, 10000)}\n\nСУДАЛГААНЫ БАРИМТ:\n${JSON.stringify([...(research.market || []), ...(research.macro || [])].slice(0, 30))}`;
    let out;
    try { out = await callJSON({ system: SYSTEM, user, maxTokens: 12000 }); } catch (e) { log(`feasibility алдаа: ${e.message}`); break; }
    if (!out || !out.assumptions) break;
    let A2; try { A2 = normalize({ ...best.A, ...out.assumptions, assumed_fields: [...new Set([...(best.A.assumed_fields || []), ...((out.assumptions.assumed_fields) || [])])] }); } catch (e) { log(`feasibility normalize алдаа: ${e.message}`); break; }
    const an2 = analyse(A2);
    log(`feasibility ${round}: NPV ${Math.round(best.an.npv)} → ${Math.round(an2.npv)}, DSCR1 ${best.an.R.dscr[0]} → ${an2.R.dscr[0]}`);
    if (score(an2) > score(best.an)) best = { A: A2, an: an2, changes: [...best.changes, ...(out.changes || [])], reason: out.reason };
    else break;
  }
  best.viable = viable(best.an);
  return best;
}
module.exports = { review, viable, metrics };
