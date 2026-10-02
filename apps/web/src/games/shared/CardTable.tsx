/** Four-seat 3D card table used by Call Bridge and Twenty-Nine. */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import clsx from 'clsx';
import type { Card } from '@arena/games/cards';
import type { MatchDto } from '@arena/shared';
import { CardBack, PlayingCard, relativeSeat, SeatTag, seatPlayers } from './GameUi';
import { useSoundOnChange } from './sound';

export interface TablePlay {
  player: number;
  card: Card;
}

// by position relative to you: 0 bottom, 1 left, 2 top, 3 right
const SEAT_POS = ['bottom-[3%] left-1/2 -translate-x-1/2', 'left-[3%] top-1/2 -translate-y-1/2', 'top-[3%] left-1/2 -translate-x-1/2', 'right-[3%] top-1/2 -translate-y-1/2'];
// offsets in card sizes (translate % is relative to the card itself)
const TRICK_AT: [string, string][] = [
  ['0%', '62%'],
  ['-118%', '0%'],
  ['0%', '-62%'],
  ['118%', '0%'],
];
const FLY_FROM: [string, string][] = [
  ['0px', '160px'],
  ['-170px', '0px'],
  ['0px', '-150px'],
  ['170px', '0px'],
];

const HOLD_MS = 1300;
const SWEEP_MS = 450;

/**
 * After the 4th card the server already starts the next trick, so the client keeps the finished
 * trick on the felt for a moment (winner highlighted) and then sweeps it to the winner — as card
 * apps do. Nothing here affects the game: it is display only.
 */
