/**
 * THE wallet / ledger service — the only code in the platform that changes token balances.
 *
 * Every token movement is a ledger transaction made of postings (from → to, amount). Each posting
 * writes two immutable ledger entries (−amount on `from`, +amount on `to`) and updates the two
 * cached balances, inside the caller's D1 batch (one SQL transaction). Consequences:
 *   * sum(entries) of every transaction is exactly 0 (double entry, by construction)
 *   * balances can only change together with matching ledger entries
 *   * an overdraft violates the wallet_balance_non_negative CHECK and aborts the whole batch
 *   * the idempotency key is UNIQUE, so the same operation can never post twice
 *
 * There is deliberately no "set balance" function anywhere.
 */
import {
  addUnits,
  assertPositiveUnits,
  playerAccountId,
  SYSTEM_ACCOUNT_IDS,
  type LedgerTxType,
  type PlayerBucket,
  type PostingType,
  type SystemAccount,
} from '@arena/shared';
import { ulid } from '../lib/ids';
import { assertStmt, first, type Stmt } from '../lib/db';

export type AccountRef = { userId: string; bucket: PlayerBucket } | { system: SystemAccount };

export interface Posting {
  from: AccountRef;
  to: AccountRef;
  amount: number;
  postingType?: PostingType;
}

export interface LedgerTxSpec {
  idempotencyKey: string;
  type: LedgerTxType;
  referenceType?: string | null;
  referenceId?: string | null;
  gameId?: string | null;
  createdBy: { type: 'PLAYER' | 'ADMIN' | 'SYSTEM'; id: string | null };
  metadata?: Record<string, unknown>;
  postings: Posting[];
}

export interface BuiltTransaction {
  txId: string;
  statements: Stmt[];
}

export interface HoldSpec {
  userId: string;
  bucket: 'LOCKED_GAME' | 'LOCKED_SELL';
  amount: number;
  referenceType: 'MATCH' | 'SELL_REQUEST' | 'CRASH_BET';
  referenceId: string;
  lockTxId: string;
}

function accountId(ref: AccountRef): string {
  return 'system' in ref ? SYSTEM_ACCOUNT_IDS[ref.system] : playerAccountId(ref.userId, ref.bucket);
}
function accountUser(ref: AccountRef): string | null {
  return 'system' in ref ? null : ref.userId;
}
function accountBucket(ref: AccountRef): string {
  return 'system' in ref ? ref.system : ref.bucket;
}

export class LedgerService {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number,
  ) {}

  /** Builds the statements for one balanced ledger transaction. The caller runs them in its batch. */
  buildTransaction(spec: LedgerTxSpec): BuiltTransaction {
    if (!spec.idempotencyKey) throw new Error('idempotencyKey is required');
    if (spec.postings.length === 0) throw new Error('a ledger transaction needs at least one posting');
    for (const p of spec.postings) {
      assertPositiveUnits(p.amount, 'posting amount');
      if (accountId(p.from) === accountId(p.to)) throw new Error('posting from and to must differ');
    }
    const now = this.now();
    const txId = ulid(now);
    const total = addUnits(...spec.postings.map((p) => p.amount));
    const db = this.db;
    const statements: Stmt[] = [
      db
        .prepare(
          `INSERT INTO ledger_transactions (id, idempotency_key, type, reference_type, reference_id, game_id, created_by_type, created_by_id, metadata, total_units, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          txId,
          spec.idempotencyKey,
          spec.type,
          spec.referenceType ?? null,
          spec.referenceId ?? null,
          spec.gameId ?? null,
          spec.createdBy.type,
          spec.createdBy.id,
          JSON.stringify(spec.metadata ?? {}),
          total,
          now,
        ),
    ];
    spec.postings.forEach((p, index) => {
      const postingType = p.postingType ?? spec.type;
      for (const [ref, signed] of [
        [p.from, -p.amount],
        [p.to, p.amount],
      ] as const) {
        const id = accountId(ref);
        statements.push(
          db.prepare('UPDATE wallet_accounts SET balance = balance + ?, updated_at = ? WHERE id = ?').bind(signed, now, id),
          db
            .prepare(
              `INSERT INTO ledger_entries (id, transaction_id, posting_index, posting_type, account_id, user_id, bucket, amount, balance_after, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT balance FROM wallet_accounts WHERE id = ?), ?)`,
            )
            .bind(ulid(now), txId, index, postingType, id, accountUser(ref), accountBucket(ref), signed, id, now),
        );
      }
    });
    return { txId, statements };
  }

  /** Records which reference a locked amount belongs to (same batch as the lock transaction). */
  createHoldStmt(h: HoldSpec): Stmt {
    const now = this.now();
    return this.db
      .prepare(
        `INSERT INTO wallet_holds (id, user_id, bucket, amount, reference_type, reference_id, status, lock_tx_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
      )
      .bind(ulid(now), h.userId, h.bucket, h.amount, h.referenceType, h.referenceId, h.lockTxId, now, now);
  }

  /**
   * Finalises holds of a reference. `expectedActive` guards against a concurrent resolution:
   * the batch aborts unless exactly that many holds are still ACTIVE.
   */
  finalizeHoldsStmts(p: { referenceType: 'MATCH' | 'SELL_REQUEST' | 'CRASH_BET'; referenceId: string; userId?: string; status: 'RELEASED' | 'CAPTURED'; releaseTxId: string; expectedActive: number }): Stmt[] {
    const now = this.now();
    const userFilter = p.userId ? ' AND user_id = ?' : '';
    const userParams = p.userId ? [p.userId] : [];
    return [
      assertStmt(
        this.db,
        `SELECT COUNT(*) = ? FROM wallet_holds WHERE reference_type = ? AND reference_id = ? AND status = 'ACTIVE'${userFilter}`,
        p.expectedActive,
        p.referenceType,
        p.referenceId,
        ...userParams,
      ),
      this.db
        .prepare(`UPDATE wallet_holds SET status = ?, release_tx_id = ?, updated_at = ? WHERE reference_type = ? AND reference_id = ? AND status = 'ACTIVE'${userFilter}`)
        .bind(p.status, p.releaseTxId, now, p.referenceType, p.referenceId, ...userParams),
    ];
  }

  async findByIdempotencyKey(key: string): Promise<{ id: string; type: LedgerTxType; reference_type: string | null; reference_id: string | null; metadata: string; total_units: number } | null> {
    return first(this.db, 'SELECT id, type, reference_type, reference_id, metadata, total_units FROM ledger_transactions WHERE idempotency_key = ?', key);
  }
}
