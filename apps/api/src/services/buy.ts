/**
 * Manual token purchases. A player reports a payment they made (e.g. bKash TrxID); nothing is
 * credited until an administrator verifies it and presses APPROVE & CREDIT. Crediting moves
 * tokens ADMIN_TREASURY → player AVAILABLE with idempotency key `buy:<id>:credit`, so a request
 * can be credited at most once no matter how many times approve is called.
 */
import {
  BUY_OPEN_STATUSES,
  formatBdt,
  formatTokens,
  hasPermission,
  PAYMENT_PROVIDERS,
  tokenUnitsForBdt,
  type AdminBuyRequestDto,
  type BuyRequestDto,
  type BuyStatus,
  type PaymentMethod,
} from '@arena/shared';
import type { AdminContext } from '../env';
import { assertStmt, classifyDbError, counterValueSql, nextCounterStmt, runBatch } from '../lib/db';
import { AppError, alreadyProcessed, invalidState, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import { FinanceRepository, mapBuy, type BuyRow } from '../repositories/finance';
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

export interface CreateBuyInput {
  amountPoisha: number;
  paymentMethod: PaymentMethod;
  senderNumber: string;
  paymentReference: string;
  note?: string;
}

export class BuyService {
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

  async create(user: UserRecord, input: CreateBuyInput, clientKey: string): Promise<{ request: BuyRequestDto; replayed: boolean }> {
    const prior = await this.repo.findBuyByClientKey(user.id, clientKey);
    if (prior) return { request: mapBuy(prior, { kind: 'OWNER' }), replayed: true };

    assertCanTransact(user);
    const s = await this.settings.get();
    assertNotMaintenance(s);
    if (!s.buy_requests_enabled) throw new AppError('FEATURE_DISABLED', 'Token purchases are currently disabled.');
    if (!s.enabled_payment_methods.includes(input.paymentMethod)) throw new AppError('FEATURE_DISABLED', 'This payment method is not available.');
    this.settings.assertFinanceSafe(s);

    const provider = PAYMENT_PROVIDERS[input.paymentMethod];
    const sender = provider.normalizeAccount(input.senderNumber);
    if (!sender) throw new AppError('VALIDATION_ERROR', `Enter a valid ${provider.accountLabel}.`, { field: 'senderNumber' });
    const reference = provider.normalizeReference(input.paymentReference);
    if (!reference) throw new AppError('VALIDATION_ERROR', `Enter a valid ${provider.referenceLabel} (6–40 letters/numbers).`, { field: 'paymentReference' });
    if (input.amountPoisha < s.minimum_buy_bdt * 100 || input.amountPoisha > s.maximum_buy_bdt * 100) {
      throw new AppError('AMOUNT_OUT_OF_RANGE', `Buy between ${formatBdt(s.minimum_buy_bdt * 100)} and ${formatBdt(s.maximum_buy_bdt * 100)}.`);
    }
    // Rate snapshot: the rate in force now is stored on the request and never recalculated.
    const rate = s.BUY_TOKENS_PER_BDT;
    const tokenUnits = tokenUnitsForBdt(input.amountPoisha, rate);

    const id = ulid();
    const now = this.now();
    try {
      await runBatch(this.db, [
        nextCounterStmt(this.db, 'buy_request'),
        this.db
          .prepare(
            `INSERT INTO buy_requests (id, request_number, user_id, status, amount_poisha, token_units, rate_tokens_per_bdt, payment_method,
               sender_number, payment_reference, payment_reference_normalized, note, client_key, created_at, updated_at)
             VALUES (?, ${counterValueSql}, ?, 'SUBMITTED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, 'buy_request', user.id, input.amountPoisha, tokenUnits, rate, input.paymentMethod, sender, reference, reference, input.note || null, clientKey, now, now),
        this.repo.eventStmt('BUY', id, 'SUBMITTED', 'PLAYER', user.id),
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'UNIQUE' && err.mentions('client_key')) {
        const replay = await this.repo.findBuyByClientKey(user.id, clientKey);
        if (replay) return { request: mapBuy(replay, { kind: 'OWNER' }), replayed: true };
      }
      if (err.kind === 'UNIQUE' && err.mentions('payment_reference_normalized')) {
        await this.fraud.flagDuplicateReference(user.id, reference, input.paymentMethod);
        throw new AppError('DUPLICATE_PAYMENT_REFERENCE');
      }
      throw err;
    }

    const row = await this.repo.findBuy(id);
    if (!row) throw notFound('Buy request');
    await this.notifications.notifyPlayer(user.id, {
      type: 'BUY_REQUEST_RECEIVED',
      title: `Buy request #${row.request_number} received`,
      body: `We will verify your ${formatBdt(row.amount_poisha)} payment and credit ${formatTokens(row.token_units)}.`,
      link: `/wallet/buy/${id}`,
    });
    await this.notifications.notifyAdmins('finance.buy.manage', {
      type: 'ADMIN_NEW_BUY_REQUEST',
      title: `New buy request #${row.request_number}`,
      body: `Player #${user.playerNumber} reported ${formatBdt(row.amount_poisha)} for ${formatTokens(row.token_units)}.`,
      link: `/admin/finance/buy-requests/${id}`,
    });
    if (row.token_units >= s.large_transaction_tokens * 100) {
      await this.notifications.notifyAdmins('finance.buy.manage', {
        type: 'ADMIN_LARGE_TRANSACTION',
        title: `Large buy request #${row.request_number}`,
        body: `${formatTokens(row.token_units)} requested by Player #${user.playerNumber}.`,
        link: `/admin/finance/buy-requests/${id}`,
      });
    }
    await this.fraud.checkBuyRequest({ id, userId: user.id, senderNumber: sender, tokenUnits, largeTokens: s.large_transaction_tokens });
    return { request: mapBuy(row, { kind: 'OWNER' }), replayed: false };
  }

  async cancel(user: UserRecord, id: string): Promise<BuyRequestDto> {
    const row = await this.repo.findBuy(id);
    if (!row || row.user_id !== user.id) throw notFound('Buy request');
    if (row.status !== 'SUBMITTED') throw invalidState('Only a request that is not yet under review can be cancelled.');
    const now = this.now();
    try {
      await runBatch(this.db, [
        assertStmt(this.db, "SELECT EXISTS (SELECT 1 FROM buy_requests WHERE id = ? AND status = 'SUBMITTED')", id),
        this.db.prepare("UPDATE buy_requests SET status = 'CANCELLED', updated_at = ? WHERE id = ?").bind(now, id),
        this.repo.eventStmt('BUY', id, 'CANCELLED', 'PLAYER', user.id),
      ]);
    } catch (e) {
      if (classifyDbError(e).kind === 'ASSERTION') throw invalidState('This request is already being reviewed.');
      throw e;
    }
    return this.getForOwner(user.id, id);
  }

  async listForOwner(userId: string, q: { page: number; pageSize: number; status?: BuyStatus }): Promise<{ items: BuyRequestDto[]; hasMore: boolean }> {
    const rows = await this.repo.listBuys({ ...q, userId });
    const page = rows.slice(0, q.pageSize);
    const unread = await this.repo.unreadCounts('BUY', page.map((r) => r.id), 'PLAYER');
    return { items: page.map((r) => mapBuy(r, { kind: 'OWNER' }, unread.get(r.id) ?? 0)), hasMore: rows.length > q.pageSize };
  }

  async getForOwner(userId: string, id: string): Promise<BuyRequestDto> {
    const row = await this.repo.findBuy(id);
    if (!row || row.user_id !== userId) throw notFound('Buy request');
    const [unread, events] = await Promise.all([this.repo.unreadCounts('BUY', [id], 'PLAYER'), this.repo.events('BUY', id)]);
    return mapBuy(row, { kind: 'OWNER' }, unread.get(id) ?? 0, events);
  }

  // ---------------------------------------------------------------- admin

  private async toAdminDto(rows: BuyRow[], admin: AdminContext, withEvents = false): Promise<AdminBuyRequestDto[]> {
    const users = await this.users.findManyByIds([...rows.map((r) => r.user_id), ...rows.flatMap((r) => (r.reviewed_by ? [r.reviewed_by] : []))]);
    const unread = await this.repo.unreadCounts('BUY', rows.map((r) => r.id), 'ADMIN');
    const sensitive = hasPermission(admin.permissions, 'finance.buy.manage') || hasPermission(admin.permissions, 'players.view_sensitive');
    const out: AdminBuyRequestDto[] = [];
    for (const r of rows) {
      const u = users.get(r.user_id);
      if (!u) continue;
      const reviewer = r.reviewed_by ? users.get(r.reviewed_by) : undefined;
      out.push({
        ...mapBuy(r, { kind: 'ADMIN', sensitive }, unread.get(r.id) ?? 0, withEvents ? await this.repo.events('BUY', r.id) : []),
        player: playerSummary(u, this.now()),
        reviewedBy: reviewer ? `#${reviewer.playerNumber} ${reviewer.username}` : null,
        adminNotes: r.admin_notes,
      });
    }
    return out;
  }

  async adminList(admin: AdminContext, q: { page: number; pageSize: number; status?: BuyStatus; q?: string; open?: boolean }): Promise<{ items: AdminBuyRequestDto[]; hasMore: boolean }> {
    const rows = await this.repo.listBuys({ page: q.page, pageSize: q.pageSize, status: q.status, statuses: q.open ? BUY_OPEN_STATUSES : undefined, search: q.q });
    return { items: await this.toAdminDto(rows.slice(0, q.pageSize), admin), hasMore: rows.length > q.pageSize };
  }

  async adminGet(admin: AdminContext, id: string): Promise<AdminBuyRequestDto> {
    const row = await this.repo.findBuy(id);
    if (!row) throw notFound('Buy request');
    const [dto] = await this.toAdminDto([row], admin, true);
    if (!dto) throw notFound('Buy request');
    return dto;
  }

  async startReview(admin: AdminContext, id: string, audit: AuditService): Promise<AdminBuyRequestDto> {
    const row = await this.repo.findBuy(id);
    if (!row) throw notFound('Buy request');
    if (row.status !== 'SUBMITTED') throw invalidState(row.status === 'UNDER_REVIEW' ? 'Already under review.' : `Request is ${row.status}.`);
    const now = this.now();
    await this.guarded(id, 'SUBMITTED', [
      this.db.prepare("UPDATE buy_requests SET status = 'UNDER_REVIEW', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?").bind(admin.userId, now, now, id),
      this.repo.eventStmt('BUY', id, 'UNDER_REVIEW', 'ADMIN', admin.userId),
      audit.stmt({ adminUserId: admin.userId, action: 'buy.start_review', entityType: 'buy_request', entityId: id, before: { status: row.status }, after: { status: 'UNDER_REVIEW' } }),
    ]);
    this.publisher.publish(`finance:BUY:${id}`, { type: 'request.updated' });
    return this.adminGet(admin, id);
  }

  async approve(admin: AdminContext, id: string, audit: AuditService): Promise<AdminBuyRequestDto> {
    const row = await this.repo.findBuy(id);
    if (!row) throw notFound('Buy request');
    if (row.status === 'COMPLETED' || row.ledger_tx_id) throw alreadyProcessed('This purchase was already approved and credited.');
    if (row.status !== 'SUBMITTED' && row.status !== 'UNDER_REVIEW') throw invalidState(`A ${row.status} request cannot be approved.`);
    const user = await this.users.findById(row.user_id);
    if (!user) throw notFound('Player');
    const treasury = await this.wallets.getSystemBalance('ADMIN_TREASURY');
    if (treasury < row.token_units) throw new AppError('TREASURY_INSUFFICIENT');

    const tx = this.ledger.buildTransaction({
      idempotencyKey: `buy:${id}:credit`,
      type: 'TOKEN_PURCHASE',
      referenceType: 'BUY_REQUEST',
      referenceId: id,
      createdBy: { type: 'ADMIN', id: admin.userId },
      metadata: { requestNumber: row.request_number, amountPoisha: row.amount_poisha, rateTokensPerBdt: row.rate_tokens_per_bdt, paymentMethod: row.payment_method, paymentReference: row.payment_reference },
      postings: [{ from: { system: 'ADMIN_TREASURY' }, to: { userId: row.user_id, bucket: 'AVAILABLE' }, amount: row.token_units }],
    });
    const now = this.now();
    try {
      await runBatch(this.db, [
        assertStmt(this.db, 'SELECT EXISTS (SELECT 1 FROM buy_requests WHERE id = ? AND status = ? AND ledger_tx_id IS NULL)', id, row.status),
        ...tx.statements,
        this.db
          .prepare("UPDATE buy_requests SET status = 'COMPLETED', ledger_tx_id = ?, reviewed_by = COALESCE(reviewed_by, ?), reviewed_at = COALESCE(reviewed_at, ?), completed_at = ?, updated_at = ? WHERE id = ?")
          .bind(tx.txId, admin.userId, now, now, now, id),
        this.repo.eventStmt('BUY', id, 'APPROVED', 'ADMIN', admin.userId),
        this.repo.eventStmt('BUY', id, 'TOKEN_CREDITED', 'SYSTEM', null, `Ledger transaction ${tx.txId}`),
        this.repo.eventStmt('BUY', id, 'COMPLETED', 'SYSTEM', null),
        audit.stmt({
          adminUserId: admin.userId,
          action: 'buy.approve',
          entityType: 'buy_request',
          entityId: id,
          before: { status: row.status },
          after: { status: 'COMPLETED', ledgerTxId: tx.txId, tokenUnits: row.token_units, playerNumber: user.playerNumber },
        }),
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'BALANCE') throw new AppError('TREASURY_INSUFFICIENT');
      if (err.kind === 'IDEMPOTENCY' || err.kind === 'ASSERTION') throw alreadyProcessed('This purchase was already approved and credited.');
      throw err;
    }
    await this.notifications.notifyPlayer(row.user_id, {
      type: 'BUY_APPROVED',
      title: `Buy request #${row.request_number} approved`,
      body: `Your ${formatBdt(row.amount_poisha)} payment was verified.`,
      link: `/wallet/buy/${id}`,
    });
    await this.notifications.notifyPlayer(row.user_id, {
      type: 'TOKENS_CREDITED',
      title: `${formatTokens(row.token_units)} credited`,
      body: `Tokens from buy request #${row.request_number} are now in your available balance.`,
      link: `/wallet/transactions/${tx.txId}`,
    });
    this.publisher.publish(`user:${row.user_id}`, { type: 'wallet.updated' });
    this.publisher.publish(`finance:BUY:${id}`, { type: 'request.updated' });
    return this.adminGet(admin, id);
  }

  async reject(admin: AdminContext, id: string, reason: string, audit: AuditService): Promise<AdminBuyRequestDto> {
    const row = await this.repo.findBuy(id);
    if (!row) throw notFound('Buy request');
    if (row.status !== 'SUBMITTED' && row.status !== 'UNDER_REVIEW') throw invalidState(`A ${row.status} request cannot be rejected.`);
    const now = this.now();
    await this.guarded(id, row.status, [
      this.db
        .prepare("UPDATE buy_requests SET status = 'REJECTED', rejection_reason = ?, reviewed_by = COALESCE(reviewed_by, ?), reviewed_at = COALESCE(reviewed_at, ?), updated_at = ? WHERE id = ?")
        .bind(reason, admin.userId, now, now, id),
      this.repo.eventStmt('BUY', id, 'REJECTED', 'ADMIN', admin.userId, reason),
      audit.stmt({ adminUserId: admin.userId, action: 'buy.reject', entityType: 'buy_request', entityId: id, before: { status: row.status }, after: { status: 'REJECTED' }, reason }),
    ]);
    await this.notifications.notifyPlayer(row.user_id, {
      type: 'BUY_REJECTED',
      title: `Buy request #${row.request_number} rejected`,
      body: reason,
      link: `/wallet/buy/${id}`,
    });
    this.publisher.publish(`finance:BUY:${id}`, { type: 'request.updated' });
    return this.adminGet(admin, id);
  }

  async setNotes(admin: AdminContext, id: string, notes: string, audit: AuditService): Promise<AdminBuyRequestDto> {
    const row = await this.repo.findBuy(id);
    if (!row) throw notFound('Buy request');
    await runBatch(this.db, [
      this.db.prepare('UPDATE buy_requests SET admin_notes = ?, updated_at = ? WHERE id = ?').bind(notes, this.now(), id),
      audit.stmt({ adminUserId: admin.userId, action: 'buy.notes', entityType: 'buy_request', entityId: id, before: { notes: row.admin_notes }, after: { notes } }),
    ]);
    return this.adminGet(admin, id);
  }

  /** Runs a status change only if the request is still in `expected` status. */
  private async guarded(id: string, expected: BuyStatus, stmts: D1PreparedStatement[]): Promise<void> {
    try {
      await runBatch(this.db, [assertStmt(this.db, 'SELECT EXISTS (SELECT 1 FROM buy_requests WHERE id = ? AND status = ?)', id, expected), ...stmts]);
    } catch (e) {
      if (classifyDbError(e).kind === 'ASSERTION') throw new AppError('CONFLICT', 'The request changed in the meantime. Refresh and try again.');
      throw e;
    }
  }
}
