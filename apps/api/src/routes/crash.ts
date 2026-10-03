/**
 * Aviator (crash) endpoints. Bets and cash-outs are forwarded to the game's CrashGame Durable
 * Object, which owns the round clock. The browser never supplies a multiplier or a result.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { crashBetSchema, crashCashoutSchema, paginationSchema, type ErrorCode } from '@arena/shared';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { ok, param, parseBody, parseQuery, type Ctx } from '../lib/http';
import { idempotency, rateLimit, requireUser } from '../middleware';

async function crashGame(c: Ctx, path: string, body?: unknown): Promise<unknown> {
  const gameId = param(c, 'gameId');
  const game = await c.get('services').games.get(gameId);
  if (game.kind !== 'CRASH') throw new AppError('GAME_UNAVAILABLE', 'This is not a crash game.');
  const ns = c.env.CRASH_GAMES;
  if (!ns) throw new AppError('FEATURE_DISABLED', 'The crash game engine is not configured.');
  const res = await ns.get(ns.idFromName(`crash:${game.id}`)).fetch(`https://crash.internal${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-arena-user': c.get('user').id, 'x-arena-game': game.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as { data?: unknown; error?: { code: ErrorCode; message: string; details?: unknown } };
  if (json.error) throw new AppError(json.error.code, json.error.message, json.error.details);
  return json.data;
}

export function crashRoutes(auth: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  r.use('*', auth, requireUser);

  r.get('/me/bets', async (c) => {
    const q = parseQuery(c, paginationSchema);
    return ok(c, { ...(await c.get('services').crash.myBets(c.get('user').id, q.page, q.pageSize)), page: q.page, pageSize: q.pageSize });
  });
  r.get('/:gameId/state', async (c) => ok(c, await crashGame(c, '/state')));
  r.get('/:gameId/history', async (c) => ok(c, await c.get('services').crash.history(param(c, 'gameId'), 50)));
  r.post('/:gameId/bets', rateLimit('crash_bet'), idempotency, async (c) => {
    const input = await parseBody(c, crashBetSchema);
    return ok(c, await crashGame(c, '/bet', { ...input, clientKey: c.get('idempotencyKey') }), 201);
  });
  r.post('/:gameId/cashout', rateLimit('crash_cashout'), async (c) => ok(c, await crashGame(c, '/cashout', await parseBody(c, crashCashoutSchema))));
  /** cancel a bet before take-off (full refund) */
  r.post('/:gameId/cancel', rateLimit('crash_cashout'), async (c) => ok(c, await crashGame(c, '/cancel', await parseBody(c, crashCashoutSchema))));
  return r;
}
