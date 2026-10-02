import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { BOARD, COIN_R, POCKETS, POCKET_R, STRIKER_R } from '@arena/games/carrom';
import type { CarromView } from '@arena/games/views';
import { Button } from '../../components/ui';
import { GameMessage, seatPlayers, TurnClock } from '../shared/GameUi';
import { playSound } from '../shared/sound';
import type { GameClientProps } from '../types';

type Frame = [string, number, number][];
const FRAME_MS = 50;
const PULL_FULL = 320; // board units of pull-back for 100% power

/**
 * Aim guide (Carrom Pool style): where the striker first touches a coin, and the direction that
 * coin will travel. Straight-line approximation for display only — the server runs the physics.
 */
function guide(coins: { id: string; x: number; y: number }[], sx: number, sy: number, angle: number) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best: { t: number; coin: { x: number; y: number } } | null = null;
  for (const c of coins) {
    const fx = sx - c.x;
    const fy = sy - c.y;
    const rr = COIN_R + STRIKER_R;
    const b = fx * dx + fy * dy;
    const disc = b * b - (fx * fx + fy * fy - rr * rr);
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0 && (!best || t < best.t)) best = { t, coin: c };
  }
  if (!best) {
    // to the cushion
    const tx = dx > 0 ? (BOARD - STRIKER_R - sx) / dx : dx < 0 ? (STRIKER_R - sx) / dx : Infinity;
    const ty = dy > 0 ? (BOARD - STRIKER_R - sy) / dy : dy < 0 ? (STRIKER_R - sy) / dy : Infinity;
    const t = Math.min(tx, ty);
    return { hit: null, end: [sx + dx * t, sy + dy * t] as const };
  }
  const hx = sx + dx * best.t;
  const hy = sy + dy * best.t;
  const nx = best.coin.x - hx;
  const ny = best.coin.y - hy;
  const n = Math.hypot(nx, ny) || 1;
  return { hit: { x: hx, y: hy, coin: best.coin, dir: [nx / n, ny / n] as const }, end: [hx, hy] as const };
}
const fill = (id: string) => (id === 'S' ? 'url(#cr-striker)' : id === 'Q' ? 'url(#cr-queen)' : id[0] === 'W' ? 'url(#cr-white)' : 'url(#cr-black)');
/** coin edge colour, drawn just below each disc so coins have visible thickness */
const rim = (id: string) => (id === 'S' ? '#92400e' : id === 'Q' ? '#7f1d1d' : id[0] === 'W' ? '#a89d80' : '#000');
const ring = (id: string) => (id === 'S' ? '#b45309' : id === 'Q' ? '#fecaca' : id[0] === 'W' ? '#c9bc9c' : '#4b5563');