function useFinishedTrick(lastTrick: { plays: TablePlay[]; winner: number } | null | undefined) {
  const key = lastTrick ? lastTrick.plays.map((p) => p.card).join() : '';
  const [initialKey] = useState(key); // never replay a trick that was already over when the page opened
  const [phase, setPhase] = useState<'hold' | 'sweep' | null>(null);
  useEffect(() => {
    if (!key || key === initialKey) return;
    setPhase('hold');
    const a = setTimeout(() => setPhase('sweep'), HOLD_MS);
    const b = setTimeout(() => setPhase(null), HOLD_MS + SWEEP_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [key, initialKey]);
  return phase;
}

/** small fixed tilt per card so a trick looks tossed onto the felt, not laid on a grid */
const toss = (card: string) => ([...card].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 17) - 8;

export function CardTable({
  match,
  you,
  turn,
  handCounts,
  trick,
  seatExtra,
  centre,
  hand,
  legal,
  onPlay,
  teamTone,
  lastTrick,
}: {
  match: MatchDto;
  you: number;
  turn: number | null;
  handCounts: number[];
  trick: TablePlay[];
  seatExtra: (seat: number) => ReactNode;
  centre?: ReactNode;
  hand: Card[];
  legal: Card[];
  onPlay?: (card: Card) => void;
  teamTone?: (seat: number) => string | undefined;
  lastTrick?: { plays: TablePlay[]; winner: number } | null;
}) {
  const players = seatPlayers(match);
  const finished = useFinishedTrick(lastTrick);
  const showFinished = trick.length === 0 && finished !== null && !!lastTrick;
  const shownPlays = showFinished ? lastTrick.plays : trick;
  const sweepTo = showFinished && finished === 'sweep' ? FLY_FROM[relativeSeat(lastTrick.winner, you)]! : null;
  const canPlay = onPlay && !showFinished ? onPlay : undefined;
  useSoundOnChange(trick.map((t) => t.card).join() + '|' + (lastTrick?.plays.map((p) => p.card).join() ?? ''), () => 'card');
  const mid = (hand.length - 1) / 2;
  // tighter overlap only when the hand is big, so every corner index stays readable
  const overlap = hand.length > 10 ? '-ml-8 sm:-ml-6 lg:-ml-5' : hand.length > 6 ? '-ml-6 sm:-ml-4' : '-ml-3';
  return (
    <div className="space-y-2">
      <div className="stage-3d mx-auto -mt-6 w-full max-w-2xl px-1 pb-6">
        <div className="slab wood-frame rounded-[2.4rem] p-[2.4%]" style={{ '--tilt': '32deg', '--edge-top': '#5b3310', '--edge-bottom': '#200f04' } as CSSProperties}>
          <div className="felt preserve-3d relative aspect-[4/3] rounded-[2rem]">
            <div className="pointer-events-none absolute inset-[18%] rounded-[50%] border-2 border-white/10" />
            {[0, 1, 2, 3].map((seat) => {
              const pos = relativeSeat(seat, you);
              const p = players[seat];
              const backs = Math.min(handCounts[seat] ?? 0, 8);
              return (
                <div key={seat} className={clsx('preserve-3d absolute z-10', SEAT_POS[pos])}>
                  <div className="upright flex flex-col items-center gap-1">
                    {pos !== 0 && backs > 0 && (
                      <div className="flex h-11 items-end">
                        {Array.from({ length: backs }, (_, i) => (
                          <CardBack key={i} style={{ marginLeft: i ? -18 : 0, rotate: `${(i - (backs - 1) / 2) * 7}deg`, transformOrigin: '50% 120%' }} />
                        ))}
                      </div>
                    )}
                    {p && <SeatTag name={p.username} number={p.playerNumber} active={turn === seat} you={seat === you} extra={seatExtra(seat)} tone={teamTone?.(seat)} />}
                  </div>
                </div>
              );
            })}
            <div className="preserve-3d absolute inset-0">
              {shownPlays.map((t, i) => {
                const rel = relativeSeat(t.player, you);
                const [x, y] = TRICK_AT[rel]!;
                const [fx, fy] = FLY_FROM[rel]!;
                const won = showFinished && t.player === lastTrick.winner;
                // a finished trick: only its last card still needs to fly in
                const animateIn = !showFinished || i === shownPlays.length - 1;
                return (
                  <div
                    key={`${t.player}-${t.card}`}
                    className="absolute top-1/2 left-1/2 transition-[translate,opacity] duration-[450ms] ease-in"
                    style={{ translate: sweepTo ? `calc(-50% + ${sweepTo[0]}) calc(-50% + ${sweepTo[1]})` : `calc(-50% + ${x}) calc(-50% + ${y})`, opacity: sweepTo ? 0 : 1 }}
                  >
                    <div className={clsx(animateIn && 'card-in', won && 'rounded-[10px] shadow-[0_0_0_3px_#fcd34d,0_0_22px_6px_rgb(252_211_77/0.7)]')} style={{ '--from-x': fx, '--from-y': fy, rotate: `${toss(t.card)}deg` } as CSSProperties}>
                      <PlayingCard card={t.card} size="md" />
                    </div>
                  </div>
                );
              })}
              {showFinished && finished === 'hold' && (
                <div className="absolute bottom-[8%] left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-xs font-bold whitespace-nowrap text-amber-200">
                  {players[lastTrick.winner]?.username ?? 'Player'} wins the trick
                </div>
              )}
              {shownPlays.length === 0 && centre && <div className="absolute top-1/2 left-1/2 -translate-1/2 whitespace-nowrap">{centre}</div>}
            </div>
          </div>
        </div>
      </div>
      {/* your hand, fanned like cards held in the hand */}
      <div className="flex justify-center px-2 pt-3 pb-1">
        <div className="flex items-start">
          {hand.map((c, i) => {
            const off = i - mid;
            return (
              <div key={c} className={clsx(i > 0 && overlap)} style={{ rotate: `${off * 2.2}deg`, marginTop: `${Math.round(off * off * 0.6)}px`, transformOrigin: '50% 160%' }}>
                <PlayingCard card={c} size="md" className="lg:h-24 lg:w-16" playable={legal.includes(c)} dim={legal.length > 0 && !legal.includes(c)} onClick={canPlay ? () => canPlay(c) : undefined} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
