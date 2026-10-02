/* Rules tests for every installed game + full bot playthroughs through the real RoomEngine. */
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { GameModule, GamePlayerInfo, MatchOutcome } from '@arena/shared';
import { RoomEngine } from '../../apps/api/src/games/room-engine';
import { callBridgeModule, carromModule, chessModule, ludoModule, twentyNineModule } from '@arena/games/server';
import * as ludo from '../../packages/games/src/ludo/rules';
import * as cb from '../../packages/games/src/call-bridge/rules';
import * as tn from '../../packages/games/src/twenty-nine/rules';
import * as carrom from '../../packages/games/src/carrom/rules';
import { simulateShot, initialCoins, baselineY } from '../../packages/games/src/carrom/physics';

/** deterministic PRNG for reproducible tests */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const people = (n: number): GamePlayerInfo[] => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, playerNumber: 100001 + i, username: `p${i}`, displayName: `P${i}`, seat: i + 1 }));

/**
 * Plays a module to the end. `bot` returns a message for the player to act, or null to let the
 * turn timer fire (exercising handleTimeout / auto-play).
 */
function playOut<S>(module: GameModule<S>, n: number, seed: number, bot: (state: any, random: () => number) => { userId: string; message: unknown } | null, maxSteps = 5000): { outcome: MatchOutcome; engine: RoomEngine<S> } {
  const random = rng(seed);
  const players = people(n);
  const engine = RoomEngine.create(module, { matchId: 'm', gameId: 'g', stakeUnits: 1000, players }, 0, random);
  let now = 1;
  let started = false;
  for (const p of players) started = engine.connect(p.userId, now++).start || started;
  expect(started).toBe(true);
  for (let step = 0; step < maxSteps; step++) {
    const snap = engine.snapshot;
    if (snap.finished) return { outcome: snap.outcome!, engine };
    const act = bot(snap.state, random);
    now += 1000;
    const fx = act ? engine.message(act.userId, { t: 'move', data: act.message }, now) : engine.alarm((now = Math.max(now, snap.moduleTimerAt ?? now)));
    if (fx.outcome) return { outcome: fx.outcome.outcome, engine };
  }
  throw new Error('game did not finish');
}

// ---------------------------------------------------------------- Ludo
describe('Ludo', () => {
  it('needs a 6 to leave base and moves exactly', () => {
    let s = ludo.newLudo(['a', 'b']);
    s = ludo.roll(s, 0, 4);
    expect(s.turn).toBe(1); // no legal move → next player
    s = ludo.roll(s, 1, 6);
    expect(s.movable).toEqual([0, 1, 2, 3]);
    s = ludo.move(s, 1, 0);
    expect(s.tokens[1]![0]).toBe(0);
    expect(s.turn).toBe(1); // a six gives another roll
  });
  it('captures on unsafe squares, never on safe ones', () => {
    const s = ludo.newLudo(['a', 'b']); // colours 0 and 2 → starts 0 and 26
    s.tokens[0]![0] = 27; // absolute 27 (unsafe)
    s.tokens[1]![0] = 0; // absolute 26, one behind
    s.turn = 1;
    const next = ludo.move({ ...s, phase: 'MOVE', dice: 1, movable: [0] }, 1, 0);
    expect(next.tokens[0]![0]).toBe(-1);
    expect(next.lastMove?.captured).toEqual([{ player: 0, token: 0 }]);
    expect(next.turn).toBe(1); // capture = extra roll
    const safe = ludo.newLudo(['a', 'b']);
    safe.tokens[0]![0] = 34; // absolute 34 = star
    safe.tokens[1]![0] = 7; // absolute 33
    const n2 = ludo.move({ ...safe, turn: 1, phase: 'MOVE', dice: 1, movable: [0] }, 1, 0);
    expect(n2.tokens[0]![0]).toBe(34);
  });
  it('requires an exact roll to finish and three sixes lose the turn', () => {
    const s = ludo.newLudo(['a', 'b']);
    s.tokens[0] = [54, 56, 56, 56];
    expect(ludo.legalTokens(s, 0, 3)).toEqual([]);
    const won = ludo.move({ ...s, phase: 'MOVE', dice: 2, movable: [0] }, 0, 0);
    expect(won.winner).toBe(0);
    let t = ludo.newLudo(['a', 'b']);
    t.tokens[0] = [10, -1, -1, -1];
    t = ludo.roll(t, 0, 6);
    t = ludo.move(t, 0, 0);
    t = ludo.roll(t, 0, 6);
    t = ludo.move(t, 0, 0);
    t = ludo.roll(t, 0, 6);
    expect(t.turn).toBe(1);
  });
  it.each([1, 2, 3])('a full 4-player game finishes with a validated winner (seed %i)', (seed) => {
    const { outcome } = playOut(ludoModule, 4, seed, (s: ludo.LudoState) => {
      if (s.phase === 'OVER') return null;
      const userId = s.players[s.turn]!;
      return s.phase === 'ROLL' ? { userId, message: { action: 'roll' } } : { userId, message: { action: 'move', token: ludo.autoToken(s) } };
    });
    expect(outcome.type).toBe('WIN');
  });
  it('idle players are auto-played, then removed; the last one standing wins', () => {
    const { outcome } = playOut(ludoModule, 3, 9, () => null);
    expect(outcome.type).toBe('WIN');
  });
});

