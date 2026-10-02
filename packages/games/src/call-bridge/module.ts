import type { GameModule, MatchOutcome, ModuleResult, RoomContext } from '@arena/shared';
import { sortHand, type Card } from '../common/cards';
import { autoBid, autoCard, bid, CB_RANKS, deal, forfeit, legalCards, newCallBridge, play, type CallBridgeState } from './rules';

export const CB_TURN_MS = 20_000;
export const CB_ROUND_PAUSE_MS = 5_000;
const FORFEITED_TURN_MS = 800;
/** after this many consecutive timeouts the player is auto-played instantly for the rest of the game */
export const CB_MAX_TIMEOUTS = 3;

export interface CallBridgeRoomState extends CallBridgeState {
  deadline: number | null;
}

function outcomeOf(s: CallBridgeState): MatchOutcome | undefined {
  if (s.phase !== 'OVER') return undefined;
  if (s.winner !== null) return { type: 'WIN', winnerUserId: s.players[s.winner]!, reason: 'NORMAL' };
  return { type: 'DRAW' };
}

function schedule(s: CallBridgeState, now: number, extraPersist: { type: string; payload: unknown }[] = []): ModuleResult<CallBridgeRoomState> {
  let deadline: number | null = null;
  if (s.phase === 'ROUND_END') deadline = now + CB_ROUND_PAUSE_MS;
  else if (s.phase === 'BIDDING' || s.phase === 'PLAYING') deadline = now + (s.forfeited[s.turn] || s.timeouts[s.turn]! >= CB_MAX_TIMEOUTS ? FORFEITED_TURN_MS : CB_TURN_MS);
  const state: CallBridgeRoomState = { ...s, deadline };
  const persist = [...extraPersist];
  if (s.phase === 'OVER') persist.push({ type: 'CALL_BRIDGE_FINISHED', payload: { scores: s.scores, history: s.history } });
  return { state, timerAt: deadline, outcome: outcomeOf(s), persist };
}

function act(s: CallBridgeState, ctx: RoomContext): CallBridgeState {
  if (s.phase === 'ROUND_END') return deal(s, ctx.random);
  if (s.phase === 'BIDDING') return bid(s, s.turn, autoBid(s, s.turn));
  if (s.phase === 'PLAYING') return play(s, s.turn, autoCard(s, s.turn));
  return s;
}

export const callBridgeModule: GameModule<CallBridgeRoomState> = {
  moduleKey: 'call-bridge',
  version: '1.0.0',
  minPlayers: 4,
  maxPlayers: 4,
  disconnectPolicy: { reconnectWindowMs: 90_000, onTimeout: 'MODULE' },

  createRoom: (ctx) => ({ ...newCallBridge([...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.userId)), deadline: null }),
  joinRoom: (state) => ({ state }),
  startMatch: (state, ctx) => schedule(deal(state, ctx.random), ctx.now),

  handleMessage(state, userId, message, ctx) {
    const player = state.players.indexOf(userId);
    const m = message as { action?: string; call?: number; card?: Card } | null;
    try {
      let next: CallBridgeState;
      if (m?.action === 'bid' && typeof m.call === 'number') next = bid(state, player, m.call);
      else if (m?.action === 'play' && typeof m.card === 'string') next = play(state, player, m.card);
      else return { state, send: [{ userId, message: { error: 'Unknown action' } }] };
      next.timeouts[player] = 0;
      return schedule(next, ctx.now, m.action === 'bid' ? [{ type: 'CALL', payload: { player, call: m.call, round: next.round } }] : []);
    } catch (e) {
      return { state, send: [{ userId, message: { error: (e as Error).message } }] };
    }
  },

  handleTimeout(state, ctx) {
    if (state.phase === 'OVER') return { state, timerAt: null };
    const s: CallBridgeState = { ...state, timeouts: [...state.timeouts] };
    if (s.phase === 'BIDDING' || s.phase === 'PLAYING') s.timeouts[s.turn]! += 1;
    return schedule(act(s, ctx), ctx.now);
  },

  validateResult(state, outcome) {
    const expected = outcomeOf(state);
    if (!expected) return { valid: false, reason: 'Game not finished' };
    if (expected.type !== outcome.type || (expected.type === 'WIN' && outcome.type === 'WIN' && expected.winnerUserId !== outcome.winnerUserId)) return { valid: false, reason: 'Outcome mismatch' };
    return { valid: true, proof: JSON.stringify({ scores: state.scores, history: state.history }) };
  },

  handleDisconnect: (state) => ({ state }),
  handleReconnect: (state) => ({ state }),
  handleDraw: (state) => ({ state }),
  handleForfeit(state, userId, ctx) {
    const player = state.players.indexOf(userId);
    return schedule(forfeit(state, player), ctx.now, [{ type: 'CALL_BRIDGE_FORFEIT', payload: { player } }]);
  },

  viewFor(state, userId) {
    const you = state.players.indexOf(userId);
    return {
      you,
      round: state.round,
      rounds: 5,
      dealer: state.dealer,
      phase: state.phase,
      turn: state.turn,
      deadline: state.deadline,
      hand: you >= 0 ? sortHand(state.hands[you]!, CB_RANKS) : [],
      handCounts: state.hands.map((h) => h.length),
      legal: you >= 0 && state.turn === you && state.phase === 'PLAYING' ? legalCards(state, you) : [],
      bids: state.bids,
      tricksWon: state.tricksWon,
      trick: state.trick,
      lastTrick: state.lastTrick,
      scores: state.scores,
      history: state.history,
      forfeited: state.forfeited,
      winner: state.winner,
      draw: state.draw,
    };
  },
};
