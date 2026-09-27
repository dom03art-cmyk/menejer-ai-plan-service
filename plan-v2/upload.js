// Захиалагч бүрийн хувийн "файл илгээх" хуудас. Facebook-ийн файлын хязгаарлалтыг тойроно.
// GET  /u/:token          → утсанд зориулсан энгийн хуудас
// POST /u/:token/file     → нэг файл (base64) хүлээн авч уншина, Make-д ярианы түүхэнд нэмүүлнэ
// POST /u/:token/done     → захиалагчид Messenger-ээр баталгаа илгээнэ
// POST /upload-link       → (x-api-key) { psid } → { url }  — Make холбоос авахад ашиглана
const express = require("express");
const crypto = require("crypto");
const { extractBuffer } = require("./files");
const { fbText } = require("./util");
const router = express.Router();
const BASE = process.env.PUBLIC_URL || "https://menejer-ai-plan-service.onrender.com";
const secret = () => process.env.UPLOAD_SECRET || process.env.API_KEY || "dev";
const sign = (psid) => crypto.createHmac("sha256", secret()).update(String(psid)).digest("hex").slice(0, 20);
const tokenFor = (psid) => `${psid}.${sign(psid)}`;
function verify(token) {
  const [psid, sig] = String(token || "").split(".");
  if (!psid || !sig || sig.length !== 20) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(psid)));
  return ok ? psid : null;
}
const received = new Map(); // psid -> [нэрс] (сүүлийн илгээлтийн баталгаанд)

router.post("/upload-link", express.json(), (req, res) => {
  if (req.get("x-api-key") !== process.env.API_KEY) return res.status(401).json({ error: "unauthorized" });
  const psid = req.body && req.body.psid; if (!psid) return res.status(400).json({ error: "psid" });
  res.json({ url: `${BASE}/u/${tokenFor(psid)}` });
});


