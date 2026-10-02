/**
 * PMT price ladder. The price only moves up one stage at a time, and only when the taka reserve
 * can back it (see apps/api/src/services/reserve.ts). Rates are whole PMT per ৳1; the sell-back
 * rate is 10% higher than the buy rate (the spread that builds the reserve and pays the platform).
 * Stages beyond ৳0.10 need finer rates than whole PMT per ৳1 and are not configured yet.
 */
export interface LadderStage {
  buy: number;
  sell: number;
  /** price of 1 PMT in taka, for display */
  priceBdt: number;
}

export const PRICE_LADDER: LadderStage[] = [
  { buy: 1000, sell: 1100, priceBdt: 0.001 },
  { buy: 500, sell: 550, priceBdt: 0.002 },
  { buy: 200, sell: 220, priceBdt: 0.005 },
  { buy: 100, sell: 110, priceBdt: 0.01 },
  { buy: 50, sell: 55, priceBdt: 0.02 },
  { buy: 20, sell: 22, priceBdt: 0.05 },
  { buy: 10, sell: 11, priceBdt: 0.1 },
];

export const LADDER_RULES = {
  /** the reserve (after pending sells) must cover this share of what is owed at the new sell rate */
  minCoverageBps: 5_000,
  /** at least this long between price steps */
  minDaysBetweenSteps: 30,
} as const;

/** Index of the stage whose buy rate matches, or -1 when the rates are custom. */
export function ladderIndex(buyTokensPerBdt: number): number {
  return PRICE_LADDER.findIndex((s) => s.buy === buyTokensPerBdt);
}

/**
 * What players could sell back, in poisha, at a sell rate: units / rate, rounded up
 * (1 PMT = 100 units and ৳1 = 100 poisha, so poisha = units ÷ PMT-per-৳).
 */
export function liabilityPoisha(sellableUnits: number, sellTokensPerBdt: number): number {
  return Math.ceil(sellableUnits / sellTokensPerBdt);
}

/** Coverage in basis points (10000 = 100%); null when nothing is owed. */
export function coverageBps(freeReservePoisha: number, owedPoisha: number): number | null {
  if (owedPoisha <= 0) return null;
  return Math.floor((Math.max(0, freeReservePoisha) * 10_000) / owedPoisha);
}
