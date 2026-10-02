/**
 * Call Bridge (Call Break), Bangladesh style — 4 players, individual scores.
 *  - 52 cards, 13 each. Spades are always trump. Redeal if any hand has no spade.
 *  - Each player calls (1–13) the number of tricks they expect to win.
 *  - Play: follow the led suit; if you can beat the winning card you must.
 *    If you cannot follow, you must play a spade (higher than any spade already played if you can);
 *    if you have no spade that can win, you may play any card.
 *  - Round score (stored in tenths): made the call → +10×call + 1 per extra trick (i.e. +call.extra);
 *    missed → −10×call.
 *  - 5 rounds; highest total wins. Equal top scores → draw (stakes refunded).
 */
import { makeDeck, nextSeat, rankOf, shuffle, suitOf, type Card } from '../common/cards';

export const CB_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;
export const CB_ROUNDS = 5;
const power = (c: Card) => CB_RANKS.length - CB_RANKS.indexOf(rankOf(c) as (typeof CB_RANKS)[number]);

export interface TrickPlay {
  player: number;
  card: Card;
}

export interface CallBridgeState {
  players: string[];
  round: number;
  dealer: number;
  hands: Card[][];
  bids: (number | null)[];
  tricksWon: number[];
  phase: 'BIDDING' | 'PLAYING' | 'ROUND_END' | 'OVER';
  turn: number;
  trick: TrickPlay[];
  lastTrick: { plays: TrickPlay[]; winner: number } | null;
  scores: number[];
  history: { bids: number[]; tricks: number[]; delta: number[] }[];
  forfeited: boolean[];
  timeouts: number[];
  winner: number | null;
  draw: boolean;
}

export function newCallBridge(players: string[]): CallBridgeState {
  if (players.length !== 4) throw new Error('Call Bridge needs exactly 4 players');
  return {
    players,
    round: 0,
    dealer: 3,
    hands: [[], [], [], []],
    bids: [null, null, null, null],
    tricksWon: [0, 0, 0, 0],
    phase: 'ROUND_END',
    turn: 0,
    trick: [],
    lastTrick: null,
    scores: [0, 0, 0, 0],
    history: [],
    forfeited: [false, false, false, false],
    timeouts: [0, 0, 0, 0],
    winner: null,
    draw: false,
  };
}

export function deal(state: CallBridgeState, random: () => number): CallBridgeState {
  const s = clone(state);
  let hands: Card[][] = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    const deck = shuffle(makeDeck(CB_RANKS), random);
    hands = [0, 1, 2, 3].map((i) => deck.slice(i * 13, i * 13 + 13));
    if (hands.every((h) => h.some((c) => suitOf(c) === 'S'))) break;
  }
  s.round += 1;
  s.dealer = nextSeat(s.dealer, 4);
  s.hands = hands;
  s.bids = [null, null, null, null];
  s.tricksWon = [0, 0, 0, 0];
  s.trick = [];
  s.lastTrick = null;
  s.phase = 'BIDDING';
  s.turn = nextSeat(s.dealer, 4);
  return s;
}

export function bid(state: CallBridgeState, player: number, call: number): CallBridgeState {
  if (state.phase !== 'BIDDING' || state.turn !== player) throw new Error('Not your call');
  if (!Number.isInteger(call) || call < 1 || call > 13) throw new Error('Call between 1 and 13');
  const s = clone(state);
  s.bids[player] = call;
  if (s.bids.every((b) => b !== null)) {
    s.phase = 'PLAYING';
    s.turn = nextSeat(s.dealer, 4);
  } else s.turn = nextSeat(player, 4);
  return s;
}

/** Index of the play currently winning the trick. */
export function winningIndex(trick: TrickPlay[]): number {
  const led = suitOf(trick[0]!.card);
  let best = 0;
  trick.forEach((p, i) => {
    const b = trick[best]!.card;
    const c = p.card;
    const cTrump = suitOf(c) === 'S';
    const bTrump = suitOf(b) === 'S';
    if (cTrump && !bTrump) best = i;
    else if (cTrump === bTrump && suitOf(c) === suitOf(b) && power(c) > power(b)) best = i;
    else if (!cTrump && !bTrump && suitOf(c) === led && suitOf(b) !== led) best = i;
  });
  return best;
}

