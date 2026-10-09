import { initializeApp, getApps } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, addDoc, collection, query, where, orderBy, limit, onSnapshot, serverTimestamp, enableMultiTabIndexedDbPersistence } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app;
let auth;
let db;
let persistence = 'not-initialized';
let booted = false;
let retryCount = 0;
let lastError = null;
let lastSuccessAt = null;
const listeners = new Set();

export const LEGACY_COUNCIL_REGISTRY = [
  { email:'rachata.le@gmail.com', roles:['CAO','AOC'], access:['OAS-0','018-S'] },
  { email:'06554@tupp.ac.th', roles:['DCAO','AOC'], access:['OS-1 FIELD','018'] },
  { email:'thanawinnoble07@gmail.com', roles:['SCAO','HSA'], access:['OS-1','010-S'] },
  { email:'06546@tupp.ac.th', roles:['SCAO','HSA'], access:['SO-1','LEGACY-S'] },
];

export function firebaseConfigured(){
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
}

export async function initFirebase(){
  if (booted) return {app,auth,db,persistence};
  if (!firebaseConfigured()) throw new Error('Firebase environment variables are missing');
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  try { await enableMultiTabIndexedDbPersistence(db); persistence = 'enabled'; }
  catch { persistence = 'unavailable'; }
  booted = true;
  lastSuccessAt = Date.now();
  return {app,auth,db,persistence};
}

export function getFirebaseState(){
  return {configured:firebaseConfigured(), booted, persistence, retryCount, lastError:lastError?.message||'', lastSuccessAt, activeListeners:listeners.size};
}

export async function withRetry(fn, {tries=5, baseMs=600}={}){
  let last;
  for(let i=0;i<tries;i++){
    try { const v=await fn(); retryCount=i===0?retryCount:retryCount+1; lastSuccessAt=Date.now(); lastError=null; return v; }
    catch(e){ last=e; lastError=e; if(i<tries-1) await new Promise(r=>setTimeout(r,baseMs*Math.pow(2,i))); }
  }
  throw last;
}

export async function signInCouncil(email,password){
  await initFirebase();
  const cred = await withRetry(()=>signInWithEmailAndPassword(auth,email.trim().toLowerCase(),password));
  const ref = doc(db,'councilMembers',cred.user.uid);
  const snap = await withRetry(()=>getDoc(ref));
  if(!snap.exists()) { await signOut(auth); throw new Error('บัญชี Firebase นี้ยังไม่ได้ลงทะเบียนใน Council Directory'); }
  const member = snap.data();
  if(member.active === false) { await signOut(auth); throw new Error('บัญชี Council ถูกระงับ'); }
  return {user:cred.user, member};
}

export async function signInGeneral(){
  await initFirebase();
  return withRetry(()=>signInAnonymously(auth));
}

export async function logout(){ if(!auth) return; await signOut(auth); }
export function watchAuth(callback){ if(!auth) return ()=>{}; return onAuthStateChanged(auth,callback); }

export async function getCouncilProfile(uid){
  await initFirebase();
  const snap=await withRetry(()=>getDoc(doc(db,'councilMembers',uid)));
  return snap.exists()?{id:snap.id,...snap.data()}:null;
}

export async function ensureProfile(uid,profile){
  await initFirebase();
  await withRetry(()=>setDoc(doc(db,'profiles',uid),{...profile,updatedAt:serverTimestamp()},{merge:true}));
}

export async function writeAudit(event,payload={}){
  await initFirebase();
  await withRetry(()=>addDoc(collection(db,'audit'),{event,payload,actorUid:auth?.currentUser?.uid||null,createdAt:serverTimestamp()}));
}

export async function listHomework(studentId){
  await initFirebase();
  const q=query(collection(db,'homework'),where('studentId','==',studentId),orderBy('dueAt','asc'),limit(200));
  return new Promise((resolve,reject)=>{
    const stop=onSnapshot(q,s=>{lastSuccessAt=Date.now();resolve(s.docs.map(d=>({id:d.id,...d.data()})));},e=>{lastError=e;reject(e);});
    listeners.add(stop); setTimeout(()=>{listeners.delete(stop);},600000);
  });
}

export async function listClassHomework(classRoom){
  await initFirebase();
  const q=query(collection(db,'homework'),where('classRoom','==',classRoom),orderBy('dueAt','asc'),limit(500));
  return new Promise((resolve,reject)=>{
    const stop=onSnapshot(q,s=>resolve(s.docs.map(d=>({id:d.id,...d.data()}))),reject);
    listeners.add(stop);
  });
}

export async function addHomework(data){
  await initFirebase();
  return withRetry(()=>addDoc(collection(db,'homework'),{...data,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
}

export async function testFirebase(){
  await initFirebase();
  const started=performance.now();
  const snap=await withRetry(()=>getDoc(doc(db,'system','health')));
  lastSuccessAt=Date.now();
  return {ok:snap.exists()||!snap.exists(),latencyMs:Math.round(performance.now()-started),healthDocument:snap.exists()};
}

export { auth, db };
