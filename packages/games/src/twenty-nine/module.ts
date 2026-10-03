import type { GameModule, MatchOutcome, ModuleResult, RoomContext } from '@arena/shared';
import { sortHand, type Card } from '../common/cards';
import {
  autoBid,
  autoCard,
  autoTrump,
  canReveal,
  canShowPair,
  chooseTrump,
  deal,
  forfeitTeam,
  legalCards,
  mustBid,
  newTwentyNine,
  placeBid,
  playCard,
  reveal,
  showPair,
  teamOf,
  TN_RANKS,
  type TwentyNineState,
} from './rules';

export const TN_TURN_MS = 20_000;
export const TN_HAND_PAUSE_MS = 5_000;
export const TN_MAX_TIMEOUTS = 3;
const FAST_MS = 800;

/** a 🤖 bot acts after this pause, like a person would */
export const TN_BOT_MS = 1_200;

export interface TwentyNineRoomState extends TwentyNineState {
  deadline: number | null;
  /** seats played by a 🤖 bot (absent in rooms created before bots existed) */
  bots?: boolean[];
}

function outcomeOf(s: TwentyNineState): MatchOutcome | undefined {
  if (s.phase !== 'OVER') return undefined;
  if (s.draw || s.winnerTeam === null) return { type: 'DRAW' };
  const [a, b] = [s.winnerTeam, s.winnerTeam + 2];
  return { type: 'WIN', winnerUserId: s.players[a]!, teammateUserIds: [s.players[b]!], reason: 'NORMAL' };
}

function schedule(s: TwentyNineState & { bots?: boolean[] }, now: number, persist: { type: string; payload: unknown }[] = []): ModuleResult<TwentyNineRoomState> {
  let deadline: number | null = null;
  if (s.phase === 'HAND_END') deadline = now + TN_HAND_PAUSE_MS;
  else if (s.phase !== 'OVER') deadline = now + (s.bots?.[s.turn] ? TN_BOT_MS : s.timeouts[s.turn]! >= TN_MAX_TIMEOUTS ? FAST_MS : TN_TURN_MS);
  const out = [...persist];
  if (s.phase === 'OVER') out.push({ type: 'TWENTY_NINE_FINISHED', payload: { gameScore: s.gameScore, history: s.history } });
  return { state: { ...s, deadline }, timerAt: deadline, outcome: outcomeOf(s), persist: out };
}

function auto(s: TwentyNineState, ctx: RoomContext): TwentyNineState {
  switch (s.phase) {
    case 'HAND_END':
      return deal(s, ctx.random);
    case 'BIDDING':
      return placeBid(s, s.turn, autoBid(s, s.turn));
    case 'TRUMP':
      return chooseTrump(s, s.turn, autoTrump(s, s.turn));
    case 'PLAYING': {
      const next = canShowPair(s, s.turn) ? showPair(s, s.turn) : s;
      return playCard(next, next.turn, autoCard(next, next.turn));
    }
    default:
      return s;
  }
}

