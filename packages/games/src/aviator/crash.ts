/**
 * Aviator (crash) math — shared by the server (authoritative) and the browser (animation + verification).
 *
 * Provably fair:
 *   1. Before betting opens the server picks a random 32-byte seed and publishes SHA-256(seed).
 *   2. crash point = f(HMAC-SHA256(key = seed, message = round number)) — fixed before any bet.
 *   3. After the crash the seed is revealed; anyone can recompute both the hash and the crash point.
 *
 *   h = first 52 bits of the HMAC;  E = 2^52
 *   if h % 101 == 0 → 1.00× (instant crash; this is the ≈1% house edge)
 *   else crash×100 = floor((100·E − h) / (E − h)), capped at the configured maximum.
 *
 * Flight: multiplier(t) = e^(GROWTH × t) (t in ms) → 2× after ≈11.6 s, 10× after ≈38 s, 100× after ≈77 s.
 * Multipliers are integers ×100 (e.g. 250 = 2.50×). Payouts use integer/BigInt math only.
 */
export const CRASH_GROWTH_PER_MS = 0.00006;
export const CRASH_BETTING_MS = 7_000;
export const CRASH_PAUSE_MS = 4_000;
export const CRASH_MIN_AUTO_X100 = 101;

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export function randomSeedHex(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Pure part of the formula, given the HMAC hex digest. */
export function crashFromHmacHex(hmacHex: string, maxX100: number): number {
  const h = BigInt(`0x${hmacHex.slice(0, 13)}`);
  if (h % 101n === 0n) return 100;
  const E = 2n ** 52n;
  const x = Number((100n * E - h) / (E - h));
  return Math.max(100, Math.min(maxX100, x));
}

export async function crashPointX100(seedHex: string, roundNumber: number, maxX100: number): Promise<number> {
  const key = await crypto.subtle.importKey('raw', enc.encode(seedHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(roundNumber)));
  return crashFromHmacHex(hex(sig), maxX100);
}

/** Multiplier ×100 after `elapsedMs` of flight (floored, ≥ 100). */
export function multiplierAt(elapsedMs: number): number {
  if (elapsedMs <= 0) return 100;
  return Math.max(100, Math.floor(100 * Math.exp(CRASH_GROWTH_PER_MS * elapsedMs) + 1e-9));
}

/** Flight time (ms) at which the multiplier reaches `x100`. */
export function timeToReach(x100: number): number {
  if (x100 <= 100) return 0;
  return Math.ceil(Math.log(x100 / 100) / CRASH_GROWTH_PER_MS);
}

/** Largest profit a bet can make: limited by the round cap and the per-bet profit limit. */
export function maxProfitUnits(stakeUnits: number, maxX100: number, maxProfit: number): number {
  const byCap = Number((BigInt(stakeUnits) * BigInt(maxX100 - 100)) / 100n);
  return Math.min(byCap, maxProfit);
}

/** Total paid back (stake + profit) when cashing out at `x100`. */
export function payoutUnits(stakeUnits: number, x100: number, maxProfit: number): number {
  const gross = Number((BigInt(stakeUnits) * BigInt(x100)) / 100n);
  return stakeUnits + Math.min(Math.max(gross - stakeUnits, 0), maxProfit);
}

export const formatX = (x100: number) => `${(x100 / 100).toFixed(2)}×`;
