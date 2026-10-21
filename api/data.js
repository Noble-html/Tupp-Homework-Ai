import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, verifySessionCookie } from './_firebaseAdmin.js';

const send = (res, status, body) => res.status(status).json(body);
const bodyOf = req => !req.body ? {} : (typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
const COUNCIL_ROLES = ['CAO', 'ADMIN', 'DCAO', 'SCAO', 'HSA'];
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  try { if (!host || new URL(origin).host.toLowerCase() !== host) { const e = new Error('คำขอมาจากเว็บไซต์อื่น'); e.status = 403; throw e; } }
  catch (e) { if (e.status) throw e; const error = new Error('Origin header ไม่ถูกต้อง'); error.status = 403; throw error; }
}
async function identityFor(uid) {
  const db = adminDb();
  const [p, c] = await Promise.all([db.collection('profiles').doc(uid).get(), db.collection('councilMembers').doc(uid).get()]);
  const profile = p.exists ? { id: p.id, ...p.data() } : null;
  const council = c.exists ? { id: c.id, ...c.data() } : null;
  const isCouncil = council?.active === true && Array.isArray(council.roles) && council.roles.some(r => COUNCIL_ROLES.includes(r));
  const activeProfile = ['student', 'teacher'].includes(profile?.role);
  return { profile, council, isCouncil, activeProfile };
}
async function requireActive(uid) {
  const identity = await identityFor(uid);
  if (identity.isCouncil || identity.activeProfile) return identity;
  const e = new Error('บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้ระบบ'); e.status = 403; throw e;
}
function assertRoles(member, allowed) {
  if (!member?.active || !Array.isArray(member.roles) || !member.roles.some(role => allowed.includes(role) && COUNCIL_ROLES.includes(role))) {
    const e = new Error('ไม่มีสิทธิ์ดำเนินการนี้'); e.status = 403; throw e;
  }
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  try {
    assertSameOrigin(req);
    const caller = await verifySessionCookie(req);
    const body = bodyOf(req);
    const action = String(body.action || '');
    const uid = caller.uid;
    const db = adminDb();

    // These profile lookups are limited to the signed-in UID. A client can never choose another UID here.
    if (action === 'getUserProfile' || action === 'getCouncilProfile') {
      const identity = await identityFor(uid);
      return send(res, 200, { data: action === 'getUserProfile' ? identity.profile : identity.council });
    }

    // Audit records are server-attributed and payload-limited.
    if (action === 'writeAudit') {
      const event = clean(body.event, 80);
      const rawPayload = body.payload && typeof body.payload === 'object' ? body.payload : {};
      const payloadText = JSON.stringify(rawPayload);
      if (payloadText.length > 4000) { const e = new Error('Audit payload มีขนาดใหญ่เกินไป'); e.status = 413; throw e; }
      const ref = await db.collection('audit').add({ event, payload: rawPayload, actorUid: uid, actorEmail: clean(caller.email, 254), createdAt: FieldValue.serverTimestamp() });
      return send(res, 200, { ok: true, id: ref.id });
    }

    if (action === 'health') {
      const { council } = await identityFor(uid);
      assertRoles(council, ['CAO', 'ADMIN', 'DCAO', 'SCAO', 'HSA']);
      const started = Date.now();
      const snap = await db.collection('system').doc('health').get();
      return send(res, 200, { ok: true, latencyMs: Date.now() - started, healthDocument: snap.exists, mode: 'server-side Firebase Admin SDK' });
    }

    if (action === 'listHomework') {
      const studentId = clean(body.studentId, 5);
      if (!/^\d{5}$/.test(studentId)) return send(res, 200, { data: [] });
      const identity = await requireActive(uid);
      if (!identity.isCouncil && (identity.profile?.role !== 'student' || String(identity.profile.studentId) !== studentId)) {
        const e = new Error('นักเรียนสามารถดูได้เฉพาะการบ้านของบัญชีตัวเอง'); e.status = 403; throw e;
      }
      const snap = await db.collection('homework').where('studentId', '==', studentId).limit(200).get();
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.dueAt || '').localeCompare(String(b.dueAt || '')));
      return send(res, 200, { data });
    }

    if (action === 'listClassHomework') {
      const identity = await requireActive(uid);
      if (!identity.isCouncil && identity.profile?.role !== 'teacher') { const e = new Error('เฉพาะคุณครูหรือผู้ดูแลที่ได้รับอนุญาต'); e.status = 403; throw e; }
      const classRoom = clean(body.classRoom, 32);
      if (!classRoom) return send(res, 200, { data: [] });
      const snap = await db.collection('homework').where('classRoom', '==', classRoom).limit(500).get();
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.dueAt || '').localeCompare(String(b.dueAt || '')));
      return send(res, 200, { data });
    }

    if (action === 'addHomework') {
      const identity = await requireActive(uid);
      const profile = identity.profile;
      if (!identity.isCouncil && !['student', 'teacher'].includes(profile?.role)) { const e = new Error('ไม่มีสิทธิ์บันทึกการบ้าน'); e.status = 403; throw e; }
      const title = clean(body.data?.title, 180);
      const subject = clean(body.data?.subject, 100);
      const studentIdInput = clean(body.data?.studentId, 5);
      if (!title || !subject) { const e = new Error('กรุณากรอกชื่องานและวิชา'); e.status = 400; throw e; }
      if (!/^\d{5}$/.test(studentIdInput)) { const e = new Error('รหัสนักเรียนต้องเป็นตัวเลข 5 หลัก'); e.status = 400; throw e; }
      let studentId = studentIdInput;
      let classRoom = clean(body.data?.classRoom, 32);
      if (!identity.isCouncil && profile?.role === 'student') {
        if (studentIdInput !== String(profile.studentId || '')) { const e = new Error('ไม่สามารถบันทึกงานให้รหัสนักเรียนอื่นได้'); e.status = 403; throw e; }
        studentId = profile.studentId; classRoom = '';
      } else if (!identity.isCouncil && profile?.role !== 'teacher') {
        const e = new Error('ไม่มีสิทธิ์มอบหมายการบ้าน'); e.status = 403; throw e;
      }
      const item = {
        studentId, classRoom, title, subject, dueAt: clean(body.data?.dueAt, 40),
        priority: ['NORMAL', 'HIGH', 'URGENT'].includes(body.data?.priority) ? body.data.priority : 'NORMAL',
        scoreMax: Math.max(0, Math.min(100000, Number(body.data?.scoreMax) || 0)),
        note: clean(body.data?.note, 2000), status: 'PENDING',
        createdBy: uid, createdByEmail: clean(caller.email, 254),
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      };
      const ref = await db.collection('homework').add(item);
      return send(res, 200, { ok: true, id: ref.id });
    }

    if (action === 'listPendingTeachers') {
      const identity = await requireActive(uid);
      assertRoles(identity.council, ['CAO', 'ADMIN', 'DCAO']);
      const snap = await db.collection('profiles').where('role', '==', 'teacher_pending').limit(100).get();
      return send(res, 200, { data: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    }

    return send(res, 400, { error: 'Unknown data action' });
  } catch (error) {
    return send(res, Number(error?.status) || 500, { error: error?.message || 'Server error' });
  }
}
