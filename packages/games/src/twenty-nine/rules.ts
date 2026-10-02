/**
 * Twenty-Nine (29), Bangladesh style — 4 players in 2 teams (seats 0 & 2 vs 1 & 3).
 *  - 32 cards (7–A). Rank high→low: J 9 A 10 K Q 8 7. Points: J=3, 9=2, A=1, 10=1 (28 per hand).
 *  - 4 cards each, then bidding 16–28 (pass allowed; if the first three pass the fourth must bid 16).
 *  - The cards are redealt if any player's first four cards hold no points.
 *  - The highest bidder places one of their four cards face down: its suit is trump. That card is
 *    out of their hand until the trump is revealed; then it returns to their hand. Then 4 more cards each.
 *  - Must follow suit. A player who cannot follow may call the trump open ("reveal"); the player
 *    who reveals must then play a trump if they hold one. Before the reveal, trumps have no power.
 *    If nobody reveals, the bidder plays the face-down card in the last trick, which reveals it.
 *  - Pair: after the reveal, a player holding K+Q of trump may show it once their team has won a
 *    trick after the reveal: target −4 if they are the bidding team (min 16), +4 otherwise (max 28).
 *  - The bidding team needs ≥ target points: made → +1 game point, failed → −1.
 *  - First team to +6 wins (a team at −6 loses). After 12 hands the higher game score wins; equal → draw.
 */
import { makeDeck, nextSeat, rankOf, shuffle, SUITS, suitOf, type Card, type Suit } from '../common/cards';

export const TN_RANKS = ['J', '9', 'A', 'T', 'K', 'Q', '8', '7'] as const;
export const TN_POINTS: Record<string, number> = { J: 3, '9': 2, A: 1, T: 1 };
export const TN_MIN_BID = 16;
export const TN_MAX_BID = 28;
export const TN_WIN_SCORE = 6;
export const TN_MAX_HANDS = 12;

const power = (c: Card) => TN_RANKS.length - TN_RANKS.indexOf(rankOf(c) as (typeof TN_RANKS)[number]);
export const cardPoints = (c: Card) => TN_POINTS[rankOf(c)] ?? 0;
export const teamOf = (seat: number) => seat % 2;

export interface TrickPlay {
  player: number;
  card: Card;
}

export interface TwentyNineState {
  players: string[];
  dealer: number;
  hand: number;
  hands: Card[][];
  pending: Card[][];
  phase: 'BIDDING' | 'TRUMP' | 'PLAYING' | 'HAND_END' | 'OVER';
  turn: number;
  bid: number | null;
  bidder: number | null;
  passed: boolean[];
  bidLog: { player: number; bid: number | null }[];
  trump: Suit | null;
  /** the bidder's face-down trump card while it is set aside (null once back in the hand) */
  trumpCard: Card | null;
  trumpRevealed: boolean;
  /** per team: won a trick after the trump was revealed (needed to show a pair) */
  wonAfterReveal: [boolean, boolean];
  revealedBy: number | null;
  /** player who revealed during the current trick and therefore must play trump */
  mustTrump: number | null;
  target: number;
  pairShown: { player: number; team: number } | null;
  trick: TrickPlay[];
  lastTrick: { plays: TrickPlay[]; winner: number; points: number } | null;
  teamPoints: [number, number];
  teamTricks: [number, number];
  gameScore: [number, number];
  history: { bidder: number; bid: number; target: number; trump: Suit; points: [number, number]; made: boolean }[];
  timeouts: number[];
  winnerTeam: number | null;
  draw: boolean;
}

export function newTwentyNine(players: string[]): TwentyNineState {
  if (players.length !== 4) throw new Error('Twenty-Nine needs exactly 4 players');
  return {
    players,
    dealer: 3,
    hand: 0,
    hands: [[], [], [], []],
    pending: [[], [], [], []],
    phase: 'HAND_END',
    turn: 0,
    bid: null,
    bidder: null,
    passed: [false, false, false, false],
    bidLog: [],
    trump: null,
    trumpCard: null,
    trumpRevealed: false,
    wonAfterReveal: [false, false],
    revealedBy: null,
    mustTrump: null,
    target: TN_MIN_BID,
    pairShown: null,
    trick: [],
    lastTrick: null,
    teamPoints: [0, 0],
    teamTricks: [0, 0],
    gameScore: [0, 0],
    history: [],
    timeouts: [0, 0, 0, 0],
    winnerTeam: null,
    draw: false,
  };
}

