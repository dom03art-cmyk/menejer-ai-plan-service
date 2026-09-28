// Claude API дуудлага: streaming (урт хариу тасрахгүй), дахин оролдлого, JSON задлах.
const WRITER = process.env.CLAUDE_WRITER_MODEL || "claude-sonnet-5";
const FAST = process.env.CLAUDE_FAST_MODEL || "claude-haiku-4-5-20251001";
let client = null;
function getClient() {
  if (!client) {
    const Anthropic = require("@anthropic-ai/sdk");
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// usage-ийг захиалга (job) тус бүрээр тусад нь цуглуулна (AsyncLocalStorage).
// Нийт (сервис ассанаас хойшхи) дүн нь `usage`-д, ажлын дүн нь withUsage()-ийн объектод.
const { AsyncLocalStorage } = require("async_hooks");
const als = new AsyncLocalStorage();
const newUsage = () => ({ input: 0, output: 0, cache_write: 0, cache_read: 0, web_searches: 0, calls: 0, max_tokens_retries: 0 });
const usage = newUsage();
function addUsage(u, msg) {
  u.calls++; u.input += msg.usage?.input_tokens || 0; u.output += msg.usage?.output_tokens || 0;
  u.cache_write += msg.usage?.cache_creation_input_tokens || 0; u.cache_read += msg.usage?.cache_read_input_tokens || 0;
  u.web_searches += msg.usage?.server_tool_use?.web_search_requests || 0;
}
// fn-ийг тусдаа usage тоолууртай ажиллуулна: const u = newUsage(); await withUsage(u, () => ...)
function withUsage(u, fn) { return als.run(u, fn); }

// cached: олон дуудлагад давтагддаг урт контекст (system-ийн араас залгана, prompt cache-д хадгалагдана).
// Ингэснээр 36 хэсэг бичихэд ижил контекстийг дахин бүтэн үнээр уншуулахгүй (~90% хямд).
async function call({ system, cached, user, model = WRITER, maxTokens = 16000, webSearch = false, maxSearches = 5, tries = 4 }) {
  if (process.env.PLAN_MOCK === "1") return require("./mock").respond(user);
  const sys = cached ? [{ type: "text", text: system }, { type: "text", text: cached, cache_control: { type: "ephemeral" } }] : system;
  const params = { model, max_tokens: maxTokens, system: sys, messages: [{ role: "user", content: user }] };
  if (webSearch) params.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }];
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const msg = await getClient().messages.stream(params).finalMessage();
      addUsage(usage, msg); const ju = als.getStore(); if (ju) addUsage(ju, msg);
      const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
      if (msg.stop_reason === "max_tokens") {
        if (params.max_tokens >= 48000) { console.warn("[claude] max_tokens — хамгийн их хэмжээнд хүрсэн, байгаагаар нь буцаав"); return text; }
        params.max_tokens = Math.min(48000, Math.round(params.max_tokens * 1.6)); usage.max_tokens_retries++; { const ju = als.getStore(); if (ju) ju.max_tokens_retries++; } console.warn(`[claude] max_tokens-д хүрсэн — ${params.max_tokens} токеноор дахин оролдоно`); lastErr = new Error("max_tokens"); continue;
      }
      return text;
    } catch (e) {
      lastErr = e;
      const status = e.status || 0;
      const retryable = status === 429 || status === 529 || status >= 500 || !status;
      console.warn(`[claude] алдаа (${status}) оролдлого ${i + 1}/${tries}: ${e.message}`);
      if (!retryable) break;
      await sleep(Math.min(60000, 5000 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

// Хариунаас JSON-г тэсвэртэйгээр задлах (```json хашилт, урд/хойд текст байсан ч)
function parseJSON(text) {
  let t = String(text).replace(/```json|```/g, "").trim();
  const s = Math.min(...["{", "["].map(c => t.indexOf(c)).filter(i => i >= 0));
  const e = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (s === Infinity || e < 0) throw new Error("JSON олдсонгүй");
  return JSON.parse(t.slice(s, e + 1));
}

async function callJSON(opts) {
  const text = await call(opts);
  try { return parseJSON(text); }
  catch (e) {
    // Нэг удаа засуулах
    const fixed = await call({ model: FAST, maxTokens: opts.maxTokens || 16000, system: "Return ONLY valid JSON. Fix syntax errors in the given JSON without changing its content.", user: text });
    return parseJSON(fixed);
  }
}

module.exports = { call, callJSON, parseJSON, usage, newUsage, withUsage, WRITER, FAST };
