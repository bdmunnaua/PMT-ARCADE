/**
 * The taka reserve behind PMT sell-backs, so the owner never has to pay sellers from their own
 * pocket:
 *   reserve      = taka received for PMT purchases − taka paid for sell-backs − owner's net take
 *   free reserve = reserve − taka promised to sell requests not paid yet
 *   owed         = every sellable PMT players hold (AVAILABLE + staked), valued at the sell rate
 * Rules (each checked inside the same SQL transaction as the action, so they cannot race):
 *   - a new sell request must fit in the free reserve;
 *   - the owner may only take out what stays above 100% of what is owed;
 *   - in production the PMT price may only be raised while the free reserve covers at least
 *     LADDER_RULES.minCoverageBps of what would be owed at the new sell rate.
 */
import { coverageBps, LADDER_RULES, ladderIndex, liabilityPoisha, PRICE_LADDER, type ReserveDto } from '@arena/shared';
import { all, assertStmt, classifyDbError, first, runBatch, type Stmt } from '../lib/db';
import { AppError } from '../lib/errors';
import { ulid } from '../lib/ids';
import type { AdminContext } from '../env';
import type { AuditService } from './audit';
import type { SettingsService } from './settings';

const DAY = 86_400_000;
const PENDING_SELL = "('SUBMITTED', 'TOKENS_LOCKED', 'UNDER_REVIEW', 'APPROVED', 'PAYMENT_PROCESSING', 'PAYMENT_SENT')";

const SQL = {
  received: "SELECT COALESCE(SUM(amount_poisha), 0) FROM buy_requests WHERE status IN ('TOKEN_CREDITED', 'COMPLETED')",
  paid: "SELECT COALESCE(SUM(COALESCE(payment_amount_poisha, bdt_poisha)), 0) FROM sell_requests WHERE status = 'COMPLETED'",
  owner: "SELECT COALESCE(SUM(CASE kind WHEN 'OWNER_WITHDRAWAL' THEN amount_poisha ELSE -amount_poisha END), 0) FROM reserve_movements",
  pending: `SELECT COALESCE(SUM(bdt_poisha), 0) FROM sell_requests WHERE status IN ${PENDING_SELL}`,
  sellable: "SELECT COALESCE(SUM(balance), 0) FROM wallet_accounts WHERE owner_type = 'PLAYER' AND bucket IN ('AVAILABLE', 'LOCKED_GAME')",
};
/** free reserve in poisha, as one SQL expression */
const FREE_RESERVE = `((${SQL.received}) - (${SQL.paid}) - (${SQL.owner}) - (${SQL.pending}))`;

export interface ReserveFigures {
  receivedPoisha: number;
  paidOutPoisha: number;
  ownerNetWithdrawnPoisha: number;
  pendingSellPoisha: number;
  sellableUnits: number;
}

export async function reserveFigures(db: D1Database): Promise<ReserveFigures> {
  const row = await first<{ r: number; p: number; o: number; pe: number; s: number }>(
    db,
    `SELECT (${SQL.received}) AS r, (${SQL.paid}) AS p, (${SQL.owner}) AS o, (${SQL.pending}) AS pe, (${SQL.sellable}) AS s`,
  );
  return { receivedPoisha: row?.r ?? 0, paidOutPoisha: row?.p ?? 0, ownerNetWithdrawnPoisha: row?.o ?? 0, pendingSellPoisha: row?.pe ?? 0, sellableUnits: row?.s ?? 0 };
}

/** Batch statement that aborts the transaction unless the free reserve covers `bdtPoisha`. */
export function reserveSellGuardStmt(db: D1Database, bdtPoisha: number): Stmt {
  return assertStmt(db, `SELECT ${FREE_RESERVE} >= ?`, bdtPoisha);
}

export const freeReserveOf = (f: ReserveFigures) => f.receivedPoisha - f.paidOutPoisha - f.ownerNetWithdrawnPoisha - f.pendingSellPoisha;

export class ReserveService {
  constructor(
    private readonly db: D1Database,
    private readonly settings: SettingsService,
    private readonly now: () => number,
  ) {}

