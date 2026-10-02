/**
 * Player match endpoints. Note what is NOT here: there is no endpoint through which a player
 * reports a result or a winner. Results come only from the trusted settlement interface.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { createDisputeSchema, createMatchSchema, joinByCodeSchema, openMatchesQuerySchema, quickMatchSchema } from '@arena/shared';
import type { AppEnv } from '../env';
import { ok, param, parseBody, parseQuery } from '../lib/http';
import { idempotency, rateLimit, requireUser } from '../middleware';

export function matchRoutes(auth: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  r.use('*', auth, requireUser);

  r.get('/open', async (c) => {
    const q = parseQuery(c, openMatchesQuerySchema);
    return ok(c, await c.get('services').matches.listOpen(q.gameId, c.get('user').id));
  });

  r.post('/', rateLimit('match_create'), idempotency, async (c) => {
    const input = await parseBody(c, createMatchSchema);
    const res = await c.get('services').matches.create(c.get('user'), input, c.get('idempotencyKey'));
    return ok(c, res, res.replayed ? 200 : 201);
  });

  r.post('/quick', rateLimit('match_join'), idempotency, async (c) => {
    const input = await parseBody(c, quickMatchSchema);
    return ok(c, await c.get('services').matches.quickMatch(c.get('user'), input.gameId, input.stakeUnits, c.get('idempotencyKey')));
  });

  r.post('/join-by-code', rateLimit('match_join'), async (c) => {
    const input = await parseBody(c, joinByCodeSchema);
    return ok(c, await c.get('services').matches.joinByCode(c.get('user'), input.code));
  });

  r.get('/:id', async (c) => ok(c, await c.get('services').matches.get(param(c, 'id'), c.get('user').id)));

  r.post('/:id/join', rateLimit('match_join'), async (c) => ok(c, await c.get('services').matches.join(c.get('user'), param(c, 'id'))));

  r.post('/:id/leave', rateLimit('match_join'), async (c) => ok(c, await c.get('services').matches.leave(c.get('user'), param(c, 'id'))));
  /** host fills the empty seats with 🤖 bots, which starts the game */
  r.post('/:id/bots', rateLimit('match_join'), async (c) => ok(c, await c.get('services').bots.fill(c.get('user'), param(c, 'id'))));

  r.post('/:id/disputes', rateLimit('dispute_create'), async (c) => {
    const input = await parseBody(c, createDisputeSchema);
    return ok(c, await c.get('services').disputes.create(c.get('user'), param(c, 'id'), input.category, input.description), 201);
  });

  return r;
}
