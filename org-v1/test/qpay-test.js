// QPay туршилт (QPay, Facebook-ийг дуурайна, бодит дуудлага хийхгүй):  node org-v1/test/qpay-test.js
delete process.env.REDIS_URL; process.env.FB_PAGE_TOKEN = "fb"; process.env.ADMIN_PSID = "ADM"; process.env.API_KEY = "k"; process.env.PORT = "3999";
process.env.QPAY_CLIENT_ID = "id"; process.env.QPAY_CLIENT_SECRET = "sec"; process.env.QPAY_INVOICE_CODE = "INV"; process.env.QPAY_ENV = "sandbox";
const fb = [], qp = [], jobs = []; let paid = {}, n = 0;
global.fetch = async (url, o = {}) => {
  const ok = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j) });
  if (url.startsWith("https://graph.facebook.com")) { fb.push(JSON.parse(o.body)); return ok({}); }
  if (url.includes("merchant-sandbox.qpay.mn")) {
    const path = url.replace("https://merchant-sandbox.qpay.mn", ""); qp.push([o.method, path, o.body ? JSON.parse(o.body) : null, o.headers]);
    if (path === "/v2/auth/token") return ok({ access_token: "AT", refresh_token: "RT", expires_in: Math.floor(Date.now() / 1000) + 86400, refresh_expires_in: Math.floor(Date.now() / 1000) + 172800 });
    if (path === "/v2/invoice") { const id = "INVID" + (++n); return ok({ invoice_id: id, qr_text: "x", qr_image: Buffer.from("PNG").toString("base64"), qPay_shortUrl: "https://s.qpay.mn/" + id, urls: [] }); }
    if (path === "/v2/payment/check") { const b = JSON.parse(o.body), a = paid[b.object_id] || 0; return ok({ count: a ? 1 : 0, paid_amount: a, rows: a ? [{ payment_id: "P1", payment_status: "PAID", payment_amount: String(a) }] : [] }); }
    if (o.method === "DELETE") return ok({});
    return ok({}, 404);
  }
  if (url.includes("127.0.0.1:3999/org/jobs")) { jobs.push(JSON.parse(o.body)); return ok({ job_id: "J" + jobs.length }); }
  return ok({}, 404);
};
const flow = require("../flow"), QP = require("../qpay");
let fail = 0; const okk = (c, m) => { console.log(c ? "✓" : "✗", m); if (!c) fail++; };
const texts = (psid) => fb.filter((x) => x.recipient.id === psid).map((x) => (x.message.text || (x.message.attachment && "[IMG] " + x.message.attachment.payload.url)));
(async () => {
  // 1. Үнийн санал → QPay нэхэмжлэх
  await flow.onQuote("C1", "report_dept", { price: 49900, units: 5 });
  let f = await flow._getF("C1");
  const inv = qp.find((x) => x[1] === "/v2/invoice");
  okk(inv && inv[2].amount === 49900 && inv[2].invoice_code === "INV" && /\/qpay\/callback\?no=/.test(inv[2].callback_url), "нэхэмжлэх зөв дүнгээр үүссэн");
  okk(f.s === "awaiting_payment" && f.qpay && f.qpay.no, "захиалга төлбөр хүлээх төлөвт, нэхэмжлэх хадгалагдсан");
  okk(texts("C1").some((t) => t.startsWith("[IMG]") && t.includes("/qpay/qr/")) && texts("C1").some((t) => t.includes("https://s.qpay.mn/INVID1")), "QR зураг, төлөх холбоос илгээгдсэн");
  // 2. Төлөөгүй байхад «шалгах»
  await flow.handleMessage({ psid: "C1", payload: "FLOW_QPCHECK" });
  okk(texts("C1").some((t) => t.includes("хараахан орж ирээгүй")) && jobs.length === 0, "төлөөгүй үед ажил эхлээгүй");
  // 3. Дутуу төлбөр → эхлэхгүй
  paid.INVID1 = 30000; okk((await QP.settle(f.qpay.no)) === "unpaid" && jobs.length === 0, "дутуу төлбөрөөр эхлэхгүй");
  // 4. Бүрэн төлбөр → callback → автоматаар эхэлнэ
  paid.INVID1 = 49900; okk((await QP.settle(f.qpay.no, "callback")) === "paid", "төлбөр баталгаажсан");
  f = await flow._getF("C1");
  okk(jobs.length === 1 && jobs[0].product === "report_dept" && f.s === "processing", "ажил автоматаар эхэлсэн");
  okk(texts("C1").some((t) => t.includes("QPay төлбөр амжилттай")) && texts("ADM").some((t) => t.includes("Автоматаар баталгаажиж")), "захиалагч, админд мэдэгдсэн");
  // 5. Давхар callback → давхар ажил үүсэхгүй
  okk((await QP.settle(f.qpay.no, "callback")) === "done" && jobs.length === 1, "давхар callback-аар давхар эхлэхгүй");
  okk(qp.filter((x) => x[1] === "/v2/auth/token").length === 1, "token нэг л удаа авсан");
  // 6. Материал нэмээд үнэ өөрчлөгдвөл хуучин нэхэмжлэх цуцлагдана
  await flow.onQuote("C2", "plan", { price: 99000, units: 10 });
  await flow.onQuote("C2", "plan", { price: 129900, units: 30 });
  const f2 = await flow._getF("C2");
  okk(qp.some((x) => x[0] === "DELETE" && x[1] === "/v2/invoice/INVID2") && f2.qpay.amount === 129900, "хуучин нэхэмжлэх цуцлагдаж шинэ дүнгээр үүссэн");
  // 7. Бизнес төсөл (Make): төлбөр орвол админд APPROVE товч
  const b = await QP.createInvoice({ psid: "B1", amount: 149900, kind: "biz" });
  paid[b.id] = 149900; await QP.settle(b.no);
  const adm = fb.filter((x) => x.recipient.id === "ADM").pop();
  okk(adm.message.quick_replies && adm.message.quick_replies[0].payload === "APPROVE|B1", "бизнес төсөл: админд APPROVE товч очсон");
  // 8. Цуцалбал нэхэмжлэх цуцлагдана
  await flow.onQuote("C3", "report_dept", { price: 49900, units: 5 });
  const f3 = await flow._getF("C3"); await flow.handleMessage({ psid: "C3", payload: "FLOW_CANCEL" });
  okk((await QP.getInv(f3.qpay.no)).status === "cancelled", "цуцлахад нэхэмжлэх цуцлагдсан");
  // 9. QPay унтраалттай бол хуучин урсгал
  delete process.env.QPAY_CLIENT_ID; const before = qp.length;
  await flow.onQuote("C4", "report_dept", { price: 49900, units: 5 });
  okk(qp.length === before && texts("C4").some((t) => t.includes("гүйлгээний баримтын зургийг")), "QPay тохируулаагүй үед хуучин (дансаар) урсгал");
  console.log(fail ? `АЛДАА ${fail}` : "БҮХ ТУРШИЛТ АМЖИЛТТАЙ"); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
