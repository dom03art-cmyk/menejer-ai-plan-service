// org-v1/flow.js-ийн холбоос: TENDER → тендерийн модуль, бусад нь хуучнаараа
process.env.TENDER_MOCK = "1"; process.env.ADMIN_PSID = "ADMIN"; delete process.env.REDIS_URL;
const ORG = require("../../org-v1/flow"), { OUTBOX } = require("../msg"), S = require("../store");
let bad = 0; const ok = (c, l) => { console.log((c ? "  ✓ " : "  ✗ ") + l); if (!c) bad++; };
(async () => {
  process.env.TENDER_ENABLED = "0";
  const r0 = await ORG.handleMessage({ psid: "H1", payload: "TENDER" });
  ok(r0 === "selecting_type" && !(await S.getState("H1")), "унтраалттай үед TENDER хуучин урсгалаар (цэс), тендерийн төлөв үүсэхгүй");
  process.env.TENDER_ENABLED = "1";
  ok((await ORG.handleMessage({ psid: "H1", payload: "TENDER" })) === "ext" && (await S.getState("H1")).s === "tnd_upload", "асаалттай үед тендерийн урсгал эхэлнэ");
  ok((await ORG.handleMessage({ psid: "H1", payload: "MKT_PLAN" })) === "ext" && (await ORG._getF("H1")).s === "mkt_interview", "Маркетинг товч хуучнаараа ажиллана");
  ok((await S.getState("H1")).s === "tnd_left", "тендерээс гарсан");
  const a = await ORG.adminAction("PAYOK|TND|H9");
  ok(a && a.ok === false && OUTBOX.some((m) => m.psid === "ADMIN" && /Тендер H9/.test(m.text)), "админы PAYOK|TND| тендерт очно");
  console.log(bad ? "АЛДАА " + bad : "Бүгд зөв"); process.exit(bad ? 1 : 0);
})();