// ---------------------------------------------------------------- Call Bridge
describe('Call Bridge', () => {
  it('deals 13 cards each, everyone holds a spade', () => {
    const s = cb.deal(cb.newCallBridge(['a', 'b', 'c', 'd']), rng(5));
    expect(s.hands.every((h) => h.length === 13 && h.some((c) => c[1] === 'S'))).toBe(true);
    expect(new Set(s.hands.flat()).size).toBe(52);
  });
  it('must follow suit and beat if possible; void must trump', () => {
    const s = cb.newCallBridge(['a', 'b', 'c', 'd']);
    s.phase = 'PLAYING';
    s.hands = [['5H'], ['3H', 'KH', '2S'], ['4D', '9S', '2S'], ['7C']];
    s.trick = [{ player: 0, card: 'QH' }];
    expect(cb.legalCards(s, 1)).toEqual(['KH']);
    s.trick = [{ player: 0, card: 'QH' }, { player: 1, card: '5S' }];
    expect(cb.legalCards(s, 2)).toEqual(['9S']); // void in hearts, must overtrump
    expect(cb.winningIndex([{ player: 0, card: 'QH' }, { player: 1, card: '2S' }, { player: 2, card: 'AH' }])).toBe(1);
  });
  it('scores calls: made → call + extra tenths, missed → −call', () => {
    expect(cb.roundDelta(4, 6)).toBe(42);
    expect(cb.roundDelta(5, 4)).toBe(-50);
  });
  it.each([1, 2])('a full 5-round game with idle (auto-played) players ends with a result (seed %i)', (seed) => {
    const { outcome, engine } = playOut(callBridgeModule, 4, seed, () => null);
    expect(['WIN', 'DRAW']).toContain(outcome.type);
    expect((engine.snapshot.state as cb.CallBridgeState).history).toHaveLength(5);
  });
  it('hides other players’ hands', () => {
    const { engine } = playOut(callBridgeModule, 4, 3, () => null);
    const view = callBridgeModule.viewFor(engine.snapshot.state, 'u0') as { hand: string[] };
    expect(JSON.stringify(view)).not.toContain('"hands"');
    expect(view.hand.length).toBeLessThanOrEqual(13);
  });
});

