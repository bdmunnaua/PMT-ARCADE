/**
 * DEVELOPMENT SETTLEMENT SIMULATOR — lets you test win / loss / draw / refund flows before any
 * game exists. Triple-guarded:
 *   1. `devOnly` returns 404 whenever ENVIRONMENT=production,
 *   2. callers must be an authenticated admin with the dev.simulator permission,
 *   3. all money still moves exclusively through MatchService + SettlementService + ledger.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { devCreateMatchSchema, devSimulateSchema } from '@arena/shared';
import type { AppEnv } from '../env';
import { AppError, invalidState, notFound } from '../lib/errors';
import { ok, param, parseBody } from '../lib/http';
import { devOnly, requireAdmin, requireUser } from '../middleware';
import type { ResolutionOutcome } from '../services/settlement';

export function devRoutes(auth: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  r.use('*', devOnly, auth, requireUser, requireAdmin('dev.simulator'));

  /** Creates a READY match between existing players (stakes are locked from their real balances). */
  r.post('/matches', async (c) => {
    const body = await parseBody(c, devCreateMatchSchema);
    const s = c.get('services');
    const users = [];
    for (const n of body.playerNumbers) {
      const u = await s.users.findByPlayerNumber(n);
      if (!u) throw new AppError('VALIDATION_ERROR', `Player #${n} does not exist.`);
      users.push(u);
    }
    if (new Set(body.playerNumbers).size !== body.playerNumbers.length) throw new AppError('VALIDATION_ERROR', 'Players must be different.');
    const [first, ...rest] = users;
    const created = await s.matches.create(first!, { gameId: body.gameId, stakeUnits: body.stakeUnits, visibility: 'PRIVATE', maxPlayers: users.length }, `dev-${crypto.randomUUID()}`, { allowDisabledGame: true });
    for (const u of rest) await s.matches.join(u, created.match.id, { allowDisabledGame: true });
    return ok(c, await s.matches.get(created.match.id, null), 201);
  });

  r.post('/matches/:id/start', async (c) => {
    await c.get('services').matches.markPlaying(param(c, 'id'), 'DEV_SIMULATOR', c.get('admin').userId);
    return ok(c, await c.get('services').matches.get(param(c, 'id'), null));
  });

  r.post('/matches/:id/simulate', async (c) => {
    const body = await parseBody(c, devSimulateSchema);
    const s = c.get('services');
    const id = param(c, 'id');
    const match = await s.matchesRepo.find(id);
    if (!match) throw notFound('Match');
    const players = await s.matchesRepo.players(id);
    const byNumber = (n?: number) => players.find((p) => p.player_number === n);

    let outcome: ResolutionOutcome;
    if (body.outcome === 'CANCEL') outcome = { type: 'CANCEL', reason: 'Development simulator: cancelled' };
    else if (body.outcome === 'VOID') outcome = { type: 'VOID', reason: 'Development simulator: server failure' };
    else if (body.outcome === 'DRAW') outcome = { type: 'DRAW' };
    else if (body.outcome === 'FORFEIT') {
      const quitter = byNumber(body.forfeitPlayerNumber);
      if (!quitter) throw new AppError('VALIDATION_ERROR', 'Choose the player who forfeits.');
      const others = players.filter((p) => p.user_id !== quitter.user_id);
      const winner = body.winnerPlayerNumber ? byNumber(body.winnerPlayerNumber) : others.length === 1 ? others[0] : undefined;
      if (!winner || winner.user_id === quitter.user_id) throw new AppError('VALIDATION_ERROR', 'Choose the winner (needed when more than two players).');
      outcome = { type: 'WIN', winnerUserId: winner.user_id, reason: 'FORFEIT' };
    } else {
      const winner = byNumber(body.winnerPlayerNumber);
      if (!winner) throw new AppError('VALIDATION_ERROR', 'Choose the winning player.');
      outcome = { type: 'WIN', winnerUserId: winner.user_id, reason: 'NORMAL' };
    }

    // a simulated result needs a started match (READY → PLAYING), just like a real game server would do
    if (outcome.type !== 'CANCEL' && outcome.type !== 'VOID' && match.status === 'READY') {
      await s.matches.markPlaying(id, 'DEV_SIMULATOR', c.get('admin').userId);
    } else if (outcome.type !== 'CANCEL' && ['CREATED', 'WAITING_FOR_OPPONENT'].includes(match.status)) {
      throw invalidState('The match is not full yet — cancel it instead.');
    }
    const result = await s.settlement.settleMatch({ matchId: id, outcome, source: 'DEV_SIMULATOR', actorId: c.get('admin').userId, resultProof: 'dev-simulator' });
    return ok(c, { result, match: await s.matches.get(id, null) });
  });

  return r;
}
