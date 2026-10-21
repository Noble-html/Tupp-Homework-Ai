import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getApp() {
  const existing = getApps()[0];
  if (existing) return existing;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    let serviceAccount;
    try { serviceAccount = JSON.parse(raw); }
    catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON'); }
    return initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID });
  }
  throw new Error('Firebase server credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON on the hosting server.');
}

export function adminAuth() { return getAuth(getApp()); }
export function adminDb() { return getFirestore(getApp()); }

function readCookie(req, name = 'tupp_session') {
  const raw = String(req.headers.cookie || '');
  for (const item of raw.split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) return decodeURIComponent(item.slice(index + 1).trim());
  }
  return '';
}

export async function verifySessionCookie(req) {
  const cookie = readCookie(req);
  if (!cookie) {
    const error = new Error('กรุณาเข้าสู่ระบบก่อน'); error.status = 401; throw error;
  }
  const auth = adminAuth(); // Surface missing server credentials as a setup error, not a false 401.
  try {
    // Revocation checking means disabled/deleted accounts and revoked refresh tokens are respected.
    return await auth.verifySessionCookie(cookie, true);
  } catch {
    const error = new Error('เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่'); error.status = 401; throw error;
  }
}

// Kept only for integrations that explicitly still use Firebase ID tokens. The app UI no longer does.
export async function verifyBearer(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) { const error = new Error('กรุณาเข้าสู่ระบบใหม่'); error.status = 401; throw error; }
  try { return await adminAuth().verifyIdToken(match[1], true); }
  catch { const error = new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); error.status = 401; throw error; }
}

export async function assertActiveAppUser(uid) {
  const db = adminDb();
  const [profile, council] = await Promise.all([
    db.collection('profiles').doc(uid).get(),
    db.collection('councilMembers').doc(uid).get(),
  ]);
  const member = council.data();
  const councilRoles = ['CAO', 'ADMIN', 'DCAO', 'SCAO', 'HSA'];
  if (council.exists && member?.active === true && Array.isArray(member.roles) && member.roles.some(r => councilRoles.includes(r))) {
    return { kind: 'council', data: member };
  }
  const profileData = profile.data();
  if (profile.exists && ['student', 'teacher'].includes(profileData?.role)) return { kind: 'profile', data: profileData };
  const error = new Error('บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้ระบบ'); error.status = 403; throw error;
}
