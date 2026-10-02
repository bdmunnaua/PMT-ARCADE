import { Hono } from 'hono';
import { z } from 'zod';
import { disputeListQuerySchema, gameUpdateSchema, matchListQuerySchema, resolveDisputeSchema, voidMatchSchema } from '@arena/shared';
import type { AppEnv } from '../../env';
import { parseJson } from '../../lib/db';
import { notFound } from '../../lib/errors';
import { ok, param, parseBody, parseQuery } from '../../lib/http';
import { requireAdmin } from '../../middleware';

const gamePatchBody = z.object({ changes: gameUpdateSchema, reason: z.string().trim().min(3).max(500) });

export function adminGameRoutes() {
  const r = new Hono<AppEnv>();

  // ---- game registry
  r.get('/games', requireAdmin('games.view', 'games.manage'), async (c) => ok(c, await c.get('services').games.list()));
  r.patch('/games/:id', requireAdmin('games.manage'), async (c) => {
    const body = await parseBody(c, gamePatchBody);
    const services = c.get('services');
    return ok(c, await services.games.update(param(c, 'id'), body.changes, c.get('admin').userId, body.reason, services.audit));
  });

  // ---- matches
  r.get('/matches', requireAdmin('matches.view'), async (c) => {
    const q = parseQuery(c, matchListQuerySchema);
    const page = await c.get('services').admin.listMatches({ ...q, live: q.live === '1' });
    return ok(c, { ...page, page: q.page, pageSize: q.pageSize });
  });

  r.get('/matches/:id', requireAdmin('matches.view'), async (c) => {
    const services = c.get('services');
    const id = param(c, 'id');
    const match = await services.matches.get(id, null);
    const row = await services.matchesRepo.find(id);
    if (!row) throw notFound('Match');
    const events = await services.matchesRepo.events(id);
    const settlement = row.resolution_tx_id ? await services.ledgerRead.adminTransaction(row.resolution_tx_id) : null;
    return ok(c, {
      match,
      resultSource: row.result_source,
      resultProof: row.result_proof,
      voidReason: row.void_reason,
      events: events.map((e) => ({ type: e.type, actorType: e.actor_type, payload: parseJson(e.payload, {}), createdAt: e.created_at })),
      settlement,
    });
  });

  /** Void a match after a game-server failure: every stake refunded, no fee. Via settlement service. */
  r.post('/matches/:id/void', requireAdmin('matches.manage'), async (c) => {
    const body = await parseBody(c, voidMatchSchema);
    const services = c.get('services');
    const id = param(c, 'id');
    const admin = c.get('admin');
    const row = await services.matchesRepo.find(id);
    if (!row) throw notFound('Match');
    const isPreStart = ['CREATED', 'WAITING_FOR_OPPONENT', 'STAKE_LOCKING'].includes(row.status);
    const result = await services.settlement.settleMatch({
      matchId: id,
      outcome: isPreStart ? { type: 'CANCEL', reason: body.reason } : { type: 'VOID', reason: body.reason },
      source: 'ADMIN',
      actorId: admin.userId,
      extraStatements: [services.audit.stmt({ adminUserId: admin.userId, action: 'match.void', entityType: 'match', entityId: id, before: { status: row.status }, reason: body.reason })],
    });
    return ok(c, result);
  });

  // ---- disputes
  r.get('/disputes', requireAdmin('disputes.view'), async (c) => {
    const q = parseQuery(c, disputeListQuerySchema);
    return ok(c, { ...(await c.get('services').disputes.adminList(q)), page: q.page, pageSize: q.pageSize });
  });
  r.get('/disputes/:id', requireAdmin('disputes.view'), async (c) => ok(c, await c.get('services').disputes.adminGet(param(c, 'id'))));
  r.post('/disputes/:id/review', requireAdmin('disputes.manage'), async (c) => {
    const services = c.get('services');
    return ok(c, await services.disputes.startReview(c.get('admin'), param(c, 'id'), services.audit));
  });
  r.post('/disputes/:id/resolve', requireAdmin('disputes.manage'), async (c) => {
    const body = await parseBody(c, resolveDisputeSchema);
    const services = c.get('services');
    return ok(c, await services.disputes.resolve(c.get('admin'), param(c, 'id'), body, services.audit));
  });

  return r;
}
