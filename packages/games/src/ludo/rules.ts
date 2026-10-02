/**
 * Ludo rules (common Bangladesh / Ludo King style):
 *  - 2–4 players, 4 tokens each; 2 players sit on opposite colours.
 *  - Roll a 6 to bring a token out onto your start square.
 *  - Move by the die; landing on an opponent (not on a safe square) sends it back to base.
 *  - Extra roll for a 6, a capture, or bringing a token home. Three 6s in a row end the turn.
 *  - Exact roll needed to reach home. First player with all 4 tokens home wins.
 * Token progress: -1 = base, 0..50 = shared track (relative to own start), 51..55 = home column, 56 = home.
 */
export const TRACK_LENGTH = 52;
export const HOME = 56;
export const LAST_TRACK = 50;
/** absolute track squares that are safe (start squares + stars) */
export const SAFE_SQUARES = [0, 8, 13, 21, 26, 34, 39, 47];

export interface LudoMoveEvent {
  player: number;
  token: number;
  from: number;
  to: number;
  dice: number;
  captured: { player: number; token: number }[];
  /** counts every move in the game, so clients can animate each one exactly once */
  n: number;
}

export interface LudoState {
  players: string[];
  colors: number[];
  tokens: number[][];
  turn: number;
  phase: 'ROLL' | 'MOVE' | 'OVER';
  dice: number | null;
  sixes: number;
  movable: number[];
  eliminated: boolean[];
  timeouts: number[];
  lastMove: LudoMoveEvent | null;
  /** `n` counts every roll in the game, so clients can animate each new roll */
  lastRoll: { player: number; dice: number; n: number } | null;
  winner: number | null;
}

export function colorsFor(count: number): number[] {
  if (count === 2) return [0, 2];
  if (count === 3) return [0, 1, 2];
  return [0, 1, 2, 3];
}

export function absoluteSquare(color: number, progress: number): number | null {
  if (progress < 0 || progress > LAST_TRACK) return null;
  return (color * 13 + progress) % TRACK_LENGTH;
}

export function newLudo(players: string[]): LudoState {
  if (players.length < 2 || players.length > 4) throw new Error('Ludo needs 2–4 players');
  return {
    players,
    colors: colorsFor(players.length),
    tokens: players.map(() => [-1, -1, -1, -1]),
    turn: 0,
    phase: 'ROLL',
    dice: null,
    sixes: 0,
    movable: [],
    eliminated: players.map(() => false),
    timeouts: players.map(() => 0),
    lastMove: null,
    lastRoll: null,
    winner: null,
  };
}

export function legalTokens(state: LudoState, player: number, dice: number): number[] {
  const out: number[] = [];
  state.tokens[player]!.forEach((p, i) => {
    if (p === -1) {
      if (dice === 6) out.push(i);
    } else if (p < HOME && p + dice <= HOME) out.push(i);
  });
  return out;
}

function activePlayers(state: LudoState): number[] {
  return state.players.map((_, i) => i).filter((i) => !state.eliminated[i]);
}

function advanceTurn(state: LudoState): void {
  const n = state.players.length;
  let next = state.turn;
  for (let k = 0; k < n; k++) {
    next = (next + 1) % n;
    if (!state.eliminated[next]) break;
  }
  state.turn = next;
  state.phase = 'ROLL';
  state.dice = null;
  state.sixes = 0;
  state.movable = [];
}

function checkLastStanding(state: LudoState): void {
  const active = activePlayers(state);
  if (active.length === 1) {
    state.winner = active[0]!;
    state.phase = 'OVER';
  }
}

/** Rolls the die (value supplied by the server RNG). */
export function roll(state: LudoState, player: number, dice: number): LudoState {
  if (state.phase !== 'ROLL' || state.turn !== player) throw new Error('Not your roll');
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) throw new Error('bad die');
  const s = clone(state);
  s.lastRoll = { player, dice, n: (s.lastRoll?.n ?? 0) + 1 };
  s.dice = dice;
  if (dice === 6) s.sixes += 1;
  if (s.sixes === 3) {
    advanceTurn(s); // three sixes: turn lost
    return s;
  }
  s.movable = legalTokens(s, player, dice);
  if (s.movable.length === 0) advanceTurn(s);
  else s.phase = 'MOVE';
  return s;
}

