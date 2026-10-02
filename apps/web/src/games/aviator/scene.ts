/**
 * Aviator canvas scene: night sky with parallax stars, a perspective grid floor that rushes toward
 * the viewer while flying, the glowing flight path and a shaded plane that banks with the climb.
 * Pure drawing — all numbers come from the server round (the browser never decides anything).
 */
import { multiplierAt } from '@arena/games/aviator';

export interface SceneInput {
  phase: 'BETTING' | 'FLYING' | 'CRASHED' | 'NONE';
  /** ms since take-off (frozen at the crash time once crashed) */
  elapsed: number;
  /** ms since the crash, when crashed */
  sinceCrash: number;
  /** wall clock in ms, for idle motion */
  now: number;
}

const STARS = Array.from({ length: 90 }, (_, i) => {
  // deterministic pseudo-random field, so stars don't jump between frames
  const r = (n: number) => {
    const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: r(1), y: r(2) * 0.7, z: 0.2 + r(3) * 0.8, tw: r(4) * 6.28 };
});

export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, s: SceneInput): void {
  const horizon = h * 0.7;
  const flying = s.phase === 'FLYING';
  const travel = s.elapsed / 1000;

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#070a1f');
  sky.addColorStop(0.6, '#1a1050');
  sky.addColorStop(1, '#4a1360');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);

  // glow on the horizon
  const sun = ctx.createRadialGradient(w * 0.72, horizon, 0, w * 0.72, horizon, w * 0.55);
  sun.addColorStop(0, 'rgba(255,120,190,0.55)');
  sun.addColorStop(0.35, 'rgba(160,80,255,0.18)');
  sun.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, horizon);

  // stars: nearer stars drift faster (parallax) while flying
  for (const st of STARS) {
    const x = (((st.x - travel * 0.03 * st.z) % 1) + 1) % 1;
    const a = 0.35 + 0.45 * Math.abs(Math.sin(s.now / 700 + st.tw));
    ctx.fillStyle = `rgba(255,255,255,${a * st.z})`;
    ctx.beginPath();
    ctx.arc(x * w, st.y * horizon, (0.6 + st.z * 1.4) * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  // floor + perspective grid rushing toward the viewer
  const floor = ctx.createLinearGradient(0, horizon, 0, h);
  floor.addColorStop(0, '#2a0c3d');
  floor.addColorStop(1, '#07030f');
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, w, h - horizon);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, horizon, w, h - horizon);
  ctx.clip();
  ctx.lineWidth = 1.2 * dpr;
  const shift = flying ? (travel * 1.6) % 1 : (s.now / 4000) % 1;
  for (let i = 0; i < 14; i++) {
    const k = (i + shift) / 14;
    const y = horizon + (h - horizon) * k * k;
    ctx.strokeStyle = `rgba(196,140,255,${0.08 + k * 0.55})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const vx = w * 0.5;
  for (let i = -12; i <= 12; i++) {
    ctx.strokeStyle = 'rgba(196,140,255,0.28)';
    ctx.beginPath();
    ctx.moveTo(vx + i * w * 0.012, horizon);
    ctx.lineTo(vx + i * w * 0.16, h);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(255,140,220,0.5)';
  ctx.fillRect(0, horizon - dpr, w, 2 * dpr);

  // flight path: x is time, y is the multiplier, auto-scaled so the plane stays on screen
  const ox = w * 0.06;
  const oy = horizon + (h - horizon) * 0.35;
  const span = Math.max(8000, s.elapsed * 1.18);
  const top = Math.max(2, (multiplierAt(s.elapsed) / 100) * 1.25);
  const point = (t: number): [number, number] => {
    const m = multiplierAt(t) / 100;
    return [ox + (t / span) * (w * 0.86), oy - ((m - 1) / (top - 1)) * (oy - h * 0.1)];
  };
  let [px, py] = [ox, oy];
  let angle = -0.08;
  if (s.phase === 'FLYING' || s.phase === 'CRASHED') {
    const steps = 120;
    const path: [number, number][] = [];
    for (let i = 0; i <= steps; i++) path.push(point((s.elapsed * i) / steps));
    // area under the path
    const area = ctx.createLinearGradient(0, h * 0.1, 0, oy);
    area.addColorStop(0, s.phase === 'CRASHED' ? 'rgba(244,63,94,0.35)' : 'rgba(167,139,250,0.4)');
    area.addColorStop(1, 'rgba(167,139,250,0)');
    ctx.fillStyle = area;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    path.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(path[path.length - 1]![0], oy);
    ctx.closePath();
    ctx.fill();
    // glowing line
    ctx.save();
    ctx.shadowColor = s.phase === 'CRASHED' ? '#f43f5e' : '#c4b5fd';
    ctx.shadowBlur = 16 * dpr;
    ctx.strokeStyle = s.phase === 'CRASHED' ? '#fb7185' : '#e9d5ff';
    ctx.lineWidth = 4 * dpr;
    ctx.lineCap = 'round';
    ctx.beginPath();
    path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
    [px, py] = path[path.length - 1]!;
    const [qx, qy] = path[Math.max(0, path.length - 6)]!;
    angle = Math.atan2(py - qy, Math.max(1, px - qx));
  } else {
    py += Math.sin(s.now / 400) * 3 * dpr; // idling on the runway
  }

  const size = Math.min(w, h * 1.6) * 0.085;
  if (s.phase === 'CRASHED') {
    // flash at the crash point, then the plane flies off up and away
    const f = Math.min(1, s.sinceCrash / 700);
    ctx.save();
    ctx.globalAlpha = 1 - f;
    const boom = ctx.createRadialGradient(px, py, 0, px, py, size * (1 + f * 3));
    boom.addColorStop(0, 'rgba(255,255,255,0.9)');
    boom.addColorStop(0.3, 'rgba(251,113,133,0.7)');
    boom.addColorStop(1, 'rgba(251,113,133,0)');
    ctx.fillStyle = boom;
    ctx.beginPath();
    ctx.arc(px, py, size * (1 + f * 3), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const away = s.sinceCrash / 1000;
    px += away * w * 0.9;
    py -= away * h * 0.9;
    angle = -0.7;
    ctx.globalAlpha = Math.max(0, 1 - away * 1.2);
  }
  if (ctx.globalAlpha > 0) drawPlane(ctx, px, py, size, angle, s.now, flying);
  ctx.globalAlpha = 1;
}

/** A small propeller plane with lit/shaded surfaces, drawn nose-right around (x, y). */
function drawPlane(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, now: number, flying: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(size / 40, size / 40);
  ctx.translate(-20, 0);

  // shadow-side wing (behind the body)
  ctx.fillStyle = '#7f1d1d';
  ctx.beginPath();
  ctx.moveTo(18, -2);
  ctx.lineTo(8, -16);
  ctx.lineTo(14, -16);
  ctx.lineTo(28, -2);
  ctx.closePath();
  ctx.fill();

  // fuselage
  const body = ctx.createLinearGradient(0, -8, 0, 8);
  body.addColorStop(0, '#fecaca');
  body.addColorStop(0.35, '#ef4444');
  body.addColorStop(1, '#7f1d1d');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-6, -2);
  ctx.quadraticCurveTo(10, -9, 34, -5);
  ctx.quadraticCurveTo(42, -2, 42, 1);
  ctx.quadraticCurveTo(42, 5, 34, 6);
  ctx.quadraticCurveTo(10, 8, -6, 3);
  ctx.closePath();
  ctx.fill();

  // tail fin
  ctx.fillStyle = '#b91c1c';
  ctx.beginPath();
  ctx.moveTo(-4, -2);
  ctx.lineTo(-10, -16);
  ctx.lineTo(-2, -15);
  ctx.lineTo(6, -4);
  ctx.closePath();
  ctx.fill();

  // cockpit glass
  const glass = ctx.createLinearGradient(20, -9, 26, -3);
  glass.addColorStop(0, '#e0f2fe');
  glass.addColorStop(1, '#0369a1');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.ellipse(24, -5, 6, 3.4, -0.15, Math.PI, 0);
  ctx.fill();

  // near wing (in front of the body)
  const wing = ctx.createLinearGradient(14, 0, 22, 18);
  wing.addColorStop(0, '#f87171');
  wing.addColorStop(1, '#991b1b');
  ctx.fillStyle = wing;
  ctx.beginPath();
  ctx.moveTo(16, 2);
  ctx.lineTo(6, 19);
  ctx.lineTo(14, 19);
  ctx.lineTo(30, 3);
  ctx.closePath();
  ctx.fill();

  // spinning propeller (a blurred disc while flying)
  ctx.fillStyle = 'rgba(226,232,240,0.55)';
  ctx.beginPath();
  ctx.ellipse(43, 0.5, 1.6, flying ? 11 : 9 * Math.abs(Math.sin(now / 90)) + 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.arc(43, 0.5, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
