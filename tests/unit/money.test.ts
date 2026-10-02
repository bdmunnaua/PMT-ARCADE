import { describe, expect, it } from 'vitest';
import {
  bdtPoishaForTokenUnits,
  computeMatchFee,
  formatBdt,
  formatTokens,
  isArbitrageSafe,
  mulDivFloor,
  parseBdtAmount,
  parseTokenAmount,
  planRefund,
  planWinSettlement,
  splitStake,
  tokensToUnits,
  tokenUnitsForBdt,
} from '@arena/shared';

const T = (n: number) => n * 100;
const p = (userId: string, stake: number, bonus = 0) => ({ userId, stakeUnits: stake, stakeBonusUnits: bonus, stakeAvailableUnits: stake - bonus });

describe('token units', () => {
  it('1 TOKEN = 100 units', () => {
    expect(tokensToUnits(100)).toBe(10_000);
  });
  it('parses decimal strings without floating point', () => {
    expect(parseTokenAmount('1,000.5')).toBe(100_050);
    expect(parseTokenAmount('0.01')).toBe(1);
    expect(parseTokenAmount('0.001')).toBeNull();
    expect(parseTokenAmount('-5')).toBeNull();
    expect(parseTokenAmount('abc')).toBeNull();
    expect(parseBdtAmount('100')).toBe(10_000);
  });
  it('formats units back to tokens / taka', () => {
    expect(formatTokens(198_000)).toBe('1,980 PMT');
    expect(formatTokens(150, { signed: true })).toBe('+1.5 PMT');
    expect(formatTokens(-2_000)).toBe('-20 PMT');
    expect(formatBdt(10_000)).toBe('৳100');
  });
  it('mulDivFloor uses BigInt and floors', () => {
    expect(mulDivFloor(199, 100, 10_000)).toBe(1);
    expect(mulDivFloor(Number.MAX_SAFE_INTEGER, 1, 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => mulDivFloor(Number.MAX_SAFE_INTEGER, 2, 1)).toThrow();
  });
});

describe('1% platform match fee', () => {
  it('1000 vs 1000 → pot 2000, fee 20, winner 1980', () => {
    const plan = planWinSettlement([p('A', T(1000)), p('B', T(1000))], 'A', 100);
    expect(plan.potUnits).toBe(T(2000));
    expect(plan.feeUnits).toBe(T(20));
    expect(plan.payoutUnits).toBe(T(1980));
    expect(plan.payouts).toEqual({ A: T(1980), B: 0 });
  });
  it('fee = floor(pot × bps / 10000) — rounds down for tiny pots', () => {
    expect(computeMatchFee(199, 100)).toBe(1);
    expect(computeMatchFee(99, 100)).toBe(0);
    expect(computeMatchFee(T(2000), 0)).toBe(0);
    expect(() => computeMatchFee(100, 1001)).toThrow();
  });
  it('postings are balanced and fee goes only to PLATFORM_FEES', () => {
    const plan = planWinSettlement([p('A', T(1000)), p('B', T(1000))], 'B', 100);
    const total = plan.postings.reduce((s, x) => s + x.amount, 0);
    expect(total).toBe(plan.potUnits);
    const fees = plan.postings.filter((x) => 'system' in x.to);
    expect(fees.reduce((s, x) => s + x.amount, 0)).toBe(T(20));
    expect(fees.every((x) => x.postingType === 'PLATFORM_MATCH_FEE')).toBe(true);
    const toWinner = plan.postings.filter((x) => !('system' in x.to) && x.to.userId === 'B' && x.to.bucket === 'AVAILABLE');
    expect(toWinner.reduce((s, x) => s + x.amount, 0)).toBe(T(1980));
  });
  it('refund plan returns each stake to its original buckets, no fee', () => {
    const plan = planRefund([p('A', T(1000), T(300)), p('B', T(1000))]);
    expect(plan.payouts).toEqual({ A: T(1000), B: T(1000) });
    const a = plan.postings.filter((x) => x.fromUserId === 'A');
    expect(a.find((x) => !('system' in x.to) && x.to.bucket === 'BONUS')?.amount).toBe(T(300));
    expect(a.find((x) => !('system' in x.to) && x.to.bucket === 'AVAILABLE')?.amount).toBe(T(700));
    expect(plan.postings.some((x) => 'system' in x.to)).toBe(false);
  });
  it('rejects winners that are not participants and inconsistent stakes', () => {
    expect(() => planWinSettlement([p('A', 100), p('B', 100)], 'C', 100)).toThrow();
    expect(() => planWinSettlement([{ userId: 'A', stakeUnits: 100, stakeBonusUnits: 10, stakeAvailableUnits: 10 }, p('B', 100)], 'A', 100)).toThrow();
  });
  it('bonus stays bonus: free tokens can never be won into the sellable balance', () => {
    // two accounts staking only free (bonus) tokens against each other
    const plan = planWinSettlement([p('A', T(1000), T(1000)), p('B', T(1000), T(1000))], 'A', 100);
    const toA = (bucket: string) => plan.postings.filter((x) => !('system' in x.to) && x.to.userId === 'A' && x.to.bucket === bucket).reduce((n, x) => n + x.amount, 0);
    expect(toA('AVAILABLE')).toBe(0);
    expect(toA('BONUS')).toBe(T(1980));
  });
  it('mixed stakes: only the AVAILABLE-funded part of the pot is paid as AVAILABLE', () => {
    // A stakes 1000 bought; B stakes 1000 of which 400 bonus. Fee 20 comes from bonus escrow first.
    const plan = planWinSettlement([p('A', T(1000)), p('B', T(1000), T(400))], 'A', 100);
    const toA = (bucket: string) => plan.postings.filter((x) => !('system' in x.to) && x.to.userId === 'A' && x.to.bucket === bucket).reduce((n, x) => n + x.amount, 0);
    expect(toA('BONUS')).toBe(T(380));
    expect(toA('AVAILABLE')).toBe(T(1600));
    expect(plan.payouts.A).toBe(T(1980));
  });
  it('stake split uses BONUS first, then AVAILABLE', () => {
    expect(splitStake(1000, 5000, 300)).toEqual({ fromBonus: 300, fromAvailable: 700 });
    expect(splitStake(1000, 500, 300)).toBeNull();
  });
});

describe('exchange rates', () => {
  it('buy ৳100 at 110 → 11,000 TOKEN', () => {
    expect(tokenUnitsForBdt(10_000, 110)).toBe(T(11_000));
  });
  it('sell 12,000 TOKEN at 120 → ৳100', () => {
    expect(bdtPoishaForTokenUnits(T(12_000), 120)).toBe(10_000);
  });
  it('sell rounds down to whole poisha', () => {
    expect(bdtPoishaForTokenUnits(T(1) + 19, 120)).toBe(0); // 119 units / 120 → 0 poisha
    expect(bdtPoishaForTokenUnits(241, 120)).toBe(2);
  });
  it('arbitrage safety requires sell rate > buy rate', () => {
    expect(isArbitrageSafe(110, 120)).toBe(true);
    expect(isArbitrageSafe(110, 110)).toBe(false);
    expect(isArbitrageSafe(110, 100)).toBe(false);
  });
  it('buy-then-sell never returns more BDT than paid at the default rates', () => {
    for (const poisha of [1, 99, 100, 5_000, 1_234_567]) {
      const units = tokenUnitsForBdt(poisha, 110);
      expect(bdtPoishaForTokenUnits(units, 120)).toBeLessThanOrEqual(poisha);
    }
  });
});
