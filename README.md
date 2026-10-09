# TUPP AI V43 — Firebase Core + Gemini + ElectricLogo

## Architecture
- React + Vite
- Firebase Authentication + Firestore as the only application data backend
- Firebase multi-tab IndexedDB persistence and exponential-backoff retry
- Gemini is called through `/api/gemini`; the Gemini API key stays server-side
- `ElectricLogo` accepts the requested React Bits-style props and uses OGL

## Firebase collections
- `profiles`
- `homework`
- `councilMembers`
- `audit`
- `system/health`

## Council legacy registry
The four legacy accounts are preserved as metadata in `src/services/firebase.js`:
CAO, D-CAO, SCAO/HSA, and SCAO/HSA. Actual authentication must be created in Firebase Auth; passwords are never stored in source code.

## Production setup
1. Copy `.env.example` to `.env.local`.
2. Add Firebase Web App configuration values.
3. Enable Firebase Authentication (Email/Password and Anonymous if desired).
4. Create Firestore Security Rules so students can only read/write their own data, while teachers/council members receive role-based access.
5. Set `GEMINI_API_KEY` in the hosting provider's server environment, never in `VITE_*` variables.
6. Deploy the Vite app and serverless `api/gemini` endpoint together.

## Stability design
The client retries Firebase operations with exponential backoff, keeps Firestore persistence enabled when available, and exposes latency/retry/listener state in the Council Admin Firebase Operations Center. 24/7 availability still depends on Firebase, hosting, quotas, network reachability, and correct security rules.

## React Bits source
ElectricLogo was located in the public React Bits repository and its JS+CSS registry variant declares `ogl@^1.0.11` as its dependency. This project keeps the same public API shape so it can be swapped for the exact registry source when the project's normal React Bits registry workflow is enabled.
