import React, { useEffect, useRef, useState } from 'react';
import ElectricLogo from './components/ElectricLogo';
import NvidiaBadge from './components/NvidiaBadge';
import {
  initFirebase, getFirebaseState, signInEmail,
  registerStudent, registerTeacher, registerAdmin, logout, getCouncilProfile,
  getUserProfile, writeAudit, testFirebase, addHomework, listHomework,
  listClassHomework, watchAuth, inviteAdmin, listPendingTeachers, approveTeacher, recoverAdminAccess
} from './services/firebase';
import { askNvidia } from './services/nvidia';

const roles = member => Array.isArray(member?.roles) ? member.roles : [];
const text = value => String(value ?? '');
const isCouncil = member => Boolean(member?.active === true && roles(member).some(r => ['CAO', 'ADMIN', 'DCAO', 'SCAO', 'HSA'].includes(r)));
const providerError = e => e?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่';

function App() {
  const [screen, setScreen] = useState('loading');
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [member, setMember] = useState(null);
  const [page, setPage] = useState('tracking');
  const [status, setStatus] = useState('');
  const [fb, setFb] = useState(getFirebaseState());
  const [studentId, setStudentId] = useState('');
  const [tasks, setTasks] = useState([]);
  const [classTasks, setClassTasks] = useState([]);
  const [messages, setMessages] = useState([{ role: 'assistant', text: 'สวัสดีครับ TUPP Homework AI เลือกโมเดลและโหมดการทำงานได้จากหน้า NVIDIA NIM' }]);
  const registering = useRef(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountName, setAccountName] = useState(() => { try { return localStorage.getItem('tupp-account-name') || ''; } catch { return ''; } });

  async function routeAfterAuth(user) {
    if (!user) {
      setSession(null); setProfile(null); setMember(null); setScreen('auth'); setLoadingFinished();
      return;
    }
    setSession(user);
    try {
      const [councilResult, profileResult] = await Promise.allSettled([getCouncilProfile(user.uid), getUserProfile(user.uid)]);
      const council = councilResult.status === 'fulfilled' ? councilResult.value : null;
      const userProfile = profileResult.status === 'fulfilled' ? profileResult.value : null;
      if (isCouncil(council)) {
        setMember(council); setProfile(userProfile); setScreen('app'); setPage('admin');
        setStatus('เข้าสู่ระบบ Council / Admin แล้ว');
        return;
      }
      if (userProfile?.role === 'teacher_pending') {
        setProfile(userProfile); setMember(null); setScreen('pending');
        setStatus('บัญชีครูรอการอนุมัติจากผู้ดูแลระบบ');
        return;
      }
      if (userProfile?.role === 'student') {
        setProfile(userProfile); setMember(null); setStudentId(userProfile.studentId || ''); setScreen('app'); setPage('tracking');
        setStatus('เข้าสู่ระบบนักเรียนแล้ว');
        return;
      }
      if (userProfile?.role === 'teacher') {
        setProfile(userProfile); setMember(null); setScreen('app'); setPage('teacher');
        setStatus('เข้าสู่ระบบครูแล้ว');
        return;
      }
      setSession(null); setProfile(null); setMember(null); setScreen('auth');
      setStatus('บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน TUPP AI กรุณาลงทะเบียนหรือขออนุมัติบัญชี');
      await logout();
    } catch (e) {
      setStatus(providerError(e)); setScreen('auth');
    } finally {
      setLoadingFinished();
    }
  }

  // Defined as a state-safe helper to finish both the Firebase boot and auth transition.
  const [loadingFinishedValue, setLoadingFinishedValue] = useState(false);
  function setLoadingFinished() { setLoadingFinishedValue(true); }

  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};
    (async () => {
      try {
        await initFirebase();
        if (disposed) return;
        setFb(getFirebaseState());
        unsubscribe = watchAuth(user => {
          if (registering.current) { setSession(user || null); setLoadingFinished(); return; }
          void routeAfterAuth(user);
        });
      } catch (e) {
        setStatus(providerError(e)); setScreen('auth'); setLoadingFinished();
      }
    })();
    const timer = setInterval(() => setFb(getFirebaseState()), 5000);
    return () => { disposed = true; unsubscribe(); clearInterval(timer); };
  // Firebase auth observer is intentionally installed once at application start.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin({ email, password }) {
    setStatus('กำลังเข้าสู่ระบบด้วย Firebase Authentication…');
    try {
      const credential = await signInEmail(email, password);
      await routeAfterAuth(credential.user);
      await writeAudit('LOGIN_SUCCESS', { uid: credential.user.uid }).catch(() => {});
    } catch (e) { setStatus(providerError(e)); }
  }

  async function handleRecoverAdmin({ email, password, recoverySecret }) {
    setStatus('กำลังตรวจสอบบัญชีและกู้คืนสิทธิ์ Admin แบบครั้งเดียว…');
    try {
      const credential = await recoverAdminAccess({ email, password, recoverySecret });
      await routeAfterAuth(credential.user);
      await writeAudit('ADMIN_ACCESS_RECOVERED', { uid: credential.user.uid }).catch(() => {});
    } catch (e) { setStatus(providerError(e)); }
  }

  async function handleRegister({ role, email, password, studentId: sid, teacherId, firstName, lastName, inviteToken, bootstrapSecret }) {
    registering.current = true;
    setStatus('กำลังสร้างบัญชีและตรวจสอบข้อมูลกับ Firebase…');
    try {
      let credential;
      if (role === 'student') credential = await registerStudent({ email, password, studentId: sid });
      else if (role === 'teacher') credential = await registerTeacher({ email, password, teacherId, firstName, lastName });
      else credential = await registerAdmin({ email, password, inviteToken, bootstrapSecret });
      registering.current = false;
      try { localStorage.setItem('tupp-v50-registration-complete', '1'); } catch {}
      await routeAfterAuth(credential.user);
      await writeAudit('ACCOUNT_REGISTERED', { uid: credential.user.uid, role }).catch(() => {});
    } catch (e) {
      registering.current = false;
      setSession(null); setProfile(null); setMember(null); setScreen('auth');
      setStatus(providerError(e));
    }
  }

  async function doLogout() {
    try { await writeAudit('LOGOUT', { uid: session?.uid }).catch(() => {}); await logout(); }
    finally { registering.current = false; setSession(null); setProfile(null); setMember(null); setScreen('auth'); setPage('tracking'); setStatus('ออกจากระบบแล้ว'); }
  }

  async function loadStudentTasks(id = studentId) {
    try { setTasks(await listHomework(id)); }
    catch (e) { setStatus(providerError(e)); }
  }

  if (screen === 'loading' || !loadingFinishedValue) return <LoadingScreen message={status || 'กำลังเชื่อมต่อ Firebase อย่างปลอดภัย…'} />;
  if (screen === 'auth' || !session) return <AuthGate status={status} onLogin={handleLogin} onRegister={handleRegister} onRecoverAdmin={handleRecoverAdmin} />;
  if (screen === 'pending') return <PendingScreen profile={profile} status={status} onLogout={doLogout} />;

  const adminAccess = isCouncil(member);
  const isStudent = profile?.role === 'student';
  const isTeacher = profile?.role === 'teacher';
  const menu = isStudent
    ? [['tracking', 'การบ้าน', '01'], ['ai', 'NVIDIA AI', '02']]
    : isTeacher
      ? [['teacher', 'จัดการงานนักเรียน', '01'], ['ai', 'NVIDIA AI', '02']]
      : [['admin', 'ศูนย์ผู้ดูแล', '01'], ['tracking', 'ติดตามงาน', '02'], ['ai', 'NVIDIA AI', '03']];

  return <div className="app-shell">
    <header className="top">
      <div className="brand">
        <div className="logo-ring"><ElectricLogo color="#f7cde8" glowColor="#1688ff" scale={.85} strands={4} crackle={1.3} arcs={1} speed={2.1} interactive /></div>
        <div><div className="brand-title">TUPP AI</div><div className="brand-sub">Homework • Firebase • NVIDIA NIM</div></div>
        <NvidiaBadge compact />
      </div>
      <div className="top-actions"><span className={`status-dot ${fb.booted ? 'ok' : ''}`}></span><span className="tiny">FIREBASE {fb.booted ? 'READY' : 'CONNECTING'}</span><button className="account-trigger" onClick={() => setAccountOpen(v => !v)} aria-expanded={accountOpen}><span className="account-avatar">{(accountName || profile?.firstName || profile?.email || member?.email || session.email || 'U').slice(0,1).toUpperCase()}</span><span className="account-trigger-text"><b>{accountName || profile?.firstName || profile?.email || member?.email || session.email || 'บัญชีของฉัน'}</b><small>บัญชีของฉัน ▾</small></span></button>{accountOpen && <div className="account-popover"><div className="account-popover-head"><b>ตั้งค่าบัญชี</b><button className="account-close" onClick={() => setAccountOpen(false)}>×</button></div><label>ชื่อที่แสดง<input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder={profile?.firstName || 'ตั้งชื่อที่แสดง'} maxLength={40}/></label><button className="primary full" onClick={() => { try { localStorage.setItem('tupp-account-name', accountName.trim()); } catch {} setAccountName(accountName.trim()); setStatus('บันทึกชื่อที่แสดงในอุปกรณ์นี้แล้ว'); setAccountOpen(false); }}>บันทึกการตั้งค่า</button><div className="account-details"><span>อีเมล</span><b>{profile?.email || member?.email || session.email || '—'}</b><span>ประเภทบัญชี</span><b>{member ? 'ผู้ดูแลระบบ' : profile?.role === 'student' ? 'นักเรียน' : profile?.role === 'teacher' ? 'คุณครู' : profile?.role || 'สมาชิก'}</b><span>UID</span><small>{session.uid}</small></div><button className="ghost full" onClick={doLogout}>ออกจากระบบ</button></div>}</div>
    </header>
    <nav className="nav">{menu.map(([key, label, num]) => <button className={page === key ? 'active' : ''} key={key} onClick={() => setPage(key)}><b>{num}</b><span>{label}</span></button>)}</nav>
    <main>
      {page === 'tracking' && isStudent && <TrackingPage session={session} profile={profile} studentId={studentId} setStudentId={setStudentId} tasks={tasks} onLoad={loadStudentTasks} />}
      {page === 'teacher' && isTeacher && <TeacherPage profile={profile} status={status} setStatus={setStatus} classTasks={classTasks} setClassTasks={setClassTasks} />}
      {page === 'tracking' && adminAccess && <CouncilHomeworkPage tasks={tasks} onLoad={loadStudentTasks} />}
      {page === 'admin' && adminAccess && <AdminPage member={member} fb={fb} setFb={setFb} status={status} setStatus={setStatus} classTasks={classTasks} setClassTasks={setClassTasks} />}
      {page === 'ai' && <AIPage messages={messages} setMessages={setMessages} />}
    </main>
    <footer className="app-footer"><span>TUPP Homework AI • ระบบต้นแบบสำหรับการศึกษา</span><span>AI model access via NVIDIA NIM — ไม่ได้แสดงถึงการรับรองจาก NVIDIA</span></footer>
  </div>;
}

