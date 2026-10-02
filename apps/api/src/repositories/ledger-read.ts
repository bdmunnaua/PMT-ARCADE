/** Read models over the immutable ledger (history pages, admin ledger, system wallets). */
import {
  SYSTEM_ACCOUNT_IDS,
  type BucketEffects,
  type LedgerEntryDto,
  type LedgerTransactionDto,
  type LedgerTxType,
  type PlayerBucket,
  type PlayerTransactionDto,
  type PlayerTxCategory,
  type PostingType,
  type SystemWalletEntryDto,
} from '@arena/shared';
import { all, first, parseJson } from '../lib/db';

interface PlayerTxRow {
  id: string;
  type: LedgerTxType;
  reference_type: string | null;
  reference_id: string | null;
  game_id: string | null;
  metadata: string;
  created_at: number;
  d_available: number;
  d_locked_game: number;
  d_locked_sell: number;
  d_bonus: number;
}

const SELL_TYPES = ['TOKEN_SELL_LOCK', 'TOKEN_SELL_COMPLETE', 'TOKEN_SELL_REFUND'];

export function categorize(type: LedgerTxType, dAvailable: number, dBonus: number): PlayerTxCategory {
  switch (type) {
    case 'TOKEN_PURCHASE':
      return 'BUY';
    case 'TOKEN_SELL_LOCK':
    case 'TOKEN_SELL_COMPLETE':
    case 'TOKEN_SELL_REFUND':
      return 'SELL';
    case 'GAME_STAKE_LOCK':
      return 'GAME_STAKE';
    case 'GAME_STAKE_REFUND':
      return 'GAME_REFUND';
    case 'GAME_WIN_PAYOUT':
      // winnings can arrive as AVAILABLE and/or BONUS (bonus stakes stay bonus)
      return dAvailable + dBonus > 0 ? 'GAME_WIN' : 'GAME_LOSS';
    case 'PLAYER_TRANSFER':
      return 'TRANSFER';
    case 'ARCADE_REWARD':
      return 'FREE_GAME';
    case 'ONCHAIN_WITHDRAW':
    case 'ONCHAIN_WITHDRAW_PAID':
    case 'ONCHAIN_WITHDRAW_REFUND':
    case 'ONCHAIN_DEPOSIT':
      return 'CRYPTO';
    case 'HOUSE_BET_WIN':
      return 'GAME_WIN';
    case 'HOUSE_BET_LOSS':
      return 'GAME_LOSS';
    case 'HOUSE_BET_REFUND':
      return 'GAME_REFUND';
    case 'ADMIN_GRANT':
      return dBonus > 0 ? 'BONUS' : 'ADMIN_GRANT';
    default:
      return 'ADJUSTMENT';
  }
}

function describe(category: PlayerTxCategory, type: LedgerTxType, label: string | null): string {
  const ref = label ? ` — ${label}` : '';
  switch (category) {
    case 'BUY':
      return `Tokens credited from purchase${ref}`;
    case 'SELL':
      if (type === 'TOKEN_SELL_LOCK') return `Tokens locked for sale${ref}`;
      if (type === 'TOKEN_SELL_COMPLETE') return `Sale completed${ref}`;
      return `Locked tokens returned${ref}`;
    case 'GAME_STAKE':
      return `Stake locked${ref}`;
    case 'GAME_REFUND':
      return `Stake refunded${ref}`;
    case 'GAME_WIN':
      return `Winnings${ref}`;
    case 'GAME_LOSS':
      return `Stake lost${ref}`;
    case 'BONUS':
      return `Bonus tokens${ref}`;
    case 'TRANSFER':
      return `PMT transfer${ref}`;
    case 'FREE_GAME':
      return `Free game reward${ref}`;
    case 'CRYPTO':
      if (type === 'ONCHAIN_DEPOSIT') return `Deposit from your crypto wallet${ref}`;
      if (type === 'ONCHAIN_WITHDRAW_REFUND') return `Withdrawal returned${ref}`;
      return `Withdrawal to your crypto wallet${ref}`;
    case 'ADMIN_GRANT':
      return `Tokens granted by the platform${ref}`;
    default:
      return `Balance adjustment${ref}`;
  }
}

