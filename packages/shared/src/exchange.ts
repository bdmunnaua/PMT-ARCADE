import { assertUnits, MoneyError, mulUnits } from './money';

/**
 * Exchange rates are integers: tokens per 1 BDT.
 *   BUY_TOKENS_PER_BDT  = 110 → ৳1 buys 110 TOKEN
 *   SELL_TOKENS_PER_BDT = 120 → 120 TOKEN redeem for ৳1
 *
 * Because 1 TOKEN = 100 units and ৳1 = 100 poisha, the conversions reduce to:
 *   buy:  tokenUnits = poisha × BUY_TOKENS_PER_BDT
 *   sell: poisha     = floor(tokenUnits / SELL_TOKENS_PER_BDT)
 *
 * Sell rounding is DOWN (any remainder below 1 poisha is not paid out).
 */
export function tokenUnitsForBdt(poisha: number, buyTokensPerBdt: number): number {
  assertUnits(poisha, 'poisha');
  assertUnits(buyTokensPerBdt, 'buyTokensPerBdt');
  if (poisha <= 0 || buyTokensPerBdt <= 0) throw new MoneyError('amount and rate must be positive');
  return mulUnits(poisha, buyTokensPerBdt);
}

export function bdtPoishaForTokenUnits(tokenUnits: number, sellTokensPerBdt: number): number {
  assertUnits(tokenUnits, 'tokenUnits');
  assertUnits(sellTokensPerBdt, 'sellTokensPerBdt');
  if (tokenUnits <= 0 || sellTokensPerBdt <= 0) throw new MoneyError('amount and rate must be positive');
  return Math.floor(tokenUnits / sellTokensPerBdt); // both safe integers; result is exact integer division
}

/**
 * Buying and immediately selling must never return more BDT than was paid.
 * With integer rates this holds exactly when SELL_TOKENS_PER_BDT > BUY_TOKENS_PER_BDT
 * (equality would allow a zero-margin loop that still costs the treasury on rounding edge cases
 * and leaves no buffer for payment fees, so it is also refused).
 */
export function isArbitrageSafe(buyTokensPerBdt: number, sellTokensPerBdt: number): boolean {
  return Number.isSafeInteger(buyTokensPerBdt) && Number.isSafeInteger(sellTokensPerBdt) && sellTokensPerBdt > buyTokensPerBdt;
}
