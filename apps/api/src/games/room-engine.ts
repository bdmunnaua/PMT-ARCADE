/**
 * RoomEngine — the platform side of a live game room, independent of Cloudflare APIs so it can be
 * unit-tested. It hosts one GameModule, tracks presence, applies the module's disconnect policy
 * (reconnect window → forfeit / void / module decision), validates the final outcome with the
 * module, and returns "effects" for the GameRoom Durable Object to carry out (send messages,
 * persist important events, start the match, hand the outcome to the settlement service).
 */
import type { ClientToRoomMessage, GameModule, GamePlayerInfo, MatchOutcome, ModuleResult, PersistableEvent, RoomContext, RoomToClientMessage } from '@arena/shared';

export interface EngineSnapshot<S> {
  matchId: string;
  gameId: string;
  stakeUnits: number;
  players: GamePlayerInfo[];
  state: S;
  started: boolean;
  finished: boolean;
  connected: string[];
  disconnectDeadlines: Record<string, number>;
  outcome: MatchOutcome | null;
  proof: string | null;
  /** module turn timer (absolute ms) */
  moduleTimerAt?: number | null;
}

export interface EngineEffects {
  send: { userId: string; message: RoomToClientMessage }[];
  persist: PersistableEvent[];
  start: boolean;
  outcome: { outcome: MatchOutcome; proof: string } | null;
  alarmAt: number | null;
}

function emptyEffects(): EngineEffects {
  return { send: [], persist: [], start: false, outcome: null, alarmAt: null };
}

export class RoomEngine<S> {
  private constructor(
    private readonly module: GameModule<S>,
    private snap: EngineSnapshot<S>,
    private readonly random: () => number,
  ) {}

  /** 🤖 bot seats are played by the server, so they count as connected from the start. */
  static create<S>(module: GameModule<S>, init: { matchId: string; gameId: string; stakeUnits: number; players: GamePlayerInfo[] }, now: number, random: () => number): RoomEngine<S> {
    const ctx: RoomContext = { ...init, now, random };
    const state = module.createRoom(ctx);
    return new RoomEngine(module, { ...init, state, started: false, finished: false, connected: init.players.filter((p) => p.isBot).map((p) => p.userId), disconnectDeadlines: {}, outcome: null, proof: null, moduleTimerAt: null }, random);
  }

  static restore<S>(module: GameModule<S>, snapshot: EngineSnapshot<S>, random: () => number): RoomEngine<S> {
    return new RoomEngine(module, snapshot, random);
  }

  get snapshot(): EngineSnapshot<S> {
    return this.snap;
  }

  private ctx(now: number): RoomContext {
    return { matchId: this.snap.matchId, gameId: this.snap.gameId, stakeUnits: this.snap.stakeUnits, players: this.snap.players, now, random: this.random };
  }

  private player(userId: string): GamePlayerInfo | undefined {
    return this.snap.players.find((p) => p.userId === userId);
  }

  private presence(): RoomToClientMessage {
    const deadlines = Object.values(this.snap.disconnectDeadlines);
    return {
      t: 'presence',
      players: this.snap.players.map((p) => ({ playerNumber: p.playerNumber, connected: this.snap.connected.includes(p.userId) })),
      reconnectDeadline: deadlines.length ? Math.min(...deadlines) : null,
    };
  }

  private toAll(fx: EngineEffects, message: RoomToClientMessage): void {
    for (const id of this.snap.connected) fx.send.push({ userId: id, message });
  }

  private pushViews(fx: EngineEffects, now?: number): void {
    for (const id of this.snap.connected) fx.send.push({ userId: id, message: { t: 'state', view: this.module.viewFor(this.snap.state, id), now } });
  }

  private nextAlarm(): number | null {
    const d = Object.values(this.snap.disconnectDeadlines);
    if (this.snap.moduleTimerAt && !this.snap.finished) d.push(this.snap.moduleTimerAt);
    return d.length ? Math.min(...d) : null;
  }

  /** Merges a module result into effects; validates any final outcome before accepting it. */
  private apply(fx: EngineEffects, result: ModuleResult<S>, now: number): void {
    this.snap.state = result.state;
    if (result.timerAt !== undefined) this.snap.moduleTimerAt = result.timerAt;
    for (const m of result.broadcast ?? []) this.toAll(fx, { t: 'event', data: m });
    for (const s of result.send ?? []) if (this.snap.connected.includes(s.userId)) fx.send.push({ userId: s.userId, message: { t: 'event', data: s.message } });
    fx.persist.push(...(result.persist ?? []));
    if (result.outcome && !this.snap.finished) {
      const check = this.module.validateResult(this.snap.state, result.outcome, this.ctx(now));
      if (check.valid) {
        this.snap.finished = true;
        this.snap.outcome = result.outcome;
        this.snap.proof = check.proof;
        this.snap.disconnectDeadlines = {};
        this.snap.moduleTimerAt = null;
        fx.outcome = { outcome: result.outcome, proof: check.proof };
        fx.persist.push({ type: 'RESULT_VALIDATED', payload: { outcome: result.outcome } });
        const winner = result.outcome.type === 'WIN' ? this.player(result.outcome.winnerUserId)?.playerNumber ?? null : null;
        this.toAll(fx, { t: 'result', outcome: { type: result.outcome.type, winnerPlayerNumber: winner } });
      } else {
        fx.persist.push({ type: 'RESULT_REJECTED', payload: { outcome: result.outcome, reason: check.reason } });
      }
    }
    this.pushViews(fx, now);
  }

