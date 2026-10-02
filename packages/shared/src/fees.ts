import { addUnits, assertPositiveUnits, assertUnits, MoneyError, mulDivFloor } from './money';
import type { PlayerBucket, PostingType } from './enums';

export const BPS_DENOMINATOR = 10_000;
export const MAX_MATCH_FEE_BPS = 1_000; // hard ceiling: 10%

/**
 * Platform match fee.
 *   feeUnits = floor(totalPotUnits * feeBps / 10000)
 * Rounding: always DOWN, in the player's favour. A pot smaller than
 * ceil(10000 / feeBps) units therefore pays no fee (at 1%: pots below 100 units = 1 TOKEN).
 */
export function computeMatchFee(totalPotUnits: number, feeBps: number): number {
  assertUnits(totalPotUnits, 'totalPotUnits');
  assertUnits(feeBps, 'feeBps');
  if (totalPotUnits < 0) throw new MoneyError('pot must not be negative');
  if (feeBps < 0 || feeBps > MAX_MATCH_FEE_BPS) throw new MoneyError('feeBps out of range');
  return mulDivFloor(totalPotUnits, feeBps, BPS_DENOMINATOR);
}

export interface SettlementParticipant {
  userId: string;
  stakeUnits: number;
  /** portion of the stake that came from BONUS (returned to BONUS on refund) */
  stakeBonusUnits: number;
  /** portion of the stake that came from AVAILABLE */
  stakeAvailableUnits: number;
}

export type PlanTarget = { userId: string; bucket: PlayerBucket } | { system: 'PLATFORM_FEES' };

export interface PlanPosting {
  fromUserId: string; // always the participant's LOCKED_GAME account
  to: PlanTarget;
  amount: number;
  postingType: PostingType;
}

export interface WinPlan {
  kind: 'WIN';
  winnerUserId: string;
  winnerUserIds: string[];
  potUnits: number;
  feeUnits: number;
  /** total paid to all winners (pot − fee) */
  payoutUnits: number;
  postings: PlanPosting[];
  payouts: Record<string, number>;
}

export interface RefundPlan {
  kind: 'REFUND';
  potUnits: number;
  postings: PlanPosting[];
  payouts: Record<string, number>;
}

function validateParticipants(players: SettlementParticipant[]): number {
  if (players.length === 0) throw new MoneyError('no participants');
  const seen = new Set<string>();
  for (const p of players) {
    if (seen.has(p.userId)) throw new MoneyError('duplicate participant');
    seen.add(p.userId);
    assertPositiveUnits(p.stakeUnits, 'stakeUnits');
    assertUnits(p.stakeBonusUnits, 'stakeBonusUnits');
    assertUnits(p.stakeAvailableUnits, 'stakeAvailableUnits');
    if (p.stakeBonusUnits < 0 || p.stakeAvailableUnits < 0 || addUnits(p.stakeBonusUnits, p.stakeAvailableUnits) !== p.stakeUnits) {
      throw new MoneyError('stake split does not add up');
    }
  }
  return addUnits(...players.map((p) => p.stakeUnits));
}

/**
 * Winner(s) take the pot minus the platform fee.
 *   fee     = floor(pot × feeBps / 10000), drawn from the losers' escrow first (seat order)
 *   payout  = pot − fee, split equally among winners; the indivisible remainder (< number of
 *             winners units) goes to the first-listed winners, one unit each.
 * Each winner is paid from their own escrow first, then from the losers' remaining escrow.
 * Bonus stays bonus: escrow that was staked from BONUS is paid to the winner's BONUS bucket, and
 * only escrow staked from AVAILABLE lands in AVAILABLE. Free (bonus) tokens can therefore never
 * be turned into sellable tokens by playing a second account. The fee is taken from bonus escrow
 * first. Works for 1 winner (1v1, Ludo) and teams (29: 2 winners).
 */