  async status(): Promise<ReserveDto> {
    const s = await this.settings.get();
    const f = await reserveFigures(this.db);
    const now = this.now();
    const reservePoisha = f.receivedPoisha - f.paidOutPoisha - f.ownerNetWithdrawnPoisha;
    const free = freeReserveOf(f);
    const owed = liabilityPoisha(f.sellableUnits, s.SELL_TOKENS_PER_BDT);
    const idx = ladderIndex(s.BUY_TOKENS_PER_BDT);
    const nextStage = idx >= 0 ? PRICE_LADDER[idx + 1] : PRICE_LADDER.find((st) => st.buy < s.BUY_TOKENS_PER_BDT);

    const [flows, lastChange, movements] = await Promise.all([
      first<{ bought: number; sold: number }>(
        this.db,
        `SELECT
           (SELECT COALESCE(SUM(amount_poisha), 0) FROM buy_requests WHERE status IN ('TOKEN_CREDITED', 'COMPLETED') AND COALESCE(completed_at, reviewed_at, updated_at) >= ?) AS bought,
           (SELECT COALESCE(SUM(COALESCE(payment_amount_poisha, bdt_poisha)), 0) FROM sell_requests WHERE status = 'COMPLETED' AND COALESCE(completed_at, updated_at) >= ?) AS sold`,
        now - 30 * DAY,
        now - 30 * DAY,
      ),
      first<{ at: number | null }>(this.db, "SELECT MAX(created_at) AS at FROM audit_logs WHERE action = 'settings.exchange_rate_change'"),
      all<{ id: string; kind: 'OWNER_WITHDRAWAL' | 'OWNER_DEPOSIT'; amount_poisha: number; reason: string; created_at: number }>(
        this.db,
        'SELECT id, kind, amount_poisha, reason, created_at FROM reserve_movements ORDER BY created_at DESC LIMIT 50',
      ),
    ]);
    const bought = flows?.bought ?? 0;
    const sold = flows?.sold ?? 0;
    const daysSinceChange = lastChange?.at ? Math.floor((now - lastChange.at) / DAY) : null;

    let next: ReserveDto['next'] = null;
    if (nextStage) {
      const owedNext = liabilityPoisha(f.sellableUnits, nextStage.sell);
      const cov = coverageBps(free, owedNext);
      const coverageOk = cov === null || cov >= LADDER_RULES.minCoverageBps;
      const demandOk = bought - sold > 0;
      const timeOk = daysSinceChange === null || daysSinceChange >= LADDER_RULES.minDaysBetweenSteps;
      next = { buy: nextStage.buy, sell: nextStage.sell, priceBdt: nextStage.priceBdt, liabilityPoisha: owedNext, coverageBps: cov, coverageOk, netBuy30dPoisha: bought - sold, demandOk, daysSinceChange, timeOk, ready: coverageOk && demandOk && timeOk };
    }

    return {
      receivedPoisha: f.receivedPoisha,
      paidOutPoisha: f.paidOutPoisha,
      ownerNetWithdrawnPoisha: f.ownerNetWithdrawnPoisha,
      reservePoisha,
      pendingSellPoisha: f.pendingSellPoisha,
      freeReservePoisha: free,
      sellableUnits: f.sellableUnits,
      liabilityPoisha: owed,
      coverageBps: coverageBps(free, owed),
      safeToWithdrawPoisha: Math.max(0, free - owed),
      rates: { buy: s.BUY_TOKENS_PER_BDT, sell: s.SELL_TOKENS_PER_BDT },
      stage: { index: idx, of: PRICE_LADDER.length, priceBdt: idx >= 0 ? PRICE_LADDER[idx]!.priceBdt : null },
      next,
      last30d: { boughtPoisha: bought, soldPoisha: sold },
      movements: (movements ?? []).map((m) => ({ id: m.id, kind: m.kind, amountPoisha: m.amount_poisha, reason: m.reason, createdAt: m.created_at })),
    };
  }

  /**
   * Owner takes income out of the reserve (WITHDRAW) or adds money to it (DEPOSIT, e.g. ad income).
   * A withdrawal may never leave less than 100% of what is owed at today's sell rate.
   */
  async move(admin: AdminContext, input: { direction: 'WITHDRAW' | 'DEPOSIT'; amountPoisha: number; reason: string }, idempotencyKey: string, audit: AuditService): Promise<{ id: string; replayed: boolean }> {
    const prior = await first<{ id: string }>(this.db, 'SELECT id FROM reserve_movements WHERE idempotency_key = ?', idempotencyKey);
    if (prior) return { id: prior.id, replayed: true };
    const s = await this.settings.get();
    const id = ulid();
    const now = this.now();
    const kind = input.direction === 'WITHDRAW' ? 'OWNER_WITHDRAWAL' : 'OWNER_DEPOSIT';
    const stmts: Stmt[] = [];
    if (kind === 'OWNER_WITHDRAWAL') {
      // free reserve − owed (rounded up) must still be ≥ the amount taken
      stmts.push(assertStmt(this.db, `SELECT ${FREE_RESERVE} - CAST(((${SQL.sellable}) + ? - 1) / ? AS INTEGER) >= ?`, s.SELL_TOKENS_PER_BDT, s.SELL_TOKENS_PER_BDT, input.amountPoisha));
    }
    stmts.push(
      this.db
        .prepare('INSERT INTO reserve_movements (id, kind, amount_poisha, reason, admin_user_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, kind, input.amountPoisha, input.reason, admin.userId, idempotencyKey, now),
      audit.stmt({ adminUserId: admin.userId, action: kind === 'OWNER_WITHDRAWAL' ? 'reserve.withdraw' : 'reserve.deposit', entityType: 'reserve', entityId: id, after: { amountPoisha: input.amountPoisha }, reason: input.reason }),
    );
    try {
      await runBatch(this.db, stmts);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'ASSERTION') throw new AppError('RESERVE_LIMIT', 'That would leave the reserve unable to pay back every seller. Take out at most the "safe to withdraw" amount.');
      if (err.kind === 'UNIQUE') {
        const again = await first<{ id: string }>(this.db, 'SELECT id FROM reserve_movements WHERE idempotency_key = ?', idempotencyKey);
        if (again) return { id: again.id, replayed: true };
      }
      throw err;
    }
    return { id, replayed: false };
  }
}
