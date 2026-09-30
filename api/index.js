const nodemailer = require("nodemailer");

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@amfgamestore.my.id";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Katasandi123";
const MAILTM_EMAIL = process.env.MAILTM_EMAIL || "";
const MAILTM_PASSWORD = process.env.MAILTM_PASSWORD || "";
const MAILTM_API = "https://api.mail.tm";
const SMTP_HOST = process.env.MAILTM_SMTP_HOST || "smtp.mail.tm";
const SMTP_PORT = Number(process.env.MAILTM_SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.MAILTM_SMTP_SECURE || "false") === "true";

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let raw="";
    req.on("data", c => raw += c);
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("JSON tidak valid")); }
    });
    req.on("error", reject);
  });
}
function auth(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(h.slice(6), "base64").toString();
    const i = decoded.indexOf(":");
    return i >= 0 && decoded.slice(0,i) === ADMIN_EMAIL && decoded.slice(i+1) === ADMIN_PASSWORD;
  } catch { return false; }
}
async function mailtm(path, options={}) {
  const r = await fetch(MAILTM_API + path, {
    ...options,
    headers: { "Content-Type":"application/json", ...(options.headers||{}) }
  });
  const text = await r.text();
  let data={}; try { data=text ? JSON.parse(text) : {}; } catch { data={raw:text}; }
  if (!r.ok) {
    const msg = data.message || data.detail || `Mail.tm HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}
async function getToken() {
  if (!MAILTM_EMAIL || !MAILTM_PASSWORD) throw new Error("MAILTM_EMAIL dan MAILTM_PASSWORD belum diatur di Vercel.");
  const d = await mailtm("/token", {
    method:"POST",
    body:JSON.stringify({address:MAILTM_EMAIL,password:MAILTM_PASSWORD})
  });
  return d.token;
}
async function mailtmAuth(path, token, options={}) {
  return mailtm(path, {
    ...options,
    headers: { Authorization:`Bearer ${token}`, ...(options.headers||{}) }
  });
}
function htmlEscape(s="") {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}
async function main(req,res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const p = url.pathname;

    if (req.method === "POST" && p === "/api/login") {
      const b = await body(req);
      if (b.email === ADMIN_EMAIL && b.password === ADMIN_PASSWORD) {
        return json(res,200,{ok:true,email:ADMIN_EMAIL});
      }
      return json(res,401,{ok:false,message:"Email atau password salah."});
    }

    if (req.method === "GET" && p === "/api/config") {
      if (!auth(req)) return json(res,401,{ok:false,message:"Unauthorized"});
      return json(res,200,{
        ok:true,
        adminEmail:ADMIN_EMAIL,
        mailbox:MAILTM_EMAIL || null,
        smtp:{host:SMTP_HOST,port:SMTP_PORT,secure:SMTP_SECURE}
      });
    }

    if (!auth(req)) return json(res,401,{ok:false,message:"Unauthorized"});

    if (req.method === "GET" && p === "/api/inbox") {
      const token = await getToken();
      const page = Math.max(1, Number(url.searchParams.get("page")||1));
      const data = await mailtmAuth(`/messages?page=${page}`, token);
      return json(res,200,data);
    }

    if (req.method === "GET" && p.startsWith("/api/message/")) {
      const id = decodeURIComponent(p.slice("/api/message/".length));
      const token = await getToken();
      return json(res,200,await mailtmAuth(`/messages/${encodeURIComponent(id)}`, token));
    }

    if (req.method === "DELETE" && p.startsWith("/api/message/")) {
      const id = decodeURIComponent(p.slice("/api/message/".length));
      const token = await getToken();
      await mailtmAuth(`/messages/${encodeURIComponent(id)}`, token, {method:"DELETE"});
      return json(res,200,{ok:true});
    }

    if (req.method === "POST" && p === "/api/send") {
      const b = await body(req);
      if (!b.to || !b.subject) return json(res,400,{ok:false,message:"Tujuan dan subjek wajib diisi."});
      if (!MAILTM_EMAIL || !MAILTM_PASSWORD) return json(res,400,{ok:false,message:"Mailbox Mail.tm belum dikonfigurasi."});
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE,
        auth:{user:MAILTM_EMAIL,password:MAILTM_PASSWORD}
      });
      const info = await transporter.sendMail({
        from: b.from || MAILTM_EMAIL,
        to: b.to,
        subject: b.subject,
        text: b.text || "",
        html: b.html || undefined
      });
      return json(res,200,{ok:true,messageId:info.messageId});
    }

    if (req.method === "GET" && p === "/api/health") {
      return json(res,200,{ok:true,service:"AMF Dummy Mail"});
    }
    return json(res,404,{ok:false,message:"Not found"});
  } catch (e) {
    return json(res,500,{ok:false,message:e.message || "Server error"});
  }
}
module.exports = main;
