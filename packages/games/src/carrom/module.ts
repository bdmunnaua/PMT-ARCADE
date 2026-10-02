import type { GameModule, MatchOutcome, ModuleResult } from '@arena/shared';
import { baselineY, BASELINE } from './physics';
import { forfeit, newCarrom, passTurn, shoot, type CarromState } from './rules';

export const CARROM_SHOT_MS = 30_000;
export const CARROM_MAX_TIMEOUTS = 3;

export interface CarromRoomState extends CarromState {
  deadline: number | null;
}

function outcomeOf(s: CarromState): MatchOutcome | undefined {
  if (s.phase !== 'OVER') return undefined;
  if (s.draw || s.winner === null) return { type: 'DRAW' };
  return { type: 'WIN', winnerUserId: s.players[s.winner]!, reason: 'NORMAL' };
}

function schedule(s: CarromState, now: number, persist: { type: string; payload: unknown }[] = []): ModuleResult<CarromRoomState> {
  const deadline = s.phase === 'OVER' ? null : now + CARROM_SHOT_MS;
  const out = [...persist];
  if (s.phase === 'OVER') out.push({ type: 'CARROM_FINISHED', payload: { pocketedBy: s.pocketedBy, queen: s.queen, shots: s.shots } });
  return { state: { ...s, deadline }, timerAt: deadline, outcome: outcomeOf(s), persist: out };
}

export const carromModule: GameModule<CarromRoomState> = {
  moduleKey: 'carrom',
  version: '1.0.0',
  minPlayers: 2,
  maxPlayers: 2,
  disconnectPolicy: { reconnectWindowMs: 60_000, onTimeout: 'FORFEIT' },

  createRoom: (ctx) => ({ ...newCarrom([...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.userId)), deadline: null }),
  joinRoom: (state) => ({ state }),
  startMatch: (state, ctx) => schedule(state, ctx.now),

  handleMessage(state, userId, message, ctx) {
    const player = state.players.indexOf(userId);
    const m = message as { action?: string; x?: number; angle?: number; power?: number } | null;
    if (m?.action !== 'shoot') return { state, send: [{ userId, message: { error: 'Unknown action' } }] };
    try {
      const next = shoot(state, player, Number(m.x), Number(m.angle), Number(m.power));
      next.timeouts[player] = 0;
      const shot = next.lastShot!;
      const persist = shot.pocketed.length || shot.foul ? [{ type: 'SHOT', payload: { player, pocketed: shot.pocketed, foul: shot.foul, returned: shot.returned } }] : [];
      return schedule(next, ctx.now, persist);
    } catch (e) {
      return { state, send: [{ userId, message: { error: (e as Error).message } }] };
    }
  },

  handleTimeout(state, ctx) {
    if (state.phase === 'OVER') return { state, timerAt: null };
    const player = state.turn;
    const timeouts = state.timeouts.map((t, i) => (i === player ? t + 1 : t));
    const next = timeouts[player]! >= CARROM_MAX_TIMEOUTS ? forfeit({ ...state, timeouts }, player) : passTurn({ ...state, timeouts });
    return schedule(next, ctx.now);
  },

  validateResult(state, outcome) {
    const expected = outcomeOf(state);
    if (!expected || expected.type !== outcome.type) return { valid: false, reason: 'Outcome mismatch' };
    if (expected.type === 'WIN' && outcome.type === 'WIN' && expected.winnerUserId !== outcome.winnerUserId) return { valid: false, reason: 'Winner mismatch' };
    return { valid: true, proof: JSON.stringify({ pocketedBy: state.pocketedBy, queen: state.queen, shots: state.shots }) };
  },

  handleDisconnect: (state) => ({ state }),
  handleReconnect: (state) => ({ state }),
  handleDraw: (state) => ({ state }),
  handleForfeit: (state, userId, ctx) => schedule(forfeit(state, state.players.indexOf(userId)), ctx.now, [{ type: 'CARROM_FORFEIT', payload: { player: state.players.indexOf(userId) } }]),

  viewFor: (state, userId) => ({
    you: state.players.indexOf(userId),
    colors: state.colors,
    coins: state.coins,
    pocketedBy: state.pocketedBy,
    queen: state.queen,
    turn: state.turn,
    phase: state.phase,
    deadline: state.deadline,
    lastShot: state.lastShot,
    shots: state.shots,
    winner: state.winner,
    draw: state.draw,
    baseline: { min: BASELINE.min, max: BASELINE.max, y: [baselineY(0), baselineY(1)] },
  }),
};