// ---------------------------------------------------------------- Twenty-Nine
describe('Twenty-Nine', () => {
  it('uses 32 cards worth 28 points', () => {
    const s = tn.deal(tn.newTwentyNine(['a', 'b', 'c', 'd']), rng(2));
    const all = [...s.hands.flat(), ...s.pending.flat()];
    expect(new Set(all).size).toBe(32);
    expect(all.reduce((n, c) => n + tn.cardPoints(c), 0)).toBe(28);
  });
  it('bidding: 16–28, the fourth must bid when everyone passed', () => {
    let s = tn.deal(tn.newTwentyNine(['a', 'b', 'c', 'd']), rng(3));
    s = tn.placeBid(s, s.turn, null);
    s = tn.placeBid(s, s.turn, null);
    s = tn.placeBid(s, s.turn, null);
    expect(() => tn.placeBid(s, s.turn, null)).toThrow();
    expect(() => tn.placeBid(s, s.turn, 15)).toThrow();
    s = tn.placeBid(s, s.turn, 16);
    expect(s.phase).toBe('TRUMP');
  });
  it('trumps have no power until revealed; the revealer must trump', () => {
    const s = tn.newTwentyNine(['a', 'b', 'c', 'd']);
    Object.assign(s, { phase: 'PLAYING', trump: 'S', bidder: 0, turn: 1, hands: [[], ['7S', '8D'], [], []], trick: [{ player: 0, card: 'JH' }] });
    expect(tn.trickWinner([{ player: 0, card: 'JH' }, { player: 1, card: '7S' }], null)).toBe(0);
    expect(tn.trickWinner([{ player: 0, card: 'JH' }, { player: 1, card: '7S' }], 'S')).toBe(1);
    expect(tn.legalCards(s, 1)).toEqual(['7S', '8D']);
    const r = tn.reveal(s, 1);
    expect(tn.legalCards(r, 1)).toEqual(['7S']);
  });
  it.each([1, 2, 3])('a full match with auto-played players ends in a team win or draw (seed %i)', (seed) => {
    const { outcome } = playOut(twentyNineModule, 4, seed, () => null, 20000);
    if (outcome.type === 'WIN') expect(outcome.teammateUserIds).toHaveLength(1);
    else expect(outcome.type).toBe('DRAW');
  });
  it('the trump stays hidden from everyone but the bidder', () => {
    let s = tn.deal(tn.newTwentyNine(['u0', 'u1', 'u2', 'u3']), rng(4));
    while (s.phase === 'BIDDING') s = tn.placeBid(s, s.turn, tn.mustBid(s, s.turn) ? 16 : null);
    const card = s.hands[s.bidder!]![0]!;
    s = tn.chooseTrump(s, s.bidder!, card);
    const state = { ...s, deadline: null };
    const bidderView = twentyNineModule.viewFor(state, `u${s.bidder}`) as { trump: string | null; trumpCard: string | null; trumpFaceDown: boolean };
    const otherView = twentyNineModule.viewFor(state, `u${(s.bidder! + 1) % 4}`) as { trump: string | null; trumpCard: string | null; trumpFaceDown: boolean };
    expect(bidderView.trump).toBe(card[1]);
    expect(bidderView.trumpCard).toBe(card);
    expect(otherView.trump).toBeNull();
    expect(otherView.trumpCard).toBeNull();
    expect(otherView.trumpFaceDown).toBe(true);
  });
  it('the trump card is set aside face down and returns to the bidder when revealed', () => {
    let s = tn.deal(tn.newTwentyNine(['u0', 'u1', 'u2', 'u3']), rng(5));
    while (s.phase === 'BIDDING') s = tn.placeBid(s, s.turn, tn.mustBid(s, s.turn) ? 16 : null);
    const bidder = s.bidder!;
    const card = s.hands[bidder]![1]!;
    expect(() => tn.chooseTrump(s, bidder, s.hands[(bidder + 1) % 4]![0]!)).toThrow();
    s = tn.chooseTrump(s, bidder, card);
    expect(s.hands[bidder]).toHaveLength(7);
    expect(s.hands[bidder]).not.toContain(card);
    expect(s.hands.filter((_, i) => i !== bidder).every((h) => h.length === 8)).toBe(true);
    // someone who cannot follow calls the trump: the card goes back to the bidder
    const caller = (bidder + 1) % 4;
    // a lead in a suit nobody holds, so the caller cannot follow
    Object.assign(s, { turn: caller, trick: [{ player: bidder, card: 'JZ' }] });
    const r = tn.reveal(s, caller);
    expect(r.trumpRevealed).toBe(true);
    expect(r.hands[bidder]).toContain(card);
    expect(r.trumpCard).toBeNull();
  });
  it('if nobody reveals, the bidder plays the face-down card in the last trick and it counts as trump', () => {
    const s = tn.newTwentyNine(['a', 'b', 'c', 'd']);
    Object.assign(s, {
      phase: 'PLAYING', trump: 'S', trumpCard: '7S', bidder: 0, turn: 0, trumpRevealed: false,
      hands: [[], ['JH'], ['8H'], ['9H']], trick: [], teamPoints: [10, 10], teamTricks: [3, 4],
    });
    expect(tn.legalCards(s, 0)).toEqual(['7S']);
    let n = tn.playCard(s, 0, '7S');
    expect(n.trumpRevealed).toBe(true);
    n = tn.playCard(n, 1, 'JH');
    n = tn.playCard(n, 2, '8H');
    n = tn.playCard(n, 3, '9H');
    expect(n.lastTrick?.winner).toBe(0); // 7 of the revealed trump beats the jack of hearts
  });
  it('redeals when a first four cards hold no points', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = tn.deal(tn.newTwentyNine(['a', 'b', 'c', 'd']), rng(seed));
      expect(s.hands.every((h) => h.some((c) => tn.cardPoints(c) > 0))).toBe(true);
    }
  });
  it('a pair can be shown only after the team wins a trick after the reveal', () => {
    const s = tn.newTwentyNine(['a', 'b', 'c', 'd']);
    Object.assign(s, { phase: 'PLAYING', trump: 'H', trumpRevealed: true, bidder: 1, target: 20, hands: [['KH', 'QH', '7C'], [], [], []], teamTricks: [2, 1], wonAfterReveal: [false, false] });
    expect(tn.canShowPair(s, 0)).toBe(false);
    s.wonAfterReveal = [true, false];
    expect(tn.canShowPair(s, 0)).toBe(true);
    expect(tn.showPair(s, 0).target).toBe(24); // opponents of the bidder: +4
  });
});

