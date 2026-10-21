BACKEND-ONLY FIREBASE MODE

The browser must not read Firebase Web Config or initialize Firebase SDKs.
Firebase Authentication is handled by /api/auth using the Firebase Identity Toolkit API from the server; Firestore is accessed only by Firebase Admin SDK through /api/data and other server APIs.
Do not add firebase-config.json, VITE_FIREBASE_* variables, or client-side Firebase SDK imports.
