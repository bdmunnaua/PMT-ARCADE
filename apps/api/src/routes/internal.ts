/**
 * Trusted server-to-server interface for external game servers (if a game is not hosted inside the
 * GameRoom Durable Object). Requests must be signed:
 *   X-Arena-Timestamp: <epoch ms>
 *   X-Arena-Signature: base64url(HMAC-SHA256(INTERNAL_API_SECRET, `${timestamp}.${METHOD}.${path}.${rawBody}`))
 * Disabled entirely when INTERNAL_API_SECRET is not set. Never callable from a browser
 * (no CORS, secret never shipped to clients).
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { INTERNAL_SIGNATURE_MAX_SKEW_MS } from '@arena/shared';
import type { AppEnv } from '../env';
import { hmacVerify } from '../lib/crypto';
import { AppError, notFound } from '../lib/errors';
import { ok, param } from '../lib/http';

const resultSchema = z.object({
  outcome: z.discriminatedUnion('type', [
    z.object({ type: z.literal('WIN'), winnerPlayerNumber: z.int().positive(), reason: z.enum(['NORMAL', 'FORFEIT', 'TIMEOUT']).default('NORMAL') }),
    z.object({ type: z.literal('DRAW') }),
    z.object({ type: z.literal('VOID'), reason: z.string().min(3).max(300) }),
  ]),
  resultProof: z.string().max(2000).optional(),
});
const eventSchema = z.object({ type: z.string().regex(/^[A-Z0-9_]{2,40}$/), payload: z.unknown() });

const verifySignature: MiddlewareHandler<AppEnv> = async (c, next) => {
  const secret = c.env.INTERNAL_API_SECRET;
  if (!secret || secret.length < 32) throw new AppError('NOT_FOUND');
  const ts = Number(c.req.header('x-arena-timestamp'));
  const sig = c.req.header('x-arena-signature') ?? '';
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > INTERNAL_SIGNATURE_MAX_SKEW_MS) throw new AppError('UNAUTHENTICATED', 'Stale or missing timestamp.');
  const body = await c.req.text();
  const path = new URL(c.req.url).pathname;
  if (!(await hmacVerify(secret, `${ts}.${c.req.method}.${path}.${body}`, sig))) throw new AppError('UNAUTHENTICATED', 'Bad signature.');
  await next();
};

async function jsonBody<T>(raw: string, schema: z.ZodType<T>): Promise<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid JSON.');
  }
  const r = schema.safeParse(parsed);
  if (!r.success) throw new AppError('VALIDATION_ERROR', undefined, { issues: r.error.issues });
  return r.data;
}

export function internalRoutes() {
  const r = new Hono<AppEnv>();
  r.use('*', verifySignature);

  r.post('/matches/:id/start', async (c) => {
    await c.get('services').matches.markPlaying(param(c, 'id'), 'INTERNAL_API', null);
    return ok(c, { ok: true });
  });

  r.post('/matches/:id/events', async (c) => {
    const body = await jsonBody(await c.req.text(), eventSchema);
    await c.get('services').matches.recordEvent(param(c, 'id'), body.type, body.payload, 'INTERNAL_API', null);
    return ok(c, { ok: true });
  });

  r.post('/matches/:id/result', async (c) => {
    const body = await jsonBody(await c.req.text(), resultSchema);
    const services = c.get('services');
    const id = param(c, 'id');
    const players = await services.matchesRepo.players(id);
    if (players.length === 0) throw notFound('Match');
    let outcome;
    if (body.outcome.type === 'WIN') {
      const { winnerPlayerNumber, reason } = body.outcome;
      const winner = players.find((p) => p.player_number === winnerPlayerNumber);
      if (!winner) throw new AppError('VALIDATION_ERROR', 'Winner is not a player in this match.');
      outcome = { type: 'WIN' as const, winnerUserId: winner.user_id, reason };
    } else outcome = body.outcome;
    return ok(c, await services.settlement.settleMatch({ matchId: id, outcome, source: 'INTERNAL_API', resultProof: body.resultProof ?? null }));
  });

  return r;
}
