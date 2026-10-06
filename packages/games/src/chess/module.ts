/**
 * Chess — full FIDE move rules via chess.js (check, mate, stalemate, castling, en passant,
 * promotion, threefold repetition, 50-move rule, insufficient material).
 * Blitz clock 5 min + 3 s increment, enforced by the server. Colours are assigned randomly.
 * Flag fall: opponent wins — unless the opponent cannot possibly mate (then draw).
 */
import { Chess } from 'chess.js';
import type { GameModule, MatchOutcome, ModuleResult, RoomContext } from '@arena/shared';
import { chessBotMove } from './bot';

export const CHESS_BASE_MS = 5 * 60_000;
export const CHESS_INCREMENT_MS = 3_000;
/** a 🤖 bot "thinks" this long before it moves */
export const CHESS_BOT_MS = 1_800;

export interface ChessState {
  white: string;
  black: string;
  moves: string[];
  clock: { w: number; b: number };
  turnStartedAt: number | null;
  drawOfferBy: 'w' | 'b' | null;
  /** cached position so views never need to replay the game */
  fen: string;
  inCheck: boolean;
  result: { type: 'WIN'; winner: 'w' | 'b'; reason: string } | { type: 'DRAW'; reason: string } | null;
  /** colours played by a 🤖 bot (absent in rooms created before bots existed) */
  bots?: { w?: boolean; b?: boolean };
}

export function replay(moves: string[]): Chess {
  const game = new Chess();
  for (const m of moves) game.move(m);
  return game;
}

// one live board per isolate: consecutive moves of the same game reuse it instead of replaying
let live: { key: string; game: Chess } | null = null;
function board(moves: string[]): Chess {
  const key = moves.join(' ');
  if (live?.key !== key) live = { key, game: replay(moves) };
  return live.game;
}
const START_FEN = new Chess().fen();

/** Can `color` still deliver mate with its material? (K vs K, K+B, K+N cannot) */
function canMate(game: Chess, color: 'w' | 'b'): boolean {
  const pieces = game
    .board()
    .flat()
    .filter((p): p is NonNullable<typeof p> => !!p && p.color === color && p.type !== 'k');
  if (pieces.length === 0) return false;
  if (pieces.length === 1 && (pieces[0]!.type === 'b' || pieces[0]!.type === 'n')) return false;
  return true;
}

