/**
 * Administrative token movements — always through the ledger, always audited:
 *   * issue:   ISSUANCE → ADMIN_TREASURY (super admin only; creates new supply, explicitly)
 *   * grant:   ADMIN_TREASURY → player AVAILABLE (or BONUS for type BONUS)
 *   * adjust:  compensating correction between ADMIN_TREASURY and a player's AVAILABLE
 * Each uses an idempotency key derived from the admin and the client's Idempotency-Key, so a
 * double-click or a retried request can never distribute twice.
 */
import { formatTokens, type GrantResultDto, type GrantType } from '@arena/shared';
import type { AdminContext } from '../env';
import { assertStmt, classifyDbError, parseJson, runBatch, type Stmt } from '../lib/db';
import { AppError, notFound } from '../lib/errors';
import type { UserRepository } from '../repositories/users';
import type { WalletRepository } from '../repositories/wallets';
import type { RealtimePublisher } from '../realtime/publisher';
import type { AuditService } from './audit';
import type { LedgerService } from './ledger';
import type { NotificationService } from './notifications';

export class TreasuryService {
  constructor(
    private readonly db: D1Database,
    private readonly ledger: LedgerService,
    private readonly users: UserRepository,
    private readonly wallets: WalletRepository,
    private readonly notifications: NotificationService,
    private readonly publisher: RealtimePublisher,
  ) {}

  private async replay(key: string, expect: Record<string, unknown>): Promise<string | null> {
    const prior = await this.ledger.findByIdempotencyKey(key);
    if (!prior) return null;
    const meta = parseJson<Record<string, unknown>>(prior.metadata, {});
    for (const [k, v] of Object.entries(expect)) {
      if (meta[k] !== v) throw new AppError('IDEMPOTENCY_CONFLICT');
    }
    return prior.id;
  }

  async issue(admin: AdminContext, amountUnits: number, reason: string, clientKey: string, audit: AuditService): Promise<{ transactionId: string; replayed: boolean }> {
    const key = `issue:${admin.userId}:${clientKey}`;
    const expect = { amountUnits, reason };
    const prior = await this.replay(key, expect);
    if (prior) return { transactionId: prior, replayed: true };
    const tx = this.ledger.buildTransaction({
      idempotencyKey: key,
      type: 'TREASURY_ISSUANCE',
      referenceType: 'TREASURY',
      referenceId: 'ADMIN_TREASURY',
      createdBy: { type: 'ADMIN', id: admin.userId },
      metadata: expect,
      postings: [{ from: { system: 'ISSUANCE' }, to: { system: 'ADMIN_TREASURY' }, amount: amountUnits }],
    });
    const raced = await this.execute(key, expect, [
      ...tx.statements,
      audit.stmt({ adminUserId: admin.userId, action: 'treasury.issue', entityType: 'wallet', entityId: 'ADMIN_TREASURY', after: { amountUnits, ledgerTxId: tx.txId }, reason }),
    ]);
    if (raced) return { transactionId: raced, replayed: true };
    return { transactionId: tx.txId, replayed: false };
  }

