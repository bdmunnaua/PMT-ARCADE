/**
 * Token redemption ("sell"). Submitting immediately moves the tokens AVAILABLE → LOCKED_SELL, so
 * they can no longer be staked, sold again or spent. The request then ends in exactly one of:
 *   * COMPLETED       — admin confirmed the BDT payment: LOCKED_SELL → ADMIN_TREASURY
 *   * TOKENS_UNLOCKED — admin rejected: LOCKED_SELL → AVAILABLE
 *   * CANCELLED       — player cancelled before review: LOCKED_SELL → AVAILABLE
 * All three use the idempotency key `sell:<id>:resolution`, so only one can ever happen.
 */
import {
  bdtPoishaForTokenUnits,
  formatBdt,
  formatTokens,
  hasPermission,
  PAYMENT_PROVIDERS,
  SELL_OPEN_STATUSES,
  type AdminSellRequestDto,
  type PaymentMethod,
  type SellRequestDto,
  type SellStatus,
} from '@arena/shared';
import type { AdminContext } from '../env';
import { assertStmt, classifyDbError, counterValueSql, nextCounterStmt, runBatch, type Stmt } from '../lib/db';
import { reserveSellGuardStmt } from './reserve';
import { AppError, alreadyProcessed, invalidState, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import { FinanceRepository, mapSell, type SellRow } from '../repositories/finance';
import type { UserRecord, UserRepository } from '../repositories/users';
import type { WalletRepository } from '../repositories/wallets';
import type { RealtimePublisher } from '../realtime/publisher';
import type { AuditService } from './audit';
import type { FraudService } from './fraud';
import { assertCanTransact, assertNotMaintenance } from './guards';
import type { LedgerService } from './ledger';
import type { NotificationService } from './notifications';
import { playerSummary } from './player-summary';
import type { SettingsService } from './settings';

export interface CreateSellInput {
  amountUnits: number;
  paymentMethod: PaymentMethod;
  receivingNumber: string;
  note?: string;
}

const REJECTABLE: SellStatus[] = ['TOKENS_LOCKED', 'UNDER_REVIEW', 'PAYMENT_PROCESSING'];

export class SellService {
  constructor(
    private readonly db: D1Database,
    private readonly repo: FinanceRepository,
    private readonly users: UserRepository,
    private readonly wallets: WalletRepository,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly fraud: FraudService,
    private readonly publisher: RealtimePublisher,
    private readonly now: () => number,
  ) {}

  async create(user: UserRecord, input: CreateSellInput, clientKey: string): Promise<{ request: SellRequestDto; replayed: boolean }> {
    const prior = await this.repo.findSellByClientKey(user.id, clientKey);
    if (prior) return { request: mapSell(prior, { kind: 'OWNER' }), replayed: true };

    assertCanTransact(user);
    const s = await this.settings.get();
    assertNotMaintenance(s);
    if (!s.sell_requests_enabled) throw new AppError('FEATURE_DISABLED', 'Token sales are currently disabled.');
    if (!s.enabled_payment_methods.includes(input.paymentMethod)) throw new AppError('FEATURE_DISABLED', 'This payment method is not available.');
    this.settings.assertFinanceSafe(s);

    const provider = PAYMENT_PROVIDERS[input.paymentMethod];
    const receiving = provider.normalizeAccount(input.receivingNumber);
    if (!receiving) throw new AppError('VALIDATION_ERROR', `Enter a valid ${provider.accountLabel}.`, { field: 'receivingNumber' });
    if (input.amountUnits < s.minimum_sell_tokens * 100 || input.amountUnits > s.maximum_sell_tokens * 100) {
      throw new AppError('AMOUNT_OUT_OF_RANGE', `Sell between ${formatTokens(s.minimum_sell_tokens * 100)} and ${formatTokens(s.maximum_sell_tokens * 100)}.`);
    }
    const rate = s.SELL_TOKENS_PER_BDT; // snapshot
    const bdtPoisha = bdtPoishaForTokenUnits(input.amountUnits, rate);
    if (bdtPoisha <= 0) throw new AppError('AMOUNT_OUT_OF_RANGE', 'The amount is too small to pay out.');
    const wallet = await this.wallets.getWallet(user.id);
    if (wallet.availableUnits < input.amountUnits) throw new AppError('INSUFFICIENT_BALANCE');

    const id = ulid();
    const now = this.now();
    const lock = this.ledger.buildTransaction({
      idempotencyKey: `sell:${id}:lock`,
      type: 'TOKEN_SELL_LOCK',
      referenceType: 'SELL_REQUEST',
      referenceId: id,
      createdBy: { type: 'PLAYER', id: user.id },
      metadata: { bdtPoisha, rateTokensPerBdt: rate },
      postings: [{ from: { userId: user.id, bucket: 'AVAILABLE' }, to: { userId: user.id, bucket: 'LOCKED_SELL' }, amount: input.amountUnits }],
    });
    try {
      await runBatch(this.db, [
        // the owner never pays sellers from their own pocket: the sale must fit in the taka reserve
        ...(s.reserve_guard_enabled ? [reserveSellGuardStmt(this.db, bdtPoisha)] : []),
        nextCounterStmt(this.db, 'sell_request'),
        // ledger first: sell_requests.lock_tx_id references the ledger transaction
        ...lock.statements,
        this.db
          .prepare(
            `INSERT INTO sell_requests (id, request_number, user_id, status, amount_units, bdt_poisha, rate_tokens_per_bdt, payment_method,
               receiving_number, note, client_key, lock_tx_id, created_at, updated_at)
             VALUES (?, ${counterValueSql}, ?, 'TOKENS_LOCKED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, 'sell_request', user.id, input.amountUnits, bdtPoisha, rate, input.paymentMethod, receiving, input.note || null, clientKey, lock.txId, now, now),
        this.ledger.createHoldStmt({ userId: user.id, bucket: 'LOCKED_SELL', amount: input.amountUnits, referenceType: 'SELL_REQUEST', referenceId: id, lockTxId: lock.txId }),
        this.repo.eventStmt('SELL', id, 'SUBMITTED', 'PLAYER', user.id),
        this.repo.eventStmt('SELL', id, 'TOKENS_LOCKED', 'SYSTEM', null, `Ledger transaction ${lock.txId}`),
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'BALANCE') throw new AppError('INSUFFICIENT_BALANCE');
      if (err.kind === 'ASSERTION') throw new AppError('RESERVE_LIMIT');
      if (err.kind === 'UNIQUE' && err.mentions('client_key')) {
        const replay = await this.repo.findSellByClientKey(user.id, clientKey);
        if (replay) return { request: mapSell(replay, { kind: 'OWNER' }), replayed: true };
      }
      throw err;
    }
    const row = await this.repo.findSell(id);
    if (!row) throw notFound('Sell request');
    await this.notifications.notifyPlayer(user.id, {
      type: 'SELL_SUBMITTED',
      title: `Sell request #${row.request_number} submitted`,
      body: `${formatTokens(row.amount_units)} are locked while we process your ${formatBdt(row.bdt_poisha)} payout.`,
      link: `/wallet/sell/${id}`,
    });
    await this.notifications.notifyAdmins('finance.sell.manage', {
      type: 'ADMIN_NEW_SELL_REQUEST',
      title: `New sell request #${row.request_number}`,
      body: `Player #${user.playerNumber} wants ${formatBdt(row.bdt_poisha)} for ${formatTokens(row.amount_units)}.`,
      link: `/admin/finance/sell-requests/${id}`,
    });
    if (row.amount_units >= s.large_transaction_tokens * 100) {
      await this.notifications.notifyAdmins('finance.sell.manage', {
        type: 'ADMIN_LARGE_TRANSACTION',
        title: `Large sell request #${row.request_number}`,
        body: `${formatTokens(row.amount_units)} by Player #${user.playerNumber}.`,
        link: `/admin/finance/sell-requests/${id}`,
      });
    }
    await this.fraud.checkSellRequest({ id, userId: user.id, receivingNumber: receiving, amountUnits: row.amount_units, accountCreatedAt: user.createdAt, largeTokens: s.large_transaction_tokens });
    this.publisher.publish(`user:${user.id}`, { type: 'wallet.updated' });
    return { request: mapSell(row, { kind: 'OWNER' }), replayed: false };
  }

  /** LOCKED_SELL → AVAILABLE, used by player cancel and admin reject. */
  private unlockStatements(row: SellRow, finalStatus: 'TOKENS_UNLOCKED' | 'CANCELLED', actor: { type: 'PLAYER' | 'ADMIN'; id: string }, reason: string | null): { txId: string; statements: Stmt[] } {
    const tx = this.ledger.buildTransaction({
      idempotencyKey: `sell:${row.id}:resolution`,
      type: 'TOKEN_SELL_REFUND',
      referenceType: 'SELL_REQUEST',
      referenceId: row.id,
      createdBy: actor,
      metadata: { requestNumber: row.request_number, reason, outcome: finalStatus },
      postings: [{ from: { userId: row.user_id, bucket: 'LOCKED_SELL' }, to: { userId: row.user_id, bucket: 'AVAILABLE' }, amount: row.amount_units }],
    });
    const now = this.now();
    return {
      txId: tx.txId,
      statements: [
        assertStmt(this.db, 'SELECT EXISTS (SELECT 1 FROM sell_requests WHERE id = ? AND status = ?)', row.id, row.status),
        ...tx.statements,
        ...this.ledger.finalizeHoldsStmts({ referenceType: 'SELL_REQUEST', referenceId: row.id, status: 'RELEASED', releaseTxId: tx.txId, expectedActive: 1 }),
        this.db
          .prepare('UPDATE sell_requests SET status = ?, rejection_reason = ?, resolution_tx_id = ?, completed_at = ?, updated_at = ? WHERE id = ?')
          .bind(finalStatus, reason, tx.txId, now, now, row.id),
      ],
    };
  }

  async cancel(user: UserRecord, id: string): Promise<SellRequestDto> {
    const row = await this.repo.findSell(id);
    if (!row || row.user_id !== user.id) throw notFound('Sell request');
    if (row.status !== 'TOKENS_LOCKED') throw invalidState('Only a request that is not yet under review can be cancelled.');
    const unlock = this.unlockStatements(row, 'CANCELLED', { type: 'PLAYER', id: user.id }, 'Cancelled by player');
    await this.execute(row.id, [...unlock.statements, this.repo.eventStmt('SELL', id, 'CANCELLED', 'PLAYER', user.id, 'Tokens returned to available balance')]);
    this.publisher.publish(`user:${user.id}`, { type: 'wallet.updated' });
    return this.getForOwner(user.id, id);
  }

  async listForOwner(userId: string, q: { page: number; pageSize: number; status?: SellStatus }): Promise<{ items: SellRequestDto[]; hasMore: boolean }> {
    const rows = await this.repo.listSells({ ...q, userId });
    const page = rows.slice(0, q.pageSize);
    const unread = await this.repo.unreadCounts('SELL', page.map((r) => r.id), 'PLAYER');
    return { items: page.map((r) => mapSell(r, { kind: 'OWNER' }, unread.get(r.id) ?? 0)), hasMore: rows.length > q.pageSize };
  }

  async getForOwner(userId: string, id: string): Promise<SellRequestDto> {
    const row = await this.repo.findSell(id);
    if (!row || row.user_id !== userId) throw notFound('Sell request');
    const [unread, events] = await Promise.all([this.repo.unreadCounts('SELL', [id], 'PLAYER'), this.repo.events('SELL', id)]);
    return mapSell(row, { kind: 'OWNER' }, unread.get(id) ?? 0, events);
  }

  // ---------------------------------------------------------------- admin

  private async toAdminDto(rows: SellRow[], admin: AdminContext, withEvents = false): Promise<AdminSellRequestDto[]> {
    const users = await this.users.findManyByIds([...rows.map((r) => r.user_id), ...rows.flatMap((r) => (r.reviewed_by ? [r.reviewed_by] : []))]);
    const unread = await this.repo.unreadCounts('SELL', rows.map((r) => r.id), 'ADMIN');
    const sensitive = hasPermission(admin.permissions, 'finance.sell.manage') || hasPermission(admin.permissions, 'players.view_sensitive');
    const out: AdminSellRequestDto[] = [];
    for (const r of rows) {
      const u = users.get(r.user_id);
      if (!u) continue;
      const reviewer = r.reviewed_by ? users.get(r.reviewed_by) : undefined;
      out.push({
        ...mapSell(r, { kind: 'ADMIN', sensitive }, unread.get(r.id) ?? 0, withEvents ? await this.repo.events('SELL', r.id) : []),
        player: playerSummary(u, this.now()),
        reviewedBy: reviewer ? `#${reviewer.playerNumber} ${reviewer.username}` : null,
        adminNotes: r.admin_notes,
      });
    }
    return out;
  }

  async adminList(admin: AdminContext, q: { page: number; pageSize: number; status?: SellStatus; q?: string; open?: boolean }): Promise<{ items: AdminSellRequestDto[]; hasMore: boolean }> {
    const rows = await this.repo.listSells({ page: q.page, pageSize: q.pageSize, status: q.status, statuses: q.open ? SELL_OPEN_STATUSES : undefined, search: q.q });
    return { items: await this.toAdminDto(rows.slice(0, q.pageSize), admin), hasMore: rows.length > q.pageSize };
  }

  async adminGet(admin: AdminContext, id: string): Promise<AdminSellRequestDto> {
    const row = await this.repo.findSell(id);
    if (!row) throw notFound('Sell request');
    const [dto] = await this.toAdminDto([row], admin, true);
    if (!dto) throw notFound('Sell request');
    return dto;
  }

  async startReview(admin: AdminContext, id: string, audit: AuditService): Promise<AdminSellRequestDto> {
    const row = await this.repo.findSell(id);
    if (!row) throw notFound('Sell request');
    if (row.status !== 'TOKENS_LOCKED') throw invalidState(row.status === 'UNDER_REVIEW' ? 'Already under review.' : `Request is ${row.status}.`);
    const now = this.now();
    await this.execute(id, [
      assertStmt(this.db, "SELECT EXISTS (SELECT 1 FROM sell_requests WHERE id = ? AND status = 'TOKENS_LOCKED')", id),
      this.db.prepare("UPDATE sell_requests SET status = 'UNDER_REVIEW', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?").bind(admin.userId, now, now, id),
      this.repo.eventStmt('SELL', id, 'UNDER_REVIEW', 'ADMIN', admin.userId),
      audit.stmt({ adminUserId: admin.userId, action: 'sell.start_review', entityType: 'sell_request', entityId: id, before: { status: row.status }, after: { status: 'UNDER_REVIEW' } }),
    ]);
    this.publisher.publish(`finance:SELL:${id}`, { type: 'request.updated' });
    return this.adminGet(admin, id);
  }

  /** Approval does NOT complete the sale — it moves to PAYMENT_PROCESSING until payment is confirmed. */
  async approve(admin: AdminContext, id: string, audit: AuditService): Promise<AdminSellRequestDto> {
    const row = await this.repo.findSell(id);
    if (!row) throw notFound('Sell request');
    if (row.status !== 'TOKENS_LOCKED' && row.status !== 'UNDER_REVIEW') {
      throw row.status === 'PAYMENT_PROCESSING' || row.status === 'COMPLETED' ? alreadyProcessed('This sell request was already approved.') : invalidState(`A ${row.status} request cannot be approved.`);
    }
    const now = this.now();
    await this.execute(id, [
      assertStmt(this.db, 'SELECT EXISTS (SELECT 1 FROM sell_requests WHERE id = ? AND status = ?)', id, row.status),
      this.db
        .prepare("UPDATE sell_requests SET status = 'PAYMENT_PROCESSING', approved_by = ?, approved_at = ?, reviewed_by = COALESCE(reviewed_by, ?), reviewed_at = COALESCE(reviewed_at, ?), updated_at = ? WHERE id = ?")
        .bind(admin.userId, now, admin.userId, now, now, id),
      this.repo.eventStmt('SELL', id, 'APPROVED', 'ADMIN', admin.userId),
      this.repo.eventStmt('SELL', id, 'PAYMENT_PROCESSING', 'SYSTEM', null),
      audit.stmt({ adminUserId: admin.userId, action: 'sell.approve', entityType: 'sell_request', entityId: id, before: { status: row.status }, after: { status: 'PAYMENT_PROCESSING' } }),
    ]);
    await this.notifications.notifyPlayer(row.user_id, {
      type: 'SELL_APPROVED',
      title: `Sell request #${row.request_number} approved`,
      body: `Your ${formatBdt(row.bdt_poisha)} payout is being processed.`,
      link: `/wallet/sell/${id}`,
    });
    await this.notifications.notifyPlayer(row.user_id, {
      type: 'PAYMENT_PROCESSING',
      title: 'Payment processing',
      body: `We are sending ${formatBdt(row.bdt_poisha)} to your registered number.`,
      link: `/wallet/sell/${id}`,
    });
    this.publisher.publish(`finance:SELL:${id}`, { type: 'request.updated' });
    return this.adminGet(admin, id);
  }

  async reject(admin: AdminContext, id: string, reason: string, audit: AuditService): Promise<AdminSellRequestDto> {
    const row = await this.repo.findSell(id);
    if (!row) throw notFound('Sell request');
    if (!REJECTABLE.includes(row.status)) {
      throw row.status === 'TOKENS_UNLOCKED' ? alreadyProcessed('This request was already rejected.') : invalidState(`A ${row.status} request cannot be rejected.`);
    }
    const unlock = this.unlockStatements(row, 'TOKENS_UNLOCKED', { type: 'ADMIN', id: admin.userId }, reason);
    await this.execute(id, [
      ...unlock.statements,
      this.repo.eventStmt('SELL', id, 'REJECTED', 'ADMIN', admin.userId, reason),
      this.repo.eventStmt('SELL', id, 'TOKENS_UNLOCKED', 'SYSTEM', null, `Ledger transaction ${unlock.txId}`),
      audit.stmt({ adminUserId: admin.userId, action: 'sell.reject', entityType: 'sell_request', entityId: id, before: { status: row.status }, after: { status: 'TOKENS_UNLOCKED', ledgerTxId: unlock.txId }, reason }),
    ]);
    await this.notifications.notifyPlayer(row.user_id, {
      type: 'SELL_REJECTED',
      title: `Sell request #${row.request_number} rejected`,
      body: `${reason} — ${formatTokens(row.amount_units)} returned to your available balance.`,
      link: `/wallet/sell/${id}`,
    });
    this.publisher.publish(`user:${row.user_id}`, { type: 'wallet.updated' });
    this.publisher.publish(`finance:SELL:${id}`, { type: 'request.updated' });
    return this.adminGet(admin, id);
  }

  /** CONFIRM PAYMENT SENT: LOCKED_SELL → ADMIN_TREASURY, payment reference recorded, COMPLETED. */
  async confirmPaymentSent(admin: AdminContext, id: string, p: { amountSentPoisha: number; outgoingReference: string; note?: string }, audit: AuditService): Promise<AdminSellRequestDto> {
    const row = await this.repo.findSell(id);
    if (!row) throw notFound('Sell request');
    if (row.status === 'COMPLETED') throw alreadyProcessed('Payment was already confirmed for this request.');
    if (row.status !== 'PAYMENT_PROCESSING') throw invalidState('Approve the request before confirming payment.');
    if (p.amountSentPoisha !== row.bdt_poisha) {
      throw new AppError('VALIDATION_ERROR', `The amount sent must equal the approved payout of ${formatBdt(row.bdt_poisha)}.`, { field: 'amountSentPoisha' });
    }
    const reference = PAYMENT_PROVIDERS[row.payment_method].normalizeReference(p.outgoingReference);
    if (!reference) throw new AppError('VALIDATION_ERROR', 'Enter a valid outgoing transaction reference.', { field: 'outgoingReference' });
    const tx = this.ledger.buildTransaction({
      idempotencyKey: `sell:${id}:resolution`,
      type: 'TOKEN_SELL_COMPLETE',
      referenceType: 'SELL_REQUEST',
      referenceId: id,
      createdBy: { type: 'ADMIN', id: admin.userId },
      metadata: { requestNumber: row.request_number, bdtPoisha: row.bdt_poisha, rateTokensPerBdt: row.rate_tokens_per_bdt, outgoingReference: reference },
      postings: [{ from: { userId: row.user_id, bucket: 'LOCKED_SELL' }, to: { system: 'ADMIN_TREASURY' }, amount: row.amount_units }],
    });
    const now = this.now();
    try {
      await runBatch(this.db, [
        assertStmt(this.db, "SELECT EXISTS (SELECT 1 FROM sell_requests WHERE id = ? AND status = 'PAYMENT_PROCESSING')", id),
        ...tx.statements,
        ...this.ledger.finalizeHoldsStmts({ referenceType: 'SELL_REQUEST', referenceId: id, status: 'CAPTURED', releaseTxId: tx.txId, expectedActive: 1 }),
        this.db
          .prepare(
            `UPDATE sell_requests SET status = 'COMPLETED', payment_amount_poisha = ?, payment_reference = ?, payment_note = ?, payment_sent_by = ?,
               payment_sent_at = ?, resolution_tx_id = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(p.amountSentPoisha, reference, p.note || null, admin.userId, now, tx.txId, now, now, id),
        this.repo.eventStmt('SELL', id, 'PAYMENT_SENT', 'ADMIN', admin.userId, `Reference ${reference}`),
        this.repo.eventStmt('SELL', id, 'COMPLETED', 'SYSTEM', null, `Ledger transaction ${tx.txId}`),
        audit.stmt({
          adminUserId: admin.userId,
          action: 'sell.payment_sent',
          entityType: 'sell_request',
          entityId: id,
          before: { status: row.status },
          after: { status: 'COMPLETED', amountSentPoisha: p.amountSentPoisha, outgoingReference: reference, ledgerTxId: tx.txId },
        }),
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'IDEMPOTENCY' || err.kind === 'ASSERTION') throw alreadyProcessed('Payment was already confirmed for this request.');
      if (err.kind === 'UNIQUE' && err.mentions('payment_reference')) throw new AppError('DUPLICATE_PAYMENT_REFERENCE', 'This outgoing payment reference was already used for another payout.');
      if (err.kind === 'BALANCE') throw new AppError('CONFLICT', 'Locked balance does not match this request. Run the ledger integrity check.');
      throw err;
    }
    await this.notifications.notifyPlayer(row.user_id, {
      type: 'PAYMENT_SENT',
      title: `${formatBdt(row.bdt_poisha)} sent`,
      body: `Payment reference ${reference}.`,
      link: `/wallet/sell/${id}`,
    });
    await this.notifications.notifyPlayer(row.user_id, {
      type: 'SELL_COMPLETED',
      title: `Sell request #${row.request_number} completed`,
      body: `${formatTokens(row.amount_units)} redeemed for ${formatBdt(row.bdt_poisha)}.`,
      link: `/wallet/sell/${id}`,
    });
    this.publisher.publish(`user:${row.user_id}`, { type: 'wallet.updated' });
    this.publisher.publish(`finance:SELL:${id}`, { type: 'request.updated' });
    return this.adminGet(admin, id);
  }

  async setNotes(admin: AdminContext, id: string, notes: string, audit: AuditService): Promise<AdminSellRequestDto> {
    const row = await this.repo.findSell(id);
    if (!row) throw notFound('Sell request');
    await runBatch(this.db, [
      this.db.prepare('UPDATE sell_requests SET admin_notes = ?, updated_at = ? WHERE id = ?').bind(notes, this.now(), id),
      audit.stmt({ adminUserId: admin.userId, action: 'sell.notes', entityType: 'sell_request', entityId: id, before: { notes: row.admin_notes }, after: { notes } }),
    ]);
    return this.adminGet(admin, id);
  }

  private async execute(id: string, stmts: Stmt[]): Promise<void> {
    try {
      await runBatch(this.db, stmts);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'IDEMPOTENCY' || err.kind === 'ASSERTION') {
        const fresh = await this.repo.findSell(id);
        if (fresh && ['COMPLETED', 'TOKENS_UNLOCKED', 'CANCELLED'].includes(fresh.status)) throw alreadyProcessed('This sell request was already resolved.');
        throw new AppError('CONFLICT', 'The request changed in the meantime. Refresh and try again.');
      }
      if (err.kind === 'BALANCE') throw new AppError('CONFLICT', 'Locked balance does not match this request. Run the ledger integrity check.');
      throw err;
    }
  }
}