function terminal(game: Chess): ChessState['result'] {
  if (game.isCheckmate()) return { type: 'WIN', winner: game.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' };
  if (game.isStalemate()) return { type: 'DRAW', reason: 'stalemate' };
  if (game.isInsufficientMaterial()) return { type: 'DRAW', reason: 'insufficient material' };
  if (game.isThreefoldRepetition()) return { type: 'DRAW', reason: 'threefold repetition' };
  if (game.isDraw()) return { type: 'DRAW', reason: '50-move rule' };
  return null;
}

function outcomeOf(s: ChessState): MatchOutcome | undefined {
  if (!s.result) return undefined;
  if (s.result.type === 'DRAW') return { type: 'DRAW' };
  return { type: 'WIN', winnerUserId: s.result.winner === 'w' ? s.white : s.black, reason: s.result.reason === 'checkmate' ? 'NORMAL' : s.result.reason === 'time' ? 'TIMEOUT' : 'FORFEIT' };
}

function finalize(s: ChessState): ModuleResult<ChessState> {
  if (s.result) return { state: { ...s, turnStartedAt: null }, timerAt: null, outcome: outcomeOf(s), persist: [{ type: 'CHESS_FINISHED', payload: { result: s.result, moves: s.moves } }] };
  const turn = s.moves.length % 2 === 0 ? 'w' : 'b';
  const flag = s.turnStartedAt! + s.clock[turn];
  // a bot's turn wakes the room after a short pause so the server can play it
  return { state: s, timerAt: s.bots?.[turn] ? Math.min(flag, s.turnStartedAt! + CHESS_BOT_MS) : flag };
}

/** Plays one move for `color` (already checked to be on turn) and runs the clock. */
function playMove(state: ChessState, color: 'w' | 'b', from: string, to: string, promotion: string | undefined, ctx: RoomContext): ModuleResult<ChessState> | null {
  const spent = ctx.now - (state.turnStartedAt ?? ctx.now);
  const game = board(state.moves);
  let san: string;
  try {
    san = game.move({ from, to, promotion: promotion ?? 'q' }).san;
  } catch {
    return null;
  }
  const moves = [...state.moves, san];
  live = { key: moves.join(' '), game };
  const clock = { ...state.clock, [color]: state.clock[color] - spent + CHESS_INCREMENT_MS };
  const next: ChessState = { ...state, moves, clock, turnStartedAt: ctx.now, drawOfferBy: state.drawOfferBy === color ? color : null, fen: game.fen(), inCheck: game.inCheck(), result: terminal(game) };
  return { ...finalize(next), broadcast: [{ kind: 'move', san }] };
}

const colorOf = (s: ChessState, userId: string): 'w' | 'b' | null => (userId === s.white ? 'w' : userId === s.black ? 'b' : null);

export const chessModule: GameModule<ChessState> = {
  moduleKey: 'chess',
  version: '1.0.0',
  minPlayers: 2,
  maxPlayers: 2,
  // the clock keeps running while disconnected; flag fall decides
  disconnectPolicy: { reconnectWindowMs: 10 * 60_000, onTimeout: 'MODULE' },

  createRoom(ctx) {
    const [a, b] = [...ctx.players].sort((x, y) => x.seat - y.seat);
    const swap = ctx.random() < 0.5;
    const white = (swap ? b : a)!;
    const black = (swap ? a : b)!;
    const bots = white.isBot || black.isBot ? { ...(white.isBot ? { w: true } : {}), ...(black.isBot ? { b: true } : {}) } : undefined;
    return { white: white.userId, black: black.userId, moves: [], clock: { w: CHESS_BASE_MS, b: CHESS_BASE_MS }, turnStartedAt: null, drawOfferBy: null, fen: START_FEN, inCheck: false, result: null, ...(bots ? { bots } : {}) };
  },
  joinRoom: (state) => ({ state }),
  startMatch: (state, ctx) => finalize({ ...state, turnStartedAt: ctx.now }),

  handleMessage(state, userId, message, ctx) {
    const color = colorOf(state, userId);
    const m = message as { action?: string; from?: string; to?: string; promotion?: string } | null;
    if (!color || state.result) return { state };
    const turn = state.moves.length % 2 === 0 ? 'w' : 'b';
    if (m?.action === 'offer_draw') return { state: { ...state, drawOfferBy: color }, broadcast: [{ kind: 'draw_offer', by: color }] };
    if (m?.action === 'accept_draw') {
      if (!state.drawOfferBy || state.drawOfferBy === color) return { state, send: [{ userId, message: { error: 'No draw offer to accept' } }] };
      return finalize({ ...state, result: { type: 'DRAW', reason: 'agreement' } });
    }
    if (m?.action === 'decline_draw') return { state: { ...state, drawOfferBy: null } };
    if (m?.action !== 'move') return { state, send: [{ userId, message: { error: 'Unknown action' } }] };
    if (turn !== color) return { state, send: [{ userId, message: { error: 'Not your move' } }] };
    const spent = ctx.now - (state.turnStartedAt ?? ctx.now);
    if (spent >= state.clock[turn]) return chessModule.handleTimeout!(state, ctx);
    return playMove(state, color, m.from ?? '', m.to ?? '', m.promotion, ctx) ?? { state, send: [{ userId, message: { error: 'Illegal move' } }] };
  },

  handleTimeout(state, ctx) {
    if (state.result || state.turnStartedAt === null) return { state, timerAt: null };
    const turn = state.moves.length % 2 === 0 ? 'w' : 'b';
    const left = state.clock[turn] - (ctx.now - state.turnStartedAt);
    if (left > 0 && state.bots?.[turn]) {
      // the bot's move; a draw offer from the human is simply declined by playing on
      const pick = chessBotMove(state.moves, ctx.random);
      const played = playMove({ ...state, drawOfferBy: null }, turn, pick.from, pick.to, pick.promotion, ctx);
      if (played) return played;
    }
    if (left > 0) return { state, timerAt: ctx.now + left };
    const other = turn === 'w' ? 'b' : 'w';
    const result: ChessState['result'] = canMate(board(state.moves), other) ? { type: 'WIN', winner: other, reason: 'time' } : { type: 'DRAW', reason: 'timeout vs insufficient material' };
    return finalize({ ...state, clock: { ...state.clock, [turn]: 0 }, result });
  },

  validateResult(state, outcome) {
    const expected = outcomeOf(state);
    if (!expected || expected.type !== outcome.type) return { valid: false, reason: 'Outcome mismatch' };
    if (expected.type === 'WIN' && outcome.type === 'WIN' && expected.winnerUserId !== outcome.winnerUserId) return { valid: false, reason: 'Winner mismatch' };
    // moves must replay legally
    try {
      replay(state.moves);
    } catch {
      return { valid: false, reason: 'Move list does not replay' };
    }
    return { valid: true, proof: JSON.stringify({ moves: state.moves, result: state.result }) };
  },

  handleDisconnect: (state) => ({ state }),
  handleReconnect: (state) => ({ state }),
  handleDraw: (state) => finalize({ ...state, result: { type: 'DRAW', reason: 'agreement' } }),
  handleForfeit(state, userId) {
    const color = colorOf(state, userId);
    if (!color || state.result) return { state };
    return finalize({ ...state, result: { type: 'WIN', winner: color === 'w' ? 'b' : 'w', reason: 'resignation' } });
  },

  viewFor(state, userId) {
    return {
      you: colorOf(state, userId),
      fen: state.fen,
      moves: state.moves,
      turn: state.moves.length % 2 === 0 ? 'w' : 'b',
      inCheck: state.inCheck,
      clock: state.clock,
      turnStartedAt: state.turnStartedAt,
      drawOfferBy: state.drawOfferBy,
      result: state.result,
      white: state.white === userId ? 'you' : 'opponent',
    };
  },
};
