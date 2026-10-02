/**
 * CrashGame — one Durable Object per crash game (Aviator). It owns the round timeline:
 *
 *   BETTING (7 s) ──► FLYING (multiplier = e^(0.00006·t)) ──► CRASHED (4 s pause) ──► next round
 *
 * The crash point is fixed in D1 when the round opens (provably fair). Cash-outs are timed by
 * THIS object's clock — the browser only asks; it never states a multiplier. Every money
 * movement goes through CrashService (bet lock) and SettlementService (win / loss / refund).
 * All handlers run inside blockConcurrencyWhile, so round transitions, bets and cash-outs are
 * strictly serialised. Rounds only run while someone is connected (no idle cost).
 */
import { DurableObject } from 'cloudflare:workers';
import { CRASH_PAUSE_MS, multiplierAt, timeToReach } from '@arena/games/aviator';
import { tokensToUnits, type CrashStateDto } from '@arena/shared';
import type { Env } from '../env';
import { AppError } from '../lib/errors';
import { DurableObjectPublisher, NoopPublisher } from '../realtime/publisher';
import { createServices } from '../services/container';
import { toRoundDto, type CrashRoundRow } from '../services/crash';

interface Mem {
  gameId: string;
  roundId: string | null;
  phase: 'BETTING' | 'FLYING' | 'CRASHED' | 'IDLE';
  crashX100: number;
  bettingEndsAt: number;
  startedAt: number | null;
  crashAt: number | null;
  crashedAt: number | null;
}

type Reply = { status: number; body: unknown };

export class CrashGame extends DurableObject<Env> {
  private mem: Mem | null = null;

  private services() {
    const publisher = this.env.REALTIME ? new DurableObjectPublisher(this.env.REALTIME, (p) => this.ctx.waitUntil(p)) : new NoopPublisher();
    return createServices(this.env, { requestId: `crash-${crypto.randomUUID()}`, ip: null, userAgent: 'crash-game', country: null }, { publisher });
  }