export function move(state: LudoState, player: number, token: number): LudoState {
  if (state.phase !== 'MOVE' || state.turn !== player || state.dice === null) throw new Error('Not your move');
  if (!state.movable.includes(token)) throw new Error('Illegal token');
  const s = clone(state);
  const dice = s.dice!;
  const from = s.tokens[player]![token]!;
  const to = from === -1 ? 0 : from + dice;
  s.tokens[player]![token] = to;
  const captured: { player: number; token: number }[] = [];
  const abs = absoluteSquare(s.colors[player]!, to);
  if (abs !== null && !SAFE_SQUARES.includes(abs)) {
    s.tokens.forEach((toks, op) => {
      if (op === player || s.eliminated[op]) return;
      toks.forEach((p, ti) => {
        if (absoluteSquare(s.colors[op]!, p) === abs) {
          toks[ti] = -1;
          captured.push({ player: op, token: ti });
        }
      });
    });
  }
  s.lastMove = { player, token, from, to, dice, captured, n: (s.lastMove?.n ?? 0) + 1 };
  if (s.tokens[player]!.every((p) => p === HOME)) {
    s.winner = player;
    s.phase = 'OVER';
    return s;
  }
  const extra = dice === 6 || captured.length > 0 || to === HOME;
  if (extra) {
    s.phase = 'ROLL';
    s.dice = null;
    s.movable = [];
    if (dice !== 6) s.sixes = 0;
  } else advanceTurn(s);
  return s;
}

/** A player leaves (forfeit / repeated inactivity): their tokens are removed from the board. */
export function eliminate(state: LudoState, player: number): LudoState {
  const s = clone(state);
  if (s.eliminated[player] || s.phase === 'OVER') return s;
  s.eliminated[player] = true;
  s.tokens[player] = [-1, -1, -1, -1];
  checkLastStanding(s);
  if (s.winner === null && s.turn === player) advanceTurn(s);
  return s;
}

/** Choice used for auto-play: prefer finishing, capturing, leaving base, then the most advanced token. */
export function autoToken(state: LudoState): number {
  const player = state.turn;
  const dice = state.dice!;
  let best = state.movable[0]!;
  let bestScore = -Infinity;
  for (const t of state.movable) {
    const from = state.tokens[player]![t]!;
    const to = from === -1 ? 0 : from + dice;
    let score = to;
    if (to === HOME) score += 1000;
    const abs = absoluteSquare(state.colors[player]!, to);
    if (abs !== null && !SAFE_SQUARES.includes(abs)) {
      state.tokens.forEach((toks, op) => {
        if (op !== player && toks.some((p) => absoluteSquare(state.colors[op]!, p) === abs)) score += 500;
      });
    }
    if (from === -1) score += 100;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function clone(s: LudoState): LudoState {
  return { ...s, colors: [...s.colors], tokens: s.tokens.map((t) => [...t]), movable: [...s.movable], eliminated: [...s.eliminated], timeouts: [...s.timeouts] };
}

/** How many opponent tokens could reach `abs` with a single roll (1–6) — the risk of being captured there. */
function threatsAt(state: LudoState, player: number, abs: number): number {
  if (SAFE_SQUARES.includes(abs)) return 0;
  let threats = 0;
  state.tokens.forEach((toks, op) => {
    if (op === player || state.eliminated[op]) return;
    for (const p of toks) {
      const at = absoluteSquare(state.colors[op]!, p);
      if (at === null) continue;
      const ahead = (abs - at + TRACK_LENGTH) % TRACK_LENGTH;
      if (ahead >= 1 && ahead <= 6 && p + ahead <= LAST_TRACK) threats++;
    }
  });
  return threats;
}

/**
 * The 🤖 bot's choice: like auto-play (finish, capture, leave base, advance) but it also avoids
 * landing just in front of opponents, likes safe squares and moves tokens out of danger —
 * a careful casual player, not a perfect one. It only uses the visible board and the current die.
 */
export function botToken(state: LudoState): number {
  const player = state.turn;
  const dice = state.dice!;
  const color = state.colors[player]!;
  let best = state.movable[0]!;
  let bestScore = -Infinity;
  for (const t of state.movable) {
    const from = state.tokens[player]![t]!;
    const to = from === -1 ? 0 : from + dice;
    let score = to;
    if (to === HOME) score += 1000;
    const absTo = absoluteSquare(color, to);
    if (absTo !== null && !SAFE_SQUARES.includes(absTo)) {
      state.tokens.forEach((toks, op) => {
        if (op !== player && !state.eliminated[op] && toks.some((p) => absoluteSquare(state.colors[op]!, p) === absTo)) score += 500;
      });
    }
    if (from === -1) score += 120;
    if (absTo !== null && SAFE_SQUARES.includes(absTo)) score += 40;
    if (to > LAST_TRACK && from <= LAST_TRACK) score += 60; // into the home column: safe for good
    const absFrom = absoluteSquare(color, from);
    if (absFrom !== null) score += 70 * threatsAt(state, player, absFrom); // rescue a token in danger
    if (absTo !== null) score -= 90 * threatsAt(state, player, absTo); // do not walk into danger
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}