  connect(userId: string, now: number): EngineEffects {
    const fx = emptyEffects();
    const me = this.player(userId);
    if (!me) {
      fx.send.push({ userId, message: { t: 'error', code: 'FORBIDDEN', message: 'You are not a player in this match.' } });
      return fx;
    }
    const wasAway = userId in this.snap.disconnectDeadlines;
    if (!this.snap.connected.includes(userId)) this.snap.connected.push(userId);
    delete this.snap.disconnectDeadlines[userId];
    fx.send.push({ userId, message: { t: 'welcome', matchId: this.snap.matchId, you: me.playerNumber, players: this.snap.players.map((p) => ({ playerNumber: p.playerNumber, connected: this.snap.connected.includes(p.userId) })) } });

    if (this.snap.finished) {
      const winner = this.snap.outcome?.type === 'WIN' ? this.player(this.snap.outcome.winnerUserId)?.playerNumber ?? null : null;
      if (this.snap.outcome) fx.send.push({ userId, message: { t: 'result', outcome: { type: this.snap.outcome.type, winnerPlayerNumber: winner } } });
    } else if (wasAway && this.snap.started) {
      fx.persist.push({ type: 'PLAYER_RECONNECTED', payload: { playerNumber: me.playerNumber } });
      this.apply(fx, this.module.handleReconnect(this.snap.state, userId, this.ctx(now)), now);
    } else if (!this.snap.started) {
      this.apply(fx, this.module.joinRoom(this.snap.state, me, this.ctx(now)), now);
      if (this.snap.players.every((p) => this.snap.connected.includes(p.userId))) {
        this.snap.started = true;
        fx.start = true;
        fx.persist.push({ type: 'ALL_PLAYERS_CONNECTED', payload: {} });
        this.apply(fx, this.module.startMatch(this.snap.state, this.ctx(now)), now);
      }
    } else {
      this.pushViews(fx, now);
    }
    this.toAll(fx, this.presence());
    fx.alarmAt = this.nextAlarm();
    return fx;
  }

  disconnect(userId: string, now: number): EngineEffects {
    const fx = emptyEffects();
    const me = this.player(userId);
    this.snap.connected = this.snap.connected.filter((id) => id !== userId);
    if (!me || this.snap.finished) return fx;
    if (this.snap.started) {
      this.snap.disconnectDeadlines[userId] = now + this.module.disconnectPolicy.reconnectWindowMs;
      fx.persist.push({ type: 'PLAYER_DISCONNECTED', payload: { playerNumber: me.playerNumber, reconnectDeadline: this.snap.disconnectDeadlines[userId] } });
      this.apply(fx, this.module.handleDisconnect(this.snap.state, userId, { ...this.ctx(now), expired: false }), now);
    }
    this.toAll(fx, this.presence());
    fx.alarmAt = this.nextAlarm();
    return fx;
  }

  message(userId: string, raw: unknown, now: number): EngineEffects {
    const fx = emptyEffects();
    if (!this.player(userId)) return fx;
    const msg = raw as ClientToRoomMessage;
    if (msg?.t === 'ping') {
      fx.send.push({ userId, message: { t: 'pong' } });
      return fx;
    }
    if (this.snap.finished) {
      fx.send.push({ userId, message: { t: 'error', code: 'MATCH_FINISHED', message: 'The match is over.' } });
      return fx;
    }
    if (!this.snap.started) {
      fx.send.push({ userId, message: { t: 'error', code: 'NOT_STARTED', message: 'Waiting for all players to connect.' } });
      return fx;
    }
    if (msg?.t === 'forfeit') {
      fx.persist.push({ type: 'PLAYER_FORFEITED', payload: { playerNumber: this.player(userId)?.playerNumber } });
      this.apply(fx, this.module.handleForfeit(this.snap.state, userId, this.ctx(now)), now);
    } else if (msg?.t === 'move') {
      this.apply(fx, this.module.handleMessage(this.snap.state, userId, msg.data, this.ctx(now)), now);
    } else {
      fx.send.push({ userId, message: { t: 'error', code: 'BAD_MESSAGE', message: 'Unknown message type.' } });
    }
    fx.alarmAt = this.nextAlarm();
    return fx;
  }

  /** Module timers and reconnect windows that expired. */
  alarm(now: number): EngineEffects {
    const fx = emptyEffects();
    const timerAt = this.snap.moduleTimerAt;
    if (timerAt && timerAt <= now && this.snap.started && !this.snap.finished && this.module.handleTimeout) {
      this.snap.moduleTimerAt = null;
      this.apply(fx, this.module.handleTimeout(this.snap.state, this.ctx(now)), now);
    }
    for (const [userId, deadline] of Object.entries(this.snap.disconnectDeadlines)) {
      if (deadline > now || this.snap.finished) continue;
      delete this.snap.disconnectDeadlines[userId];
      const playerNumber = this.player(userId)?.playerNumber;
      fx.persist.push({ type: 'RECONNECT_WINDOW_EXPIRED', payload: { playerNumber, policy: this.module.disconnectPolicy.onTimeout } });
      const policy = this.module.disconnectPolicy.onTimeout;
      if (policy === 'FORFEIT') this.apply(fx, this.module.handleForfeit(this.snap.state, userId, this.ctx(now)), now);
      else if (policy === 'VOID') this.apply(fx, { state: this.snap.state, outcome: { type: 'VOID', reason: `Player #${playerNumber} did not reconnect` } }, now);
      else this.apply(fx, this.module.handleDisconnect(this.snap.state, userId, { ...this.ctx(now), expired: true }), now);
    }
    if (!fx.outcome) this.toAll(fx, this.presence());
    fx.alarmAt = this.nextAlarm();
    return fx;
  }
}
