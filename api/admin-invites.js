import crypto from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb, verifySessionCookie } from './_firebaseAdmin.js';

const ADMIN_ROLES = new Set(['CAO', 'ADMIN', 'DCAO', 'SCAO', 'HSA']);
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const send = (res, status, body) => res.status(status).json(body);

async function activeCouncil(uid, allowedRoles = ['CAO', 'ADMIN']) {
  const snap = await adminDb().collection('councilMembers').doc(uid).get();
  const member = snap.data();
  if (!snap.exists || member?.active !== true || !Array.isArray(member.roles) || !member.roles.some(role => allowedRoles.includes(role) && ADMIN_ROLES.has(role))) {
    const e = new Error('ต้องเป็นสมาชิก Council ที่ได้รับอนุมัติก่อนทำรายการนี้'); e.status = 403; throw e;
  }
  return member;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const origin = req.headers.origin;
  if (origin) {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    try { if (!host || new URL(origin).host.toLowerCase() !== host) return send(res, 403, { error: 'คำขอมาจากเว็บไซต์อื่น' }); }
    catch { return send(res, 403, { error: 'Origin header ไม่ถูกต้อง' }); }
  }
  let caller;
  try {
    caller = await verifySessionCookie(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = String(body.action || '');
    const db = adminDb();
    const uid = caller.uid;
    const email = String(caller.email || '').trim().toLowerCase();

    if (action === 'bootstrap') {
      const expected = process.env.ADMIN_BOOTSTRAP_SECRET || '';
      const supplied = String(req.headers['x-admin-bootstrap-secret'] || '');
      if (expected.length < 24) return send(res, 503, { error: 'ยังไม่ได้ตั้ง ADMIN_BOOTSTRAP_SECRET ฝั่งเซิร์ฟเวอร์ (ต้องยาวอย่างน้อย 24 ตัวอักษร)' });
      const a = Buffer.from(expected); const b = Buffer.from(supplied);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 403, { error: 'รหัสเปิดระบบแอดมินครั้งแรกไม่ถูกต้อง' });
      if (!email || String(body.email || '').trim().toLowerCase() !== email) return send(res, 403, { error: 'อีเมลบัญชีไม่ตรงกับ Firebase Authentication' });
      const lockRef = db.collection('system').doc('adminBootstrap');
      const memberRef = db.collection('councilMembers').doc(uid);
      await db.runTransaction(async tx => {
        const lock = await tx.get(lockRef);
        const anyMember = await tx.get(db.collection('councilMembers').limit(1));
        if (lock.exists || !anyMember.empty) throw new Error('ระบบมีบัญชี Council อยู่แล้ว จึงปิดการตั้งค่าแอดมินครั้งแรก');
        tx.set(memberRef, { uid, email, roles: ['CAO', 'ADMIN'], accessLevel: 'OAS-0 / FIRST ADMIN', active: true, createdAt: FieldValue.serverTimestamp() });
        tx.set(lockRef, { completed: true, uid, email, completedAt: FieldValue.serverTimestamp() });
      });
      return send(res, 200, { ok: true, role: 'CAO', message: 'ตั้งค่าแอดมินคนแรกแล้ว' });
    }

    if (action === 'recover') {
      const expected = process.env.ADMIN_RECOVERY_SECRET || '';
      const supplied = String(req.headers['x-admin-recovery-secret'] || '');
      if (expected.length < 32) return send(res, 503, { error: 'ยังไม่ได้ตั้ง ADMIN_RECOVERY_SECRET ฝั่งเซิร์ฟเวอร์ (ต้องยาวอย่างน้อย 32 ตัวอักษร)' });
      const a = Buffer.from(expected); const b = Buffer.from(supplied);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 403, { error: 'Recovery secret ไม่ถูกต้อง' });
      if (!email || String(body.email || '').trim().toLowerCase() !== email) return send(res, 403, { error: 'อีเมลบัญชีไม่ตรงกับ Firebase Authentication' });
      const active = await db.collection('councilMembers').where('active', '==', true).get();
      const hasActiveCAO = active.docs.some(d => Array.isArray(d.data()?.roles) && d.data().roles.includes('CAO'));
      if (hasActiveCAO) return send(res, 409, { error: 'ยังมี CAO ที่ active อยู่ ต้องให้ผู้ดูแลเดิมเชิญบัญชีนี้แทนการ recovery' });
      const lockRef = db.collection('system').doc('adminRecovery');
      const memberRef = db.collection('councilMembers').doc(uid);
      await db.runTransaction(async tx => {
        const lock = await tx.get(lockRef);
        if (lock.exists) throw new Error('การกู้คืนสิทธิ์แบบฉุกเฉินถูกใช้ไปแล้ว');
        tx.set(memberRef, { uid, email, roles: ['CAO', 'ADMIN'], accessLevel: 'RECOVERED CAO', active: true, recoveredAt: FieldValue.serverTimestamp() }, { merge: true });
        tx.set(lockRef, { completed: true, uid, email, completedAt: FieldValue.serverTimestamp() });
      });
      return send(res, 200, { ok: true, role: 'CAO', message: 'กู้คืนสิทธิ์ผู้ดูแลแล้ว' });
    }

    if (action === 'redeem') {
      const token = String(body.inviteToken || '');
      if (token.length < 24) return send(res, 400, { error: 'ลิงก์เชิญแอดมินไม่ถูกต้อง' });
      if (!email || String(body.email || '').trim().toLowerCase() !== email) return send(res, 403, { error: 'อีเมล Firebase Authentication ไม่ตรงกับบัญชีที่ได้รับเชิญ' });
      const inviteRef = db.collection('adminInvites').doc(hash(token));
      const memberRef = db.collection('councilMembers').doc(uid);
      await db.runTransaction(async tx => {
        const inviteSnap = await tx.get(inviteRef);
        if (!inviteSnap.exists) throw new Error('ไม่พบคำเชิญแอดมินนี้');
        const invite = inviteSnap.data();
        if (invite.redeemed === true) throw new Error('คำเชิญนี้ถูกใช้ไปแล้ว');
        if (String(invite.email || '').toLowerCase() !== email) throw new Error('อีเมลนี้ไม่ได้รับคำเชิญ');
        if (!invite.expiresAt || invite.expiresAt.toMillis() < Date.now()) throw new Error('คำเชิญหมดอายุแล้ว');
        tx.set(memberRef, { uid, email, roles: invite.roles || ['ADMIN'], accessLevel: 'INVITED ADMIN', active: true, invitedBy: invite.invitedBy || null, createdAt: FieldValue.serverTimestamp() });
        tx.update(inviteRef, { redeemed: true, redeemedBy: uid, redeemedAt: FieldValue.serverTimestamp() });
      });
      return send(res, 200, { ok: true, role: 'ADMIN', message: 'เปิดใช้งานบัญชีแอดมินแล้ว' });
    }

    if (action === 'create') {
      await activeCouncil(uid, ['CAO', 'ADMIN']);
      const targetEmail = String(body.email || '').trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(targetEmail)) return send(res, 400, { error: 'กรุณากรอกอีเมลสำหรับเชิญที่ถูกต้อง' });
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = hash(token);
      await db.collection('adminInvites').doc(tokenHash).create({
        email: targetEmail, roles: ['ADMIN'], invitedBy: uid, invitedByEmail: email,
        createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 72 * 60 * 60 * 1000), redeemed: false,
      });
      return send(res, 200, { ok: true, email: targetEmail, inviteToken: token, expiresInHours: 72 });
    }

    if (action === 'approveTeacher') {
      await activeCouncil(uid, ['CAO', 'ADMIN', 'DCAO']);
      const targetUid = String(body.uid || '');
      if (!targetUid) return send(res, 400, { error: 'ไม่พบรหัสบัญชีครู' });
      const ref = db.collection('profiles').doc(targetUid);
      const target = await ref.get();
      if (!target.exists || target.data()?.role !== 'teacher_pending') return send(res, 404, { error: 'ไม่พบรายการครูที่รออนุมัติ' });
      await ref.update({ role: 'teacher', approvedBy: uid, approvedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return send(res, 200, { ok: true, message: 'อนุมัติบัญชีครูแล้ว' });
    }

    return send(res, 400, { error: 'Unknown admin action' });
  } catch (error) {
    const status = Number(error?.status) || 400;
    return send(res, status, { error: error?.message || 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
}