function LoadingScreen({ message }) {
  return <main className="loading-screen"><div className="loading-mark"><ElectricLogo color="#fff" glowColor="#76b900" scale={.9} strands={4} crackle={1.2} interactive={false} /></div><h1>TUPP AI</h1><p>{message}</p><NvidiaBadge /></main>;
}

function AuthGate({ status, onLogin, onRegister, onRecoverAdmin }) {
  const inviteEntry = new URLSearchParams(window.location.search).has('adminInvite');
  const registrationDone = (() => { try { return localStorage.getItem('tupp-v50-registration-complete') === '1'; } catch { return false; } })();
  const [mode, setMode] = useState(inviteEntry || !registrationDone ? 'register' : 'login');
  const [role, setRole] = useState(new URLSearchParams(window.location.search).has('adminInvite') ? 'admin' : 'student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sid, setSid] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [inviteToken, setInviteToken] = useState(new URLSearchParams(window.location.search).get('adminInvite') || '');
  const [bootstrapSecret, setBootstrapSecret] = useState('');
  const [recoverySecret, setRecoverySecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const message = localError || status;

  async function submit(e) {
    e.preventDefault(); setLocalError(''); setBusy(true);
    try {
      if (mode === 'login') {
        await onLogin({ email: email.trim(), password });
        return;
      }
      if (password.length < 8) throw new Error('ตั้งรหัสผ่านอย่างน้อย 8 ตัวอักษร');
      if (password !== confirmPassword) throw new Error('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      if (role === 'student' && !/^\d{5}$/.test(sid)) throw new Error('รหัสประจำตัวนักเรียนต้องเป็นตัวเลข 5 หลัก');
      if (role === 'teacher') {
        if (!/^\d{5}$/.test(teacherId)) throw new Error('รหัสประจำตัวครูต้องเป็นตัวเลข 5 หลัก');
        if (!firstName.trim() || !lastName.trim()) throw new Error('กรุณากรอกชื่อจริงและนามสกุลครู');
      }
      if (role === 'admin' && !inviteToken.trim() && !bootstrapSecret.trim()) throw new Error('ต้องใช้ลิงก์เชิญแอดมิน หรือรหัสเปิดระบบครั้งแรก');
      await onRegister({ role, email: email.trim(), password, studentId: sid, teacherId, firstName, lastName, inviteToken: inviteToken.trim(), bootstrapSecret: bootstrapSecret.trim() });
    } catch (e2) { setLocalError(providerError(e2)); }
    finally { setBusy(false); }
  }

  return <div className="auth-shell">
    <div className="auth-backdrop-grid" />
    <section className="auth-card">
      <div className="auth-brand-row"><div className="auth-emblem"><ElectricLogo color="#fff" glowColor="#76b900" scale={.55} strands={4} crackle={1.1} interactive={false} /></div><div><span className="eyebrow">TUPP CRT-AI • SECURE ENTRY</span><h1>TUPP Homework AI</h1><p>{registrationDone && !inviteEntry ? 'ลงทะเบียนครั้งแรกเรียบร้อยแล้ว เข้าสู่ระบบเพื่อใช้งานต่อ' : 'ลงทะเบียนครั้งแรกก่อนเริ่มใช้งาน จากนั้นใช้บัญชีเดิมเข้าสู่ระบบ'}</p></div></div>
      <div className="provider-line"><NvidiaBadge /><span>Firebase Admin Backend • Auth + Firestore</span></div>
      <div className={`auth-mode-tabs ${registrationDone && !inviteEntry ? 'login-only' : ''}`}><button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setLocalError(''); }}>เข้าสู่ระบบ</button>{(!registrationDone || inviteEntry) && <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setLocalError(''); }}>ลงทะเบียนครั้งแรก</button>}</div>
      <form onSubmit={submit} className="auth-form">
        {mode === 'register' && <>
          <label>ประเภทบัญชี<select value={role} onChange={e => setRole(e.target.value)}><option value="student">นักเรียน</option><option value="teacher">คุณครู</option><option value="admin">ผู้ดูแลระบบ (Admin)</option></select></label>
          {role === 'student' && <label>รหัสประจำตัวนักเรียน 5 หลัก<input inputMode="numeric" autoComplete="off" value={sid} onChange={e => setSid(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="เช่น 01234" required maxLength={5}/></label>}
          {role === 'teacher' && <div className="auth-two"><label>ชื่อจริง<input value={firstName} onChange={e => setFirstName(e.target.value)} autoComplete="given-name" required /></label><label>นามสกุล<input value={lastName} onChange={e => setLastName(e.target.value)} autoComplete="family-name" required /></label><label>รหัสประจำตัวครู 5 หลัก<input inputMode="numeric" value={teacherId} onChange={e => setTeacherId(e.target.value.replace(/\D/g, '').slice(0, 5))} maxLength={5} required /></label></div>}
          {role === 'admin' && <div className="admin-setup-box"><b>Admin registration</b><p>บัญชีแอดมินต้องได้รับคำเชิญ หรือใช้รหัสเปิดระบบครั้งแรกที่ผู้ดูแลเซิร์ฟเวอร์ตั้งไว้</p><label>รหัสเชิญแอดมิน (ไม่บังคับเมื่อใช้รหัสครั้งแรก)<input value={inviteToken} onChange={e => setInviteToken(e.target.value)} placeholder="วางโทเคนจากลิงก์เชิญ" /></label><label>รหัสเปิดระบบแอดมินคนแรก<input type="password" autoComplete="off" value={bootstrapSecret} onChange={e => setBootstrapSecret(e.target.value)} placeholder="ตั้งไว้ในเซิร์ฟเวอร์เท่านั้น" /></label></div>}
        </>}
        <label>อีเมล<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={mode === 'register' && role === 'student' ? 'ต้องลงท้ายด้วย @tupp.ac.th' : 'name@example.com'} autoComplete="email" required /></label>
        {mode === 'register' && role === 'student' && <p className="field-note">นักเรียนต้องใช้อีเมลที่ลงท้ายด้วย <b>@tupp.ac.th</b></p>}
        <label>รหัสผ่าน<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : 1} required /></label>
        {mode === 'register' && <label>ยืนยันรหัสผ่าน<input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></label>}
        <button className="primary full auth-submit" disabled={busy}>{busy ? 'กำลังตรวจสอบ…' : mode === 'login' ? 'เข้าสู่ระบบอย่างปลอดภัย' : 'สร้างบัญชีและยืนยันข้อมูล'}</button>
      </form>
      {mode === 'login' && <div className="admin-recovery-box"><b>Admin access recovery</b><p>ใช้เฉพาะผู้ดูแลที่ได้รับอนุญาต และเมื่อไม่มี CAO ที่ active อยู่เท่านั้น</p><label>Recovery secret<input type="password" autoComplete="off" value={recoverySecret} onChange={e => setRecoverySecret(e.target.value)} placeholder="ADMIN_RECOVERY_SECRET ที่ตั้งฝั่งเซิร์ฟเวอร์" /></label><button type="button" className="ghost full" disabled={busy || !email.trim() || !password || !recoverySecret} onClick={async () => { setBusy(true); setLocalError(''); try { await onRecoverAdmin({ email: email.trim(), password, recoverySecret }); } catch (e) { setLocalError(providerError(e)); } finally { setBusy(false); } }}>กู้คืนสิทธิ์ Admin แบบครั้งเดียว</button></div>}
      <div className={`auth-message ${message ? 'shown' : ''}`}>{message}</div>
      <p className="auth-legal">ลงทะเบียนครั้งแรกเพียงครั้งเดียวบนอุปกรณ์นี้ หลังจากนั้นเข้าสู่ระบบด้วยบัญชีเดิมและจัดการชื่อที่แสดงได้จากเมนูบัญชี ห้ามใช้ข้อมูลผู้อื่นโดยไม่ได้รับอนุญาต บัญชีครูใหม่จะใช้งานได้หลังผ่านการอนุมัติ</p>
      <div className="auth-bottom"><span>Secure sign-in</span><span>Firebase • NVIDIA NIM</span></div>
    </section>
  </div>;
}