export function CarromClient({ match, room }: GameClientProps) {
  const v = room.view as CarromView | null;
  const players = seatPlayers(match);
  const [x, setX] = useState(500);
  const [angle, setAngle] = useState(-Math.PI / 2);
  const [power, setPower] = useState(0.6);
  const [frame, setFrame] = useState<Frame | null>(null);
  const pull = useRef(false);
  const svg = useRef<SVGSVGElement>(null);

  // replay the server's keyframes for each new shot. Keyed on the shot counter only: other state
  // messages (timers, presence) arrive mid-replay and must not cancel it.
  // default aim: straight toward the opponent's side (board "up" for player 1, "down" for player 2)
  useEffect(() => {
    if (v) setAngle(v.you === 1 ? Math.PI / 2 : -Math.PI / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.you]);

  const lastShot = useRef(v?.lastShot ?? null);
  lastShot.current = v?.lastShot ?? null;
  useEffect(() => {
    const shot = lastShot.current;
    if (!shot) return;
    const frames = shot.frames;
    let i = 0;
    setFrame(frames[0] ?? null);
    playSound('clack');
    const t = setInterval(() => {
      i += 1;
      if (i >= frames.length) {
        clearInterval(t);
        setFrame(null);
        if (shot.pocketed.some((id) => id !== 'S')) playSound('pocket');
      } else setFrame(frames[i]!);
    }, FRAME_MS);
    return () => {
      clearInterval(t);
      setFrame(null);
    };
  }, [v?.shots]);

  if (!v) return <GameMessage>Waiting for both players…</GameMessage>;
  const flip = v.you === 1; // you always shoot from the bottom of your screen
  const down = flip ? -1 : 1; // screen-down in board coordinates, for coin edges and shadows
  const myTurn = v.turn === v.you && v.phase === 'AIM';
  const by = v.baseline.y[Math.max(v.you, 0)]!;
  // offsetX/Y are in the board's own (untransformed) pixels, so aiming stays exact on the tilted 3D board
  const toBoard = (e: PointerEvent<SVGSVGElement>) => {
    const el = svg.current!;
    let px = (e.nativeEvent.offsetX / el.clientWidth) * BOARD;
    let py = (e.nativeEvent.offsetY / el.clientHeight) * BOARD;
    if (flip) [px, py] = [BOARD - px, BOARD - py];
    return [px, py] as const;
  };
  // Press on the striker and pull back (slingshot): direction and length set aim and power, and
  // letting go shoots. Pressing anywhere else just aims the striker at that point.
  const aim = (e: PointerEvent<SVGSVGElement>) => {
    if (!myTurn || frame) return;
    const [px, py] = toBoard(e);
    if (e.type === 'pointerdown') {
      pull.current = Math.hypot(px - x, py - by) <= STRIKER_R * 2.2;
      try {
        e.currentTarget.setPointerCapture(e.pointerId); // keep receiving moves outside the board
      } catch {
        /* pointer already released — aiming still works without capture */
      }
    } else if (e.buttons === 0) return;
    if (pull.current) {
      const d = Math.hypot(px - x, py - by);
      if (d < 12) return;
      setAngle(Math.atan2(by - py, x - px));
      setPower(Math.max(0.05, Math.min(1, d / PULL_FULL)));
    } else setAngle(Math.atan2(py - by, px - x));
  };
  const release = (e: PointerEvent<SVGSVGElement>) => {
    if (!pull.current || !myTurn || frame) return;
    pull.current = false;
    const [px, py] = toBoard(e);
    if (Math.hypot(px - x, py - by) >= 30) room.send({ t: 'move', data: { action: 'shoot', x, angle, power } });
  };
  const pieces: Frame = frame ?? v.coins.map((c) => [c.id, c.x, c.y]);
  const showStriker = !frame && myTurn;
  const g = showStriker ? guide(pieces.filter((c) => c[0] !== 'S').map(([id, cx, cy]) => ({ id, x: cx, y: cy })), x, by, angle) : null;
  const color = v.colors[Math.max(v.you, 0)]!;
  const mine = (c: 'W' | 'B') => (c === 'W' ? 'White' : 'Black');

  let status = myTurn ? `Your shot — you play ${mine(color)}` : `${players[v.turn]?.username ?? 'Opponent'} is aiming…`;
  if (v.phase === 'OVER') status = v.draw ? 'Draw — stakes refunded' : v.winner === v.you ? 'You won the board! 🎉' : 'You lost this board';
  else if (v.lastShot?.foul && !frame) status = `Foul by ${v.lastShot.player === v.you ? 'you' : players[v.lastShot.player]?.username} — striker pocketed. ${status}`;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,560px)_1fr]">
      <div className="stage-3d mx-auto w-full max-w-[560px] px-1 pb-6">
        <div className="slab wood-frame rounded-[26px] p-[4.5%]" style={{ '--tilt': '22deg', '--edge-top': '#6b3a14', '--edge-bottom': '#2a1405' } as CSSProperties}>
          <svg
            ref={svg}
            viewBox={`0 0 ${BOARD} ${BOARD}`}
            className="block aspect-square w-full touch-none rounded-md shadow-[0_0_0_3px_#3b1d08]"
            onPointerDown={aim}
            onPointerMove={aim}
            onPointerUp={release}
            role="img"
            aria-label="Carrom board"
          >
            <defs>
              <radialGradient id="cr-surface" cx="0.42" cy="0.38" r="0.8">
                <stop offset="0" stopColor="#fbe7bd" />
                <stop offset="0.65" stopColor="#efd19a" />
                <stop offset="1" stopColor="#d9b06f" />
              </radialGradient>
              <radialGradient id="cr-pocket" cx="0.5" cy="0.45" r="0.55">
                <stop offset="0" stopColor="#000" />
                <stop offset="0.75" stopColor="#111" />
                <stop offset="1" stopColor="#3a2410" />
              </radialGradient>
              <radialGradient id="cr-white" cx="0.35" cy="0.3" r="0.8">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="0.6" stopColor="#f1ead9" />
                <stop offset="1" stopColor="#c9bc9c" />
              </radialGradient>
              <radialGradient id="cr-black" cx="0.35" cy="0.3" r="0.8">
                <stop offset="0" stopColor="#6b6b6b" />
                <stop offset="0.5" stopColor="#262626" />
                <stop offset="1" stopColor="#050505" />
              </radialGradient>
              <radialGradient id="cr-queen" cx="0.35" cy="0.3" r="0.8">
                <stop offset="0" stopColor="#ff8a8a" />
                <stop offset="0.5" stopColor="#dc2626" />
                <stop offset="1" stopColor="#7f1d1d" />
              </radialGradient>
              <radialGradient id="cr-striker" cx="0.35" cy="0.3" r="0.8">
                <stop offset="0" stopColor="#fffbea" />
                <stop offset="0.55" stopColor="#fde68a" />
                <stop offset="1" stopColor="#b7791f" />
              </radialGradient>
            </defs>
            <g transform={flip ? `rotate(180 ${BOARD / 2} ${BOARD / 2})` : undefined} style={{ pointerEvents: 'none' }}>
              <rect width={BOARD} height={BOARD} fill="url(#cr-surface)" />
              <rect x={60} y={60} width={BOARD - 120} height={BOARD - 120} fill="none" stroke="#7c2d12" strokeOpacity={0.35} strokeWidth={2} />
              <circle cx={500} cy={500} r={95} fill="none" stroke="#7c2d12" strokeWidth={3} />
              <circle cx={500} cy={500} r={COIN_R + 4} fill="#b91c1c" fillOpacity={0.18} stroke="#7c2d12" strokeWidth={2} />
              {[0, 1].map((s) => (
                <g key={s}>
                  <line x1={v.baseline.min} x2={v.baseline.max} y1={v.baseline.y[s]! - 18} y2={v.baseline.y[s]! - 18} stroke="#7c2d12" strokeWidth={2} />
                  <line x1={v.baseline.min} x2={v.baseline.max} y1={v.baseline.y[s]! + 18} y2={v.baseline.y[s]! + 18} stroke="#7c2d12" strokeWidth={2} />
                  {[v.baseline.min, v.baseline.max].map((cx) => (
                    <circle key={cx} cx={cx} cy={v.baseline.y[s]} r={18} fill="#b91c1c" fillOpacity={0.55} stroke="#7c2d12" strokeWidth={2} />
                  ))}
                </g>
              ))}
              {POCKETS.map(([px, py], i) => (
                <g key={i}>
                  <circle cx={px} cy={py} r={POCKET_R + 6} fill="#7c4a1e" fillOpacity={0.35} />
                  <circle cx={px} cy={py} r={POCKET_R} fill="url(#cr-pocket)" />
                </g>
              ))}
              {pieces.map(([id, px, py]) => {
                const r = id === 'S' ? STRIKER_R : COIN_R;
                return (
                  <g key={id}>
                    <ellipse cx={px + 3 * down} cy={py + 7 * down} rx={r} ry={r * 0.92} fill="#000" fillOpacity={0.35} />
                    <circle cx={px} cy={py + 4 * down} r={r} fill={rim(id)} />
                    <circle cx={px} cy={py} r={r} fill={fill(id)} />
                    <circle cx={px} cy={py} r={r * 0.62} fill="none" stroke={ring(id)} strokeWidth={2.5} />
                  </g>
                );
              })}
              {showStriker && (
                <g>
                  {g && (
                    <>
                      <line x1={x} y1={by} x2={g.end[0]} y2={g.end[1]} stroke="#fff" strokeOpacity={0.85} strokeWidth={4} strokeLinecap="round" strokeDasharray="10 10" />
                      {g.hit && (
                        <>
                          <circle cx={g.hit.x} cy={g.hit.y} r={STRIKER_R} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={3} />
                          <line x1={g.hit.coin.x} y1={g.hit.coin.y} x2={g.hit.coin.x + g.hit.dir[0] * 160} y2={g.hit.coin.y + g.hit.dir[1] * 160} stroke="#fde047" strokeWidth={4} strokeLinecap="round" />
                        </>
                      )}
                    </>
                  )}
                  {/* power: a ring that grows around the striker as you pull back */}
                  <circle cx={x} cy={by} r={STRIKER_R + 8 + power * 40} fill="none" stroke="#a78bfa" strokeOpacity={0.35 + power * 0.5} strokeWidth={5} />
                  <ellipse cx={x + 3 * down} cy={by + 8 * down} rx={STRIKER_R} ry={STRIKER_R * 0.92} fill="#000" fillOpacity={0.35} />
                  <circle cx={x} cy={by + 5 * down} r={STRIKER_R} fill="#92400e" />
                  <circle cx={x} cy={by} r={STRIKER_R} fill="url(#cr-striker)" stroke="#7c3aed" strokeWidth={4} />
                </g>
              )}
            </g>
          </svg>
          <div className="sheen pointer-events-none rounded-[26px]" />
        </div>
      </div>

      <div className="space-y-4">
        <GameMessage tone={v.phase === 'OVER' ? (v.winner === v.you ? 'success' : v.draw ? 'info' : 'danger') : 'info'}>{status}</GameMessage>
        <div className="flex items-center justify-between">
          <span className="text-sm">Queen: {v.queen.status === 'COVERED' ? `covered by ${v.queen.by === v.you ? 'you' : 'opponent'}` : v.queen.status === 'PENDING' ? 'pocketed — cover it!' : 'on the board'}</span>
          <TurnClock deadline={v.deadline} serverOffset={room.serverOffset} />
        </div>
        {myTurn && (
          <div className="space-y-3 rounded-xl border border-ink-200 p-4 dark:border-ink-700">
            <label className="block text-sm font-medium">
              Striker position
              <input type="range" min={v.baseline.min} max={v.baseline.max} value={x} onChange={(e) => setX(Number(e.target.value))} className="w-full accent-brand-600" />
            </label>
            <label className="block text-sm font-medium">
              Power {Math.round(power * 100)}%
              <input type="range" min={5} max={100} value={Math.round(power * 100)} onChange={(e) => setPower(Number(e.target.value) / 100)} className="w-full accent-brand-600" />
            </label>
            <p className="text-xs text-ink-500">Pull back from the striker and let go to shoot — or tap the board to aim and use the Shoot button. The white line shows the first coin you will hit and the yellow line where it goes.</p>
            <Button className="w-full" size="lg" disabled={!!frame} onClick={() => room.send({ t: 'move', data: { action: 'shoot', x, angle, power } })}>
              Shoot
            </Button>
          </div>
        )}
        {room.lastError && <p className="text-sm text-rose-600">{room.lastError}</p>}
        <div className="grid grid-cols-2 gap-2 text-center text-sm">
          {players.map((p, i) => (
            <div key={p.playerNumber} className="rounded-xl border border-ink-200 p-3 dark:border-ink-700">
              <p className="font-semibold">
                {p.username}
                {i === v.you ? ' (you)' : ''}
              </p>
              <p className="text-ink-500">{mine(v.colors[i]!)}</p>
              <p className="text-lg font-bold">{v.pocketedBy[v.colors[i]!].length}/9</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-500">Pocket all 9 of your coins. Pocketing your own coin gives another shot. The red Queen must be covered by pocketing one of your coins right after. Pocketing the striker is a foul. Pocketing your last coin before the Queen is covered is a foul (it comes back with a penalty coin). Pocketing your opponent’s last coin gives them the board.</p>
      </div>
    </div>
  );
}