export const twentyNineModule: GameModule<TwentyNineRoomState> = {
  moduleKey: 'twenty-nine',
  version: '1.0.0',
  minPlayers: 4,
  maxPlayers: 4,
  disconnectPolicy: { reconnectWindowMs: 90_000, onTimeout: 'MODULE' },

  createRoom: (ctx) => {
    const seated = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const bots = seated.map((p) => p.isBot === true);
    return { ...newTwentyNine(seated.map((p) => p.userId)), deadline: null, ...(bots.some(Boolean) ? { bots } : {}) };
  },
  joinRoom: (state) => ({ state }),
  startMatch: (state, ctx) => schedule(deal(state, ctx.random), ctx.now),

  handleMessage(state, userId, message, ctx) {
    const player = state.players.indexOf(userId);
    const m = message as { action?: string; bid?: number | null; card?: Card } | null;
    try {
      let next: TwentyNineState;
      const persist: { type: string; payload: unknown }[] = [];
      switch (m?.action) {
        case 'bid':
          next = placeBid(state, player, typeof m.bid === 'number' ? m.bid : null);
          persist.push({ type: 'BID', payload: { player, bid: m.bid ?? null, hand: state.hand } });
          break;
        case 'trump':
          next = chooseTrump(state, player, m.card as Card);
          break;
        case 'reveal':
          next = reveal(state, player);
          persist.push({ type: 'TRUMP_REVEALED', payload: { player, trump: state.trump, hand: state.hand } });
          return { ...schedule(next, ctx.now, persist), broadcast: [{ kind: 'trump_revealed', by: player, trump: state.trump }] };
        case 'pair':
          next = showPair(state, player);
          persist.push({ type: 'PAIR_SHOWN', payload: { player, target: next.target } });
          // showing a pair does not change whose turn it is or the running timer
          return { state: { ...next, deadline: state.deadline }, persist };
        case 'play':
          next = playCard(state, player, m.card as Card);
          break;
        default:
          return { state, send: [{ userId, message: { error: 'Unknown action' } }] };
      }
      next.timeouts[player] = 0;
      return schedule(next, ctx.now, persist);
    } catch (e) {
      return { state, send: [{ userId, message: { error: (e as Error).message } }] };
    }
  },

  handleTimeout(state, ctx) {
    if (state.phase === 'OVER') return { state, timerAt: null };
    const s: TwentyNineRoomState = { ...state, timeouts: [...state.timeouts] };
    // a 🤖 bot's turn is played by the server and never counts as a missed turn
    if (s.phase !== 'HAND_END' && !s.bots?.[s.turn]) s.timeouts[s.turn]! += 1;
    return schedule(auto(s, ctx), ctx.now);
  },

  validateResult(state, outcome) {
    const expected = outcomeOf(state);
    if (!expected || expected.type !== outcome.type) return { valid: false, reason: 'Outcome mismatch' };
    if (expected.type === 'WIN' && outcome.type === 'WIN') {
      const a = [expected.winnerUserId, ...(expected.teammateUserIds ?? [])].sort().join();
      const b = [outcome.winnerUserId, ...(outcome.teammateUserIds ?? [])].sort().join();
      if (a !== b) return { valid: false, reason: 'Winners mismatch' };
    }
    return { valid: true, proof: JSON.stringify({ gameScore: state.gameScore, history: state.history }) };
  },

  handleDisconnect: (state) => ({ state }),
  handleReconnect: (state) => ({ state }),
  handleDraw: (state) => ({ state }),
  handleForfeit: (state, userId, ctx) => schedule(forfeitTeam(state, state.players.indexOf(userId)), ctx.now, [{ type: 'TEAM_FORFEIT', payload: { player: state.players.indexOf(userId) } }]),

  viewFor(state, userId) {
    const you = state.players.indexOf(userId);
    const seesTrump = state.trumpRevealed || (you >= 0 && you === state.bidder);
    const yourTurn = you >= 0 && state.turn === you;
    return {
      you,
      yourTeam: you >= 0 ? teamOf(you) : null,
      hand: you >= 0 ? sortHand(state.hands[you]!, TN_RANKS) : [],
      handCounts: state.hands.map((h) => h.length),
      handNumber: state.hand,
      dealer: state.dealer,
      phase: state.phase,
      turn: state.turn,
      deadline: state.deadline,
      bid: state.bid,
      bidder: state.bidder,
      passed: state.passed,
      bidLog: state.bidLog,
      mustBid: yourTurn && state.phase === 'BIDDING' ? mustBid(state, you) : false,
      trump: seesTrump ? state.trump : null,
      trumpChosen: state.trump !== null,
      /** the face-down card itself — only the bidder sees it */
      trumpCard: you >= 0 && you === state.bidder ? state.trumpCard : null,
      trumpFaceDown: state.trumpCard !== null,
      trumpRevealed: state.trumpRevealed,
      target: state.target,
      pairShown: state.pairShown,
      trick: state.trick,
      lastTrick: state.lastTrick,
      legal: yourTurn && state.phase === 'PLAYING' ? legalCards(state, you) : [],
      canReveal: canReveal(state, you),
      canShowPair: you >= 0 && canShowPair(state, you),
      teamPoints: state.teamPoints,
      gameScore: state.gameScore,
      history: state.history,
      winnerTeam: state.winnerTeam,
      draw: state.draw,
    };
  },
};