  private async load(gameId?: string): Promise<Mem> {
    if (!this.mem) this.mem = (await this.ctx.storage.get<Mem>('mem')) ?? null;
    if (!this.mem) {
      if (!gameId) throw new Error('crash game not initialised');
      this.mem = { gameId, roundId: null, phase: 'IDLE', crashX100: 100, bettingEndsAt: 0, startedAt: null, crashAt: null, crashedAt: null };
    }
    return this.mem;
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put('mem', this.mem);
    const m = this.mem!;
    const next =
      m.phase === 'BETTING' ? m.bettingEndsAt : m.phase === 'FLYING' ? await this.nextFlightEvent(m) : m.phase === 'CRASHED' ? (m.crashedAt ?? Date.now()) + CRASH_PAUSE_MS : null;
    if (next) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  private async nextFlightEvent(m: Mem): Promise<number> {
    let next = m.crashAt!;
    for (const b of await this.services().crash.activeBets(m.roundId!)) {
      if (b.auto_cashout_x100 && b.auto_cashout_x100 < m.crashX100) next = Math.min(next, m.startedAt! + timeToReach(b.auto_cashout_x100));
    }
    return Math.max(next, Date.now());
  }

  private broadcast(message: unknown): void {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        /* closing */
      }
    }
  }

  private async publicRound(): Promise<void> {
    const s = this.services();
    const row = this.mem?.roundId ? await s.crash.round(this.mem.roundId) : null;
    this.broadcast({ t: 'round', serverNow: Date.now(), round: row ? toRoundDto(row) : null });
    if (row) this.broadcast({ t: 'bets', bets: await s.crash.roundBets(row, null) });
  }

  /** Advances the round timeline as far as the clock allows. */
  private async tick(): Promise<void> {
    const m = this.mem!;
    const s = this.services();
    const now = Date.now();
    if (m.phase === 'IDLE' || (m.phase === 'CRASHED' && now >= (m.crashedAt ?? 0) + CRASH_PAUSE_MS)) {
      if (this.ctx.getWebSockets().length === 0) {
        m.phase = 'IDLE';
        return;
      }
      const game = await s.games.get(m.gameId);
      if (!game.enabled || game.maintenanceMode) {
        m.phase = 'IDLE';
        return;
      }
      const row = await s.crash.createRound(m.gameId);
      Object.assign(m, { roundId: row.id, phase: 'BETTING', crashX100: row.crash_x100!, bettingEndsAt: row.betting_ends_at, startedAt: null, crashAt: null, crashedAt: null });
      await this.publicRound();
      return;
    }
    if (m.phase === 'BETTING' && now >= m.bettingEndsAt) {
      m.phase = 'FLYING';
      m.startedAt = now;
      m.crashAt = now + timeToReach(m.crashX100);
      await s.crash.markFlying(m.roundId!, now);
      await this.publicRound();
    }
    if (m.phase === 'FLYING') {
      const elapsedX = multiplierAt(now - m.startedAt!);
      let changed = false;
      for (const b of await s.crash.activeBets(m.roundId!)) {
        if (b.auto_cashout_x100 && b.auto_cashout_x100 < m.crashX100 && b.auto_cashout_x100 <= elapsedX) {
          await s.settlement.settleCrashBet(b.id, { type: 'WIN', x100: b.auto_cashout_x100 }).catch(() => undefined);
          changed = true;
        }
      }
      if (now >= m.crashAt!) {
        for (const b of await s.crash.activeBets(m.roundId!)) await s.settlement.settleCrashBet(b.id, { type: 'LOSS' }).catch(() => undefined);
        m.phase = 'CRASHED';
        m.crashedAt = now;
        await s.crash.markCrashed(m.roundId!, now);
        const row = await s.crash.round(m.roundId!);
        this.broadcast({ t: 'crash', serverNow: now, round: row ? toRoundDto(row) : null });
        if (row) this.broadcast({ t: 'bets', bets: await s.crash.roundBets(row, null) });
      } else if (changed) {
        const row = await s.crash.round(m.roundId!);
        if (row) this.broadcast({ t: 'bets', bets: await s.crash.roundBets(row, null) });
      }
    }
  }

  /**
   * Serialises every operation. blockConcurrencyWhile resets the object when its callback throws,
   * so errors (e.g. a refused bet) are carried out as values and re-thrown after the block.
   */
  private async run<T>(gameId: string | undefined, fn: () => Promise<T>): Promise<T> {
    const out = await this.ctx.blockConcurrencyWhile(async (): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> => {
      try {
        await this.load(gameId);
        try {
          await this.tick();
          return { ok: true, value: await fn() };
        } finally {
          await this.save();
        }
      } catch (error) {
        return { ok: false, error };
      }
    });
    if (!out.ok) throw out.error;
    return out.value;
  }

  private async state(userId: string): Promise<CrashStateDto> {
    const s = this.services();
    const m = this.mem!;
    const [settings, game, row] = await Promise.all([s.settings.get(), s.games.get(m.gameId), m.roundId ? s.crash.round(m.roundId) : Promise.resolve(null)]);
    const bets = row ? await s.crash.roundBets(row, userId) : [];
    return {
      gameId: m.gameId,
      serverNow: Date.now(),
      round: row ? toRoundDto(row) : null,
      myBets: bets.filter((b) => b.isYou),
      bets,
      history: (await s.crash.history(m.gameId, 20)).map((r) => ({ roundNumber: r.roundNumber, crashX100: r.crashX100! })),
      limits: {
        minBetUnits: Math.max(game.minimumStakeUnits, tokensToUnits(settings.minimum_match_stake)),
        maxBetUnits: Math.min(game.maximumStakeUnits, tokensToUnits(settings.maximum_match_stake)),
        maxX100: settings.crash_max_multiplier_x100,
        maxProfitUnits: tokensToUnits(settings.crash_max_profit_tokens),
      },
    };
  }

  private async bet(userId: string, body: { amountUnits: number; autoCashoutX100?: number; panel?: 1 | 2; clientKey: string }): Promise<unknown> {
    const s = this.services();
    const m = this.mem!;
    if (m.phase !== 'BETTING' || !m.roundId) throw new AppError('ROUND_CLOSED');
    const user = await s.users.findById(userId);
    if (!user) throw new AppError('PROFILE_REQUIRED');
    const round = (await s.crash.round(m.roundId)) as CrashRoundRow;
    const bet = await s.crash.placeBet(user, round, body, body.clientKey);
    this.broadcast({ t: 'bets', bets: await s.crash.roundBets(round, null) });
    return { betId: bet.id, panel: bet.panel, stakeUnits: bet.stake_units, autoCashoutX100: bet.auto_cashout_x100 };
  }

  private async cashout(userId: string, panel: 1 | 2): Promise<unknown> {
    const s = this.services();
    const m = this.mem!;
    if (m.phase !== 'FLYING' || !m.roundId || !m.startedAt || !m.crashAt) throw new AppError('CASHOUT_TOO_LATE');
    const bet = await s.crash.betFor(m.roundId, userId, panel);
    if (!bet) throw new AppError('NOT_FOUND', 'You have no bet on this panel in this round.');
    if (bet.status !== 'ACTIVE') throw new AppError('ALREADY_PROCESSED', 'This bet is already settled.');
    const now = Date.now();
    if (now >= m.crashAt) throw new AppError('CASHOUT_TOO_LATE');
    let x100 = multiplierAt(now - m.startedAt);
    if (bet.auto_cashout_x100 && bet.auto_cashout_x100 <= x100) x100 = bet.auto_cashout_x100;
    if (x100 >= m.crashX100) throw new AppError('CASHOUT_TOO_LATE');
    const res = await s.settlement.settleCrashBet(bet.id, { type: 'WIN', x100 });
    const round = await s.crash.round(m.roundId);
    if (round) this.broadcast({ t: 'bets', bets: await s.crash.roundBets(round, null) });
    return { x100, panel, payoutUnits: res.payoutUnits };
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = request.headers.get('x-arena-user') ?? '';
    const gameId = request.headers.get('x-arena-game') ?? undefined;
    const reply = (r: Reply) => new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    try {
      if (url.pathname === '/connect') {
        if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1], [userId]);
        await this.run(gameId, async () => undefined); // starts a round if the game was idle
        pair[1].send(JSON.stringify({ t: 'hello', serverNow: Date.now() }));
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      if (url.pathname === '/state') return reply({ status: 200, body: { data: await this.run(gameId, () => this.state(userId)) } });
      if (url.pathname === '/bet' && request.method === 'POST') {
        const body = (await request.json()) as { amountUnits: number; autoCashoutX100?: number; clientKey: string };
        return reply({ status: 200, body: { data: await this.run(gameId, () => this.bet(userId, body)) } });
      }
      if (url.pathname === '/cashout' && request.method === 'POST') {
        const { panel } = (await request.json()) as { panel?: 1 | 2 };
        return reply({ status: 200, body: { data: await this.run(gameId, () => this.cashout(userId, panel === 2 ? 2 : 1)) } });
      }
      return reply({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } });
    } catch (e) {
      if (e instanceof AppError) return reply({ status: e.status, body: { error: { code: e.code, message: e.message, details: e.details } } });
      console.error('crash game error', e instanceof Error ? e.message : e);
      return reply({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } } });
    }
  }

  override async alarm(): Promise<void> {
    if (!(await this.ctx.storage.get('mem'))) return;
    await this.run(undefined, async () => undefined);
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') ws.send('pong');
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* closed */
    }
  }
}
