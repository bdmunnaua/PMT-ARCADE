/**
 * Firebase is used ONLY to read the signed-in user's session (sign-in itself happens in the host
 * project). Balances, profiles and everything else live in the platform database behind the
 * Worker, which verifies the Firebase ID token on every request.
 *
 * EXTERNAL SETUP REQUIRED: set FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN and FIREBASE_PROJECT_ID in
 * the repository-root .env — the SAME Firebase project the host app signs users into.
 */
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

const config = {
  apiKey: import.meta.env.FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.FIREBASE_PROJECT_ID as string | undefined,
};

export const firebaseConfigured = !!(config.apiKey && config.authDomain && config.projectId);

let auth: Auth | null = null;

export function firebaseAuth(): Auth {
  if (!firebaseConfigured) throw new Error('Firebase is not configured');
  // reuse the host app's default Firebase app when it has already initialised one
  auth ??= getAuth(getApps().length ? getApp() : initializeApp(config));
  return auth;
}
