import { assertActiveAppUser, verifySessionCookie } from './_firebaseAdmin.js';

const SYSTEM_PROMPT = `You are TUPP Homework AI, a helpful Thai-first education assistant for students and teachers. Explain academic topics clearly, be accurate, teach step-by-step, and encourage learning rather than simply copying answers. Never claim to be an official school or government authority or claim NVIDIA endorses this project. Do not disclose private student records. If a fact may be current or uncertain, say so.`;
const TEXT_MODELS = new Set(['nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/llama-3.1-nemotron-70b-instruct']);
const send = (res, status, body) => res.status(status).json(body);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const origin = req.headers.origin;
  if (origin) {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    try { if (!host || new URL(origin).host.toLowerCase() !== host) return send(res, 403, { error: 'คำขอมาจากเว็บไซต์อื่น' }); }
    catch { return send(res, 403, { error: 'Origin header ไม่ถูกต้อง' }); }
  }
  if (!process.env.NVIDIA_API_KEY) return send(res, 503, { error: 'NVIDIA_API_KEY ยังไม่ได้ตั้งค่าใน Environment Variables ของเซิร์ฟเวอร์' });
  try {
    const user = await verifySessionCookie(req);
    await assertActiveAppUser(user.uid);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const model = String(body.model || process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b');
    const mode = ['reasoning', 'chat'].includes(body.mode) ? body.mode : 'reasoning';
    if (model === 'nvidia/nemotron-voicechat') return send(res, 422, { error: 'Nemotron VoiceChat เป็นโมเดลเสียง full-duplex และไม่รองรับ /v1/chat/completions แบบข้อความนี้ ต้องเปิด VoiceChat realtime service ที่ได้รับอนุญาตก่อน' });
    if (!TEXT_MODELS.has(model)) return send(res, 400, { error: 'โมเดลนี้ไม่ได้อยู่ในรายการที่อนุญาต' });
    let endpoint = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1/chat/completions';
    if (model === 'nvidia/llama-3.1-nemotron-70b-instruct') {
      endpoint = process.env.NVIDIA_LLAMA31_70B_BASE_URL || process.env.NVIDIA_BASE_URL || '';
      if (!endpoint) return send(res, 503, { error: 'Llama 3.1 Nemotron 70B hosted free endpoint ถูกระบุว่า deprecated; ตั้ง NVIDIA_LLAMA31_70B_BASE_URL ไปยัง NIM endpoint ที่ใช้งานได้ หรือเลือก Nemotron 3 Ultra' });
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const normalized = messages.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      .slice(-30).map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));
    if (!normalized.length) return send(res, 400, { error: 'ไม่พบข้อความที่ใช้ถาม AI' });
    normalized.unshift({ role: 'system', content: SYSTEM_PROMPT + (mode === 'reasoning' ? ' For academic questions, reason carefully and present a clear step-by-step explanation, with a concise final summary.' : ' Prefer a direct, conversational answer. Keep it clear and concise unless more detail is requested.') });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, Accept: 'application/json' },
        body: JSON.stringify({ model, messages: normalized, temperature: mode === 'reasoning' ? 0.3 : 0.6, top_p: 0.8, max_tokens: model === 'nvidia/nemotron-3-ultra-550b-a55b' ? 4096 : 2048, stream: false }),
      });
    } finally { clearTimeout(timeout); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return send(res, response.status >= 500 ? 502 : response.status, { error: data?.error?.message || data?.detail || 'NVIDIA NIM API error' });
    return send(res, 200, { text: data?.choices?.[0]?.message?.content || '', model, mode, provider: 'NVIDIA NIM' });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return send(res, status, { error: error?.name === 'AbortError' ? 'NVIDIA AI ใช้เวลาตอบนานเกินไป กรุณาลองใหม่' : error?.message || 'Server error' });
  }
}