function categoryFilter(category: PlayerTxCategory): { where: string; having: string | null; params: unknown[] } {
  switch (category) {
    case 'BUY':
      return { where: "t.type = 'TOKEN_PURCHASE'", having: null, params: [] };
    case 'SELL':
      return { where: `t.type IN ('${SELL_TYPES.join("','")}')`, having: null, params: [] };
    case 'GAME_STAKE':
      return { where: "t.type = 'GAME_STAKE_LOCK'", having: null, params: [] };
    case 'GAME_REFUND':
      return { where: "t.type IN ('GAME_STAKE_REFUND', 'HOUSE_BET_REFUND')", having: null, params: [] };
    case 'GAME_WIN':
      return { where: "t.type IN ('GAME_WIN_PAYOUT', 'HOUSE_BET_WIN')", having: "(t.type = 'HOUSE_BET_WIN' OR d_available + d_bonus > 0)", params: [] };
    case 'GAME_LOSS':
      return { where: "t.type IN ('GAME_WIN_PAYOUT', 'HOUSE_BET_LOSS')", having: "(t.type = 'HOUSE_BET_LOSS' OR d_available + d_bonus <= 0)", params: [] };
    case 'ADMIN_GRANT':
      return { where: "t.type = 'ADMIN_GRANT'", having: 'd_bonus = 0', params: [] };
    case 'BONUS':
      return { where: "t.type = 'ADMIN_GRANT'", having: 'd_bonus > 0', params: [] };
    case 'TRANSFER':
      return { where: "t.type = 'PLAYER_TRANSFER'", having: null, params: [] };
    case 'FREE_GAME':
      return { where: "t.type = 'ARCADE_REWARD'", having: null, params: [] };
    case 'CRYPTO':
      return { where: "t.type IN ('ONCHAIN_WITHDRAW', 'ONCHAIN_WITHDRAW_REFUND', 'ONCHAIN_DEPOSIT')", having: null, params: [] };
    case 'ADJUSTMENT':
      return { where: "t.type = 'ADJUSTMENT'", having: null, params: [] };
  }
}

function mapPlayerTx(r: PlayerTxRow): PlayerTransactionDto {
  const meta = parseJson<{ label?: string }>(r.metadata, {});
  const effects: BucketEffects = {};
  if (r.d_available) effects.AVAILABLE = r.d_available;
  if (r.d_locked_game) effects.LOCKED_GAME = r.d_locked_game;
  if (r.d_locked_sell) effects.LOCKED_SELL = r.d_locked_sell;
  if (r.d_bonus) effects.BONUS = r.d_bonus;
  const category = categorize(r.type, r.d_available, r.d_bonus);
  const label = meta.label ?? null;
  return {
    id: r.id,
    type: r.type,
    category,
    status: 'COMPLETED',
    createdAt: r.created_at,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    referenceLabel: label,
    gameId: r.game_id,
    effects,
    netUnits: r.d_available + r.d_locked_game + r.d_locked_sell + r.d_bonus,
    description: describe(category, r.type, label),
  };
}

export interface PlayerTxQuery {
  page: number;
  pageSize: number;
  category?: PlayerTxCategory;
  from?: number;
  to?: number;
  gameId?: string;
  txId?: string;
}

interface EntryRow {
  id: string;
  transaction_id: string;
  account_id: string;
  user_id: string | null;
  player_number: number | null;
  bucket: string;
  amount: number;
  balance_after: number;
  posting_type: PostingType;
}

function mapEntry(r: EntryRow): LedgerEntryDto {
  return {
    id: r.id,
    accountId: r.account_id,
    accountLabel: r.player_number ? `Player #${r.player_number} · ${r.bucket}` : r.bucket,
    playerNumber: r.player_number,
    bucket: r.bucket,
    amountUnits: r.amount,
    balanceAfterUnits: r.balance_after,
    postingType: r.posting_type,
  };
}

const ENTRY_SELECT = `SELECT e.id, e.transaction_id, e.account_id, e.user_id, p.player_number, e.bucket, e.amount, e.balance_after, e.posting_type
  FROM ledger_entries e LEFT JOIN player_profiles p ON p.user_id = e.user_id`;

interface TxRow {
  id: string;
  idempotency_key: string;
  type: LedgerTxType;
  reference_type: string | null;
  reference_id: string | null;
  game_id: string | null;
  created_by_type: string;
  created_by_id: string | null;
  metadata: string;
  total_units: number;
  created_at: number;
}

export class LedgerReadRepository {
  constructor(private readonly db: D1Database) {}

  async playerTransactions(userId: string, q: PlayerTxQuery): Promise<{ items: PlayerTransactionDto[]; hasMore: boolean }> {
    const where = ['e.user_id = ?'];
    const params: unknown[] = [userId];
    let having: string | null = null;
    if (q.category) {
      const f = categoryFilter(q.category);
      where.push(f.where);
      params.push(...f.params);
      having = f.having;
    }
    if (q.from) {
      where.push('e.created_at >= ?');
      params.push(q.from);
    }
    if (q.to) {
      where.push('e.created_at <= ?');
      params.push(q.to);
    }
    if (q.gameId) {
      where.push('t.game_id = ?');
      params.push(q.gameId);
    }
    if (q.txId) {
      where.push('t.id = ?');
      params.push(q.txId.trim().toUpperCase());
    }
    const rows = await all<PlayerTxRow>(
      this.db,
      `SELECT t.id, t.type, t.reference_type, t.reference_id, t.game_id, t.metadata, t.created_at,
         SUM(CASE WHEN e.bucket = 'AVAILABLE' THEN e.amount ELSE 0 END) AS d_available,
         SUM(CASE WHEN e.bucket = 'LOCKED_GAME' THEN e.amount ELSE 0 END) AS d_locked_game,
         SUM(CASE WHEN e.bucket = 'LOCKED_SELL' THEN e.amount ELSE 0 END) AS d_locked_sell,
         SUM(CASE WHEN e.bucket = 'BONUS' THEN e.amount ELSE 0 END) AS d_bonus
       FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
       WHERE ${where.join(' AND ')}
       GROUP BY t.id ${having ? `HAVING ${having}` : ''}
       ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`,
      ...params,
      q.pageSize + 1,
      (q.page - 1) * q.pageSize,
    );
    return { items: rows.slice(0, q.pageSize).map(mapPlayerTx), hasMore: rows.length > q.pageSize };
  }