// Нууцлалын бодлого ба мэдээлэл устгах заавар (Facebook App-ыг Live болгоход шаардлагатай)
const LEGAL_CSS = "body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:760px;margin:0 auto;padding:28px 18px;line-height:1.6;color:#222}h1{color:#0B3A27}h2{color:#0B3A27;margin-top:28px}";
router.get("/privacy", (req, res) => res.set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><html lang="mn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Менежер AI — Нууцлалын бодлого / Privacy Policy</title><style>${LEGAL_CSS}</style></head><body>
<h1>Менежер AI — Нууцлалын бодлого</h1><p>Шинэчилсэн огноо: 2026-09-27</p>
<p>Менежер AI нь Facebook Messenger-ээр дамжуулан бизнес төсөл боловсруулах үйлчилгээ үзүүлдэг. Энэхүү бодлого нь бид таны мэдээллийг хэрхэн цуглуулж, ашиглаж, хадгалдгийг тайлбарлана.</p>
<h2>1. Цуглуулах мэдээлэл</h2><p>Facebook-ийн нэр, Messenger-ийн хэрэглэгчийн дугаар (PSID), таны бичсэн мессеж, илгээсэн файл (Word, Excel, PDF, зураг), пэйжийн пост дээр бичсэн коммент, төлбөрийн баримтын зураг.</p>
<h2>2. Ашиглах зорилго</h2><p>Зөвхөн таны захиалсан бизнес төслийг боловсруулах, хүргэх, засварлах, төлбөр баталгаажуулах, үйлчилгээний чанарыг сайжруулах, таны хүссэн үнэгүй материалыг илгээх зорилгоор ашиглана. Мэдээллийг зар сурталчилгааны зорилгоор гуравдагч этгээдэд худалдахгүй.</p>
<h2>3. Гуравдагч талын үйлчилгээ</h2><p>Үйлчилгээг үзүүлэхэд Meta (Facebook Messenger), Anthropic (Claude AI — төсөл бичих), Make.com (автоматжуулалт), Render (сервер), Google (захиалгын бүртгэл) үйлчилгээг ашигладаг. Эдгээр үйлчилгээ нь зөвхөн тухайн ажлыг гүйцэтгэх хэмжээнд мэдээлэл боловсруулна.</p>
<h2>4. Хадгалах хугацаа</h2><p>Захиалгын мэдээллийг үйлчилгээ болон засвар хийхэд шаардлагатай хугацаанд (ихэвчлэн 12 сар хүртэл) хадгална. Таны хүсэлтээр өмнө нь устгана.</p>
<h2>5. Таны эрх, мэдээлэл устгах</h2><p>Та өөрийн мэдээллийг харах, засах, устгуулах эрхтэй. Устгуулах хүсэлтийг Менежер AI пэйжийн Messenger-т «мэдээлэл устга» гэж бичиж эсвэл <a href="/data-deletion">энэ зааврын</a> дагуу илгээнэ үү. 7 хоногийн дотор устгана.</p>
<h2>6. Холбоо барих</h2><p>Facebook: Менежер AI пэйжийн Messenger · Имэйл: dom03art@gmail.com</p>
<hr><h1>Privacy Policy (English)</h1>
<p>Менежер AI (Menejer AI) provides an automated business-plan writing service via Facebook Messenger. We collect your Facebook name, Page-scoped ID, messages, files you send, comments on our Page, and payment receipt images, solely to prepare, deliver and revise the business plan you ordered, verify payment, send materials you requested, and improve the service. We do not sell your data. Data is processed by Meta, Anthropic (Claude AI), Make.com, Render and Google only as needed to provide the service, and kept up to 12 months unless you request deletion. To request deletion, message our Page "delete my data" or follow the <a href="/data-deletion">data deletion instructions</a>. Contact: dom03art@gmail.com.</p>
</body></html>`));
router.get("/data-deletion", (req, res) => res.set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><html lang="mn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Менежер AI — Мэдээлэл устгах заавар</title><style>${LEGAL_CSS}</style></head><body>
<h1>Мэдээлэл устгах заавар</h1><ol><li>Facebook дээр Менежер AI пэйжийн Messenger-ийг нээнэ.</li><li>«мэдээлэл устга» гэж бичиж илгээнэ.</li><li>Бид 7 хоногийн дотор таны захиалга, ярианы түүх, файлыг устгаж, Messenger-ээр мэдэгдэнэ.</li></ol><p>Эсвэл dom03art@gmail.com хаягаар Facebook нэрээ бичиж хүсэлт илгээнэ үү.</p>
<h1>Data Deletion Instructions</h1><ol><li>Open Messenger with the Менежер AI Page.</li><li>Send the message "delete my data".</li><li>We delete your orders, conversation history and files within 7 days and confirm via Messenger.</li></ol><p>Or email dom03art@gmail.com with your Facebook name.</p></body></html>`));

// Үнэгүй "Бизнес төсөл бичих заавар" (нийтэд нээлттэй)
const path = require("path");
router.get("/guide.pdf", (req, res) => res.set({ "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=\"biznes-tusul-bichih-zaavar.pdf\"" }).sendFile(path.join(__dirname, "assets", "guide.pdf")));
router.get("/guide.docx", (req, res) => res.set({ "Content-Disposition": "attachment; filename=\"biznes-tusul-bichih-zaavar.docx\"" }).sendFile(path.join(__dirname, "assets", "guide.docx")));

router.get("/u/:token", (req, res) => {
  if (!verify(req.params.token)) return res.status(404).send("Холбоос буруу байна.");
  res.set("Content-Type", "text/html; charset=utf-8").send(PAGE);
});

router.post("/u/:token/file", express.json({ limit: "30mb" }), async (req, res) => {
  const psid = verify(req.params.token);
  if (!psid) return res.status(404).json({ ok: false, message: "Холбоос буруу" });
  const { name, type, data } = req.body || {};
  try {
    const buf = Buffer.from(String(data || ""), "base64");
    const out = await extractBuffer({ buf, mime: type || "", name: name || "file", type: /^image\//.test(type || "") ? "image" : undefined });
    if (process.env.MAKE_FILE_WEBHOOK) {
      await fetch(process.env.MAKE_FILE_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ psid, name, kind: out.kind, summary: out.summary }), signal: AbortSignal.timeout(15000) });
    }
    const list = received.get(psid) || []; list.push(name); received.set(psid, list);
    res.json({ ok: true, kind: out.kind });
  } catch (e) {
    console.warn("[upload]", e.message);
    res.json({ ok: false, message: /credit/i.test(e.message) ? "Систем түр саатаж байна" : e.message });
  }
});