  /** Moves PMT between ADMIN_TREASURY and REWARDS_POOL (free-game rewards, check-ins, referrals). */
  async transferRewardsPool(admin: AdminContext, p: { direction: 'TO_POOL' | 'FROM_POOL'; amountUnits: number; reason: string; clientKey: string }, audit: AuditService): Promise<{ transactionId: string; replayed: boolean }> {
    const key = `rewards-pool:${admin.userId}:${p.clientKey}`;
    const expect = { direction: p.direction, amountUnits: p.amountUnits, reason: p.reason };
    const prior = await this.replay(key, expect);
    if (prior) return { transactionId: prior, replayed: true };
    const treasury = { system: 'ADMIN_TREASURY' as const };
    const pool = { system: 'REWARDS_POOL' as const };
    const tx = this.ledger.buildTransaction({
      idempotencyKey: key,
      type: 'REWARDS_POOL_TRANSFER',
      referenceType: 'REWARDS_POOL',
      referenceId: 'REWARDS_POOL',
      createdBy: { type: 'ADMIN', id: admin.userId },
      metadata: expect,
      postings: [p.direction === 'TO_POOL' ? { from: treasury, to: pool, amount: p.amountUnits } : { from: pool, to: treasury, amount: p.amountUnits }],
    });
    try {
      await runBatch(this.db, [
        ...tx.statements,
        audit.stmt({ adminUserId: admin.userId, action: 'rewards_pool.transfer', entityType: 'wallet', entityId: 'REWARDS_POOL', after: { ...expect, ledgerTxId: tx.txId }, reason: p.reason }),
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'BALANCE') throw new AppError(p.direction === 'TO_POOL' ? 'TREASURY_INSUFFICIENT' : 'INSUFFICIENT_BALANCE', p.direction === 'TO_POOL' ? undefined : 'The rewards pool does not hold that much.');
      if (err.kind === 'IDEMPOTENCY') return { transactionId: (await this.replay(key, expect)) ?? tx.txId, replayed: true };
      throw err;
    }
    return { transactionId: tx.txId, replayed: false };
  }

  /**
   * Moves tokens between ADMIN_TREASURY and HOUSE_BANKROLL (Aviator). Withdrawals may not leave
   * the bankroll below the maximum profit that currently open bets could still win.
   */
  async transferBankroll(admin: AdminContext, p: { direction: 'TO_BANKROLL' | 'FROM_BANKROLL'; amountUnits: number; reason: string; clientKey: string }, audit: AuditService): Promise<{ transactionId: string; replayed: boolean }> {
    const key = `bankroll:${admin.userId}:${p.clientKey}`;
    const expect = { direction: p.direction, amountUnits: p.amountUnits, reason: p.reason };
    const prior = await this.replay(key, expect);
    if (prior) return { transactionId: prior, replayed: true };
    const treasury = { system: 'ADMIN_TREASURY' as const };
    const bankroll = { system: 'HOUSE_BANKROLL' as const };
    const tx = this.ledger.buildTransaction({
      idempotencyKey: key,
      type: 'HOUSE_BANKROLL_TRANSFER',
      referenceType: 'HOUSE_BANKROLL',
      referenceId: 'HOUSE_BANKROLL',
      createdBy: { type: 'ADMIN', id: admin.userId },
      metadata: expect,
      postings: [p.direction === 'TO_BANKROLL' ? { from: treasury, to: bankroll, amount: p.amountUnits } : { from: bankroll, to: treasury, amount: p.amountUnits }],
    });
    const stmts = [
      ...(p.direction === 'FROM_BANKROLL'
        ? [
            assertStmt(
              this.db,
              "SELECT (SELECT balance FROM wallet_accounts WHERE id = 'sys_house_bankroll') - ? >= (SELECT COALESCE(SUM(max_profit_units), 0) FROM crash_bets WHERE status = 'ACTIVE')",
              p.amountUnits,
            ),
          ]
        : []),
      ...tx.statements,
      audit.stmt({ adminUserId: admin.userId, action: 'bankroll.transfer', entityType: 'wallet', entityId: 'HOUSE_BANKROLL', after: { ...expect, ledgerTxId: tx.txId }, reason: p.reason }),
    ];
    try {
      await runBatch(this.db, stmts);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'BALANCE') throw new AppError(p.direction === 'TO_BANKROLL' ? 'TREASURY_INSUFFICIENT' : 'BANKROLL_LIMIT');
      if (err.kind === 'ASSERTION') throw new AppError('BANKROLL_LIMIT', 'Open Aviator bets still need this bankroll. Try again after the round.');
      if (err.kind === 'IDEMPOTENCY') return { transactionId: (await this.replay(key, expect)) ?? tx.txId, replayed: true };
      throw err;
    }
    return { transactionId: tx.txId, replayed: false };
  }

