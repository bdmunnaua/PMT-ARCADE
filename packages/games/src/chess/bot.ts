/**
 * 🤖 Chess bot: a quick, human-like club player, cheap enough for a Worker.
 * Each legal move is scored by: mate / material won / the worst capture the opponent can answer
 * with (pieces left hanging) / check / centre and development / promotion, plus a little
 * randomness so games do not repeat. It never searches deeper than that reply, so it can be beaten.
 */
import { Chess, type Move, type Square } from 'chess.js';

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const CENTRE = new Set(['d4', 'e4', 'd5', 'e5']);
const NEAR_CENTRE = new Set(['c3', 'd3', 'e3', 'f3', 'c4', 'f4', 'c5', 'f5', 'c6', 'd6', 'e6', 'f6']);

function material(game: Chess, color: 'w' | 'b'): number {
  let score = 0;
  for (const row of game.board()) for (const p of row) if (p) score += (p.color === color ? 1 : -1) * VALUE[p.type]!;
  return score;
}

/** The most the side to move can win right now with one capture (a piece left hanging). */
function bestCapture(game: Chess): number {
  let best = 0;
  for (const m of game.moves({ verbose: true }) as Move[]) {
    if (!m.captured) continue;
    const gain = VALUE[m.captured]! - (game.isAttacked(m.to as Square, m.color === 'w' ? 'b' : 'w') ? VALUE[m.piece]! : 0);
    if (gain > best) best = gain;
  }
  return best;
}

/** Picks the bot's move for the position after `moves`; returns { from, to, promotion }. */
export function chessBotMove(moves: string[], random: () => number): { from: string; to: string; promotion?: string } {
  const game = new Chess();
  for (const m of moves) game.move(m);
  const me = game.turn();
  const legal = game.moves({ verbose: true }) as Move[];
  if (legal.length === 0) throw new Error('No legal move');
  const opening = moves.length < 12;
  let best: { move: Move; score: number } | null = null;
  for (const move of legal) {
    game.move(move);
    let score: number;
    if (game.isCheckmate()) score = 100_000;
    else if (game.isDraw() || game.isStalemate()) score = material(game, me) > 200 ? -5_000 : 0;
    else {
      score = material(game, me) - bestCapture(game) * 0.9;
      if (game.inCheck()) score += 25;
      if (CENTRE.has(move.to)) score += 18;
      else if (NEAR_CENTRE.has(move.to)) score += 8;
      if (opening && (move.piece === 'n' || move.piece === 'b') && (move.from[1] === '1' || move.from[1] === '8')) score += 15;
      if (opening && move.piece === 'q') score -= 20;
      if (opening && move.piece === 'k' && !move.flags.includes('k') && !move.flags.includes('q')) score -= 40;
      if (move.flags.includes('k') || move.flags.includes('q')) score += 30;
      if (move.promotion) score += 50;
    }
    score += random() * 12;
    game.undo();
    if (!best || score > best.score) best = { move, score };
  }
  const m = best!.move;
  return { from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) };
}