router.post("/u/:token/done", express.json(), async (req, res) => {
  const psid = verify(req.params.token);
  if (!psid) return res.status(404).json({ ok: false });
  const list = received.get(psid) || []; received.delete(psid);
  if (list.length) await fbText(psid, `📎 ${list.length} файл хүлээн авч уншлаа ✅\n${list.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n\nНэмэлт мэдээллээ бичих эсвэл «дууслаа» гэж бичнэ үү. Файлуудын агуулгыг төсөлд тусгана.`).catch(() => { });
  res.json({ ok: true, count: list.length });
});

const PAGE = `<!doctype html><html lang="mn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Менежер AI — Файл илгээх</title>
<style>
:root{--navy:#1B2A4A;--gold:#C9A227;--bg:#F6F4EE}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:#222}
.wrap{max-width:480px;margin:0 auto;padding:24px 18px}
h1{color:var(--navy);font-size:22px;margin:8px 0 4px}p{line-height:1.5;color:#444}
.card{background:#fff;border-radius:14px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.06);margin-top:16px}
label.pick{display:block;text-align:center;background:var(--navy);color:#fff;padding:16px;border-radius:12px;font-size:17px;font-weight:600;cursor:pointer}
input[type=file]{display:none}
ul{list-style:none;padding:0;margin:14px 0 0}li{padding:10px 12px;border:1px solid #e6e1d3;border-radius:10px;margin-bottom:8px;font-size:14px;display:flex;justify-content:space-between;gap:8px}
.ok{color:#1a7f37}.err{color:#b42318}.wait{color:#8a6d12}
button{width:100%;margin-top:14px;padding:15px;border:0;border-radius:12px;background:var(--gold);color:#1B2A4A;font-size:17px;font-weight:700}
button:disabled{opacity:.5}
.small{font-size:13px;color:#666}
</style></head><body><div class="wrap">
<h1>📎 Файл илгээх</h1>
<p>Бизнес төсөлд тусгах файлаа энд илгээнэ үү: үнийн санал, хүснэгт, өмнөх төсөл, гэрчилгээ, зураг гэх мэт.</p>
<div class="card">
<label class="pick" for="f">Файл сонгох</label>
<input id="f" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/*">
<ul id="list"></ul>
<button id="send" disabled>Илгээх</button>
<p class="small">Word, Excel, PDF, зураг (нэг файл 20MB хүртэл). Нэг дор хэд хэдэн файл сонгож болно.</p>
</div>
<p id="done" style="display:none;font-weight:600;color:#1a7f37">✅ Бүх файл илгээгдлээ. Messenger руугаа буцаж ярилцлагаа үргэлжлүүлнэ үү.</p>
</div>
<script>
const input=document.getElementById('f'),list=document.getElementById('list'),btn=document.getElementById('send');let files=[];
input.onchange=()=>{files=[...input.files];list.innerHTML=files.map((f,i)=>'<li><span>'+f.name.replace(/</g,'&lt;')+'</span><span id="s'+i+'" class="wait">бэлэн</span></li>').join('');btn.disabled=!files.length;};
const b64=f=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]);r.onerror=no;r.readAsDataURL(f);});
btn.onclick=async()=>{btn.disabled=true;input.disabled=true;const base=location.pathname;let good=0;
for(let i=0;i<files.length;i++){const s=document.getElementById('s'+i);const f=files[i];
if(f.size>20*1024*1024){s.textContent='хэт том';s.className='err';continue;}
s.textContent='уншиж байна…';try{const r=await fetch(base+'/file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name,type:f.type,data:await b64(f)})});const j=await r.json();
if(j.ok){s.textContent='✅ уншлаа';s.className='ok';good++;}else{s.textContent=j.message||'алдаа';s.className='err';}}catch(e){s.textContent='алдаа';s.className='err';}}
await fetch(base+'/done',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});
if(good)document.getElementById('done').style.display='block';btn.textContent='Дахин файл сонгох бол дээрээс сонгоно уу';input.disabled=false;};
</script></body></html>`;

module.exports = router;
module.exports.tokenFor = tokenFor;
