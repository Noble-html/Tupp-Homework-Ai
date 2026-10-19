import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

let adminApp;

if (!getApps().length) {
  // Use default credential or environment variables
  adminApp = initializeApp();
} else {
  adminApp = getApps()[0];
}

const db = getFirestore(adminApp);
const auth = getAuth(adminApp);

export { db, auth };
