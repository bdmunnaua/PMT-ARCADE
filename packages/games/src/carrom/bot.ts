/**
 * 🤖 Carrom bot. Like a player it looks for "ghost ball" shots: for each own coin (and the Queen,
 * once allowed) and each pocket it places the striker so it hits the coin toward that pocket,
 * picks the power from the distances, then tries the most promising few with the real physics
 * and keeps the shot with the best result. It is decent but not perfect, so people can win.
 */
import { BASELINE, baselineY, COIN_R, MAX_SPEED, POCKETS, STRIKER_R } from './physics';
import { autoShot, nearestValidX, shoot, validStrikerX, type CarromState } from './rules';

const FRICTION = 650;
/** how many candidate shots are run through the physics (each costs a few ms of CPU) */
const SIMULATE = 3;
/** aiming error in radians (≈ 4°) and how often the bot just takes a plausible shot untested */
const AIM_NOISE = 0.07;
const CASUAL_SHOT = 0.45;

interface Aim {
  x: number;
  angle: number;
  power: number;
  prior: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function candidates(state: CarromState, player: number): Aim[] {
  const color = state.colors[player]!;
  const y = baselineY(player);
  const queenAllowed = state.pocketedBy[color].length > 0 && state.queen.status === 'BOARD';
  const targets = state.coins.filter((c) => c.id[0] === color || (c.id === 'Q' && queenAllowed));
  const out: Aim[] = [];
  for (const coin of targets) {
    for (const [px, py] of POCKETS) {
      const toPocket = { x: px - coin.x, y: py - coin.y };
      const d2 = Math.hypot(toPocket.x, toPocket.y);
      if (d2 < 1) continue;
      const u = { x: toPocket.x / d2, y: toPocket.y / d2 };
      // where the striker's centre must be when it touches the coin
      const ghost = { x: coin.x - u.x * (COIN_R + STRIKER_R), y: coin.y - u.y * (COIN_R + STRIKER_R) };
      // striker x on the baseline that lines up with the pocket (a straight shot), plus nearby options
      const straight = Math.abs(u.y) > 0.05 ? coin.x - (u.x / u.y) * (coin.y - y) : coin.x;
      for (const raw of [straight, ghost.x, (straight + ghost.x) / 2]) {
        const x0 = clamp(raw, BASELINE.min, BASELINE.max);
        const x = validStrikerX(state, player, x0) ? x0 : nearestValidX(state, player, x0);
        const dir = { x: ghost.x - x, y: ghost.y - y };
        const d1 = Math.hypot(dir.x, dir.y);
        if (d1 < 1) continue;
        const cos = (dir.x * u.x + dir.y * u.y) / d1; // 1 = straight, 0 = 90° cut (impossible)
        if (cos < 0.35) continue;
        // speeds: coin must reach the pocket, striker loses speed to friction before the hit
        const coinSpeed = Math.sqrt(2 * FRICTION * d2) * 1.3 + 120;
        const strikerAtHit = coinSpeed / (1.35 * cos);
        const power = clamp(Math.sqrt(strikerAtHit ** 2 + 2 * FRICTION * d1) / MAX_SPEED, 0.3, 1);
        out.push({ x, angle: Math.atan2(dir.y, dir.x), power, prior: cos * 2 - (d1 + d2) / 1400 });
      }
    }
  }
  return out.sort((a, b) => b.prior - a.prior);
}

function score(before: CarromState, after: CarromState, player: number): number {
  const color = before.colors[player]!;
  const other = color === 'W' ? 'B' : 'W';
  const shot = after.lastShot;
  let s = (after.pocketedBy[color].length - before.pocketedBy[color].length) * 100;
  s -= (after.pocketedBy[other].length - before.pocketedBy[other].length) * 70;
  if (shot?.foul) s -= 250;
  if (after.queen.status === 'COVERED' && after.queen.by === player && before.queen.status !== 'COVERED') s += 180;
  if (after.queen.status === 'PENDING' && after.queen.by === player) s += 40;
  if (after.phase === 'OVER') s += after.winner === player ? 10_000 : -10_000;
  if (shot?.continues) s += 30;
  return s;
}

/** The bot's shot for the player on turn. */
export function carromBotShot(state: CarromState, random: () => number): { x: number; angle: number; power: number } {
  const player = state.turn;
  const pool = candidates(state, player);
  const jitter = (c: Aim) => ({ x: c.x, angle: c.angle + (random() - 0.5) * 2 * AIM_NOISE, power: clamp(c.power * (0.92 + random() * 0.16), 0.3, 1) });
  // sometimes it just goes for a decent-looking shot, like a person who does not overthink
  if (pool.length && random() < CASUAL_SHOT) return jitter(pool[Math.floor(random() * Math.min(6, pool.length))]!);
  let best: { aim: { x: number; angle: number; power: number }; score: number } | null = null;
  for (const c of pool.slice(0, SIMULATE)) {
    // the result is judged with the shot exactly as it will be played, imprecision included
    const aim = jitter(c);
    try {
      const s = score(state, shoot(state, player, aim.x, aim.angle, aim.power), player) + c.prior;
      if (!best || s > best.score) best = { aim, score: s };
    } catch {
      /* invalid placement — skip */
    }
  }
  return best?.aim ?? autoShot(state);
}

