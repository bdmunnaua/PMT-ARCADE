/**
 * Carrom physics, run ONLY on the server (the browser just replays the returned keyframes).
 * Board units: 1000 × 1000 playing surface. Real proportions: 74 cm board → coin Ø 3.18 cm,
 * striker Ø 4.13 cm, pocket Ø 4.45 cm. Fixed-step integration with sliding friction, elastic
 * piece collisions (restitution 0.92) and lossy cushions (0.75).
 */
export const BOARD = 1000;
export const COIN_R = 21;
export const STRIKER_R = 28;
export const POCKET_R = 32;
export const POCKETS: [number, number][] = [
  [POCKET_R, POCKET_R],
  [BOARD - POCKET_R, POCKET_R],
  [POCKET_R, BOARD - POCKET_R],
  [BOARD - POCKET_R, BOARD - POCKET_R],
];
export const MAX_SPEED = 3200; // units / s at full power
const FRICTION = 650; // deceleration, units / s²
const DT = 1 / 600;
const MAX_TIME = 12;
const FRAME_EVERY = 30; // steps per keyframe → 20 fps
const COIN_MASS = 1;
const STRIKER_MASS = 2.7;
const RESTITUTION = 0.92;
const CUSHION = 0.75;

export interface Piece {
  id: string; // 'S' striker, 'Q' queen, 'W0'..'W8', 'B0'..'B8'
  x: number;
  y: number;
}

interface Body extends Piece {
  vx: number;
  vy: number;
  r: number;
  m: number;
  sunk: boolean;
}

export interface SimResult {
  pieces: Piece[]; // final positions of pieces still on the board (striker excluded)
  pocketed: string[]; // in the order they fell (may include 'S')
  frames: [string, number, number][][]; // keyframes: [id, x, y] of moving/visible pieces
}

export function simulateShot(coins: Piece[], striker: { x: number; y: number }, angle: number, power: number): SimResult {
  const speed = Math.max(0.05, Math.min(1, power)) * MAX_SPEED;
  const bodies: Body[] = [
    { id: 'S', x: striker.x, y: striker.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: STRIKER_R, m: STRIKER_MASS, sunk: false },
    ...coins.map((c) => ({ ...c, vx: 0, vy: 0, r: COIN_R, m: COIN_MASS, sunk: false })),
  ];
  const pocketed: string[] = [];
  const frames: [string, number, number][][] = [];
  const snapshot = () => frames.push(bodies.filter((b) => !b.sunk).map((b) => [b.id, Math.round(b.x), Math.round(b.y)]));
  snapshot();
  const steps = Math.ceil(MAX_TIME / DT);
  for (let step = 1; step <= steps; step++) {
    let moving = false;
    for (const b of bodies) {
      if (b.sunk) continue;
      const v = Math.hypot(b.vx, b.vy);
      if (v === 0) continue;
      const nv = Math.max(0, v - FRICTION * DT);
      if (nv < 1) {
        b.vx = 0;
        b.vy = 0;
        continue;
      }
      moving = true;
      b.vx *= nv / v;
      b.vy *= nv / v;
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      // cushions
      if (b.x < b.r) [b.x, b.vx] = [b.r, Math.abs(b.vx) * CUSHION];
      if (b.x > BOARD - b.r) [b.x, b.vx] = [BOARD - b.r, -Math.abs(b.vx) * CUSHION];
      if (b.y < b.r) [b.y, b.vy] = [b.r, Math.abs(b.vy) * CUSHION];
      if (b.y > BOARD - b.r) [b.y, b.vy] = [BOARD - b.r, -Math.abs(b.vy) * CUSHION];
    }
    // collisions
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      if (a.sunk) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]!;
        if (b.sunk) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const min = a.r + b.r;
        if (dist === 0 || dist >= min) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        // separate
        const overlap = min - dist;
        const total = a.m + b.m;
        a.x -= nx * overlap * (b.m / total);
        a.y -= ny * overlap * (b.m / total);
        b.x += nx * overlap * (a.m / total);
        b.y += ny * overlap * (a.m / total);
        // impulse
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel >= 0) continue;
        const j2 = (-(1 + RESTITUTION) * rel) / (1 / a.m + 1 / b.m);
        a.vx -= (j2 / a.m) * nx;
        a.vy -= (j2 / a.m) * ny;
        b.vx += (j2 / b.m) * nx;
        b.vy += (j2 / b.m) * ny;
        moving = true;
      }
    }
    // pockets
    for (const b of bodies) {
      if (b.sunk) continue;
      if (POCKETS.some(([px, py]) => Math.hypot(b.x - px, b.y - py) < POCKET_R)) {
        b.sunk = true;
        b.vx = 0;
        b.vy = 0;
        pocketed.push(b.id);
      }
    }
    if (step % FRAME_EVERY === 0) snapshot();
    if (!moving) break;
  }
  snapshot();
  return { pieces: bodies.filter((b) => !b.sunk && b.id !== 'S').map(({ id, x, y }) => ({ id, x: Math.round(x), y: Math.round(y) })), pocketed, frames };
}

/** Standard starting rosette: queen in the centre, inner ring of 6, outer ring of 12, colours alternating. */
export function initialCoins(): Piece[] {
  const c = BOARD / 2;
  const pieces: Piece[] = [{ id: 'Q', x: c, y: c }];
  let w = 0;
  let k = 0;
  const ring = (count: number, radius: number, offset: number) => {
    for (let i = 0; i < count; i++) {
      const a = offset + (i * 2 * Math.PI) / count;
      const white = i % 2 === 0;
      pieces.push({ id: white ? `W${w++}` : `B${k++}`, x: Math.round(c + Math.cos(a) * radius), y: Math.round(c + Math.sin(a) * radius) });
    }
  };
  ring(6, COIN_R * 2 + 1, Math.PI / 2);
  ring(12, COIN_R * 4 + 2, Math.PI / 2 + Math.PI / 12);
  return pieces;
}

/** Nearest free spot to the centre for a returned coin. */
export function freeSpotNearCentre(pieces: Piece[]): { x: number; y: number } {
  const c = BOARD / 2;
  for (let r = 0; r < 300; r += 4) {
    for (let a = 0; a < 360; a += 15) {
      const x = Math.round(c + Math.cos((a * Math.PI) / 180) * r);
      const y = Math.round(c + Math.sin((a * Math.PI) / 180) * r);
      if (pieces.every((p) => Math.hypot(p.x - x, p.y - y) >= COIN_R * 2 + 1)) return { x, y };
    }
  }
  return { x: c, y: c };
}

export const BASELINE = { min: 190, max: 810, offsetFromEdge: 135 };
export const baselineY = (seat: number) => (seat === 0 ? BOARD - BASELINE.offsetFromEdge : BASELINE.offsetFromEdge);
