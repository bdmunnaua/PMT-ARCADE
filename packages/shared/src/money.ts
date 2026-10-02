/**
 * Integer-only token and BDT math.
 *
 * 1 TOKEN = 100 TOKEN_UNITS. 1 BDT = 100 poisha.
 * Every stored or computed amount is a safe integer number of units.
 * Multiplication/division that could overflow goes through BigInt.
 * No function in this file performs floating point arithmetic on amounts.
 */

export const TOKEN_UNITS_PER_TOKEN = 100;
export const POISHA_PER_BDT = 100;
export const TOKEN_SYMBOL = 'PMT';
export const BDT_SYMBOL = '৳';

export class MoneyError extends Error {}

export function isUnits(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertUnits(value: unknown, label = 'amount'): number {
  if (!isUnits(value)) throw new MoneyError(`${label} must be a safe integer, got ${String(value)}`);
  return value;
}

export function assertPositiveUnits(value: unknown, label = 'amount'): number {
  const n = assertUnits(value, label);
  if (n <= 0) throw new MoneyError(`${label} must be positive`);
  return n;
}

function toSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`${label} exceeds the safe integer range`);
  }
  return Number(value);
}

/** floor(a * b / c) using BigInt; a, b >= 0, c > 0. */
export function mulDivFloor(a: number, b: number, c: number): number {
  assertUnits(a, 'a');
  assertUnits(b, 'b');
  assertUnits(c, 'c');
  if (a < 0 || b < 0 || c <= 0) throw new MoneyError('mulDivFloor expects a,b >= 0 and c > 0');
  return toSafeNumber((BigInt(a) * BigInt(b)) / BigInt(c), 'mulDivFloor result');
}

export function mulUnits(a: number, b: number): number {
  assertUnits(a, 'a');
  assertUnits(b, 'b');
  return toSafeNumber(BigInt(a) * BigInt(b), 'product');
}

export function addUnits(...values: number[]): number {
  let total = 0n;
  for (const v of values) total += BigInt(assertUnits(v));
  return toSafeNumber(total, 'sum');
}

export function tokensToUnits(wholeTokens: number): number {
  return mulUnits(assertUnits(wholeTokens, 'tokens'), TOKEN_UNITS_PER_TOKEN);
}

/**
 * Parse a decimal string (e.g. "1,000.5") into integer minor units with `decimals` places.
 * Returns null for anything that is not a plain non-negative decimal number.
 */
export function parseDecimalToMinor(input: string, decimals = 2): number | null {
  const cleaned = input.replace(/[,\s_]/g, '');
  const re = new RegExp(`^(\\d{1,15})(?:\\.(\\d{0,${decimals}}))?$`);
  const m = re.exec(cleaned);
  if (!m) return null;
  const whole = m[1] ?? '0';
  const frac = (m[2] ?? '').padEnd(decimals, '0');
  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || '0');
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

/** "1,000.50" → 100050 token units. */
export function parseTokenAmount(input: string): number | null {
  return parseDecimalToMinor(input, 2);
}

/** "100" → 10000 poisha. */
export function parseBdtAmount(input: string): number | null {
  return parseDecimalToMinor(input, 2);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Format integer minor units as a grouped decimal string, trimming ".00". */
export function formatMinor(minor: number, opts: { decimals?: number; signed?: boolean; keepZeros?: boolean } = {}): string {
  const decimals = opts.decimals ?? 2;
  assertUnits(minor);
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  let frac = digits.slice(digits.length - decimals);
  if (!opts.keepZeros) frac = frac.replace(/0+$/, '');
  const body = groupThousands(whole) + (frac ? `.${frac}` : '');
  const sign = negative ? '-' : opts.signed && minor > 0 ? '+' : '';
  return sign + body;
}

export function formatTokens(units: number, opts: { signed?: boolean; symbol?: boolean } = {}): string {
  const s = formatMinor(units, { signed: opts.signed });
  return opts.symbol === false ? s : `${s} ${TOKEN_SYMBOL}`;
}

export function formatBdt(poisha: number, opts: { signed?: boolean } = {}): string {
  const s = formatMinor(poisha, { signed: opts.signed });
  return s.startsWith('-') || s.startsWith('+') ? `${s[0]}${BDT_SYMBOL}${s.slice(1)}` : `${BDT_SYMBOL}${s}`;
}
