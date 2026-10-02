/**
 * REFERENCE EXAMPLE — not one of the 10 platform games and NOT registered in GAME_MODULES.
 * It exists to show (and test) the complete GameModule contract end to end:
 * hidden information (viewFor), server-side result validation, forfeits, draws, disconnects.
 *
 * Rules: two players each pick rock/paper/scissors; same pick = draw; otherwise the usual rules.
 */
import type { GameModule, MatchOutcome } from '@arena/shared';

type Pick = 'rock' | 'paper' | 'scissors';
const BEATS: Record<Pick, Pick> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export interface RpsState {
  picks: Record<string, Pick>;
  players: string[];
  forfeitedBy: string | null;
}

function decide(state: RpsState): MatchOutcome | undefined {
  const [a, b] = state.players;
  if (!a || !b) return undefined;
  if (state.forfeitedBy) return { type: 'WIN', winnerUserId: state.forfeitedBy === a ? b : a, reason: 'FORFEIT' };
  const pa = state.picks[a];
  const pb = state.picks[b];
  if (!pa || !pb) return undefined;
  if (pa === pb) return { type: 'DRAW' };
  return { type: 'WIN', winnerUserId: BEATS[pa] === pb ? a : b, reason: 'NORMAL' };
}

export const rockPaperScissorsModule: GameModule<RpsState> = {
  moduleKey: 'reference-rps',
  version: '1.0.0',
  minPlayers: 2,
  maxPlayers: 2,
  disconnectPolicy: { reconnectWindowMs: 30_000, onTimeout: 'FORFEIT' },

  createRoom: (ctx) => ({ picks: {}, players: ctx.players.map((p) => p.userId), forfeitedBy: null }),
  joinRoom: (state) => ({ state }),
  startMatch: (state) => ({ state, broadcast: [{ kind: 'round_started' }] }),

  handleMessage(state, userId, message) {
    const pick = (message as { pick?: string } | null)?.pick;
    if (pick !== 'rock' && pick !== 'paper' && pick !== 'scissors') return { state, send: [{ userId, message: { kind: 'invalid_move' } }] };
    if (state.picks[userId]) return { state, send: [{ userId, message: { kind: 'already_picked' } }] };
    const next: RpsState = { ...state, picks: { ...state.picks, [userId]: pick } };
    const outcome = decide(next);
    return {
      state: next,
      broadcast: [{ kind: 'player_picked' }],
      persist: outcome ? [{ type: 'ROUND_RESULT', payload: { picks: next.picks } }] : [],
      outcome,
    };
  },

  validateResult(state, outcome) {
    const expected = decide(state);
    if (!expected) return { valid: false, reason: 'No result yet' };
    if (expected.type !== outcome.type) return { valid: false, reason: 'Outcome type mismatch' };
    if (expected.type === 'WIN' && outcome.type === 'WIN' && expected.winnerUserId !== outcome.winnerUserId) return { valid: false, reason: 'Winner mismatch' };
    return { valid: true, proof: JSON.stringify({ picks: state.picks, forfeitedBy: state.forfeitedBy }) };
  },

  handleDisconnect: (state) => ({ state, broadcast: [{ kind: 'opponent_disconnected' }] }),
  handleReconnect: (state) => ({ state, broadcast: [{ kind: 'opponent_reconnected' }] }),
  handleDraw: (state) => ({ state, outcome: { type: 'DRAW' } }),

  handleForfeit(state, userId) {
    const next = { ...state, forfeitedBy: userId };
    return { state: next, persist: [{ type: 'FORFEIT', payload: { userId } }], outcome: decide(next) };
  },

  // hide the opponent's pick until both have picked
  viewFor(state, userId) {
    const done = Object.keys(state.picks).length === 2;
    return { yourPick: state.picks[userId] ?? null, opponentHasPicked: Object.keys(state.picks).some((id) => id !== userId), picks: done ? state.picks : null };
  },
};
