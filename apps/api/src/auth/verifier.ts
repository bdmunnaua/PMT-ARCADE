/**
 * Firebase ID token verification (server side, every request).
 *
 * Firebase ID tokens are RS256 JWTs signed by Google. We verify the signature against Google's
 * published JWKS and enforce the claims Firebase documents:
 *   iss = https://securetoken.google.com/<projectId>, aud = <projectId>,
 *   exp in the future, iat/auth_time in the past, sub = non-empty uid (≤128 chars).
 * The uid comes ONLY from a verified token — never from a request body or header.
 */
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../lib/errors';

export const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export interface VerifiedIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  signInProvider: string | null;
  /** Display name from the identity provider, if any (used only as the initial display name). */
  name: string | null;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}

let remoteJwks: JWTVerifyGetKey | null = null;
function googleJwks(): JWTVerifyGetKey {
  // cached per isolate; jose honours the endpoint's cache headers and refetches on unknown kid
  remoteJwks ??= createRemoteJWKSet(new URL(FIREBASE_JWKS_URL), { cooldownDuration: 30_000, cacheMaxAge: 6 * 60 * 60 * 1000 });
  return remoteJwks;
}

interface FirebaseClaims extends JWTPayload {
  email?: string;
  email_verified?: boolean;
  auth_time?: number;
  name?: string;
  firebase?: { sign_in_provider?: string };
}

export function createFirebaseVerifier(projectId: string, keys: JWTVerifyGetKey = googleJwks()): TokenVerifier {
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not configured');
  return {
    async verify(token: string): Promise<VerifiedIdentity> {
      let payload: FirebaseClaims;
      try {
        const res = await jwtVerify<FirebaseClaims>(token, keys, {
          issuer: `https://securetoken.google.com/${projectId}`,
          audience: projectId,
          algorithms: ['RS256'],
          clockTolerance: 30,
        });
        payload = res.payload;
      } catch (e) {
        if (e instanceof joseErrors.JOSEError) throw new AppError('INVALID_TOKEN');
        throw e;
      }
      const now = Math.floor(Date.now() / 1000);
      if (!payload.sub || payload.sub.length > 128) throw new AppError('INVALID_TOKEN');
      if (typeof payload.auth_time !== 'number' || payload.auth_time > now + 30) throw new AppError('INVALID_TOKEN');
      if (typeof payload.iat !== 'number' || payload.iat > now + 30) throw new AppError('INVALID_TOKEN');
      return {
        uid: payload.sub,
        email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
        emailVerified: payload.email_verified === true,
        signInProvider: payload.firebase?.sign_in_provider ?? null,
        name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 40) : null,
      };
    },
  };
}

/**
 * DEVELOPMENT ONLY: accepts `dev.<name>` bearer tokens so the platform can be exercised locally
 * before it is merged into the host project's sign-in. Enabled only when ENVIRONMENT is exactly
 * "development" AND DEV_AUTH is "true" (see `devAuthEnabled`); production never reaches this code.
 */
export const DEV_TOKEN_PREFIX = 'dev.';
const DEV_NAME = /^[a-z0-9_]{3,20}$/;

export function devAuthEnabled(env: { ENVIRONMENT?: string; DEV_AUTH?: string }): boolean {
  return env.ENVIRONMENT === 'development' && env.DEV_AUTH === 'true';
}

export function createDevVerifier(): TokenVerifier {
  return {
    async verify(token: string): Promise<VerifiedIdentity> {
      const name = token.startsWith(DEV_TOKEN_PREFIX) ? token.slice(DEV_TOKEN_PREFIX.length) : '';
      if (!DEV_NAME.test(name)) throw new AppError('INVALID_TOKEN');
      return { uid: `dev-${name}`, email: `${name}@dev.localhost`, emailVerified: true, signInProvider: 'dev', name };
    },
  };
}
