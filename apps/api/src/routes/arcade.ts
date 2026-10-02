/**
 * Free arcade games. Public: config, popularity, leaderboards. Signed in: profile, daily check-in,
 * invite codes, and game sessions (start → finish with a score; the server decides the reward).
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { arcadeReferralSchema, arcadeRunFinishSchema, arcadeRunStartSchema } from '@arena/shared';
import type { AppEnv } from '../env';
import { ok, parseBody } from '../lib/http';
import { rateLimit, requireUser } from '../middleware';

export function arcadeRoutes(auth: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();

  r.get('/config', async (c) => ok(c, await c.get('services').arcade.config()));
  r.get('/popular', async (c) => {
    c.header('Cache-Control', 'public, max-age=600');
    return ok(c, { plays: await c.get('services').arcade.popular() });
  });
  r.get('/leaderboard', async (c) => ok(c, await c.get('services').arcade.leaderboard(c.req.query('game') ?? '', null)));

  r.get('/me', auth, requireUser, async (c) => ok(c, await c.get('services').arcade.me(c.get('user'))));
  r.post('/checkin', auth, requireUser, rateLimit('arcade_checkin'), async (c) => ok(c, await c.get('services').arcade.checkin(c.get('user'))));
  r.post('/referral', auth, requireUser, rateLimit('arcade_checkin'), async (c) => {
    const { code } = await parseBody(c, arcadeReferralSchema);
    return ok(c, await c.get('services').arcade.useReferral(c.get('user'), code));
  });
  r.post('/runs/start', auth, requireUser, rateLimit('arcade_run'), async (c) => {
    const { game } = await parseBody(c, arcadeRunStartSchema);
    return ok(c, await c.get('services').arcade.startRun(c.get('user'), game), 201);
  });
  r.post('/runs/finish', auth, requireUser, rateLimit('arcade_run'), async (c) => {
    const { runId, score } = await parseBody(c, arcadeRunFinishSchema);
    return ok(c, await c.get('services').arcade.finishRun(c.get('user'), runId, score));
  });
  return r;
}