function PendingScreen({ profile, status, onLogout }) {
  return <div className="pending-screen"><div className="pending-card"><div className="pending-icon">⌛</div><span className="eyebrow">TEACHER ACCOUNT REVIEW</span><h1>บัญชีรอการอนุมัติ</h1><p>ระบบได้รับข้อมูลลงทะเบียนของคุณครูแล้ว บัญชีจะเปิดใช้งานเมื่อผู้ดูแลตรวจสอบและอนุมัติ</p><div className="pending-details"><span>ชื่อ</span><b>{text(profile?.firstName)} {text(profile?.lastName)}</b><span>อีเมล</span><b>{text(profile?.email)}</b><span>รหัสประจำตัวครู</span><b>{text(profile?.teacherId)}</b></div><p className="form-msg">{status}</p><button className="ghost" onClick={onLogout}>ออกจากระบบ</button></div></div>;
}

function TrackingPage({ session, profile, studentId, setStudentId, tasks, onLoad }) {
  const [form, setForm] = useState({ title: '', subject: '', dueAt: '', priority: 'NORMAL', scoreMax: '10', note: '' });
  const [msg, setMsg] = useState('');
  const now = Date.now();
  async function submit(e) {
    e.preventDefault();
    if (!session || profile?.role !== 'student') return setMsg('ต้องเข้าสู่ระบบด้วยบัญชีนักเรียนก่อน');
    if (!/^\d{5}$/.test(studentId)) return setMsg('รหัสนักเรียนต้องเป็นตัวเลข 5 หลัก');
    try {
      await addHomework({ ...form, studentId, scoreMax: Number(form.scoreMax || 0), classRoom: '', status: 'PENDING', createdBy: session.uid });
      setMsg('บันทึกงานแล้ว'); await onLoad(studentId); setForm({ title: '', subject: '', dueAt: '', priority: 'NORMAL', scoreMax: '10', note: '' });
    } catch (e2) { setMsg(providerError(e2)); }
  }
  useEffect(() => { if (studentId) void onLoad(studentId); }, [studentId]);
  return <section className="page">
    <div className="section-head"><div><span className="eyebrow">HOMEWORK TRACKING</span><h2>การบ้านของฉัน</h2><p>บันทึกงาน กำหนดส่ง และเช็กสถานะได้จากบัญชีของตัวเอง</p></div><div className="tracking-badge">{tasks.filter(x => x.status === 'PENDING').length} งานค้าง</div></div>
    <div className="tracking-grid"><form className="panel" onSubmit={submit}><h3>บันทึกการบ้าน</h3><label>รหัสนักเรียน<input value={studentId} readOnly /></label><label>ชื่องาน<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required /></label><label>วิชา<input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} required /></label><label>กำหนดส่ง<input type="datetime-local" value={form.dueAt} onChange={e => setForm({ ...form, dueAt: e.target.value })} /></label><div className="two"><label>ความสำคัญ<select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}><option value="NORMAL">ปกติ</option><option value="HIGH">สูง</option><option value="URGENT">เร่งด่วน</option></select></label><label>คะแนนเต็ม<input type="number" min="0" value={form.scoreMax} onChange={e => setForm({ ...form, scoreMax: e.target.value })} /></label></div><label>หมายเหตุ<textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label><button className="primary">บันทึกการบ้าน</button><div className="form-msg">{msg}</div></form>
      <div className="panel"><div className="panel-head"><div><h3>สถานะงาน</h3><span className="muted">ข้อมูลของบัญชีที่ลงชื่อเข้าใช้</span></div><button type="button" className="ghost" onClick={() => onLoad(studentId)}>รีเฟรช</button></div><div className="stat-row"><Stat n={tasks.length} t="ทั้งหมด"/><Stat n={tasks.filter(x => x.status === 'SUBMITTED').length} t="ส่งแล้ว"/><Stat n={tasks.filter(x => x.status === 'PENDING').length} t="ยังไม่ส่ง"/><Stat n={tasks.filter(x => x.status === 'PENDING' && x.dueAt && new Date(x.dueAt).getTime() < now).length} t="เลยกำหนด" red/></div><div className="task-list">{tasks.map(t => <div key={t.id} className={`task ${t.status === 'PENDING' && t.dueAt && new Date(t.dueAt).getTime() < now ? 'overdue' : ''}`}><div><b>{text(t.title)}</b><span>{text(t.subject || 'ไม่ระบุวิชา')} • {text(t.priority)}</span></div><div className="task-right"><span>{t.status === 'SUBMITTED' ? 'ส่งแล้ว' : 'ยังไม่ส่ง'}</span><small>{t.dueAt || 'ไม่ระบุวันส่ง'}</small></div></div>)}{!tasks.length && <div className="empty">ยังไม่มีการบ้านที่บันทึกไว้</div>}</div></div>
    </div>
  </section>;
}

