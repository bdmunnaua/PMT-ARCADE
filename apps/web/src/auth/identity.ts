/**
 * Where the signed-in user comes from.
 *
 * This app has NO login or registration screens: users sign in through the host project that
 * this platform is merged into. The app only reads that session and sends its ID token to the
 * API, which verifies it server-side and creates the player profile on first use.
 *
 * Built-in sources:
 *  - firebase: the Firebase Auth session of the same Firebase project (shared with the host app
 *    when both run on the same origin). Configure FIREBASE_* in the root .env.
 *  - dev: local development only (`vite dev` + VITE_DEV_AUTH=true, API with DEV_AUTH=true).
 *    Never part of a production build.
 * A host project can pass its own `IdentitySource` to <AuthProvider source={…}>.
 */
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { firebaseAuth, firebaseConfigured } from '../lib/firebase';

export interface IdentitySource {
  kind: string;
  /** Calls back with `true`/`false` whenever the session changes. Returns an unsubscribe. */
  subscribe(onChange: (signedIn: boolean) => void): () => void;
  /** A fresh bearer token for the API, or null when signed out. */
  getIdToken(): Promise<string | null>;
  signOut(): Promise<void>;
}

/** Host sign-in page; the signed-out screen links to it with `?redirect=<current url>`. */
export const loginUrl = (import.meta.env.VITE_LOGIN_URL as string | undefined) || null;

export function firebaseIdentitySource(): IdentitySource {
  const auth = firebaseAuth();
  return {
    kind: 'firebase',
    subscribe: (cb) => onAuthStateChanged(auth, (u) => cb(!!u)),
    getIdToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
    signOut: () => fbSignOut(auth),
  };
}

// ---------- development-only identity ----------
export const devAuthEnabled = import.meta.env.DEV && (import.meta.env.VITE_DEV_AUTH as string | undefined) === 'true';
const DEV_KEY = 'arena.devUser';
const devListeners = new Set<(signedIn: boolean) => void>();

function readDevUser(): string | null {
  try {
    return sessionStorage.getItem(DEV_KEY);
  } catch {
    return null;
  }
}

/** Dev only: act as `name` in this browser tab (sessionStorage, so each tab can be a different player). */
export function devSignIn(name: string): void {
  if (!devAuthEnabled) return;
  try {
    sessionStorage.setItem(DEV_KEY, name);
  } catch {
    /* storage unavailable — nothing to persist */
  }
  devListeners.forEach((l) => l(true));
}

export function devIdentitySource(): IdentitySource {
  return {
    kind: 'dev',
    subscribe(cb) {
      devListeners.add(cb);
      cb(!!readDevUser());
      return () => devListeners.delete(cb);
    },
    getIdToken: async () => {
      const u = readDevUser();
      return u ? `dev.${u}` : null;
    },
    async signOut() {
      try {
        sessionStorage.removeItem(DEV_KEY);
      } catch {
        /* ignore */
      }
      devListeners.forEach((l) => l(false));
    },
  };
}

/** The default source: dev identity in local development when enabled, else Firebase, else none. */
export function defaultIdentitySource(): IdentitySource | null {
  if (devAuthEnabled) return devIdentitySource();
  if (firebaseConfigured) return firebaseIdentitySource();
  return null;
}
