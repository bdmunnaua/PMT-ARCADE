/**
 * Carrom (2 players, singles), simplified ICF board rules:
 *  - Player 1 (bottom) plays White, player 2 (top) plays Black; 9 coins each + the red Queen.
 *  - Place the striker on your baseline and flick it. Pocketing your own coin (or the Queen) lets you shoot again.
 *  - Queen: may be pocketed only after you have pocketed at least one own coin; you must "cover" it by
 *    pocketing an own coin in the same or your next shot, otherwise it returns to the centre.
 *  - Foul (striker pocketed): your coins pocketed in that shot, the Queen if pocketed in that shot,
 *    and one of your earlier coins (penalty) return to the centre; the turn passes.
 *  - Opponent coins you pocket count for the opponent.
 *  - Pocketing your own LAST coin while the Queen is not covered is a foul: that coin and one
 *    earlier coin return to the centre and the turn passes (ICF).
 *  - Pocketing the opponent's last coin hands them the board.
 *  - A colour that has all 9 coins pocketed with the Queen covered (by either player) wins the board.
 */
import { baselineY, BASELINE, COIN_R, freeSpotNearCentre, initialCoins, simulateShot, STRIKER_R, type Piece, type SimResult } from './physics';

export type CarromColor = 'W' | 'B';
export const MAX_SHOTS = 400;

export interface CarromShot {
  player: number;
  x: number;
  angle: number;
  power: number;
  frames: [string, number, number][][];
  pocketed: string[];
  foul: boolean;
  returned: string[];
  continues: boolean;
}

export interface CarromState {
  players: string[];
  colors: CarromColor[];
  coins: Piece[];
  pocketedBy: Record<CarromColor, string[]>;
  queen: { status: 'BOARD' | 'PENDING' | 'COVERED'; by: number | null };
  turn: number;
  shots: number;
  timeouts: number[];
  lastShot: CarromShot | null;
  phase: 'AIM' | 'OVER';
  winner: number | null;
  draw: boolean;
}

export function newCarrom(players: string[]): CarromState {
  if (players.length !== 2) throw new Error('Carrom needs 2 players');
  return {
    players,
    colors: ['W', 'B'],
    coins: initialCoins(),
    pocketedBy: { W: [], B: [] },
    queen: { status: 'BOARD', by: null },
    turn: 0,
    shots: 0,
    timeouts: [0, 0],
    lastShot: null,
    phase: 'AIM',
    winner: null,
    draw: false,
  };
}

export function validStrikerX(state: CarromState, player: number, x: number): boolean {
  if (!Number.isFinite(x) || x < BASELINE.min || x > BASELINE.max) return false;
  const y = baselineY(player);
  return state.coins.every((c) => Math.hypot(c.x - x, c.y - y) >= COIN_R + STRIKER_R);
}

/** First valid striker position closest to the given x (used for auto-play and UI hints). */
export function nearestValidX(state: CarromState, player: number, x: number): number {
  for (let d = 0; d < 700; d += 2) for (const c of [x - d, x + d]) if (validStrikerX(state, player, c)) return c;
  return 500;
}

function returnToCentre(coins: Piece[], id: string): Piece[] {
  const spot = freeSpotNearCentre(coins);
  return [...coins, { id, ...spot }];
}

export function shoot(state: CarromState, player: number, x: number, angle: number, power: number): CarromState {
  if (state.phase !== 'AIM' || state.turn !== player) throw new Error('Not your shot');
  if (!validStrikerX(state, player, x)) throw new Error('Place the striker on your baseline, clear of coins');
  if (!Number.isFinite(angle) || !Number.isFinite(power) || power <= 0 || power > 1) throw new Error('Bad shot');
  return applyShot(state, player, { x, angle, power }, simulateShot(state.coins, { x, y: baselineY(player) }, angle, power));
}

