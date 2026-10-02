import { Hono, type MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { ok } from '../lib/http';
import { rateLimit } from '../middleware';

export function authRoutes(auth: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();

  /**
   * Called by the web app after every sign-in in the host project. The first call for a uid
   * creates the player profile, permanent player number and wallets (no separate registration);
   * later calls record the login. Returns the profile.
   */
  r.post('/session', auth, rateLimit('auth_session'), async (c) => {
    const services = c.get('services');
    const identity = c.get('identity');
    const { user, created } = await services.players.provision(identity, c.get('meta'));
    if (user.accountStatus === 'BANNED') {
      await services.players.recordSession(user, identity, c.get('meta'));
      throw new AppError('ACCOUNT_BANNED');
    }
    if (!created) await services.players.recordSession(user, identity, c.get('meta'));
    const fresh = (await services.users.findById(user.id)) ?? user;
    return ok(c, await services.players.me(fresh), created ? 201 : 200);
  });

  return r;
}
