import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import type { LudoView } from '@arena/games/views';
import { Button } from '../../components/ui';
import type { GameClientProps } from '../types';
import { Dice3D } from '../shared/Dice3D';
import { playSound, useSoundOnChange } from '../shared/sound';
import { GameMessage, seatPlayers, TurnClock } from '../shared/GameUi';
import { BASES, HOME_COLUMNS, LUDO_COLOR_NAMES, LUDO_COLORS, LUDO_SHADES, STARS, TRACK, tokenCell } from './board';

const YARD_SLOTS: [number, number][] = [
  [1.75, 1.75],
  [4.25, 1.75],
  [1.75, 4.25],
  [4.25, 4.25],
];

/** A standing pawn: shaded cone body and glossy head in the player's colour. */
function Pawn({ color, id }: { color: number; id: string }) {
  const [light, base, dark] = LUDO_SHADES[color]!;
  return (
    <svg viewBox="0 0 40 64" className="h-full w-full overflow-visible drop-shadow-[0_3px_2px_rgb(0_0_0/0.45)]" aria-hidden>
      <defs>
        <linearGradient id={`${id}-body`} x1="0" x2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.45" stopColor={base} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
        <radialGradient id={`${id}-head`} cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="0.25" stopColor={light} />
          <stop offset="0.7" stopColor={base} />
          <stop offset="1" stopColor={dark} />
        </radialGradient>
      </defs>
      <ellipse cx="20" cy="56" rx="17" ry="6.5" fill={dark} />
      <path d="M3 55 Q3 49 9 47 L31 47 Q37 49 37 55 Q20 62 3 55Z" fill={`url(#${id}-body)`} />
      <path d="M8 49 Q15 36 15 26 L25 26 Q25 36 32 49 Z" fill={`url(#${id}-body)`} />
      <ellipse cx="20" cy="26.5" rx="9.5" ry="3.2" fill={dark} />
      <ellipse cx="20" cy="25.5" rx="9.5" ry="3" fill={`url(#${id}-body)`} />
      <circle cx="20" cy="15" r="11" fill={`url(#${id}-head)`} />
    </svg>
  );
}

