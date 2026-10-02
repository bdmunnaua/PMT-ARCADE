import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import { Chess, type Square } from 'chess.js';
import type { ChessView } from '@arena/games/views';
import { Button, ConfirmDialog } from '../../components/ui';
import { GameMessage } from '../shared/GameUi';
import { useSoundOnChange } from '../shared/sound';
import type { GameClientProps } from '../types';

// solid glyphs for both colours (shaded ivory / ebony in game3d.css); U+FE0E keeps text presentation, never emoji
const SOLID: Record<string, string> = { k: '♚︎', q: '♛︎', r: '♜︎', b: '♝︎', n: '♞︎', p: '♟︎' };
const FILES = 'abcdefgh';
const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** Pieces of `victim` colour missing from the board (captured by the other side), and material. */
function material(game: Chess) {
  const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 } as Record<string, number>, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } as Record<string, number> };
  let score = { w: 0, b: 0 };
  for (const p of game.board().flat()) {
    if (!p || p.type === 'k') continue;
    count[p.color][p.type]! += 1;
    score = { ...score, [p.color]: score[p.color] + VALUE[p.type]! };
  }
  const missing = (c: 'w' | 'b') => Object.entries(START).flatMap(([t, n]) => Array.from({ length: Math.max(0, n - count[c][t]!) }, () => t));
  return { lostBy: { w: missing('w'), b: missing('b') }, lead: { w: score.w - score.b, b: score.b - score.w } };
}

