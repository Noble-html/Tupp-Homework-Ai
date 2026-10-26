import crypto from 'node:crypto';

// Reads the teacher roster from a Google Sheet that is shared as "Anyone with the link can view".
// Returns only the signed-in person's own role/row, never the whole list.
const SHEET_ID = process.env.TEACHER_SHEET_ID || '169h60harrex3scxsnYNUotKebYPMxSM_u-L7Ae9z19M';
const SHEET_GID = process.env.TEACHER_SHEET_GID || '0';
const ADMIN_EMAILS = new Set(['rachata.le@gmail.com', '06554@tupp.ac.th', 'thanawinnoble07@gmail.com', '06546@tupp.ac.th']);
const IGNORED_EMAILS = new Set(['example.teacher@tupp.ac.th']);
const SCHOOL_EMAIL = /^[^@\s]+@tupp\.ac\.th$/i;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'tupp-homework-ai';
const send = (res, status, body) => res.status(status).json(body);

let certCache = { certs: null, exp: 0 };
async function getCerts() {
  if (certCache.certs && Date.now() < certCache.exp) return certCache.certs;
  const r = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  if (!r.ok) { const e = new Error('ตรวจสอบการเข้าสู่ระบบไม่ได้ชั่วคราว กรุณาลองใหม่'); e.status = 503; throw e; }
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  certCache = { certs: await r.json(), exp: Date.now() + (m ? Number(m[1]) : 3600) * 1000 };
  return certCache.certs;
}
const b64 = s => Buffer.from(s, 'base64url');
async function verifyFirebaseIdToken(req) {
  const fail = () => { const e = new Error('เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่'); e.status = 401; return e; };
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) throw fail();
  const parts = m[1].split('.');
  if (parts.length !== 3) throw fail();
  let header, payload;
  try { header = JSON.parse(b64(parts[0])); payload = JSON.parse(b64(parts[1])); } catch { throw fail(); }
  if (header.alg !== 'RS256' || !header.kid) throw fail();
  const cert = (await getCerts())[header.kid];
  if (!cert) throw fail();
  let ok = false;
  try { ok = crypto.createVerify('RSA-SHA256').update(parts[0] + '.' + parts[1]).verify(cert, b64(parts[2])); } catch { ok = false; }
  const now = Math.floor(Date.now() / 1000);
  if (!ok || payload.aud !== PROJECT_ID || payload.iss !== `https://securetoken.google.com/${PROJECT_ID}` || !payload.sub || !(payload.exp > now) || payload.iat > now + 300) throw fail();
  return payload;
}

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

let cache = { rows: null, exp: 0 };
async function loadRoster(force = false) {
  if (!force && cache.rows && Date.now() < cache.exp) return cache.rows;
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${encodeURIComponent(SHEET_GID)}`;
  const unreadable = () => { const e = new Error('อ่าน Google Sheet รายชื่อครูไม่ได้ ตรวจสอบว่าแชร์เป็น Anyone with the link (Viewer)'); e.status = 502; return e; };
  const id = SHEET_ID, gid = encodeURIComponent(SHEET_GID);
  const candidates = [
    process.env.TEACHER_SHEET_CSV_URL,
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`,
  ].filter(Boolean);
  const tried = [];
  let text = null;
  for (const u of candidates) {
    try {
      const resp = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
      const body = await resp.text();
      if (resp.ok && !/^\s*<(!doctype|html)/i.test(body)) { text = body; break; }
      tried.push(`${resp.status}${/accounts\.google\.com|ServiceLogin/i.test(String(resp.url) + body.slice(0, 3000)) ? ' ต้องล็อกอิน' : ''}`);
    } catch (err) { tried.push(err?.name === 'TimeoutError' ? 'timeout' : 'network'); }
  }
  if (text === null) { const e = new Error(`อ่าน Google Sheet รายชื่อครูไม่ได้ (Google ตอบ: ${tried.join(' / ')}) ตรวจสอบว่าแชร์เป็น Anyone with the link (Viewer) หรือใช้ File > Share > Publish to web`); e.status = 502; throw e; }
  const [head = [], ...body] = parseCsv(text);
  const idx = name => head.findIndex(h => String(h).trim().toLowerCase() === name);
  const [ie, inm, isub, icl] = ['email', 'name', 'subject', 'classes'].map(idx);
  if (ie < 0) throw unreadable();
  const rows = body
    .map(r => ({
      email: String(r[ie] || '').trim().toLowerCase(),
      name: String(inm >= 0 ? r[inm] || '' : '').trim(),
      subject: String(isub >= 0 ? r[isub] || '' : '').trim(),
      classes: String(icl >= 0 ? r[icl] || '' : '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean),
    }))
    .filter(r => r.email && !IGNORED_EMAILS.has(r.email));
  cache = { rows, exp: Date.now() + 10000 };
  return rows;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  try {
    const user = await verifyFirebaseIdToken(req);
    const email = String(user.email || '').toLowerCase();
    const isAdmin = ADMIN_EMAILS.has(email);
    if (user.email_verified !== true || !(SCHOOL_EMAIL.test(email) || isAdmin)) return send(res, 403, { error: 'อนุญาตเฉพาะบัญชี @tupp.ac.th หรือผู้ดูแลที่ได้รับอนุญาต' });
    const wantAll = isAdmin && /[?&]all=1(&|$)/.test(String(req.url || ''));
    let row = null, sheetError = null, all = null, allClasses = [];
    try { const rows = await loadRoster(wantAll); row = rows.find(r => r.email === email) || null; if (wantAll) all = rows; allClasses = [...new Set(rows.flatMap(r => r.classes))].sort(); } catch (e) { sheetError = e.message; }
    const role = isAdmin ? 'admin' : row ? 'teacher' : 'student';
    return send(res, 200, { role, email, name: row?.name || '', subject: row?.subject || '', classes: row?.classes || [], allClasses, ...(all ? { roster: all } : {}), ...(sheetError ? { warning: sheetError } : {}) });
  } catch (error) {
    return send(res, Number(error?.status) || 500, { error: error?.message || 'Server error' });
  }
}
