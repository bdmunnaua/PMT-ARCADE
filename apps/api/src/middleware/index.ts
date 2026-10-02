import type { MiddlewareHandler } from 'hono';
import type { Permission, RateLimitName } from '@arena/shared';
import { isProduction, type AppEnv } from '../env';
import type { TokenVerifier } from '../auth/verifier';
import { AppError } from '../lib/errors';
import { ulid } from '../lib/ids';

type MW = MiddlewareHandler<AppEnv>;

/** Bearer token → verified identity (Firebase ID token; dev tokens only in development). */
export function authenticate(getVerifier: (env: AppEnv['Bindings'], token: string) => TokenVerifier): MW {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) throw new AppError('UNAUTHENTICATED');
    const token = match[1].trim();
    if (token.length > 4096) throw new AppError('INVALID_TOKEN');
    try {
      c.set('identity', await getVerifier(c.env, token).verify(token));
    } catch (e) {
      if (e instanceof AppError && c.req.path.endsWith('/auth/session')) {
        await c.get('services').players.logSecurityEvent('AUTH_FAILED', null, null, c.get('meta'), e.code);
      }
      throw e;
    }
    await next();
  };
}

/**
 * Loads the platform user for the verified identity. Never trusts a user/player id from the
 * request. BANNED accounts can only read their own profile (to see why).
 */
export const requireUser: MW = async (c, next) => {
  const user = await c.get('services').users.findByFirebaseUid(c.get('identity').uid);
  if (!user) throw new AppError('PROFILE_REQUIRED');
  if (user.accountStatus === 'BANNED' && !(c.req.method === 'GET' && c.req.path === '/api/me')) throw new AppError('ACCOUNT_BANNED');
  c.set('user', user);
  await next();
};

/** RBAC — permissions are read from the database on every admin request. */
export function requireAdmin(...anyOf: Permission[]): MW {
  return async (c, next) => {
    const services = c.get('services');
    const user = c.get('user');
    const loaded = c.get('admin') as AppEnv['Variables']['admin'] | undefined;
    const admin = loaded ?? (await services.players.loadAdmin(user.id));
    const verifiedRequired = (c.env.ADMIN_REQUIRE_VERIFIED_EMAIL ?? (isProduction(c.env) ? 'true' : 'false')) === 'true';
    let denial: AppError | null = null;
    if (!admin) denial = new AppError('FORBIDDEN', 'Administrator access required.');
    else if (user.accountStatus !== 'ACTIVE') denial = new AppError('FORBIDDEN', 'Your account is not active.');
    else if (verifiedRequired && !c.get('identity').emailVerified) denial = new AppError('EMAIL_NOT_VERIFIED', 'Verify your email address to use the admin panel.');
    else if (anyOf.length && !anyOf.some((p) => admin.permissions.includes(p))) denial = new AppError('FORBIDDEN', `Missing permission: ${anyOf.join(' or ')}.`);
    if (denial || !admin) {
      await services.players.logSecurityEvent('ADMIN_ACCESS_DENIED', user.id, user.firebaseUid, c.get('meta'), `${c.req.method} ${c.req.path}`);
      throw denial ?? new AppError('FORBIDDEN');
    }
    c.set('admin', { userId: user.id, role: admin.role, permissions: admin.permissions });
    await next();
  };
}

/** Per-user rate limit (per verified uid before the profile exists, per IP when unauthenticated). */
export function rateLimit(name: RateLimitName): MW {
  return async (c, next) => {
    // per user; before a profile exists, per verified uid (mobile carriers share IPs via CGNAT)
    const user = c.get('user') as AppEnv['Variables']['user'] | undefined;
    const identity = c.get('identity') as AppEnv['Variables']['identity'] | undefined;
    const subject = user?.id ?? (identity ? `uid:${identity.uid}` : `ip:${c.get('meta').ip ?? 'unknown'}`);
    try {
      await c.get('services').rateLimiter.hit(name, subject);
    } catch (e) {
      if (e instanceof AppError && e.code === 'RATE_LIMITED') {
        const retry = (e.details as { retryAfterSec?: number } | undefined)?.retryAfterSec;
        if (retry) c.header('Retry-After', String(retry));
      }
      throw e;
    }
    await next();
  };
}

/**
 * Idempotency-Key header (8–100 safe chars). The web client sends a fresh key per user action
 * and re-sends the same key on retries; double-clicks and retried requests therefore map to the
 * same operation. If absent, a random key is generated (no cross-request dedupe possible).
 */
export const idempotency: MW = async (c, next) => {
  const key = c.req.header('idempotency-key');
  if (key !== undefined && !/^[A-Za-z0-9_:-]{8,100}$/.test(key)) throw new AppError('VALIDATION_ERROR', 'Invalid Idempotency-Key header.');
  c.set('idempotencyKey', key ?? `srv-${ulid()}`);
  await next();
};

export const devOnly: MW = async (c, next) => {
  if (isProduction(c.env)) throw new AppError('NOT_FOUND');
  await next();
};