function TeacherPage({ profile, status, setStatus, classTasks, setClassTasks }) {
  const [form, setForm] = useState({ studentId: '', classRoom: '', title: '', subject: '', dueAt: '', note: '' });
  const [filterRoom, setFilterRoom] = useState('');
  const [message, setMessage] = useState('');
  async function create(e) {
    e.preventDefault();
    if (!/^\d{5}$/.test(form.studentId)) return setMessage('กรุณากรอกรหัสนักเรียน 5 หลัก');
    try {
      await addHomework({ ...form, priority: 'NORMAL', scoreMax: 10, status: 'PENDING', createdBy: profile.uid || '', createdByEmail: profile.email || '' });
      setMessage('มอบหมายงานแล้ว'); setForm({ studentId: '', classRoom: '', title: '', subject: '', dueAt: '', note: '' });
      if (filterRoom) await refresh();
    } catch (e2) { setMessage(providerError(e2)); }
  }
  async function refresh() {
    if (!filterRoom.trim()) return setMessage('กรุณาใส่ห้องเรียน');
    try { setClassTasks(await listClassHomework(filterRoom.trim())); setMessage('โหลดรายการงานเรียบร้อย'); }
    catch (e) { setMessage(providerError(e)); }
  }
  return <section className="page"><div className="section-head"><div><span className="eyebrow">TEACHER WORKSPACE</span><h2>จัดการงานนักเรียน</h2><p>บัญชีครู: {text(profile?.firstName)} {text(profile?.lastName)}</p></div></div><div className="tracking-grid"><form className="panel" onSubmit={create}><h3>มอบหมายงาน</h3><label>รหัสนักเรียน 5 หลัก<input inputMode="numeric" value={form.studentId} onChange={e => setForm({ ...form, studentId: e.target.value.replace(/\D/g, '').slice(0, 5) })} required /></label><label>ห้องเรียน<input value={form.classRoom} onChange={e => setForm({ ...form, classRoom: e.target.value })} placeholder="ม.1/9" required /></label><label>ชื่องาน<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required /></label><label>วิชา<input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} required /></label><label>กำหนดส่ง<input type="datetime-local" value={form.dueAt} onChange={e => setForm({ ...form, dueAt: e.target.value })} /></label><label>หมายเหตุ<textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label><button className="primary">มอบหมายงาน</button></form><div className="panel"><div className="panel-head"><div><h3>ติดตามงานตามห้อง</h3><span className="muted">เฉพาะบัญชีครูที่อนุมัติแล้ว</span></div></div><div className="toolbar"><input value={filterRoom} onChange={e => setFilterRoom(e.target.value)} placeholder="ม.1/9"/><button onClick={refresh}>ค้นหา</button></div><div className="task-list">{classTasks.map(t => <div key={t.id} className="task"><div><b>{text(t.studentId)} • {text(t.title)}</b><span>{text(t.subject)} • {text(t.classRoom)}</span></div><div className="task-right"><span>{t.status === 'SUBMITTED' ? 'ส่งแล้ว' : 'ยังไม่ส่ง'}</span><small>{t.dueAt || 'ไม่ระบุวันส่ง'}</small></div></div>)}{!classTasks.length && <div className="empty">เลือกห้องเรียนเพื่อดูรายการงาน</div>}</div><div className="form-msg">{message || status}</div></div></div></section>;
}

