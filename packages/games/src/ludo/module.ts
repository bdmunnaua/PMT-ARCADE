import type { GameModule, MatchOutcome, ModuleResult, RoomContext } from '@arena/shared';
import { autoToken, eliminate, move, newLudo, roll, type LudoState } from './rules';

export const LUDO_ROLL_MS = 12_000;
export const LUDO_MOVE_MS = 15_000;
/** consecutive missed turns before a player is removed from the game */
export const LUDO_MAX_TIMEOUTS = 3;

export interface LudoRoomState extends LudoState {
  deadline: number | null;
}

const outcomeOf = (s: LudoRoomState): MatchOutcome | undefined => (s.winner !== null ? { type: 'WIN', winnerUserId: s.players[s.winner]!, reason: 'NORMAL' } : undefined);

function withDeadline(s: LudoState, now: number): ModuleResult<LudoRoomState> {
  const deadline = s.phase === 'OVER' ? null : now + (s.phase === 'ROLL' ? LUDO_ROLL_MS : LUDO_MOVE_MS);
  const state: LudoRoomState = { ...s, deadline };
  return { state, timerAt: deadline, outcome: outcomeOf(state), persist: s.phase === 'OVER' ? [{ type: 'LUDO_FINISHED', payload: { winner: s.winner, tokens: s.tokens } }] : [] };
}

const die = (ctx: RoomContext) => 1 + Math.floor(ctx.random() * 6);

export const ludoModule: GameModule<LudoRoomState> = {
  moduleKey: 'ludo',
  version: '1.0.0',
  minPlayers: 2,
  maxPlayers: 4,
  // idle/disconnected players are auto-played by the turn timer and removed after 3 missed turns
  disconnectPolicy: { reconnectWindowMs: 60_000, onTimeout: 'MODULE' },

  createRoom: (ctx) => ({ ...newLudo([...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.userId)), deadline: null }),
  joinRoom: (state) => ({ state }),
  startMatch: (state, ctx) => withDeadline(state, ctx.now),

  handleMessage(state, userId, message, ctx) {
    const player = state.players.indexOf(userId);
    const m = message as { action?: string; token?: number } | null;
    try {
      let next: LudoState;
      if (m?.action === 'roll') next = roll(state, player, die(ctx));
      else if (m?.action === 'move' && typeof m.token === 'number') next = move(state, player, m.token);
      else return { state, send: [{ userId, message: { error: 'Unknown action' } }] };
      next.timeouts[player] = 0;
      return withDeadline(next, ctx.now);
    } catch (e) {
      return { state, send: [{ userId, message: { error: (e as Error).message } }] };
    }
  },

  handleTimeout(state, ctx) {
    if (state.phase === 'OVER') return { state, timerAt: null };
    const player = state.turn;
    let next: LudoState = { ...state, timeouts: state.timeouts.map((t, i) => (i === player ? t + 1 : t)) };
    if (next.timeouts[player]! >= LUDO_MAX_TIMEOUTS) next = eliminate(next, player);
    else if (next.phase === 'ROLL') next = roll(next, player, die(ctx));
    else next = move(next, player, autoToken(next));
    return withDeadline(next, ctx.now);
  },

  validateResult(state, outcome) {
    if (state.winner === null || outcome.type !== 'WIN') return { valid: false, reason: 'No Ludo winner yet' };
    if (outcome.winnerUserId !== state.players[state.winner]) return { valid: false, reason: 'Winner mismatch' };
    return { valid: true, proof: JSON.stringify({ tokens: state.tokens, eliminated: state.eliminated }) };
  },

  handleDisconnect: (state) => ({ state }),
  handleReconnect: (state) => ({ state }),
  handleDraw: (state) => ({ state }),
  handleForfeit(state, userId, ctx) {
    const next = eliminate(state, state.players.indexOf(userId));
    const r = withDeadline(next, ctx.now);
    return { ...r, persist: [{ type: 'LUDO_FORFEIT', payload: { player: state.players.indexOf(userId) } }, ...(r.persist ?? [])] };
  },

  viewFor: (state, userId) => ({ ...state, you: state.players.indexOf(userId) }),
};
