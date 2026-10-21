// Backend-only Firebase architecture: the browser never initializes Firebase SDKs.
// All Authentication / Firestore operations go through same-origin serverless APIs.
let currentUser = null;
let booted = false;
let retryCount = 0;
let lastError = null;
let lastSuccessAt = null;
let lastFirebaseCheck = null;
const listeners = new Set();

function notifyAuth() { for (const callback of listeners) { try { callback(currentUser); } catch (e) { console.error('Auth listener callback failed', e); } } }
async function callApi(path, { method = 'POST', body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}),
    });
  } catch {
    const error = new Error('ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตหรือสถานะโฮสต์');
    lastError = error; throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Backend API error (${response.status})`);
    error.status = response.status; lastError = error; throw error;
  }
  lastSuccessAt = Date.now(); lastError = null;
  return data;
}
function setUser(user, notify = true) { currentUser = user ? { uid: user.uid || user.localId, email: String(user.email || '').trim().toLowerCase() } : null; if (notify) notifyAuth(); }
function credential(data) { setUser(data.user, false); return { user: currentUser }; }

export function firebaseConfigured() { return booted; }
export async function initFirebase() {
  if (booted) return { mode: 'backend-only', persistence: 'HttpOnly session cookie' };
  const data = await callApi('/api/auth', { method: 'GET' });
  setUser(data.user || null, false);
  booted = true;
  lastFirebaseCheck = { mode: data.firebaseMode || 'server-session-cookie', authMode: data.authMode || 'server-session-cookie' };
  return { mode: 'backend-only', persistence: 'HttpOnly session cookie' };
}
export function getFirebaseState() {
  return {
    configured: booted, booted,
    persistence: 'HttpOnly + Secure (production) + SameSite=Lax session cookie',
    retryCount, lastError: lastError?.message || '', lastSuccessAt,
    activeListeners: listeners.size, configSource: 'server-only Firebase Admin SDK',
    mode: 'backend-only; no Firebase Web SDK in browser',
  };
}
export async function withRetry(fn, { tries = 3, baseMs = 400 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const value = await fn(); if (i) retryCount += i; return value; }
    catch (e) { last = e; if (i < tries - 1 && (!e.status || e.status >= 500)) await new Promise(r => setTimeout(r, baseMs * (2 ** i))); else throw e; }
  }
  throw last;
}

export async function signInEmail(email, password) {
  const data = await withRetry(() => callApi('/api/auth', { body: { action: 'login', email, password } }));
  return credential(data);
}
export async function registerStudent(args) {
  const data = await withRetry(() => callApi('/api/auth', { body: { action: 'registerStudent', ...args } }));
  return credential(data);
}
export async function registerTeacher(args) {
  const data = await withRetry(() => callApi('/api/auth', { body: { action: 'registerTeacher', ...args } }));
  return credential(data);
}
export async function registerAdmin({ email, password, inviteToken = '', bootstrapSecret = '' }) {
  const data = await withRetry(() => callApi('/api/auth', { body: { action: 'registerAdmin', email, password, inviteToken, bootstrapSecret } }));
  return credential(data);
}
export async function recoverAdminAccess({ email, password, recoverySecret }) {
  const data = await withRetry(() => callApi('/api/auth', { body: { action: 'recoverAdmin', email, password, recoverySecret } }));
  return credential(data);
}

async function adminApi(action, payload = {}, bootstrapSecret = '', recoverySecret = '') {
  const headers = {};
  if (bootstrapSecret) headers['X-Admin-Bootstrap-Secret'] = bootstrapSecret;
  if (recoverySecret) headers['X-Admin-Recovery-Secret'] = recoverySecret;
  // Cookie is HttpOnly and attached by the browser; no ID token leaves Firebase SDK because no client SDK exists.
  return callApi('/api/admin-invites', { body: { action, ...payload }, headers });
}
export async function inviteAdmin(email) { return adminApi('create', { email: email.trim().toLowerCase() }); }
export async function approveTeacher(uid) { return adminApi('approveTeacher', { uid }); }

async function dataApi(action, payload = {}) { return callApi('/api/data', { body: { action, ...payload } }); }
export async function getCouncilProfile(_uid) { const { data } = await dataApi('getCouncilProfile'); return data || null; }
export async function getUserProfile(_uid) { const { data } = await dataApi('getUserProfile'); return data || null; }
export async function writeAudit(event, payload = {}) { return dataApi('writeAudit', { event, payload }); }
export async function listHomework(studentId) { const { data } = await dataApi('listHomework', { studentId }); return Array.isArray(data) ? data : []; }
export async function listClassHomework(classRoom) { const { data } = await dataApi('listClassHomework', { classRoom }); return Array.isArray(data) ? data : []; }
export async function addHomework(data) { return dataApi('addHomework', { data }); }
export async function listPendingTeachers() { const { data } = await dataApi('listPendingTeachers'); return Array.isArray(data) ? data : []; }
export async function testFirebase() { const result = await dataApi('health'); lastFirebaseCheck = result; return result; }
export async function logout() {
  try { await callApi('/api/auth', { body: { action: 'logout' } }); }
  finally { setUser(null, false); }
}
export function watchAuth(callback) {
  listeners.add(callback);
  queueMicrotask(() => { if (listeners.has(callback)) callback(currentUser); });
  return () => listeners.delete(callback);
}