/** The rules part of a shot, given the physics result (separate so it can be tested exactly). */
export function applyShot(state: CarromState, player: number, aim: { x: number; angle: number; power: number }, sim: SimResult): CarromState {
  const { x, angle, power } = aim;
  const color = state.colors[player]!;
  const other: CarromColor = color === 'W' ? 'B' : 'W';
  const s: CarromState = { ...state, coins: sim.pieces, pocketedBy: { W: [...state.pocketedBy.W], B: [...state.pocketedBy.B] }, queen: { ...state.queen }, timeouts: [...state.timeouts], shots: state.shots + 1 };
  const foul = sim.pocketed.includes('S');
  const own = sim.pocketed.filter((id) => id[0] === color);
  const opp = sim.pocketed.filter((id) => id[0] === other);
  const queenNow = sim.pocketed.includes('Q');
  const returned: string[] = [];
  s.pocketedBy[other].push(...opp);
  let continues = false;

  if (foul) {
    for (const id of own) {
      s.coins = returnToCentre(s.coins, id);
      returned.push(id);
    }
    if (queenNow) {
      s.coins = returnToCentre(s.coins, 'Q');
      returned.push('Q');
    }
    const penalty = s.pocketedBy[color].pop();
    if (penalty) {
      s.coins = returnToCentre(s.coins, penalty);
      returned.push(penalty);
    }
    if (s.queen.status === 'PENDING' && s.queen.by === player) {
      s.coins = returnToCentre(s.coins, 'Q');
      returned.push('Q');
      s.queen = { status: 'BOARD', by: null };
    }
  } else {
    const hadOwnBefore = state.pocketedBy[color].length > 0;
    s.pocketedBy[color].push(...own);
    if (queenNow) {
      if (!hadOwnBefore && own.length === 0) {
        s.coins = returnToCentre(s.coins, 'Q');
        returned.push('Q');
      } else if (own.length > 0) s.queen = { status: 'COVERED', by: player };
      else s.queen = { status: 'PENDING', by: player };
    } else if (s.queen.status === 'PENDING' && s.queen.by === player) {
      if (own.length > 0) s.queen = { status: 'COVERED', by: player };
      else {
        s.coins = returnToCentre(s.coins, 'Q');
        returned.push('Q');
        s.queen = { status: 'BOARD', by: null };
      }
    }
    continues = own.length > 0 || queenNow;
  }

  // own last coin before the Queen is covered → foul: return this shot's own coins + one penalty coin
  if (!foul && s.pocketedBy[color].length >= 9 && s.queen.status !== 'COVERED') {
    for (const id of own) {
      s.pocketedBy[color].splice(s.pocketedBy[color].indexOf(id), 1);
      s.coins = returnToCentre(s.coins, id);
      returned.push(id);
    }
    const penalty = s.pocketedBy[color].pop();
    if (penalty) {
      s.coins = returnToCentre(s.coins, penalty);
      returned.push(penalty);
    }
    continues = false;
  }
  const lastCoinFoul = !foul && returned.some((id) => id[0] === color);

  s.lastShot = { player, x, angle, power, frames: sim.frames, pocketed: sim.pocketed, foul: foul || lastCoinFoul, returned, continues };

  // board end
  if (s.pocketedBy[other].length >= 9) {
    // finishing the opponent's coins (by them earlier or by this shot) gives them the board
    s.phase = 'OVER';
    s.winner = s.colors.indexOf(other);
    return s;
  }
  if (s.pocketedBy[color].length >= 9) {
    s.phase = 'OVER';
    s.winner = player; // only reachable with the Queen covered (see the foul above)
    return s;
  }
  if (s.shots >= MAX_SHOTS) {
    s.phase = 'OVER';
    const [a, b] = [s.pocketedBy[s.colors[0]!].length, s.pocketedBy[s.colors[1]!].length];
    if (a === b) s.draw = true;
    else s.winner = a > b ? 0 : 1;
    return s;
  }
  if (!continues) s.turn = 1 - player;
  return s;
}

export function passTurn(state: CarromState): CarromState {
  return { ...state, turn: 1 - state.turn, lastShot: null };
}

export function forfeit(state: CarromState, player: number): CarromState {
  if (state.phase === 'OVER') return state;
  return { ...state, phase: 'OVER', winner: 1 - player };
}

/** Auto shot for idle players: aim the striker at the nearest own coin. */
export function autoShot(state: CarromState): { x: number; angle: number; power: number } {
  const player = state.turn;
  const color = state.colors[player]!;
  const targets = state.coins.filter((c) => c.id[0] === color);
  const target = targets[0] ?? state.coins[0] ?? { x: 500, y: 500 };
  const x = nearestValidX(state, player, target.x);
  const y = baselineY(player);
  return { x, angle: Math.atan2(target.y - y, target.x - x), power: 0.6 };
}