function AIPage({ messages, setMessages }) {
  const [question, setQuestion] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [model, setModel] = useState('nvidia/nemotron-3-ultra-550b-a55b'); const [mode, setMode] = useState('reasoning');
  const specs = {
    'nvidia/nemotron-3-ultra-550b-a55b': { name:'Nemotron 3 Ultra 550B-A55B', params:'550B total / 55B active', context:'Up to 1M tokens per official model card', io:'Text in → Text out', arch:'Hybrid LatentMoE + Mamba-2 + Attention, with Multi-Token Prediction', use:'Advanced reasoning, planning, agent workflows, coding, long-context tasks', status:'Hosted NVIDIA NIM listing available; account access and quota apply.' },
    'nvidia/llama-3.1-nemotron-70b-instruct': { name:'Llama 3.1 Nemotron 70B Instruct', params:'70B parameters', context:'Depends on the selected deployment profile', io:'Text in → Text out', arch:'NVIDIA-customized Llama 3.1 70B Instruct', use:'Instruction following, general chat, language generation, coding', status:'Hosted free endpoint is marked deprecated; use a working/self-hosted NIM endpoint.' },
    'nvidia/nemotron-voicechat': { name:'Nemotron 3 VoiceChat', params:'12B parameters', context:'Real-time audio model; not a normal text-chat context window', io:'Audio + text in → speech + text/transcription out', arch:'Full-duplex speech-to-speech; Fast Conformer + Nemotron Nano V2 9B backbone + TTS decoder', use:'Real-time voice assistant, speech understanding and speech generation', status:'Early-access evaluation; requires a dedicated compatible VoiceChat realtime service.' }
  };
  const spec = specs[model];
  async function send() {
    const value = question.trim(); if (!value || busy) return;
    if (model === 'nvidia/nemotron-voicechat' || mode === 'voice') { setError('VoiceChat เป็นโมเดลเสียง full-duplex ไม่ใช่ chat/completions ข้อความ ต้องเปิด endpoint realtime และสิทธิ์ early access ก่อน จึงจะส่งเสียงจริงได้'); return; }
    const next = [...messages, { role: 'user', text: value }]; setMessages(next); setQuestion(''); setBusy(true); setError('');
    try {
      const answer = await askNvidia(next.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })), model, mode);
      setMessages([...next, { role: 'assistant', text: `${answer}\n\n[${model} • ${mode}]` }]);
    } catch (e) { const msg = providerError(e); setError(msg); setMessages([...next, { role: 'assistant', text: `ขออภัย: ${msg}` }]); }
    finally { setBusy(false); }
  }
  function chooseModel(value) { setModel(value); if (value === 'nvidia/nemotron-voicechat') setMode('voice'); else if (mode === 'voice') setMode('reasoning'); setError(''); }
  return <section className="page ai-page"><div className="ai-header"><div><div className="provider-tag"><NvidiaBadge /></div><span className="eyebrow">NVIDIA NIM • MODEL WORKSPACE</span><h2>TUPP Homework AI</h2><p>เลือกโมเดลตามลักษณะงาน โดยเก็บ API key ไว้ฝั่งเซิร์ฟเวอร์</p></div><div className="ai-orb"><ElectricLogo color="#fff" glowColor="#76b900" scale={1} strands={5} bend={.7} crackle={1.7} speed={2.6} interactive /></div></div>
    <div className="model-catalog"><div className="model-catalog-title"><span className="eyebrow">MODEL CATALOG</span><h3>Choose inference profile</h3></div><div className="model-catalog-grid">{Object.entries(specs).map(([id, m]) => <button key={id} type="button" className={`model-option ${model === id ? 'selected' : ''}`} onClick={() => chooseModel(id)}><span>{id === model ? 'ACTIVE' : 'SELECT MODEL'}</span><b>{m.name}</b><small>{m.params}</small><p>{m.use}</p></button>)}</div><div className="model-specs"><h3>{spec.name}</h3><div><span>MODEL ID</span><b>{model}</b></div><div><span>ARCHITECTURE</span><b>{spec.arch}</b></div><div><span>CONTEXT / OPERATION</span><b>{spec.context}</b></div><div><span>MODALITY</span><b>{spec.io}</b></div><div><span>AVAILABILITY</span><b>{spec.status}</b></div></div></div>
    <div className="chat"><div className="chat-mode-row"><label>Mode<select value={mode} onChange={e => { const v=e.target.value; setMode(v); if(v==='voice')setModel('nvidia/nemotron-voicechat'); else if(model==='nvidia/nemotron-voicechat')setModel('nvidia/nemotron-3-ultra-550b-a55b'); setError(''); }}><option value="reasoning">Reasoning / step-by-step</option><option value="chat">General chat</option><option value="voice">VoiceChat / realtime audio</option></select></label><span className="model-active-label">ACTIVE · {spec.name}</span></div><div className="chat-feed">{messages.map((m, i) => <div key={i} className={`bubble ${m.role === 'user' ? 'user' : ''}`}><span className="bubble-speaker">{m.role === 'user' ? 'คุณ' : 'TUPP AI'}</span>{m.text}</div>)}</div><div className="chat-compose"><input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()} placeholder={mode==='voice'?'VoiceChat ต้องตั้งค่า realtime endpoint ก่อน':'ถามเรื่องเรียนหรือการบ้าน…'}/><button className="primary" onClick={send} disabled={busy || mode==='voice'}>{busy ? 'กำลังคิด…' : 'ส่ง'}</button></div><div className="form-msg chat-status">{error || 'คำตอบ AI อาจผิดพลาดได้ ตรวจสอบข้อมูลสำคัญกับครูหรือแหล่งข้อมูลที่เชื่อถือได้'}</div></div><p className="provider-disclaimer">NVIDIA NIM เป็นผู้ให้บริการ API ที่เชื่อมต่อกับระบบนี้ ไม่ได้หมายความว่า NVIDIA รับรองโครงการ TUPP AI</p></section>;
}

