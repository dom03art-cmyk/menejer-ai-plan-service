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