export function deal(state: TwentyNineState, random: () => number): TwentyNineState {
  const s = clone(state);
  let deck = shuffle(makeDeck(TN_RANKS), random);
  // redeal while anyone's first four cards are pointless
  for (let attempt = 0; attempt < 50 && [0, 1, 2, 3].some((i) => deck.slice(i * 4, i * 4 + 4).every((c) => cardPoints(c) === 0)); attempt++) {
    deck = shuffle(makeDeck(TN_RANKS), random);
  }
  s.hand += 1;
  s.dealer = nextSeat(s.dealer, 4);
  s.hands = [0, 1, 2, 3].map((i) => deck.slice(i * 4, i * 4 + 4));
  s.pending = [0, 1, 2, 3].map((i) => deck.slice(16 + i * 4, 16 + i * 4 + 4));
  s.phase = 'BIDDING';
  s.turn = nextSeat(s.dealer, 4);
  s.bid = null;
  s.bidder = null;
  s.passed = [false, false, false, false];
  s.bidLog = [];
  s.trump = null;
  s.trumpCard = null;
  s.trumpRevealed = false;
  s.wonAfterReveal = [false, false];
  s.revealedBy = null;
  s.mustTrump = null;
  s.pairShown = null;
  s.trick = [];
  s.lastTrick = null;
  s.teamPoints = [0, 0];
  s.teamTricks = [0, 0];
  return s;
}

/** The fourth player must bid when everyone else passed without a bid. */
export function mustBid(state: TwentyNineState, player: number): boolean {
  return state.bid === null && state.passed.filter((p, i) => p && i !== player).length === 3;
}

export function placeBid(state: TwentyNineState, player: number, value: number | null): TwentyNineState {
  if (state.phase !== 'BIDDING' || state.turn !== player) throw new Error('Not your bid');
  const s = clone(state);
  if (value === null) {
    if (mustBid(s, player)) throw new Error('Everyone else passed — you must bid at least 16');
    s.passed[player] = true;
  } else {
    const min = s.bid === null ? TN_MIN_BID : s.bid + 1;
    if (!Number.isInteger(value) || value < min || value > TN_MAX_BID) throw new Error(`Bid between ${min} and ${TN_MAX_BID}`);
    s.bid = value;
    s.bidder = player;
  }
  s.bidLog.push({ player, bid: value });
  const active = [0, 1, 2, 3].filter((i) => !s.passed[i]);
  if (s.bid !== null && (active.length === 1 || s.bid === TN_MAX_BID)) {
    s.phase = 'TRUMP';
    s.turn = s.bidder!;
    s.target = s.bid;
    return s;
  }
  let next = player;
  do next = nextSeat(next, 4);
  while (s.passed[next]);
  s.turn = next;
  return s;
}

/** The bidder sets one of their four cards face down; its suit becomes trump. */
export function chooseTrump(state: TwentyNineState, player: number, card: Card): TwentyNineState {
  if (state.phase !== 'TRUMP' || state.bidder !== player) throw new Error('Only the bidder chooses trump');
  if (!state.hands[player]!.includes(card)) throw new Error('Choose one of your cards as the trump');
  const s = clone(state);
  s.trump = suitOf(card) as Suit;
  s.trumpCard = card;
  s.hands = s.hands.map((h, i) => [...(i === player ? h.filter((c) => c !== card) : h), ...s.pending[i]!]);
  s.pending = [[], [], [], []];
  s.phase = 'PLAYING';
  s.turn = nextSeat(s.dealer, 4);
  return s;
}

/** Reveal: the trump suit is shown to everyone and the face-down card goes back to the bidder. */
function openTrump(s: TwentyNineState): void {
  s.trumpRevealed = true;
  if (s.trumpCard && s.bidder !== null) {
    s.hands[s.bidder] = [...s.hands[s.bidder]!, s.trumpCard];
    s.trumpCard = null;
  }
}

export function canReveal(state: TwentyNineState, player: number): boolean {
  if (state.phase !== 'PLAYING' || state.turn !== player || state.trumpRevealed || state.trick.length === 0) return false;
  const led = suitOf(state.trick[0]!.card);
  return !state.hands[player]!.some((c) => suitOf(c) === led);
}

export function reveal(state: TwentyNineState, player: number): TwentyNineState {
  if (!canReveal(state, player)) throw new Error('You can only call the trump when you cannot follow suit');
  const s = clone(state);
  openTrump(s);
  s.revealedBy = player;
  s.mustTrump = player;
  return s;
}

export function legalCards(state: TwentyNineState, player: number): Card[] {
  const hand = state.hands[player]!;
  // never revealed: the bidder's last card is the face-down trump card
  if (hand.length === 0 && player === state.bidder && state.trumpCard) return [state.trumpCard];
  if (state.trick.length === 0) return [...hand];
  const led = suitOf(state.trick[0]!.card);
  const follow = hand.filter((c) => suitOf(c) === led);
  if (follow.length) return follow;
  if (state.mustTrump === player) {
    const trumps = hand.filter((c) => suitOf(c) === state.trump);
    if (trumps.length) return trumps;
  }
  return [...hand];
}

export function trickWinner(trick: TrickPlay[], trump: Suit | null): number {
  const led = suitOf(trick[0]!.card);
  let best = 0;
  trick.forEach((p, i) => {
    const b = trick[best]!.card;
    const cT = trump !== null && suitOf(p.card) === trump;
    const bT = trump !== null && suitOf(b) === trump;
    if (cT && !bT) best = i;
    else if (cT && bT && power(p.card) > power(b)) best = i;
    else if (!cT && !bT && suitOf(p.card) === led && (suitOf(b) !== led || power(p.card) > power(b))) best = i;
  });
  return trick[best]!.player;
}