  async playerTransaction(userId: string, txId: string): Promise<{ tx: PlayerTransactionDto; entries: { bucket: PlayerBucket; amountUnits: number; balanceAfterUnits: number; postingType: PostingType }[] } | null> {
    const page = await this.playerTransactions(userId, { page: 1, pageSize: 1, txId });
    const tx = page.items[0];
    if (!tx) return null;
    const entries = await all<{ bucket: PlayerBucket; amount: number; balance_after: number; posting_type: PostingType }>(
      this.db,
      'SELECT bucket, amount, balance_after, posting_type FROM ledger_entries WHERE transaction_id = ? AND user_id = ? ORDER BY posting_index, amount',
      tx.id,
      userId,
    );
    return { tx, entries: entries.map((e) => ({ bucket: e.bucket, amountUnits: e.amount, balanceAfterUnits: e.balance_after, postingType: e.posting_type })) };
  }

  async adminTransactions(q: { page: number; pageSize: number; type?: LedgerTxType; txId?: string; userId?: string; from?: number; to?: number }): Promise<{ items: LedgerTransactionDto[]; hasMore: boolean }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.type) {
      where.push('t.type = ?');
      params.push(q.type);
    }
    if (q.txId) {
      where.push('(t.id = ? OR t.idempotency_key = ?)');
      params.push(q.txId.trim().toUpperCase(), q.txId.trim());
    }
    if (q.userId) {
      where.push('t.id IN (SELECT transaction_id FROM ledger_entries WHERE user_id = ?)');
      params.push(q.userId);
    }
    if (q.from) {
      where.push('t.created_at >= ?');
      params.push(q.from);
    }
    if (q.to) {
      where.push('t.created_at <= ?');
      params.push(q.to);
    }
    const rows = await all<TxRow>(
      this.db,
      `SELECT t.* FROM ledger_transactions t ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`,
      ...params,
      q.pageSize + 1,
      (q.page - 1) * q.pageSize,
    );
    const page = rows.slice(0, q.pageSize);
    const entries = page.length
      ? await all<EntryRow>(this.db, `${ENTRY_SELECT} WHERE e.transaction_id IN (${page.map(() => '?').join(',')}) ORDER BY e.posting_index, e.amount`, ...page.map((r) => r.id))
      : [];
    const byTx = new Map<string, LedgerEntryDto[]>();
    for (const e of entries) byTx.set(e.transaction_id, [...(byTx.get(e.transaction_id) ?? []), mapEntry(e)]);
    return { hasMore: rows.length > q.pageSize, items: page.map((r) => this.mapTx(r, byTx.get(r.id) ?? [])) };
  }

  async adminTransaction(txId: string): Promise<LedgerTransactionDto | null> {
    const r = await first<TxRow>(this.db, 'SELECT * FROM ledger_transactions WHERE id = ?', txId);
    if (!r) return null;
    const entries = await all<EntryRow>(this.db, `${ENTRY_SELECT} WHERE e.transaction_id = ? ORDER BY e.posting_index, e.amount`, txId);
    return this.mapTx(r, entries.map(mapEntry));
  }

  async systemEntries(account: 'ADMIN_TREASURY' | 'PLATFORM_FEES' | 'HOUSE_BANKROLL' | 'REWARDS_POOL', page: number, pageSize: number): Promise<{ items: SystemWalletEntryDto[]; hasMore: boolean }> {
    const rows = await all<EntryRow & { tx_type: LedgerTxType; reference_type: string | null; reference_id: string | null; created_at: number }>(
      this.db,
      `SELECT e.id, e.transaction_id, e.account_id, e.user_id, NULL AS player_number, e.bucket, e.amount, e.balance_after, e.posting_type,
              t.type AS tx_type, t.reference_type, t.reference_id, e.created_at
       FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
       WHERE e.account_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`,
      SYSTEM_ACCOUNT_IDS[account],
      pageSize + 1,
      (page - 1) * pageSize,
    );
    return {
      hasMore: rows.length > pageSize,
      items: rows.slice(0, pageSize).map((r) => ({
        ...mapEntry(r),
        transactionId: r.transaction_id,
        transactionType: r.tx_type,
        referenceType: r.reference_type,
        referenceId: r.reference_id,
        createdAt: r.created_at,
      })),
    };
  }

  private mapTx(r: TxRow, entries: LedgerEntryDto[]): LedgerTransactionDto {
    return {
      id: r.id,
      idempotencyKey: r.idempotency_key,
      type: r.type,
      referenceType: r.reference_type,
      referenceId: r.reference_id,
      gameId: r.game_id,
      createdByType: r.created_by_type,
      createdById: r.created_by_id,
      metadata: parseJson(r.metadata, {}),
      createdAt: r.created_at,
      totalUnits: r.total_units,
      entries,
    };
  }
}
