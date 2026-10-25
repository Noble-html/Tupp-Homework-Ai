import crypto from 'node:crypto';

const ADMIN_EMAILS = new Set(['rachata.le@gmail.com', '06554@tupp.ac.th', 'thanawinnoble07@gmail.com', '06546@tupp.ac.th']);
const SCHOOL_EMAIL = /^[^@\s]+@tupp\.ac\.th$/i;
const MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-pro']);
const DEFAULT_MODEL = process.env.GEMINI_MODEL && MODELS.has(process.env.GEMINI_MODEL) ? process.env.GEMINI_MODEL : 'gemini-2.5-flash';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'tupp-homework-ai';
const ALLOWED_ORIGINS = new Set(['https://tupp-ai.com', 'https://www.tupp-ai.com', 'https://tupphomeworkai.vercel.app', 'https://tuppweatherai.vercel.app', 'https://tuppai-delta.vercel.app']);
const SYSTEM_PROMPT = `You are TUPP Homework AI, a helpful Thai-first education assistant for students and teachers. Explain academic topics clearly, be accurate, teach step-by-step, and encourage learning rather than simply copying answers. Never claim to be an official school or government authority or claim Google endorses this project. Do not disclose private student records. If a fact may be current or uncertain, say so.`;
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

// Verifies a Firebase ID token with Google's public certificates (no service account needed).
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

// AI Studio keys (AIza...) use the Gemini API; "AQ." keys are Google Cloud express-mode keys.
// Try the endpoint that matches the key format first, then the other one.
function endpoints(model, key) {
  const studio = { url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, headers: { 'x-goog-api-key': key } };
  const cloud = { url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(key)}`, headers: {} };
  return key.startsWith('AQ.') ? [cloud, studio] : [studio, cloud];
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const origin = req.headers.origin;
  if (origin) {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    let sameHost = false;
    try { sameHost = !!host && new URL(origin).host.toLowerCase() === host; }
    catch { return send(res, 403, { error: 'Origin header ไม่ถูกต้อง' }); }
    // Auth is a Bearer ID token (no cookies), so cross-origin calls are safe; access still needs an allowed Google account.
    void sameHost;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return send(res, 503, { error: 'GEMINI_API_KEY ยังไม่ได้ตั้งค่าใน Environment Variables ของเซิร์ฟเวอร์' });
  try {
    const user = await verifyFirebaseIdToken(req);
    const email = String(user.email || '').toLowerCase();
    const allowed = user.email_verified === true && (SCHOOL_EMAIL.test(email) || ADMIN_EMAILS.has(email));
    if (!allowed) return send(res, 403, { error: 'อนุญาตเฉพาะบัญชี Google ของโรงเรียน (@tupp.ac.th) หรือผู้ดูแลที่ได้รับอนุญาต' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const model = MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
    const mode = body.mode === 'chat' ? 'chat' : 'reasoning';
    const raw = Array.isArray(body.messages) ? body.messages : [];
    const contents = raw
      .filter(m => m && ['user', 'assistant', 'model'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
      .slice(-30)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content.slice(0, 12000) }] }));
    while (contents.length && contents[0].role !== 'user') contents.shift();
    if (!contents.length) return send(res, 400, { error: 'ไม่พบข้อความที่ใช้ถาม AI' });

    const system = SYSTEM_PROMPT + (mode === 'reasoning'
      ? ' For academic questions, reason carefully and present a clear step-by-step explanation, with a concise final summary.'
      : ' Prefer a direct, conversational answer. Keep it clear and concise unless more detail is requested.');
    const payload = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: mode === 'reasoning' ? 0.3 : 0.6, topP: 0.9, maxOutputTokens: model === 'gemini-2.5-pro' ? 8192 : 4096 },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);
    let data = null, last = null;
    try {
      for (const ep of endpoints(model, apiKey)) {
        const response = await fetch(ep.url, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', ...ep.headers }, body: payload });
        const json = await response.json().catch(() => ({}));
        if (response.ok) { data = json; break; }
        last = { status: response.status, message: json?.error?.message || 'Gemini API error' };
        if (![400, 401, 403, 404].includes(response.status)) break;
      }
    } finally { clearTimeout(timeout); }

    if (!data) return send(res, 502, { error: `Gemini API error: ${last?.message || 'unknown'}` });
    const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p?.text || '').join('').trim();
    if (!text) return send(res, 200, { text: data?.promptFeedback?.blockReason ? 'Gemini ปฏิเสธการตอบคำถามนี้ กรุณาปรับคำถามแล้วลองใหม่' : '', model, mode, provider: 'Google Gemini' });
    return send(res, 200, { text, model, mode, provider: 'Google Gemini' });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return send(res, status, { error: error?.name === 'AbortError' ? 'Gemini ใช้เวลาตอบนานเกินไป กรุณาลองใหม่' : error?.message || 'Server error' });
  }
}