// ---------------------------------------------------------------- Chess
describe('Chess', () => {
  const mover = (moves: string[]) => {
    let i = 0;
    return (s: { white: string; black: string; moves: string[]; result: unknown }) => {
      if (s.result || i >= moves.length) return null;
      const c = new Chess();
      for (const m of s.moves) c.move(m);
      const mv = c.move(moves[i++]!);
      return { userId: s.moves.length % 2 === 0 ? s.white : s.black, message: { action: 'move', from: mv.from, to: mv.to } };
    };
  };
  it('checkmate decides the winner (fool’s mate → black wins)', () => {
    const { outcome, engine } = playOut(chessModule, 2, 1, mover(['f3', 'e5', 'g4', 'Qh4#']));
    const s = engine.snapshot.state as { black: string };
    expect(outcome).toMatchObject({ type: 'WIN', winnerUserId: s.black });
  });
  it('rejects illegal moves and moves out of turn', () => {
    const engine = RoomEngine.create(chessModule, { matchId: 'm', gameId: 'g', stakeUnits: 1, players: people(2) }, 0, rng(1));
    engine.connect('u0', 1);
    engine.connect('u1', 2);
    const s = engine.snapshot.state;
    const fx = engine.message(s.black, { t: 'move', data: { action: 'move', from: 'e7', to: 'e5' } }, 3);
    expect(JSON.stringify(fx.send)).toContain('Not your move');
    const bad = engine.message(s.white, { t: 'move', data: { action: 'move', from: 'e2', to: 'e5' } }, 4);
    expect(JSON.stringify(bad.send)).toContain('Illegal move');
  });
  it('flag fall loses on time', () => {
    const { outcome, engine } = playOut(chessModule, 2, 2, () => null);
    expect(outcome).toMatchObject({ type: 'WIN', winnerUserId: (engine.snapshot.state as { black: string }).black, reason: 'TIMEOUT' });
  });
  it('a random legal game terminates with a validated result', () => {
    const c = new Chess();
    const { outcome } = playOut(
      chessModule,
      2,
      11,
      (s: { white: string; black: string; moves: string[]; result: unknown }, random) => {
        if (s.result) return null;
        while (c.history().length < s.moves.length) c.move(s.moves[c.history().length]!);
        const legal = c.moves({ verbose: true });
        const mv = legal[Math.floor(random() * legal.length)]!;
        return { userId: s.moves.length % 2 === 0 ? s.white : s.black, message: { action: 'move', from: mv.from, to: mv.to, promotion: 'q' } };
      },
      3000,
    );
    expect(['WIN', 'DRAW']).toContain(outcome.type);
  }, 120_000);
});