export function planWinSettlement(players: SettlementParticipant[], winners: string | string[], feeBps: number): WinPlan {
  const potUnits = validateParticipants(players);
  const winnerIds = Array.isArray(winners) ? winners : [winners];
  if (winnerIds.length === 0) throw new MoneyError('no winner');
  if (new Set(winnerIds).size !== winnerIds.length) throw new MoneyError('duplicate winner');
  for (const w of winnerIds) if (!players.some((p) => p.userId === w)) throw new MoneyError('winner is not a participant');
  if (winnerIds.length >= players.length) throw new MoneyError('at least one player must lose');
  const feeUnits = computeMatchFee(potUnits, feeBps);
  const payoutUnits = potUnits - feeUnits;

  const k = winnerIds.length;
  const base = Math.floor(payoutUnits / k);
  const remainder = payoutUnits - base * k;
  const need = new Map<string, number>(winnerIds.map((w, i) => [w, base + (i < remainder ? 1 : 0)]));

  // remaining escrow per player; losers first in the source order
  const losers = players.filter((p) => !winnerIds.includes(p.userId));
  const winnerRows = winnerIds.map((w) => players.find((p) => p.userId === w)!);
  // remaining escrow per player, kept apart by where it was staked from
  const bonusLeft = new Map<string, number>(players.map((p) => [p.userId, p.stakeBonusUnits]));
  const availLeft = new Map<string, number>(players.map((p) => [p.userId, p.stakeAvailableUnits]));
  const left = (id: string) => bonusLeft.get(id)! + availLeft.get(id)!;
  const postings: PlanPosting[] = [];

  let feeRemaining = feeUnits;
  for (const p of [...losers, ...winnerRows]) {
    for (const part of [bonusLeft, availLeft]) {
      const take = Math.min(feeRemaining, part.get(p.userId)!);
      if (take > 0) {
        postings.push({ fromUserId: p.userId, to: { system: 'PLATFORM_FEES' }, amount: take, postingType: 'PLATFORM_MATCH_FEE' });
        part.set(p.userId, part.get(p.userId)! - take);
        feeRemaining -= take;
      }
    }
  }
  if (feeRemaining !== 0) throw new MoneyError('fee could not be allocated');

  const pay = (from: string, to: string) => {
    for (const [part, bucket] of [
      [bonusLeft, 'BONUS'],
      [availLeft, 'AVAILABLE'],
    ] as const) {
      const amount = Math.min(part.get(from)!, need.get(to)!);
      if (amount <= 0) continue;
      postings.push({ fromUserId: from, to: { userId: to, bucket }, amount, postingType: 'GAME_WIN_PAYOUT' });
      part.set(from, part.get(from)! - amount);
      need.set(to, need.get(to)! - amount);
    }
  };
  for (const w of winnerIds) pay(w, w); // own stake back first
  for (const w of winnerIds) for (const l of losers) pay(l.userId, w);
  for (const w of winnerIds) for (const o of winnerIds) if (o !== w) pay(o, w);
  if ([...need.values()].some((n) => n !== 0) || players.some((p) => left(p.userId) !== 0)) {
    throw new MoneyError('settlement allocation failed');
  }

  const payouts: Record<string, number> = {};
  for (const p of players) payouts[p.userId] = 0;
  winnerIds.forEach((w, i) => (payouts[w] = base + (i < remainder ? 1 : 0)));
  assertPlanBalanced(postings, potUnits);
  return { kind: 'WIN', winnerUserId: winnerIds[0]!, winnerUserIds: winnerIds, potUnits, feeUnits, payoutUnits, postings, payouts };
}

/** Draw / cancel / void / server failure: every stake goes back to the bucket it came from. No fee. */
export function planRefund(players: SettlementParticipant[]): RefundPlan {
  const potUnits = validateParticipants(players);
  const postings: PlanPosting[] = [];
  const payouts: Record<string, number> = {};
  for (const p of players) {
    if (p.stakeAvailableUnits > 0) {
      postings.push({ fromUserId: p.userId, to: { userId: p.userId, bucket: 'AVAILABLE' }, amount: p.stakeAvailableUnits, postingType: 'GAME_STAKE_REFUND' });
    }
    if (p.stakeBonusUnits > 0) {
      postings.push({ fromUserId: p.userId, to: { userId: p.userId, bucket: 'BONUS' }, amount: p.stakeBonusUnits, postingType: 'GAME_STAKE_REFUND' });
    }
    payouts[p.userId] = p.stakeUnits;
  }
  assertPlanBalanced(postings, potUnits);
  return { kind: 'REFUND', potUnits, postings, payouts };
}

function assertPlanBalanced(postings: PlanPosting[], potUnits: number): void {
  const moved = addUnits(...postings.map((p) => p.amount));
  if (moved !== potUnits) throw new MoneyError(`settlement moves ${moved} but pot is ${potUnits}`);
}

/**
 * How a stake is funded: BONUS first, then AVAILABLE.
 * Returns null when the player cannot cover the stake.
 */
export function splitStake(stakeUnits: number, availableUnits: number, bonusUnits: number): { fromBonus: number; fromAvailable: number } | null {
  assertPositiveUnits(stakeUnits, 'stake');
  const fromBonus = Math.min(Math.max(bonusUnits, 0), stakeUnits);
  const fromAvailable = stakeUnits - fromBonus;
  if (fromAvailable > availableUnits) return null;
  return { fromBonus, fromAvailable };
}
