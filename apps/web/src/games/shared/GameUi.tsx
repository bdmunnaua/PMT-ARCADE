/** UI building blocks shared by the game clients. */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import clsx from 'clsx';
import { label as cardLabel, isRed, rankOf, RANK_LABEL, SUIT_SYMBOL, suitOf, type Card } from '@arena/games/cards';
import type { MatchDto } from '@arena/shared';
import { Volume2, VolumeX } from 'lucide-react';
import { setMuted, useMuted } from './sound';

/** Players of a match in seat order — index i matches the game state's player i. */
export function seatPlayers(match: MatchDto) {
  return [...match.players].sort((a, b) => a.seat - b.seat);
}

// court-card emblems; U+FE0E keeps them as text, never emoji
const COURT: Record<string, string> = { J: '⚜︎', Q: '♛︎', K: '♚︎' };

/** A playing card with paper shading, a visible edge (thickness) and a soft drop shadow. */
export function PlayingCard({ card, size = 'md', onClick, playable, dim, className, style }: { card: Card; size?: 'sm' | 'md' | 'lg'; onClick?: () => void; playable?: boolean; dim?: boolean; className?: string; style?: CSSProperties }) {
  const red = isRed(card);
  const dims = size === 'sm' ? 'h-14 w-10 text-[11px]' : size === 'lg' ? 'h-28 w-20 text-lg' : 'h-20 w-14 text-sm';
  const rank = RANK_LABEL[rankOf(card)] ?? rankOf(card);
  const suit = SUIT_SYMBOL[suitOf(card)];
  const court = COURT[rank];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick || !playable}
      aria-label={cardLabel(card)}
      style={style}
      className={clsx(
        'playing-card relative flex shrink-0 flex-col justify-between rounded-[10px] p-1 font-extrabold transition-[translate,box-shadow,opacity] duration-150 select-none',
        dims,
        red ? 'text-[#d61f45]' : 'text-[#141824]',
        playable && onClick ? 'cursor-pointer ring-2 ring-amber-300 hover:-translate-y-3 hover:shadow-[0_0_0_2px_#fcd34d,0_14px_22px_-6px_rgb(0_0_0/0.55)]' : '',
        dim && 'opacity-55 saturate-50',
        className,
      )}
    >
      <span className="relative z-10 w-[1.1em] text-center text-[1.12em] leading-[0.9] font-black">
        {rank}
        <br />
        <span className="text-[0.9em]">{suit}</span>
      </span>
      {court ? (
        <span className={clsx('absolute inset-[22%] grid place-items-center rounded-md border text-[1.5em] leading-none', red ? 'border-rose-300 bg-gradient-to-b from-rose-50 to-amber-100' : 'border-slate-300 bg-gradient-to-b from-slate-50 to-amber-100')}>
          {court}
        </span>
      ) : (
        <span className={clsx('self-center leading-none drop-shadow-[0_1px_0_rgb(0_0_0/0.15)]', rank === 'A' ? 'text-[2.2em]' : 'text-[1.6em]')}>{suit}</span>
      )}
      <span className="rotate-180 self-end leading-[0.95]">
        {rank}
        <br />
        {suit}
      </span>
    </button>
  );
}

export function CardBack({ size = 'sm', style }: { size?: 'sm' | 'md'; style?: CSSProperties }) {
  return <div className={clsx('card-back rounded-md', size === 'sm' ? 'h-10 w-7' : 'h-14 w-10')} style={style} aria-hidden />;
}

/** Countdown to a server deadline (ms). */
export function TurnClock({ deadline, serverOffset, label }: { deadline: number | null | undefined; serverOffset: number; label?: string }) {
  const [now, setNow] = useState(() => Date.now() + serverOffset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + serverOffset), 250);
    return () => clearInterval(t);
  }, [serverOffset]);
  if (!deadline) return null;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums', left <= 5 ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300' : 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200')}>
      ⏱ {label ? `${label} ` : ''}
      {left}s
    </span>
  );
}

/** A player badge: glossy avatar coin with the initial, name, number and a glowing ring on their turn. */
export function SeatTag({ name, number, active, you, extra, tone }: { name: string; number: number; active?: boolean; you?: boolean; extra?: ReactNode; tone?: string }) {
  return (
    <div className={clsx('flex items-center gap-2 rounded-2xl py-1 pr-3 pl-1 text-xs shadow-[0_6px_14px_-4px_rgb(0_0_0/0.6)] transition', active ? 'bg-gradient-to-b from-brand-500 to-brand-700 text-white ring-4 ring-amber-300/70' : 'bg-gradient-to-b from-white to-ink-100 text-ink-800 dark:from-ink-700 dark:to-ink-800 dark:text-ink-100')}>
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full text-sm font-black text-white shadow-[inset_-2px_-3px_5px_rgb(0_0_0/0.35),inset_2px_2px_3px_rgb(255_255_255/0.35)]"
        style={{ background: tone ?? '#64748b' }}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="text-left leading-tight">
        <span className="flex items-center gap-1 font-bold">
          {name}
          {you && <span className="rounded bg-black/15 px-1 text-[9px] dark:bg-white/20">YOU</span>}
        </span>
        <span className="block opacity-75">#{number}</span>
        {extra && <span className="block font-semibold">{extra}</span>}
      </span>
    </div>
  );
}

export function GameMessage({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'success' | 'danger' }) {
  return (
    <div
      className={clsx(
        'rounded-xl px-4 py-2 text-center text-sm font-semibold',
        tone === 'success' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
        tone === 'danger' && 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200',
        tone === 'info' && 'bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-200',
      )}
      role="status"
    >
      {children}
    </div>
  );
}

/** Position of a seat relative to the viewer around a 4-seat table: 0 bottom, 1 left, 2 top, 3 right. */
export const relativeSeat = (seat: number, you: number, n = 4) => (seat - Math.max(you, 0) + n) % n;

/** Sound on/off button (remembered on this device). */
export function SoundToggle({ className }: { className?: string }) {
  const muted = useMuted();
  return (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      className={clsx('grid size-8 place-items-center rounded-full text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-ink-100', className)}
      aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
      title={muted ? 'Sound off' : 'Sound on'}
    >
      {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
    </button>
  );
}