export function playCard(state: TwentyNineState, player: number, card: Card): TwentyNineState {
  if (state.phase !== 'PLAYING' || state.turn !== player) throw new Error('Not your turn');
  if (!legalCards(state, player).includes(card)) throw new Error('That card is not allowed');
  const s = clone(state);
  if (card === s.trumpCard) openTrump(s); // played in the last trick: revealed as it is played
  s.hands[player] = s.hands[player]!.filter((c) => c !== card);
  s.trick.push({ player, card });
  s.mustTrump = null;
  if (s.trick.length < 4) {
    s.turn = nextSeat(player, 4);
    return s;
  }
  const winner = trickWinner(s.trick, s.trumpRevealed ? s.trump : null);
  const points = s.trick.reduce((n, p) => n + cardPoints(p.card), 0);
  const team = teamOf(winner);
  s.teamPoints[team] += points;
  s.teamTricks[team] += 1;
  if (s.trumpRevealed) s.wonAfterReveal[team] = true;
  s.lastTrick = { plays: s.trick, winner, points };
  s.trick = [];
  s.turn = winner;
  if (s.hands.every((h) => h.length === 0)) endHand(s);
  return s;
}

export function canShowPair(state: TwentyNineState, player: number): boolean {
  if (state.phase !== 'PLAYING' || !state.trumpRevealed || state.pairShown || !state.trump) return false;
  const hand = state.hands[player]!;
  return hand.includes(`K${state.trump}`) && hand.includes(`Q${state.trump}`) && state.wonAfterReveal[teamOf(player)];
}

export function showPair(state: TwentyNineState, player: number): TwentyNineState {
  if (!canShowPair(state, player)) throw new Error('No pair to show');
  const s = clone(state);
  const team = teamOf(player);
  s.pairShown = { player, team };
  s.target = team === teamOf(s.bidder!) ? Math.max(TN_MIN_BID, s.target - 4) : Math.min(TN_MAX_BID, s.target + 4);
  return s;
}

function endHand(s: TwentyNineState): void {
  const bidTeam = teamOf(s.bidder!);
  const made = s.teamPoints[bidTeam] >= s.target;
  s.gameScore[bidTeam] += made ? 1 : -1;
  s.history.push({ bidder: s.bidder!, bid: s.bid!, target: s.target, trump: s.trump!, points: [...s.teamPoints] as [number, number], made });
  s.trumpRevealed = true; // everyone sees the trump at the end of the hand
  for (const t of [0, 1]) {
    if (s.gameScore[t]! >= TN_WIN_SCORE) return finish(s, t);
    if (s.gameScore[t]! <= -TN_WIN_SCORE) return finish(s, 1 - t);
  }
  if (s.hand >= TN_MAX_HANDS) {
    if (s.gameScore[0] === s.gameScore[1]) {
      s.phase = 'OVER';
      s.draw = true;
    } else finish(s, s.gameScore[0] > s.gameScore[1] ? 0 : 1);
    return;
  }
  s.phase = 'HAND_END';
}

function finish(s: TwentyNineState, team: number): void {
  s.phase = 'OVER';
  s.winnerTeam = team;
}

/** A player leaving forfeits for the whole team. */
export function forfeitTeam(state: TwentyNineState, player: number): TwentyNineState {
  const s = clone(state);
  if (s.phase !== 'OVER') finish(s, 1 - teamOf(player));
  return s;
}

// ---- auto-play for idle players
export function autoBid(state: TwentyNineState, player: number): number | null {
  if (mustBid(state, player)) return TN_MIN_BID;
  return null;
}

/** Auto trump: the longest/strongest suit, setting aside its least valuable card. */
export function autoTrump(state: TwentyNineState, player: number): Card {
  const hand = state.hands[player]!;
  const suit = [...SUITS].sort((a, b) => {
    const ca = hand.filter((c) => suitOf(c) === a);
    const cb = hand.filter((c) => suitOf(c) === b);
    return cb.length - ca.length || cb.reduce((n, c) => n + cardPoints(c), 0) - ca.reduce((n, c) => n + cardPoints(c), 0);
  })[0]!;
  return hand.filter((c) => suitOf(c) === suit).sort((a, b) => power(a) - power(b))[0]!;
}

export function autoCard(state: TwentyNineState, player: number): Card {
  return [...legalCards(state, player)].sort((a, b) => cardPoints(a) - cardPoints(b) || power(a) - power(b))[0]!;
}

function clone(s: TwentyNineState): TwentyNineState {
  return {
    ...s,
    hands: s.hands.map((h) => [...h]),
    pending: s.pending.map((h) => [...h]),
    passed: [...s.passed],
    bidLog: [...s.bidLog],
    trick: [...s.trick],
    teamPoints: [...s.teamPoints] as [number, number],
    teamTricks: [...s.teamTricks] as [number, number],
    wonAfterReveal: [...s.wonAfterReveal] as [boolean, boolean],
    gameScore: [...s.gameScore] as [number, number],
    history: [...s.history],
    timeouts: [...s.timeouts],
  };
}
