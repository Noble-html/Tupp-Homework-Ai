import crypto from 'node:crypto';
import { adminAuth, adminDb, verifySessionCookie } from './_firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

const SESSION_COOKIE = 'tupp_session';
const SESSION_MS = 5 * 24 * 60 * 60 * 1000;
const send = (res, status, body) => res.status(status).json(body);
const cleanEmail = v => String(v || '').trim().toLowerCase();
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cookieSecure(req) {
  return process.env.NODE_ENV === 'production' || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
function setSessionCookie(req, res, value) {
  const secure = cookieSecure(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure}`);
}
function clearSessionCookie(req, res) {
  const secure = cookieSecure(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`);
}
function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  try {
    const originHost = new URL(origin).host.toLowerCase();
    if (!host || originHost !== host) { const e = new Error('คำขอมาจากเว็บไซต์อื่น'); e.status = 403; throw e; }
  } catch (e) {
    if (e.status) throw e;
    const error = new Error('Origin header ไม่ถูกต้อง'); error.status = 403; throw error;
  }
}
function bodyOf(req) {
  if (!req.body) return {};
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
}
function timingSafeMatch(expected, supplied) {
  const a = Buffer.from(String(expected || ''));
  const b = Buffer.from(String(supplied || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function authError(message) {
  const map = {
    EMAIL_EXISTS: 'อีเมลนี้มีบัญชีอยู่แล้ว',
    EMAIL_NOT_FOUND: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    INVALID_PASSWORD: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    INVALID_LOGIN_CREDENTIALS: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    USER_DISABLED: 'บัญชีนี้ถูกปิดใช้งาน',
    WEAK_PASSWORD: 'รหัสผ่านไม่ปลอดภัยพอ กรุณาใช้รหัสผ่านที่ยาวขึ้น',
    OPERATION_NOT_ALLOWED: 'Firebase ยังไม่ได้เปิดผู้ให้บริการ Email/Password',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'มีการลองเข้าสู่ระบบหลายครั้ง กรุณารอสักครู่แล้วลองใหม่',
    INVALID_EMAIL: 'รูปแบบอีเมลไม่ถูกต้อง',
    API_KEY_INVALID: 'FIREBASE_AUTH_API_KEY ที่ตั้งฝั่งเซิร์ฟเวอร์ไม่ถูกต้อง',
  };
  const code = String(message || '').match(/([A-Z_]+)(?:\s|$)/)?.[1] || '';
  return map[code] || map[String(message || '').split(' : ')[0]] || 'ตรวจสอบบัญชีไม่สำเร็จ กรุณาตรวจข้อมูลและลองใหม่';
}
async function identityRequest(action, email, password) {
  const apiKey = process.env.FIREBASE_AUTH_API_KEY || process.env.FIREBASE_WEB_API_KEY || '';
  if (!apiKey) { const e = new Error('ยังไม่ได้ตั้ง FIREBASE_AUTH_API_KEY บนเซิร์ฟเวอร์'); e.status = 503; throw e; }
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = data?.error?.message || '';
    const error = new Error(authError(raw)); error.status = response.status === 429 ? 429 : (response.status >= 500 ? 502 : 400); throw error;
  }
  return data;
}
async function createSession(req, res, identity) {
  const maxAge = SESSION_MS;
  const sessionCookie = await adminAuth().createSessionCookie(identity.idToken, { expiresIn: maxAge });
  setSessionCookie(req, res, sessionCookie);
  return { uid: identity.localId, email: cleanEmail(identity.email) };
}
async function createRegisteredUser(role, args) {
  const db = adminDb();
  const email = cleanEmail(args.email);
  const password = String(args.password || '');
  if (!emailPattern.test(email)) { const e = new Error('กรุณากรอกอีเมลที่ถูกต้อง'); e.status = 400; throw e; }
  if (password.length < 8) { const e = new Error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); e.status = 400; throw e; }
  if (role === 'student' && !/^[^\s@]+@tupp\.ac\.th$/.test(email)) { const e = new Error('อีเมลนักเรียนต้องลงท้ายด้วย @tupp.ac.th'); e.status = 400; throw e; }
  const studentId = String(args.studentId || '').trim();
  const teacherId = String(args.teacherId || '').trim();
  if (role === 'student' && !/^\d{5}$/.test(studentId)) { const e = new Error('รหัสประจำตัวนักเรียนต้องเป็นตัวเลข 5 หลัก'); e.status = 400; throw e; }
  if (role === 'teacher' && !/^\d{5}$/.test(teacherId)) { const e = new Error('รหัสประจำตัวครูต้องเป็นตัวเลข 5 หลัก'); e.status = 400; throw e; }
  const firstName = String(args.firstName || '').trim();
  const lastName = String(args.lastName || '').trim();
  if (role === 'teacher' && (!firstName || !lastName)) { const e = new Error('กรุณากรอกชื่อจริงและนามสกุล'); e.status = 400; throw e; }
  const identity = await identityRequest('signUp', email, password);
  try {
    await db.runTransaction(async tx => {
      const id = role === 'student' ? studentId : teacherId;
      const idCollection = role === 'student' ? 'studentIds' : 'teacherIds';
      const idRef = db.collection(idCollection).doc(id);
      const existing = await tx.get(idRef);
      if (existing.exists) { const e = new Error(role === 'student' ? 'รหัสนักเรียนนี้ถูกใช้ลงทะเบียนแล้ว' : 'รหัสประจำตัวครูนี้ถูกใช้ลงทะเบียนแล้ว'); e.status = 409; throw e; }
      const profile = { uid: identity.localId, email, role: role === 'student' ? 'student' : 'teacher_pending', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
      if (role === 'student') profile.studentId = studentId;
      else Object.assign(profile, { teacherId, firstName, lastName });
      tx.create(idRef, { uid: identity.localId, createdAt: FieldValue.serverTimestamp() });
      tx.create(db.collection('profiles').doc(identity.localId), profile);
    });
  } catch (error) {
    await adminAuth().deleteUser(identity.localId).catch(() => {});
    throw error;
  }
  return identity;
}
async function assignFirstAdmin(uid, email, secret) {
  const expected = process.env.ADMIN_BOOTSTRAP_SECRET || '';
  if (expected.length < 24) { const e = new Error('ยังไม่ได้ตั้ง ADMIN_BOOTSTRAP_SECRET ฝั่งเซิร์ฟเวอร์ (ต้องยาวอย่างน้อย 24 ตัวอักษร)'); e.status = 503; throw e; }
  if (!timingSafeMatch(expected, secret)) { const e = new Error('รหัสเปิดระบบแอดมินครั้งแรกไม่ถูกต้อง'); e.status = 403; throw e; }
  const db = adminDb();
  const lockRef = db.collection('system').doc('adminBootstrap');
  const memberRef = db.collection('councilMembers').doc(uid);
  await db.runTransaction(async tx => {
    const [lock, members] = await Promise.all([tx.get(lockRef), tx.get(db.collection('councilMembers').limit(1))]);
    if (lock.exists || !members.empty) { const e = new Error('ระบบมีบัญชี Council อยู่แล้ว จึงปิดการตั้งค่าแอดมินครั้งแรก'); e.status = 409; throw e; }
    tx.create(memberRef, { uid, email, roles: ['CAO', 'ADMIN'], accessLevel: 'OAS-0 / FIRST ADMIN', active: true, createdAt: FieldValue.serverTimestamp() });
    tx.create(lockRef, { completed: true, uid, email, completedAt: FieldValue.serverTimestamp() });
  });
}
async function redeemAdminInvite(uid, email, token) {
  if (String(token || '').length < 24) { const e = new Error('ลิงก์เชิญแอดมินไม่ถูกต้อง'); e.status = 400; throw e; }
  const db = adminDb(); const inviteRef = db.collection('adminInvites').doc(hash(token)); const memberRef = db.collection('councilMembers').doc(uid);
  await db.runTransaction(async tx => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists) { const e = new Error('ไม่พบคำเชิญแอดมินนี้'); e.status = 404; throw e; }
    const invite = inviteSnap.data();
    if (invite.redeemed === true) { const e = new Error('คำเชิญนี้ถูกใช้ไปแล้ว'); e.status = 409; throw e; }
    if (cleanEmail(invite.email) !== email) { const e = new Error('อีเมลนี้ไม่ได้รับคำเชิญ'); e.status = 403; throw e; }
    if (!invite.expiresAt || invite.expiresAt.toMillis() < Date.now()) { const e = new Error('คำเชิญหมดอายุแล้ว'); e.status = 410; throw e; }
    tx.set(memberRef, { uid, email, roles: Array.isArray(invite.roles) ? invite.roles : ['ADMIN'], accessLevel: 'INVITED ADMIN', active: true, invitedBy: invite.invitedBy || null, createdAt: FieldValue.serverTimestamp() });
    tx.update(inviteRef, { redeemed: true, redeemedBy: uid, redeemedAt: FieldValue.serverTimestamp() });
  });
}
async function recoverAdmin(uid, email, secret) {
  const expected = process.env.ADMIN_RECOVERY_SECRET || '';
  if (expected.length < 32) { const e = new Error('ยังไม่ได้ตั้ง ADMIN_RECOVERY_SECRET ฝั่งเซิร์ฟเวอร์ (ต้องยาวอย่างน้อย 32 ตัวอักษร)'); e.status = 503; throw e; }
  if (!timingSafeMatch(expected, secret)) { const e = new Error('Recovery secret ไม่ถูกต้อง'); e.status = 403; throw e; }
  const db = adminDb(); const lockRef = db.collection('system').doc('adminRecovery'); const memberRef = db.collection('councilMembers').doc(uid);
  await db.runTransaction(async tx => {
    const lock = await tx.get(lockRef);
    const active = await tx.get(db.collection('councilMembers').where('active', '==', true));
    if (lock.exists) { const e = new Error('การกู้คืนสิทธิ์แบบฉุกเฉินถูกใช้ไปแล้ว'); e.status = 409; throw e; }
    const hasActiveCAO = active.docs.some(d => Array.isArray(d.data()?.roles) && d.data().roles.includes('CAO'));
    if (hasActiveCAO) { const e = new Error('ยังมี CAO ที่ active อยู่ ต้องให้ผู้ดูแลเดิมเชิญบัญชีนี้แทนการ recovery'); e.status = 409; throw e; }
    tx.set(memberRef, { uid, email, roles: ['CAO', 'ADMIN'], accessLevel: 'RECOVERED CAO', active: true, recoveredAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(lockRef, { completed: true, uid, email, completedAt: FieldValue.serverTimestamp() });
  });
}
async function getPublicUser(decoded) { return { uid: decoded.uid || decoded.localId, email: cleanEmail(decoded.email) }; }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    if (req.method === 'GET') {
      if (!(process.env.FIREBASE_AUTH_API_KEY || process.env.FIREBASE_WEB_API_KEY)) { const e = new Error('ยังไม่ได้ตั้ง FIREBASE_AUTH_API_KEY บนเซิร์ฟเวอร์'); e.status = 503; throw e; }
      adminAuth(); adminDb();
      try {
        const decoded = await verifySessionCookie(req);
        return send(res, 200, { ok: true, user: await getPublicUser(decoded), authMode: 'server-session-cookie', firebaseMode: 'admin-sdk-only' });
      } catch (error) {
        if (error.status === 401) { clearSessionCookie(req, res); return send(res, 200, { ok: true, user: null, authMode: 'server-session-cookie', firebaseMode: 'admin-sdk-only' }); }
        throw error;
      }
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    assertSameOrigin(req);
    const body = bodyOf(req);
    const action = String(body.action || '');
    if (action === 'logout') { clearSessionCookie(req, res); return send(res, 200, { ok: true }); }
    if (!(process.env.FIREBASE_AUTH_API_KEY || process.env.FIREBASE_WEB_API_KEY)) { const e = new Error('ยังไม่ได้ตั้ง FIREBASE_AUTH_API_KEY บนเซิร์ฟเวอร์'); e.status = 503; throw e; }
    adminAuth(); adminDb();

    if (action === 'login') {
      const identity = await identityRequest('signInWithPassword', cleanEmail(body.email), String(body.password || ''));
      const user = await createSession(req, res, identity);
      return send(res, 200, { ok: true, user });
    }
    if (action === 'registerStudent' || action === 'registerTeacher') {
      const role = action === 'registerStudent' ? 'student' : 'teacher';
      const identity = await createRegisteredUser(role, body);
      const user = await createSession(req, res, identity);
      return send(res, 200, { ok: true, user });
    }
    if (action === 'registerAdmin') {
      const email = cleanEmail(body.email);
      if (!emailPattern.test(email)) { const e = new Error('กรุณากรอกอีเมลที่ถูกต้อง'); e.status = 400; throw e; }
      if (String(body.password || '').length < 8) { const e = new Error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); e.status = 400; throw e; }
      const identity = await identityRequest('signUp', email, String(body.password));
      try {
        if (body.inviteToken) await redeemAdminInvite(identity.localId, email, body.inviteToken);
        else await assignFirstAdmin(identity.localId, email, body.bootstrapSecret);
      } catch (error) { await adminAuth().deleteUser(identity.localId).catch(() => {}); throw error; }
      const user = await createSession(req, res, identity);
      return send(res, 200, { ok: true, user });
    }
    if (action === 'recoverAdmin') {
      const identity = await identityRequest('signInWithPassword', cleanEmail(body.email), String(body.password || ''));
      await recoverAdmin(identity.localId, cleanEmail(identity.email), body.recoverySecret);
      const user = await createSession(req, res, identity);
      return send(res, 200, { ok: true, user });
    }
    return send(res, 400, { error: 'Unknown authentication action' });
  } catch (error) {
    return send(res, Number(error?.status) || 500, { error: error?.message || 'Server error' });
  }
}