function Board({ v }: { v: LudoView }) {
  return (
    <svg viewBox="0 0 15 15" className="block aspect-square w-full rounded-xl" role="img" aria-label="Ludo board">
      <defs>
        {LUDO_SHADES.map(([light, base, dark], c) => (
          <g key={c}>
            <radialGradient id={`ludo-yard-${c}`} cx="0.35" cy="0.3" r="0.9">
              <stop offset="0" stopColor={light} />
              <stop offset="0.6" stopColor={base} />
              <stop offset="1" stopColor={dark} />
            </radialGradient>
            <linearGradient id={`ludo-lane-${c}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={light} />
              <stop offset="1" stopColor={base} />
            </linearGradient>
            <radialGradient id={`ludo-well-${c}`} cx="0.5" cy="0.4" r="0.6">
              <stop offset="0" stopColor={dark} stopOpacity="0.15" />
              <stop offset="0.8" stopColor={dark} stopOpacity="0.45" />
              <stop offset="1" stopColor={dark} stopOpacity="0.8" />
            </radialGradient>
          </g>
        ))}
        <linearGradient id="ludo-square" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e7ebf2" />
        </linearGradient>
        <linearGradient id="ludo-yard-inner" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9dee8" />
          <stop offset="0.12" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f3f5f9" />
        </linearGradient>
      </defs>
      <rect width={15} height={15} fill="#f8fafc" />
      {BASES.map(([bx, by], c) => (
        <g key={c}>
          <rect x={bx} y={by} width={6} height={6} fill={`url(#ludo-yard-${c})`} />
          <rect x={bx + 0.75} y={by + 0.75} width={4.5} height={4.5} rx={0.45} fill="url(#ludo-yard-inner)" stroke={LUDO_SHADES[c]![2]} strokeWidth={0.08} />
          {YARD_SLOTS.map(([sx, sy], i) => (
            <circle key={i} cx={bx + sx} cy={by + sy} r={0.62} fill={`url(#ludo-well-${c})`} stroke={LUDO_SHADES[c]![2]} strokeOpacity={0.4} strokeWidth={0.05} />
          ))}
        </g>
      ))}
      {TRACK.map(([x, y], i) => {
        const startOf = [0, 13, 26, 39].indexOf(i);
        return (
          <g key={i}>
            <rect x={x + 0.03} y={y + 0.03} width={0.94} height={0.94} rx={0.12} fill={startOf >= 0 ? `url(#ludo-lane-${startOf})` : 'url(#ludo-square)'} stroke="#b8c2d3" strokeWidth={0.03} />
            {STARS.includes(i) && startOf < 0 && (
              <text x={x + 0.5} y={y + 0.74} textAnchor="middle" fontSize={0.66} fill="#94a3b8">
                ★
              </text>
            )}
            {startOf >= 0 && (
              <text x={x + 0.5} y={y + 0.74} textAnchor="middle" fontSize={0.66} fill="#fff">
                ★
              </text>
            )}
          </g>
        );
      })}
      {HOME_COLUMNS.map((col, c) => col.map(([x, y], i) => <rect key={`${c}-${i}`} x={x + 0.03} y={y + 0.03} width={0.94} height={0.94} rx={0.12} fill={`url(#ludo-lane-${c})`} stroke="#fff" strokeWidth={0.04} />))}
      <polygon points="6,6 9,6 7.5,7.5" fill={`url(#ludo-yard-1)`} />
      <polygon points="9,6 9,9 7.5,7.5" fill={`url(#ludo-yard-2)`} />
      <polygon points="9,9 6,9 7.5,7.5" fill={`url(#ludo-yard-3)`} />
      <polygon points="6,9 6,6 7.5,7.5" fill={`url(#ludo-yard-0)`} />
      <circle cx={7.5} cy={7.5} r={0.55} fill="#fff" fillOpacity={0.85} />
      <text x={7.5} y={7.72} textAnchor="middle" fontSize={0.6}>
        🏠
      </text>
      {v.eliminated.map((out, p) => {
        if (!out) return null;
        const [bx, by] = BASES[v.colors[p]!]!;
        return <rect key={p} x={bx} y={by} width={6} height={6} fill="#0f172a" fillOpacity={0.55} />;
      })}
    </svg>
  );
}

const HOP_MS = 150;

/**
 * Replays each new move square by square (Ludo King style) instead of sliding straight across the
 * board. Returns the progress to draw for the moving token while the hop runs, or null.
 */
function useHop(v: LudoView | null) {
  const mv = v?.lastMove ?? null;
  // moves up to doneN are drawn at their final square; the page never replays a move it opened on
  const [doneN, setDoneN] = useState(mv?.n ?? 0);
  const [step, setStep] = useState<{ n: number; i: number } | null>(null);
  const path = mv ? (mv.from === -1 ? [0] : Array.from({ length: mv.to - mv.from }, (_, i) => mv.from + i + 1)) : [];
  useEffect(() => {
    if (!mv || mv.n <= doneN) return;
    let i = 0;
    setStep({ n: mv.n, i: 0 });
    playSound('step');
    const t = setInterval(() => {
      i += 1;
      if (i >= path.length) {
        clearInterval(t);
        setStep(null);
        setDoneN(mv.n);
        if (mv.captured.length) playSound('capture');
      } else {
        setStep({ n: mv.n, i });
        playSound('step');
      }
    }, HOP_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mv?.n]);
  if (!mv || mv.n <= doneN) return null;
  // a new move is shown from its first hop square in the same render the server state arrives,
  // so the pawn never flashes at its destination before hopping there
  const i = step && step.n === mv.n ? step.i : 0;
  return { move: mv, progress: path[i]! };
}

export function LudoClient({ match, room }: GameClientProps) {
  const v = room.view as LudoView | null;
  const players = seatPlayers(match);
  const hop = useHop(v);
  useSoundOnChange(v?.lastRoll?.n, () => 'dice');

  // auto-move when there is no real choice (one movable token, or all movable tokens equivalent)
  const autoSent = useRef(0);
  const rollN = v?.lastRoll?.n ?? 0;
  const onlyChoice = v && v.phase === 'MOVE' && v.turn === v.you && new Set(v.movable.map((t) => v.tokens[v.you]![t])).size === 1 ? v.movable[0]! : null;
  useEffect(() => {
    if (onlyChoice === null || autoSent.current === rollN) return;
    const t = setTimeout(() => {
      autoSent.current = rollN;
      room.send({ t: 'move', data: { action: 'move', token: onlyChoice } });
    }, 650);
    return () => clearTimeout(t);
  }, [onlyChoice, rollN, room]);

  const tokens = useMemo(() => {
    if (!v) return [];
    const list: { player: number; token: number; x: number; y: number; movable: boolean }[] = [];
    const seen = new Map<string, number>();
    const captured = hop?.move.captured ?? [];
    v.tokens.forEach((toks, p) =>
      toks.forEach((prog, t) => {
        if (v.eliminated[p]) return;
        let shown = prog;
        let color = v.colors[p]!;
        if (hop && hop.move.player === p && hop.move.token === t) shown = hop.progress;
        else if (hop && captured.some((c) => c.player === p && c.token === t)) {
          // a captured token waits on its square until the attacker lands
          shown = hop.move.to;
          color = v.colors[hop.move.player]!;
        }
        let [x, y] = tokenCell(color, shown, t);
        const key = `${x},${y}`;
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        if (shown >= 0) {
          x += (n % 2) * 0.22 - 0.11 * Math.min(n, 1);
          y += Math.floor(n / 2) * 0.22 - 0.11 * Math.min(n, 1);
        }
        list.push({ player: p, token: t, x, y, movable: !hop && v.phase === 'MOVE' && v.turn === v.you && p === v.you && v.movable.includes(t) });
      }),
    );
    // paint back-to-front so nearer pawns overlap farther ones
    return list.sort((a, b) => a.y - b.y);
  }, [v, hop]);
  if (!v) return <GameMessage>Waiting for all players to join the table…</GameMessage>;

  const myTurn = v.turn === v.you && v.phase !== 'OVER';
  const canRoll = myTurn && v.phase === 'ROLL';
  const roll = () => room.send({ t: 'move', data: { action: 'roll' } });
  const status =
    v.phase === 'OVER'
      ? v.winner === v.you
        ? 'You won! 🎉'
        : `${players[v.winner ?? 0]?.username} won`
      : myTurn
        ? v.phase === 'ROLL'
          ? 'Your turn — roll the die'
          : 'Choose a token to move'
        : `${players[v.turn]?.username}'s turn`;
  const turnColor = LUDO_COLORS[v.colors[v.turn] ?? 0];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,560px)_1fr]">
      <div className="stage-3d mx-auto w-full max-w-[560px] px-1 pt-2 pb-8">
        <div className="slab wood-frame rounded-[22px] p-[3.2%]" style={{ '--tilt': '28deg' } as CSSProperties}>
          <div className="preserve-3d relative">
            <Board v={v} />
            <div className="sheen rounded-xl" />
            {tokens.map((t) => {
              const id = `pawn-${t.player}-${t.token}`;
              return (
                <div
                  key={id}
                  className={clsx('preserve-3d absolute h-[6.6%] w-[6.6%] -translate-x-1/2 -translate-y-1/2 transition-[left,top] ease-out', hop ? 'duration-[140ms]' : 'duration-300')}
                  style={{ left: `${(t.x / 15) * 100}%`, top: `${(t.y / 15) * 100}%` }}
                >
                  <span className="absolute inset-[8%] rounded-full bg-black/40 blur-[2px] [transform:translateZ(1px)]" />
                  {/* lifted 1–2px off the board so they never z-fight with the board surface */}
                  {t.movable && <span className="glow-ring absolute -inset-[30%] rounded-full border-[3px] border-white shadow-[0_0_14px_4px_rgb(167_139_250/0.9)] [transform:translateZ(2px)]" />}
                  <button
                    type="button"
                    disabled={!t.movable}
                    onClick={() => room.send({ t: 'move', data: { action: 'move', token: t.token } })}
                    aria-label={t.movable ? `Move token ${t.token + 1}` : `${LUDO_COLOR_NAMES[v.colors[t.player]!]} token`}
                    className={clsx('upright absolute bottom-1/2 left-[-5%] h-[165%] w-[110%] disabled:cursor-default', t.movable && 'cursor-pointer')}
                  >
                    <span className={clsx('block h-full w-full', t.movable && 'pawn-bob')}>
                      <Pawn color={v.colors[t.player]!} id={id} />
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <GameMessage tone={v.phase === 'OVER' ? (v.winner === v.you ? 'success' : 'danger') : 'info'}>{status}</GameMessage>
        <div className="flex items-center justify-between gap-3 rounded-2xl p-4 shadow-inner" style={{ background: `radial-gradient(circle at 30% 20%, ${turnColor}55, transparent 70%), #0f172a` }}>
          <button type="button" onClick={roll} disabled={!canRoll} className={clsx('rounded-2xl p-2 transition', canRoll && 'cursor-pointer ring-2 ring-white/60 hover:scale-105')} aria-label="Roll the die">
            <Dice3D value={v.dice ?? v.lastRoll?.dice ?? null} rollId={v.lastRoll?.n ?? 0} size={68} />
          </button>
          <div className="text-right text-white">
            <p className="text-xs tracking-wide text-white/60 uppercase">{v.lastRoll ? `${players[v.lastRoll.player]?.username ?? 'Player'} rolled` : 'No roll yet'}</p>
            <p className="text-3xl font-black">{v.lastRoll?.dice ?? '–'}</p>
            <TurnClock deadline={v.deadline} serverOffset={room.serverOffset} />
          </div>
        </div>
        <Button size="lg" className="w-full" disabled={!canRoll} onClick={roll}>
          Roll the die
        </Button>
        {room.lastError && <p className="text-sm text-rose-600">{room.lastError}</p>}
        <ul className="space-y-2">
          {players.map((p, i) => (
            <li key={p.playerNumber} className={clsx('flex items-center justify-between rounded-xl border px-3 py-2 text-sm', v.turn === i && v.phase !== 'OVER' ? 'border-brand-400 bg-brand-50 dark:bg-brand-500/10' : 'border-ink-200 dark:border-ink-700')}>
              <span className="flex items-center gap-2 font-semibold">
                <span className="size-3.5 rounded-full shadow-[inset_-2px_-2px_3px_rgb(0_0_0/0.35)]" style={{ background: LUDO_COLORS[v.colors[i]!] }} />
                {p.username} {i === v.you && <span className="text-xs text-brand-600">(you)</span>}
              </span>
              <span className="text-xs text-ink-500">
                {v.eliminated[i] ? 'out' : `${v.tokens[i]!.filter((x) => x === 56).length}/4 home · ${LUDO_COLOR_NAMES[v.colors[i]!]}`}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-500">Roll a 6 to bring a token out. 6, a capture or reaching home gives another roll. ★ squares are safe. Missing 3 turns in a row removes you from the game.</p>
      </div>
    </div>
  );
}
