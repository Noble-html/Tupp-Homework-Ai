# TUPP Homework AI V50 — Backend-only Firebase + Google Gemini

TUPP Homework AI is a React/Vite educational prototype. This version deliberately keeps **Firebase out of the browser**: the frontend does not import or initialize the Firebase Web SDK, does not receive a Firebase Web Config, and does not read or write Firestore directly. The browser calls same-origin `/api/*` routes only.

## Architecture

- `/api/auth`: handles email/password login and registration by calling Firebase Identity Toolkit from the server; exchanges the returned ID token for a 5-day Firebase session cookie (`HttpOnly`, `SameSite=Lax`, and `Secure` in production).
- `/api/data`: reads and writes Firestore using Firebase Admin SDK only; applies per-action checks for the signed-in UID, student ID, teacher status, and council roles.
- `/api/admin-invites`: admin invitations and teacher approval are authorized from the HttpOnly session cookie and server-side `councilMembers` role records.
- `/api/gemini`: verifies the Firebase ID token (Google sign-in, @tupp.ac.th or allow-listed admin) before forwarding inference to Google Gemini. The Gemini API key remains server-side.
- `firebase.rules`: denies all direct client Firestore reads/writes as defense in depth. Deploy these rules; Firebase Admin SDK server operations are not blocked by client Firestore Rules.
- There is no `firebase-config.json`, no `/api/firebase-config`, no `VITE_FIREBASE_*` variable, and no client `firebase` dependency.

## One-time setup

1. In Firebase Console, select the project `tupp-homework-ai`, enable **Authentication → Sign-in method → Email/Password**, and create Firestore.
2. Create a service-account credential for the trusted server and place its JSON as `FIREBASE_SERVICE_ACCOUNT_JSON` in the hosting provider's server-only Environment Variables. Never commit this JSON or put it in frontend code.
3. Set `FIREBASE_AUTH_API_KEY` to the Web API key for the same Firebase project. The browser never receives this value; the backend uses it to call Firebase Identity Toolkit for email/password sign-in. In Google Cloud API-key settings, ensure the key is compatible with server-side Identity Toolkit requests and restricted to only the required APIs where practical. It is an API key, not a substitute for the service-account credential.
4. Set `ADMIN_BOOTSTRAP_SECRET` to a random string of at least 24 characters. Optionally set `ADMIN_RECOVERY_SECRET` to a separate random value of 32+ characters, for one-time recovery only if no active CAO remains.
5. Set `GEMINI_API_KEY` (optionally `GEMINI_MODEL`). Do not prefix secrets with `VITE_`.
6. Deploy Firestore rules from `firebase.rules` (the included `firebase.json` points to that file). These rules intentionally deny all browser SDK access; the app's server APIs use Firebase Admin SDK.
7. Deploy to a serverless Node host such as Vercel. Use `npm install` and `npm run build`, with Vite's `dist` output. The host must route `/api/*.js` as Node functions and supply the Environment Variables in the target deployment scope. Running plain `npm run dev` starts Vite only; to test serverless API routes locally, use the host's local runtime (for example `vercel dev`) with the same server environment variables.
8. Open the deployed site, go to **ลงทะเบียนครั้งแรก → Admin**, and register the first CAO using the one-time `ADMIN_BOOTSTRAP_SECRET`. This operation succeeds only while the council directory is empty. After the first admin, create new admin invitations through the admin console.
9. Test with non-sensitive student and teacher test accounts first. Confirm login, registration, session restoration, homeworks, admin invite, and teacher approval before real use.

## Required environment variables (`.env.example`)

- `FIREBASE_SERVICE_ACCOUNT_JSON` — Firebase Admin SDK server credential.
- `FIREBASE_AUTH_API_KEY` — Firebase Identity Toolkit key used on the server only.
- `FIREBASE_PROJECT_ID` — optional when service account already contains `project_id`.
- `ADMIN_BOOTSTRAP_SECRET` — first-admin setup, one-time.
- `GEMINI_API_KEY` — Google Gemini inference.

Optional: `ADMIN_RECOVERY_SECRET`, `GEMINI_MODEL`.

## Session and security model

- The frontend never stores or receives a Firebase ID token. The server sets an `HttpOnly` session cookie; JavaScript cannot read the cookie value. The client can only call same-origin API routes.
- Session cookies last up to five days and are verified/revocation-checked in the server. Logout clears the browser cookie; users can also disable a user or revoke refresh tokens from Firebase Admin if a server-side session must be invalidated immediately.
- `/api/auth` and `/api/data` check same-origin POST requests. Use HTTPS in production. Do not enable permissive CORS for these endpoints.
- The server never trusts client-supplied UID/role/creator fields for data access; identity and roles are derived from the verified session and Firestore records.
- Firebase Admin SDK bypasses Firestore Rules, so every server route must retain its own authorization checks. Review code and rules before production.
- A serverless design does not require a human administrator to keep a browser open, but cannot promise 100% uptime; actual availability depends on Firebase, hosting provider, quotas, billing, network, and NVIDIA access.

## Gemini model routing

The browser sends a Firebase ID token to `/api/gemini`. Allowed models: `gemini-3.5-flash-lite` (default) and `gemini-3.5-flash`. Admin page: `/admin` (Google sign-in, allow-listed accounts only).

## Commands

```bash
npm install
npm run dev  # Vite frontend only; API routes need a serverless dev runtime
npm run build
npm run preview  # frontend preview only
```

This is a prototype, not an official TUPP school service. Obtain the school's privacy/security review before handling genuine student records.