function useNow(offset: number) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), 200);
    return () => clearInterval(t);
  }, [offset]);
  return now;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function ChessClient({ match, room }: GameClientProps) {
  const v = room.view as ChessView | null;
  const [selected, setSelected] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const now = useNow(room.serverOffset);
  const game = useMemo(() => (v ? new Chess(v.fen) : null), [v]);
  // last move squares, for the highlight (the view carries SAN moves only)
  const moveCount = v?.moves.length ?? 0;
  const last = useMemo(() => {
    if (!v || moveCount === 0) return null;
    const g = new Chess();
    for (const m of v.moves) g.move(m);
    return g.history({ verbose: true }).at(-1) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveCount]);
  useSoundOnChange(moveCount, () => {
    const san = v?.moves.at(-1) ?? '';
    return /[+#]/.test(san) ? 'check' : san.includes('x') ? 'take' : 'move';
  });
  if (!v || !game) return <GameMessage>Waiting for both players…</GameMessage>;

  const me = match.players.find((p) => p.isYou);
  const opp = match.players.find((p) => !p.isYou);
  const flipped = v.you === 'b';
  const myTurn = v.you === v.turn && !v.result;
  const targets = selected ? game.moves({ square: selected, verbose: true }).map((m) => m.to) : [];
  const clock = (c: 'w' | 'b') => (v.turn === c && v.turnStartedAt && !v.result ? v.clock[c] - (now - v.turnStartedAt) : v.clock[c]);

  const click = (sq: Square) => {
    if (!myTurn) return;
    const piece = game.get(sq);
    if (selected && targets.includes(sq)) {
      // a pawn reaching the last rank: ask which piece, like chess.com
      if (game.moves({ square: selected, verbose: true }).some((m) => m.to === sq && m.promotion)) setPromo({ from: selected, to: sq });
      else room.send({ t: 'move', data: { action: 'move', from: selected, to: sq, promotion: 'q' } });
      setSelected(null);
    } else if (piece && piece.color === v.you) setSelected(sq);
    else setSelected(null);
  };

  const rows = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const cols = flipped ? [...FILES].reverse() : [...FILES];
  const youColor = v.you ?? 'w';
  const oppColor = youColor === 'w' ? 'b' : 'w';
  let status = myTurn ? (v.inCheck ? 'Check! Your move' : 'Your move') : `${opp?.username ?? 'Opponent'} to move`;
  if (v.result) status = v.result.type === 'DRAW' ? `Draw — ${v.result.reason}` : v.result.winner === v.you ? `You won by ${v.result.reason}! 🎉` : `You lost by ${v.result.reason}`;

  const mat = material(game);
  const ClockBox = ({ c, label }: { c: 'w' | 'b'; label: string }) => (
    <div className={clsx('flex items-center justify-between rounded-xl px-4 py-2', v.turn === c && !v.result ? 'bg-brand-600 text-white' : 'bg-ink-100 dark:bg-ink-800')}>
      <span className="min-w-0">
        <span className="block font-semibold">
          {c === 'w' ? '⚪' : '⚫'} {label}
        </span>
        {/* pieces this player has captured, and their material lead */}
        <span className="flex h-4 items-center gap-1 text-sm leading-none opacity-80" aria-label="Captured pieces">
          <span className="tracking-[-0.2em]">{mat.lostBy[c === 'w' ? 'b' : 'w'].map((t) => SOLID[t]).join('')}</span>
          {mat.lead[c] > 0 && <span className="text-xs font-bold">+{mat.lead[c]}</span>}
        </span>
      </span>
      <span className={clsx('font-mono text-xl font-bold tabular-nums', clock(c) < 20_000 && 'text-rose-300')}>{fmt(clock(c))}</span>
    </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,520px)_1fr]">
      <div className="space-y-2">
        <ClockBox c={oppColor} label={opp?.username ?? 'Opponent'} />
        <div className="stage-3d relative px-1 pt-1 pb-7">
          <div className="slab wood-frame rounded-2xl p-[3%]" style={{ '--tilt': '24deg', '--edge-top': '#5b3310', '--edge-bottom': '#241105' } as CSSProperties}>
            <div className="preserve-3d relative grid aspect-square grid-cols-8 grid-rows-8 rounded-md ring-2 ring-black/30" role="grid" aria-label="Chess board">
              {rows.map((r, ri) =>
                cols.map((f, ci) => {
                  const sq = `${f}${r}` as Square;
                  const piece = game.get(sq);
                  const dark = (FILES.indexOf(f) + r) % 2 === 0;
                  const corner = clsx(ri === 0 && ci === 0 && 'rounded-tl-md', ri === 0 && ci === 7 && 'rounded-tr-md', ri === 7 && ci === 0 && 'rounded-bl-md', ri === 7 && ci === 7 && 'rounded-br-md');
                  return (
                    <button
                      key={sq}
                      type="button"
                      onClick={() => click(sq)}
                      aria-label={`${sq}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : ''}`}
                      className={clsx(
                        'preserve-3d relative min-h-0 min-w-0 select-none',
                        corner,
                        dark ? 'bg-gradient-to-br from-[#bf8a5e] to-[#9a6640]' : 'bg-gradient-to-br from-[#f5e6c8] to-[#e4cb9d]',
                        selected === sq && 'shadow-[inset_0_0_0_4px_#8b5cf6]',
                        piece?.type === 'k' && piece.color === v.turn && v.inCheck && 'shadow-[inset_0_0_18px_6px_#f43f5e]',
                      )}
                    >
                      {last && (last.from === sq || last.to === sq) && <span className="absolute inset-0 bg-amber-300/45" />}
                      {targets.includes(sq) && (
                        <span className={clsx('absolute inset-0 m-auto rounded-full', piece ? 'size-[88%] border-4 border-brand-500/70' : 'size-[30%] bg-brand-600/55')} />
                      )}
                      {ci === 0 && <span className="absolute top-0.5 left-0.5 text-[9px] font-semibold text-black/45">{r}</span>}
                      {ri === 7 && <span className="absolute right-0.5 bottom-0 text-[9px] font-semibold text-black/45">{f}</span>}
                      {piece && (
                        <>
                          <span className="absolute inset-x-[18%] bottom-[22%] h-[26%] rounded-[50%] bg-black/40 blur-[2px]" />
                          <span className="upright absolute inset-x-0 bottom-[34%] flex justify-center">
                            <span className={clsx('chess-piece text-[min(10.5vw,3.6rem)]', piece.color === 'w' ? 'chess-white' : 'chess-black')}>{SOLID[piece.type]}</span>
                          </span>
                        </>
                      )}
                    </button>
                  );
                }),
              )}
            </div>
          </div>
          {promo && (
            <div className="absolute inset-0 z-20 grid place-items-center rounded-2xl bg-black/50" role="dialog" aria-label="Choose promotion piece">
              <div className="flex gap-2 rounded-2xl bg-white p-3 shadow-2xl dark:bg-ink-800">
                {(['q', 'r', 'b', 'n'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="grid size-14 place-items-center rounded-xl bg-gradient-to-br from-[#f5e6c8] to-[#e4cb9d] hover:ring-4 hover:ring-brand-500"
                    aria-label={{ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[t]}
                    onClick={() => {
                      room.send({ t: 'move', data: { action: 'move', from: promo.from, to: promo.to, promotion: t } });
                      setPromo(null);
                    }}
                  >
                    <span className={clsx('chess-piece text-4xl', youColor === 'w' ? 'chess-white' : 'chess-black')}>{SOLID[t]}</span>
                  </button>
                ))}
                <button type="button" className="px-2 text-sm text-ink-500" onClick={() => setPromo(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        <ClockBox c={youColor} label={`${me?.username ?? 'You'} (you)`} />
      </div>
      <div className="space-y-4">
        <GameMessage tone={v.result ? (v.result.type === 'WIN' && v.result.winner === v.you ? 'success' : v.result.type === 'DRAW' ? 'info' : 'danger') : 'info'}>{status}</GameMessage>
        {!v.result && (
          <div className="flex flex-wrap gap-2">
            {v.drawOfferBy && v.drawOfferBy !== v.you ? (
              <>
                <Button size="sm" onClick={() => room.send({ t: 'move', data: { action: 'accept_draw' } })}>
                  Accept draw
                </Button>
                <Button size="sm" variant="outline" onClick={() => room.send({ t: 'move', data: { action: 'decline_draw' } })}>
                  Decline
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" disabled={v.drawOfferBy === v.you} onClick={() => room.send({ t: 'move', data: { action: 'offer_draw' } })}>
                {v.drawOfferBy === v.you ? 'Draw offered' : 'Offer draw'}
              </Button>
            )}
            <Button size="sm" variant="danger" onClick={() => setConfirmResign(true)}>
              Resign
            </Button>
            <ConfirmDialog
              open={confirmResign}
              onClose={() => setConfirmResign(false)}
              title="Resign this game?"
              message="Resigning counts as a loss and your stake goes to your opponent."
              confirmLabel="Resign"
              tone="danger"
              onConfirm={async () => {
                room.send({ t: 'forfeit' });
                setConfirmResign(false);
              }}
            />
          </div>
        )}
        {room.lastError && <p className="text-sm text-rose-600">{room.lastError}</p>}
        <div className="max-h-64 overflow-y-auto rounded-xl border border-ink-200 p-3 font-mono text-sm dark:border-ink-700">
          {v.moves.length === 0 ? (
            <span className="text-ink-500">No moves yet. White starts.</span>
          ) : (
            <ol className="grid grid-cols-[auto_1fr_1fr] gap-x-3">
              {Array.from({ length: Math.ceil(v.moves.length / 2) }, (_, i) => (
                <li key={i} className="contents">
                  <span className="text-ink-400">{i + 1}.</span>
                  <span>{v.moves[i * 2]}</span>
                  <span>{v.moves[i * 2 + 1] ?? ''}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <p className="text-xs text-ink-500">Blitz: 5 minutes + 3 seconds per move. If your clock reaches zero you lose (unless your opponent cannot mate). Resigning counts as a loss.</p>
      </div>
    </div>
  );
}
