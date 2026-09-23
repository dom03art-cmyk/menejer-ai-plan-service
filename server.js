const express = require("express");
const cors = require("cors");
const { calculateFinance, calculatePayroll } = require("./finance");
const { buildDocx } = require("./docxBuilder");
const { parseTextToSections, buildFinanceSections, mergeFinanceIntoSections } = require("./textParser");

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

// Энгийн API key шалгалт (сонголтоор) — орчны хувьсагчид API_KEY заасан бол
// зөвхөн зөв x-api-key толгойтой хүсэлтийг зөвшөөрнө. Make.com-ийн HTTP модульд
// "Headers" хэсэгт x-api-key нэмнэ.
const REQUIRED_API_KEY = process.env.API_KEY;
app.use((req, res, next) => {
    if (req.path === "/health") return next();
    if (!REQUIRED_API_KEY) return next(); // орчны хувьсагч тохируулаагүй бол шалгалтгүй (dev)
          const provided = req.header("x-api-key");
    if (provided !== REQUIRED_API_KEY) {
          return res.status(401).json({ error: "Буруу эсвэл дутуу x-api-key." });
    }
    next();
});

app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "menejer-ai-plan-service", time: new Date().toISOString() });
});

app.post("/calc/finance", (req, res) => {
    try {
          const result = calculateFinance(req.body || {});
          res.json(result);
    } catch (e) {
          res.status(400).json({ error: e.message });
    }
});

app.post("/calc/payroll", (req, res) => {
    try {
          const result = calculatePayroll(req.body || {});
          res.json(result);
    } catch (e) {
          res.status(400).json({ error: e.message });
    }
});

app.post("/docx", async (req, res) => {
    try {
          const buf = await buildDocx(req.body || {});
          const filenameRaw = (req.body && req.body.meta && req.body.meta.filename) || "business-plan.docx";
          // Кирилл нэр зарим клиентэд асуудалтай тул ASCII болгож экранлана (skill-ийн зөвлөмжийн дагуу)
      const asciiFallback = "business-plan.docx";
          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
          res.setHeader(
                  "Content-Disposition",
                  `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filenameRaw)}`
                );
          res.send(buf);
    } catch (e) {
          console.error(e);
          res.status(400).json({ error: e.message, stack: process.env.NODE_ENV === "development" ? e.stack : undefined });
    }
});

// Make.com-д зориулсан: Claude-ийн бичсэн ЭНГИЙН ТЕКСТ (өнөөдрийн prompt-уудын
// хэрэглэдэг "N. ТОМ ҮСГЭЭР ГАРЧИГ" загвар) + /calc/finance, /calc/payroll-ийн
// тооцооллыг нэгтгэж, шууд бэлэн .docx болгож буцаана. Ингэснээр Make.com дээр
// Claude-ээс JSON блок буцаалгах шаардлагагүй болно — өнөөдрийн найдвартай
// ажиллаж буй чөлөөт текст prompt-той хэвээр байж болно.
app.post("/docx-from-text", async (req, res) => {
    try {
          const { meta, full_text, finance, payroll, finance_heading_match } = req.body || {};
          if (!full_text || typeof full_text !== "string") {
                  return res.status(400).json({ error: "full_text (текст) заавал шаардлагатай." });
          }
          const parsed = parseTextToSections(full_text);
          const financeSections = buildFinanceSections(finance, payroll);
          const sections = mergeFinanceIntoSections(parsed, financeSections, finance_heading_match);

      const buf = await buildDocx({ meta: meta || {}, sections });
          const filenameRaw = (meta && meta.filename) || "business-plan.docx";
          const asciiFallback = "business-plan.docx";
          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
          res.setHeader(
                  "Content-Disposition",
                  `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filenameRaw)}`
                );
          res.send(buf);
    } catch (e) {
          console.error(e);
          res.status(400).json({ error: e.message, stack: process.env.NODE_ENV === "development" ? e.stack : undefined });
    }
});

// Турших зориулалттай: docx угсрахгүйгээр зөвхөн парс хийсэн sections[] массивыг
// JSON-оор буцаана (Make.com дээрх prompt-ийн гаралт зөв парслагдаж байгаа эсэхийг
// шалгахад хэрэгтэй).
app.post("/debug/parse-text", (req, res) => {
    try {
          const { full_text, finance, payroll, finance_heading_match } = req.body || {};
          if (!full_text || typeof full_text !== "string") {
                  return res.status(400).json({ error: "full_text (текст) заавал шаардлагатай." });
          }
          const parsed = parseTextToSections(full_text);
          const financeSections = buildFinanceSections(finance, payroll);
          const sections = mergeFinanceIntoSections(parsed, financeSections, finance_heading_match);
          res.json({ sections });
    } catch (e) {
          res.status(400).json({ error: e.message });
    }
});

// plan-v2: бүлэг бүрээр бичдэг шинэ төслийн урсгал (POST /jobs/plan, GET /jobs/:id)
app.use(require("./plan-v2"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`menejer-ai-plan-service listening on port ${PORT}`);
});

module.exports = app;