// ---------------------------------------------------------------- Carrom
describe('Carrom', () => {
  it('physics: a straight shot into the centre breaks the rosette and everything stays on the board area', () => {
    const coins = initialCoins();
    const res = simulateShot(coins, { x: 500, y: baselineY(0) }, -Math.PI / 2, 1);
    const moved = res.pieces.filter((p) => {
      const o = coins.find((c) => c.id === p.id);
      return o && (o.x !== p.x || o.y !== p.y);
    });
    expect(moved.length).toBeGreaterThan(5);
    for (const p of res.pieces) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1000);
    }
    expect(res.pieces.length + res.pocketed.filter((id) => id !== 'S').length).toBe(19);
  });
  it('pocketing the striker is a foul that returns a coin', () => {
    const s = carrom.newCarrom(['a', 'b']);
    s.pocketedBy.W.push('W8');
    s.coins = s.coins.filter((c) => c.id !== 'W8');
    // aim the striker straight into the bottom-left pocket
    const next = carrom.shoot(s, 0, 190, Math.atan2(1000 - 32 - baselineY(0), 32 - 190), 1);
    expect(next.lastShot?.foul).toBe(true);
    expect(next.lastShot?.returned).toContain('W8');
    expect(next.turn).toBe(1);
  });
  // rules with an exact (injected) physics result
  const after = (s: carrom.CarromState, pocketed: string[]) => ({ pieces: s.coins.filter((c) => !pocketed.includes(c.id)), pocketed, frames: [] });
  const nearlyDone = (queen: carrom.CarromState['queen']) => {
    const s = carrom.newCarrom(['a', 'b']);
    s.pocketedBy.W = ['W0', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'];
    s.pocketedBy.B = ['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'];
    s.coins = s.coins.filter((c) => !s.pocketedBy.W.includes(c.id) && !s.pocketedBy.B.includes(c.id) && (queen.status === 'BOARD' || c.id !== 'Q'));
    s.queen = queen;
    return s;
  };
  const aim = { x: 500, angle: -Math.PI / 2, power: 0.5 };
  it('own last coin before the Queen is covered is a foul: it returns with a penalty coin', () => {
    const s = nearlyDone({ status: 'BOARD', by: null });
    const next = carrom.applyShot(s, 0, aim, after(s, ['W8']));
    expect(next.phase).toBe('AIM');
    expect(next.lastShot?.foul).toBe(true);
    expect(next.pocketedBy.W).toHaveLength(7);
    expect(next.coins.map((c) => c.id)).toEqual(expect.arrayContaining(['W8', 'W7']));
    expect(next.turn).toBe(1);
  });
  it('own last coin with the Queen covered wins the board', () => {
    const s = nearlyDone({ status: 'COVERED', by: 1 });
    const next = carrom.applyShot(s, 0, aim, after(s, ['W8']));
    expect(next.phase).toBe('OVER');
    expect(next.winner).toBe(0);
  });
  it('last coin together with the Queen covers it and wins', () => {
    const s = nearlyDone({ status: 'BOARD', by: null });
    const next = carrom.applyShot(s, 0, aim, after(s, ['Q', 'W8']));
    expect(next.winner).toBe(0);
  });
  it('pocketing the opponent’s last coin hands them the board (no exploit)', () => {
    const s = nearlyDone({ status: 'BOARD', by: null });
    const next = carrom.applyShot(s, 0, aim, after(s, ['B8']));
    expect(next.phase).toBe('OVER');
    expect(next.winner).toBe(1);
  });
  it('rejects a striker placed off the baseline', () => {
    expect(() => carrom.shoot(carrom.newCarrom(['a', 'b']), 0, 100, 0, 0.5)).toThrow();
  });
  it('a bot game finishes with a validated result', () => {
    const { outcome } = playOut(
      carromModule,
      2,
      21,
      (s: carrom.CarromState, random) => {
        if (s.phase === 'OVER') return null;
        const shot = carrom.autoShot(s);
        return { userId: s.players[s.turn]!, message: { action: 'shoot', ...shot, angle: shot.angle + (random() - 0.5) * 0.1, power: 0.4 + random() * 0.6 } };
      },
      2000,
    );
    expect(['WIN', 'DRAW']).toContain(outcome.type);
  });
  it('three missed shots forfeit the board', () => {
    const { outcome, engine } = playOut(carromModule, 2, 3, () => null);
    expect(outcome.type).toBe('WIN');
    expect((engine.snapshot.state as carrom.CarromState).players[1]).toBe((outcome as { winnerUserId: string }).winnerUserId);
  });
});
