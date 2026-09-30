const crypto = require('crypto');

const SMTP_BASE = 'https://api.smtp.dev';
const COOKIE_ADMIN = 'mfi_admin';
const COOKIE_USER = 'mfi_user';
const DOMAIN = process.env.MAIL_DOMAIN || 'loginmail-mfistore.my.id';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@amfgamestore.my.id';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Katasandi123';
const APP_SECRET = process.env.APP_SECRET || 'change-this-secret-in-vercel';
const API_KEY = process.env.SMTP_DEV_API_KEY || '';

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0,i).trim()] = decodeURIComponent(p.slice(i+1).trim());
  });
  return out;
}
function b64u(v) {
  return Buffer.from(v).toString('base64url');
}
function sign(value) {
  return crypto.createHmac('sha256', APP_SECRET).update(value).digest('base64url');
}
function makeToken(payload) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}
function verifyToken(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(body)))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function setCookie(res, name, value, maxAge) {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}
function clearCookie(res, name) {
  setCookie(res, name, '', 0);
}
function adminOk(req) {
  return !!verifyToken(parseCookies(req)[COOKIE_ADMIN]);
}
function userSession(req) {
  return verifyToken(parseCookies(req)[COOKIE_USER]);
}
function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('JSON tidak valid')); }
    });
    req.on('error', reject);
  });
}
async function smtp(path, options={}) {
  if (!API_KEY) throw new Error('SMTP_DEV_API_KEY belum diatur di Vercel.');
  const r = await fetch(`${SMTP_BASE}${path}`, {
    ...options,
    headers: {
      'X-API-KEY': API_KEY,
      'Accept': 'application/json',
      ...(options.body ? {'Content-Type':'application/json'} : {}),
      ...(options.headers || {})
    }
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = data?.message || data?.detail || data?.title || `SMTP.dev error ${r.status}`;
    const e = new Error(msg); e.status = r.status; e.details = data; throw e;
  }
  return data;
}
function getPath(req) {
  return new URL(req.url, `https://${req.headers.host || 'localhost'}`).pathname;
}
function redirect(res, location) {
  res.statusCode = 302; res.setHeader('Location', location); res.end();
}

module.exports = async (req, res) => {
  const path = getPath(req);
  try {
    // Public
    if (path === '/api/health') return json(res, 200, {ok:true, domain:DOMAIN, smtpConfigured:!!API_KEY});
    if (path === '/api/auth/login' && req.method === 'POST') {
      const b = await body(req);
      if (b.email !== ADMIN_EMAIL || b.password !== ADMIN_PASSWORD) return json(res, 401, {error:'Email atau password admin salah.'});
      setCookie(res, COOKIE_ADMIN, makeToken({role:'admin', exp:Date.now()+8*60*60*1000}), 8*60*60);
      return json(res, 200, {ok:true, role:'admin'});
    }
    if (path === '/api/auth/logout' && req.method === 'POST') {
      clearCookie(res, COOKIE_ADMIN); clearCookie(res, COOKIE_USER);
      return json(res, 200, {ok:true});
    }
    if (path === '/api/access' && req.method === 'GET') {
      const token = new URL(req.url, `https://${req.headers.host}`).searchParams.get('token');
      const p = verifyToken(token);
      if (!p || p.role !== 'viewer' || !p.accountId) return redirect(res, '/?access=invalid');
      setCookie(res, COOKIE_USER, token, Math.max(1, Math.floor((p.exp-Date.now())/1000)));
      return redirect(res, '/inbox.html');
    }

    // Admin
    if (path === '/api/admin/accounts' && req.method === 'GET') {
      if (!adminOk(req)) return json(res, 401, {error:'Unauthorized'});
      const data = await smtp(`/accounts?isActive=true&page=1`);
      return json(res, 200, data);
    }
    if (path === '/api/admin/accounts' && req.method === 'POST') {
      if (!adminOk(req)) return json(res, 401, {error:'Unauthorized'});
      const b = await body(req);
      let address = String(b.address || '').trim().toLowerCase();
      const username = String(b.username || '').trim().toLowerCase();
      if (!address && username) address = `${username}@${DOMAIN}`;
      if (!address || !address.includes('@')) return json(res, 400, {error:'Alamat email tidak valid.'});
      if (!address.endsWith(`@${DOMAIN}`)) return json(res, 400, {error:`Gunakan domain @${DOMAIN}`});
      if (!b.password || String(b.password).length < 6) return json(res, 400, {error:'Password minimal 6 karakter.'});
      const created = await smtp('/accounts', {method:'POST', body:JSON.stringify({address,password:String(b.password),isActive:true})});
      return json(res, 201, created);
    }
    if (path.startsWith('/api/admin/accounts/') && req.method === 'DELETE') {
      if (!adminOk(req)) return json(res, 401, {error:'Unauthorized'});
      const id = path.split('/').pop();
      await smtp(`/accounts/${encodeURIComponent(id)}`, {method:'DELETE'});
      return json(res, 200, {ok:true});
    }
    if (path.startsWith('/api/admin/accounts/') && path.endsWith('/access') && req.method === 'POST') {
      if (!adminOk(req)) return json(res, 401, {error:'Unauthorized'});
      const id = path.split('/')[4];
      const acc = await smtp(`/accounts/${encodeURIComponent(id)}`);
      const token = makeToken({role:'viewer', accountId:acc.id, address:acc.address, exp:Date.now()+30*24*60*60*1000});
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      return json(res, 200, {url:`${proto}://${host}/api/access?token=${encodeURIComponent(token)}`, expiresInDays:30});
    }

    // Viewer
    const u = userSession(req);
    if (path === '/api/user/me' && req.method === 'GET') {
      if (!u) return json(res, 401, {error:'Unauthorized'});
      return json(res, 200, {address:u.address, accountId:u.accountId});
    }
    if (path === '/api/user/inbox' && req.method === 'GET') {
      if (!u) return json(res, 401, {error:'Unauthorized'});
      const acc = await smtp(`/accounts/${encodeURIComponent(u.accountId)}`);
      const inbox = (acc.mailboxes || []).find(m => String(m.path).toUpperCase() === 'INBOX');
      if (!inbox) return json(res, 404, {error:'INBOX tidak ditemukan.'});
      const messages = await smtp(`/accounts/${encodeURIComponent(u.accountId)}/mailboxes/${encodeURIComponent(inbox.id)}/messages?page=1`);
      return json(res, 200, {account:acc, mailbox:inbox, messages:messages.member || [], view:messages.view || null});
    }
    if (path.startsWith('/api/user/message/') && req.method === 'GET') {
      if (!u) return json(res, 401, {error:'Unauthorized'});
      const id = path.split('/').pop();
      const acc = await smtp(`/accounts/${encodeURIComponent(u.accountId)}`);
      const inbox = (acc.mailboxes || []).find(m => String(m.path).toUpperCase() === 'INBOX');
      if (!inbox) return json(res, 404, {error:'INBOX tidak ditemukan.'});
      const msg = await smtp(`/accounts/${encodeURIComponent(u.accountId)}/mailboxes/${encodeURIComponent(inbox.id)}/messages/${encodeURIComponent(id)}`);
      return json(res, 200, msg);
    }
    if (path.startsWith('/api/user/message/') && req.method === 'PATCH') {
      if (!u) return json(res, 401, {error:'Unauthorized'});
      const id = path.split('/').pop();
      const acc = await smtp(`/accounts/${encodeURIComponent(u.accountId)}`);
      const inbox = (acc.mailboxes || []).find(m => String(m.path).toUpperCase() === 'INBOX');
      if (!inbox) return json(res, 404, {error:'INBOX tidak ditemukan.'});
      const b = await body(req);
      const safe = {isRead: !!b.isRead};
      const msg = await smtp(`/accounts/${encodeURIComponent(u.accountId)}/mailboxes/${encodeURIComponent(inbox.id)}/messages/${encodeURIComponent(id)}`, {method:'PATCH',body:JSON.stringify(safe)});
      return json(res, 200, msg);
    }

    return json(res, 404, {error:'Not found'});
  } catch (e) {
    console.error(e);
    return json(res, e.status || 500, {error:e.message || 'Server error', details:e.details});
  }
};