export function legalCards(state: CallBridgeState, player: number): Card[] {
  const hand = state.hands[player]!;
  if (state.trick.length === 0) return [...hand];
  const led = suitOf(state.trick[0]!.card);
  const winning = state.trick[winningIndex(state.trick)]!.card;
  const trumped = suitOf(winning) === 'S' && led !== 'S';
  const follow = hand.filter((c) => suitOf(c) === led);
  if (follow.length) {
    if (trumped) return follow;
    const higher = follow.filter((c) => power(c) > power(winning));
    return higher.length ? higher : follow;
  }
  const spades = hand.filter((c) => suitOf(c) === 'S');
  if (!spades.length) return [...hand];
  if (!trumped) return spades;
  const over = spades.filter((c) => power(c) > power(winning));
  return over.length ? over : [...hand];
}

export function play(state: CallBridgeState, player: number, card: Card): CallBridgeState {
  if (state.phase !== 'PLAYING' || state.turn !== player) throw new Error('Not your turn');
  if (!legalCards(state, player).includes(card)) throw new Error('That card is not allowed');
  const s = clone(state);
  s.hands[player] = s.hands[player]!.filter((c) => c !== card);
  s.trick.push({ player, card });
  if (s.trick.length < 4) {
    s.turn = nextSeat(player, 4);
    return s;
  }
  const winner = s.trick[winningIndex(s.trick)]!.player;
  s.tricksWon[winner]! += 1;
  s.lastTrick = { plays: s.trick, winner };
  s.trick = [];
  s.turn = winner;
  if (s.hands.every((h) => h.length === 0)) endRound(s);
  return s;
}

export function roundDelta(call: number, tricks: number): number {
  return tricks >= call ? call * 10 + (tricks - call) : -call * 10;
}

function endRound(s: CallBridgeState): void {
  const bids = s.bids.map((b) => b ?? 1);
  const delta = bids.map((b, i) => roundDelta(b, s.tricksWon[i]!));
  s.scores = s.scores.map((v, i) => v + delta[i]!);
  s.history.push({ bids, tricks: [...s.tricksWon], delta });
  if (s.round >= CB_ROUNDS) finish(s);
  else s.phase = 'ROUND_END';
}

function finish(s: CallBridgeState): void {
  s.phase = 'OVER';
  const eligible = [0, 1, 2, 3].filter((i) => !s.forfeited[i]);
  const top = Math.max(...eligible.map((i) => s.scores[i]!));
  const leaders = eligible.filter((i) => s.scores[i] === top);
  if (leaders.length === 1) s.winner = leaders[0]!;
  else s.draw = true;
}

export function forfeit(state: CallBridgeState, player: number): CallBridgeState {
  const s = clone(state);
  s.forfeited[player] = true;
  const left = [0, 1, 2, 3].filter((i) => !s.forfeited[i]);
  if (left.length === 1 && s.phase !== 'OVER') {
    s.phase = 'OVER';
    s.winner = left[0]!;
  }
  return s;
}

/** Simple bot used for idle/forfeited players: honest call estimate, plays the lowest legal card. */
export function autoBid(state: CallBridgeState, player: number): number {
  const hand = state.hands[player]!;
  let est = 0;
  for (const c of hand) {
    if (rankOf(c) === 'A') est += 1;
    else if (rankOf(c) === 'K' && suitOf(c) === 'S') est += 1;
  }
  const spades = hand.filter((c) => suitOf(c) === 'S').length;
  if (spades >= 5) est += spades - 4;
  return Math.max(1, Math.min(13, est));
}

export function autoCard(state: CallBridgeState, player: number): Card {
  const legal = legalCards(state, player);
  return [...legal].sort((a, b) => power(a) - power(b) || (suitOf(a) === 'S' ? 1 : 0) - (suitOf(b) === 'S' ? 1 : 0))[0]!;
}

function clone(s: CallBridgeState): CallBridgeState {
  return {
    ...s,
    hands: s.hands.map((h) => [...h]),
    bids: [...s.bids],
    tricksWon: [...s.tricksWon],
    trick: [...s.trick],
    scores: [...s.scores],
    history: [...s.history],
    forfeited: [...s.forfeited],
    timeouts: [...s.timeouts],
  };
}