function CouncilHomeworkPage({ tasks, onLoad }) {
  const [id, setId] = useState('');
  return <section className="page"><div className="section-head"><div><span className="eyebrow">COUNCIL OVERSIGHT</span><h2>ติดตามงานตามรหัสนักเรียน</h2><p>ใช้เพื่อตรวจสอบงานตามหน้าที่ของผู้ดูแลเท่านั้น</p></div></div><div className="panel"><div className="toolbar"><input value={id} onChange={e => setId(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="รหัสนักเรียน 5 หลัก"/><button onClick={() => onLoad(id)}>ค้นหา</button></div><div className="task-list">{tasks.map(t => <div key={t.id} className="task"><div><b>{text(t.studentId)} • {text(t.title)}</b><span>{text(t.subject)}</span></div><div className="task-right"><span>{t.status === 'SUBMITTED' ? 'ส่งแล้ว' : 'ยังไม่ส่ง'}</span><small>{t.dueAt || 'ไม่ระบุวันส่ง'}</small></div></div>)}{!tasks.length && <div className="empty">กรอกรหัสนักเรียนเพื่อดูรายการที่ได้รับอนุญาต</div>}</div></div></section>;
}

function AdminPage({ member, fb, setFb, status, setStatus, classTasks, setClassTasks }) {
  const [probe, setProbe] = useState(null); const [classRoom, setClassRoom] = useState(''); const [inviteEmail, setInviteEmail] = useState(''); const [inviteUrl, setInviteUrl] = useState('');
  const [pendingTeachers, setPendingTeachers] = useState([]); const [localMsg, setLocalMsg] = useState(''); const [busy, setBusy] = useState(false);
  async function runCheck() {
    setStatus('กำลังตรวจ Firebase…');
    try { const r = await testFirebase(); setProbe(r); setFb(getFirebaseState()); setStatus(`เชื่อมต่อ Firebase สำเร็จ • ${r.latencyMs} ms`); await writeAudit('FIREBASE_HEALTHCHECK', r); }
    catch (e) { setStatus(providerError(e)); setFb(getFirebaseState()); }
  }
  async function loadClass() {
    if (!classRoom.trim()) return;
    try { setClassTasks(await listClassHomework(classRoom.trim())); setStatus('โหลดรายการของห้องแล้ว'); }
    catch (e) { setStatus(providerError(e)); }
  }
  async function createInvite(e) {
    e.preventDefault(); setBusy(true); setLocalMsg(''); setInviteUrl('');
    try { const result = await inviteAdmin(inviteEmail); const url = `${window.location.origin}/?adminInvite=${encodeURIComponent(result.inviteToken)}`; setInviteUrl(url); setLocalMsg(`สร้างคำเชิญสำหรับ ${result.email} แล้ว (หมดอายุใน ${result.expiresInHours} ชั่วโมง)`); setInviteEmail(''); await writeAudit('ADMIN_INVITE_CREATED', { email: result.email }); }
    catch (e2) { setLocalMsg(providerError(e2)); }
    finally { setBusy(false); }
  }
  async function refreshTeachers() {
    try { setPendingTeachers(await listPendingTeachers()); setLocalMsg('โหลดรายชื่อครูที่รออนุมัติแล้ว'); }
    catch (e) { setLocalMsg(providerError(e)); }
  }
  async function approve(uid) {
    try { await approveTeacher(uid); setPendingTeachers(old => old.filter(t => t.id !== uid)); setLocalMsg('อนุมัติบัญชีครูเรียบร้อย'); await writeAudit('TEACHER_APPROVED', { uid }); }
    catch (e) { setLocalMsg(providerError(e)); }
  }
  return <section className="page admin-page"><div className="admin-hero"><div><span className="eyebrow">TUPP CRT-AI / COUNCIL CONTROL</span><h2>Firebase Operations Center</h2><p>{member?.email} • {roles(member).join(' + ')} • {member?.accessLevel || 'ADMIN ACCESS'}</p><p className="muted">Firebase อยู่หลังบ้านผ่าน Admin SDK และ HttpOnly session cookie; uptime จริงขึ้นกับ Firebase, โฮสต์, โควตา และเครือข่าย</p></div><div className="admin-logo"><ElectricLogo color="#ffeaa0" glowColor="#76b900" scale={.82} strands={5} crackle={1.8} arcs={2} speed={2.2} interactive /></div></div>
    <div className="ops-grid"><div className="ops-card"><h3>01 // FIREBASE CONNECTION</h3><p className="muted">ตั้งค่า Firebase ที่หลังบ้านผ่าน <code>FIREBASE_SERVICE_ACCOUNT_JSON</code> และ <code>FIREBASE_AUTH_API_KEY</code> บน Hosting Environment Variables หน้าเว็บไม่รับ Firebase Web Config และไม่มี Firebase SDK ในเบราว์เซอร์</p><K label="Config" value={fb.configured ? 'READY' : 'MISSING'}/><K label="Config source" value={fb.configSource || 'runtime pending'}/><K label="Firebase boot" value={fb.booted ? 'READY' : 'OFF'}/><K label="Persistence" value={fb.persistence}/><K label="Listeners" value={fb.activeListeners}/><K label="Retry count" value={fb.retryCount}/><button className="gold" onClick={runCheck}>SYSTEM CHECK</button><div className="status-box">{status}</div>{probe && <div className="status-box ok">Health document: {probe.healthDocument ? 'FOUND' : 'NOT FOUND'} • {probe.latencyMs} ms</div>}</div>
      <div className="ops-card"><h3>02 // INVITE ADMIN</h3><p className="muted">สร้างลิงก์เชิญแบบใช้ครั้งเดียว ผูกกับอีเมล และหมดอายุใน 72 ชั่วโมง</p><form onSubmit={createInvite}><label>อีเมลแอดมิน<input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="admin@example.com" required /></label><button className="gold" disabled={busy}>{busy ? 'กำลังสร้าง…' : 'CREATE INVITE LINK'}</button></form>{inviteUrl && <><label>ลิงก์เชิญ (คัดลอกไปส่งให้ผู้รับ)<textarea readOnly value={inviteUrl}/></label><button type="button" className="ghost" onClick={() => navigator.clipboard?.writeText(inviteUrl).then(() => setLocalMsg('คัดลอกลิงก์เชิญแล้ว')).catch(() => setLocalMsg('แตะค้างในช่องลิงก์เพื่อคัดลอก'))}>คัดลอกลิงก์</button></> }</div>
      <div className="ops-card"><h3>03 // TEACHER APPROVAL</h3><button className="ghost" onClick={refreshTeachers}>REFRESH PENDING TEACHERS</button><div className="class-list">{pendingTeachers.map(t => <div className="registry" key={t.id}><b>{text(t.firstName)} {text(t.lastName)} • {text(t.email)}</b><span>รหัสครู {text(t.teacherId)}</span><button className="gold" onClick={() => approve(t.id)}>อนุมัติครู</button></div>)}{!pendingTeachers.length && <div className="empty">ยังไม่มีรายการ หรือกด Refresh เพื่อโหลด</div>}</div></div>
      <div className="ops-card"><h3>04 // OPERATOR IDENTITY</h3><p className="muted">สิทธิ์ผู้ดูแลตรวจฝั่งเซิร์ฟเวอร์จาก Firebase Auth UID และเอกสาร councilMembers ที่ active เท่านั้น</p><div className="registry"><b>{member?.email || 'Signed-in operator'}</b><span>UID: {member?.uid || 'Verified by Firebase Authentication'}</span><span>Role: {roles(member).join(' + ')}</span></div></div>
      <div className="ops-card wide"><h3>05 // CLASS HOMEWORK VIEW</h3><div className="toolbar"><input value={classRoom} onChange={e => setClassRoom(e.target.value)} placeholder="เช่น ม.1/9"/><button onClick={loadClass}>LOAD CLASS</button></div><div className="class-list">{classTasks.map(t => <div className={`class-row ${t.status === 'PENDING' ? 'pending' : ''}`} key={t.id}><b>{text(t.studentId) || '-'}</b><span>{text(t.title)}</span><span>{text(t.status)}</span><span>{text(t.dueAt) || '-'}</span></div>)}</div><div className="form-msg">{localMsg}</div></div></div>
  </section>;
}

function K({ label, value }) { return <div className="kpi-line"><span>{label}</span><b>{value}</b></div>; }
function Stat({ n, t, red }) { return <div className={`stat ${red ? 'red' : ''}`}><b>{n}</b><span>{t}</span></div>; }
export default App;