  async grant(
    admin: AdminContext,
    p: { playerNumber: number; amountUnits: number; type: GrantType; reason: string; idempotencyKey: string; referenceType?: string; referenceId?: string },
    audit: AuditService,
  ): Promise<GrantResultDto> {
    const user = await this.users.findByPlayerNumber(p.playerNumber);
    if (!user) throw notFound('Player');
    const expect = { playerNumber: p.playerNumber, amountUnits: p.amountUnits, grantType: p.type, reason: p.reason };
    const prior = await this.replay(p.idempotencyKey, expect);
    if (prior) return { transactionId: prior, playerNumber: p.playerNumber, amountUnits: p.amountUnits, type: p.type, replayed: true };
    const treasury = await this.wallets.getSystemBalance('ADMIN_TREASURY');
    if (treasury < p.amountUnits) throw new AppError('TREASURY_INSUFFICIENT');
    const tx = this.ledger.buildTransaction({
      idempotencyKey: p.idempotencyKey,
      type: 'ADMIN_GRANT',
      referenceType: p.referenceType ?? 'ADMIN_GRANT',
      referenceId: p.referenceId ?? null,
      createdBy: { type: 'ADMIN', id: admin.userId },
      metadata: expect,
      postings: [{ from: { system: 'ADMIN_TREASURY' }, to: { userId: user.id, bucket: p.type === 'BONUS' ? 'BONUS' : 'AVAILABLE' }, amount: p.amountUnits }],
    });
    const raced = await this.execute(p.idempotencyKey, expect, [
      ...tx.statements,
      audit.stmt({
        adminUserId: admin.userId,
        action: 'tokens.distribute',
        entityType: 'player',
        entityId: user.id,
        after: { playerNumber: p.playerNumber, amountUnits: p.amountUnits, type: p.type, ledgerTxId: tx.txId },
        reason: p.reason,
      }),
    ]);
    if (raced) return { transactionId: raced, playerNumber: p.playerNumber, amountUnits: p.amountUnits, type: p.type, replayed: true };
    await this.notifications.notifyPlayer(user.id, {
      type: 'TOKENS_GRANTED',
      title: `You received ${formatTokens(p.amountUnits)}`,
      body: p.type === 'BONUS' ? 'Bonus tokens were added to your wallet.' : `${p.type.replace('_', ' ').toLowerCase()}: ${p.reason}`,
      link: `/wallet/transactions/${tx.txId}`,
    });
    this.publisher.publish(`user:${user.id}`, { type: 'wallet.updated' });
    return { transactionId: tx.txId, playerNumber: p.playerNumber, amountUnits: p.amountUnits, type: p.type, replayed: false };
  }

  async adjust(
    admin: AdminContext,
    p: { playerNumber: number; direction: 'CREDIT' | 'DEBIT'; amountUnits: number; reason: string; relatedTransactionId?: string; clientKey: string },
    audit: AuditService,
  ): Promise<{ transactionId: string; replayed: boolean }> {
    const user = await this.users.findByPlayerNumber(p.playerNumber);
    if (!user) throw notFound('Player');
    const key = `adjust:${admin.userId}:${p.clientKey}`;
    const expect = { playerNumber: p.playerNumber, direction: p.direction, amountUnits: p.amountUnits, reason: p.reason };
    const prior = await this.replay(key, expect);
    if (prior) return { transactionId: prior, replayed: true };
    const playerAcct = { userId: user.id, bucket: 'AVAILABLE' as const };
    const treasury = { system: 'ADMIN_TREASURY' as const };
    const tx = this.ledger.buildTransaction({
      idempotencyKey: key,
      type: 'ADJUSTMENT',
      referenceType: p.relatedTransactionId ? 'LEDGER_TRANSACTION' : 'ADJUSTMENT',
      referenceId: p.relatedTransactionId ?? null,
      createdBy: { type: 'ADMIN', id: admin.userId },
      metadata: { ...expect, relatedTransactionId: p.relatedTransactionId ?? null },
      postings: [p.direction === 'CREDIT' ? { from: treasury, to: playerAcct, amount: p.amountUnits } : { from: playerAcct, to: treasury, amount: p.amountUnits }],
    });
    try {
      await runBatch(this.db, [
        ...tx.statements,
        audit.stmt({ adminUserId: admin.userId, action: 'ledger.adjustment', entityType: 'player', entityId: user.id, after: { ...expect, ledgerTxId: tx.txId }, reason: p.reason }),
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'BALANCE') throw new AppError(p.direction === 'CREDIT' ? 'TREASURY_INSUFFICIENT' : 'INSUFFICIENT_BALANCE');
      if (err.kind === 'IDEMPOTENCY') return { transactionId: (await this.replay(key, expect)) ?? tx.txId, replayed: true };
      throw err;
    }
    this.publisher.publish(`user:${user.id}`, { type: 'wallet.updated' });
    return { transactionId: tx.txId, replayed: false };
  }

  /** Returns the winning transaction id when a concurrent duplicate already posted, else null. */
  private async execute(key: string, expect: Record<string, unknown>, stmts: Stmt[]): Promise<string | null> {
    try {
      await runBatch(this.db, stmts);
      return null;
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'BALANCE') throw new AppError('TREASURY_INSUFFICIENT');
      if (err.kind === 'IDEMPOTENCY') {
        // concurrent duplicate: the other request won; it must have been the same operation
        const prior = await this.replay(key, expect);
        if (prior) return prior;
      }
      throw err;
    }
  }
}
