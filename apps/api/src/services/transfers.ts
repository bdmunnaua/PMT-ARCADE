/**
 * Player-to-player PMT transfers by player number.
 *   sender AVAILABLE → recipient AVAILABLE (amount − fee), sender AVAILABLE → PLATFORM_FEES (fee)
 * Only AVAILABLE (bought or won) PMT can be sent — never BONUS — so free PMT cannot be moved to
 * another account and sold. A 24-hour sending limit is checked inside the same SQL transaction.
 */
import { formatTokens, type TransferDto, type TransferRecipientDto } from '@arena/shared';
import { assertStmt, classifyDbError, first, runBatch } from '../lib/db';
import { AppError, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import type { UserRecord, UserRepository } from '../repositories/users';
import type { WalletRepository } from '../repositories/wallets';
import { assertCanTransact, assertNotMaintenance } from './guards';
import type { LedgerService } from './ledger';
import type { NotificationService } from './notifications';
import type { SettingsService } from './settings';

const DAY = 86_400_000;

interface TransferRow {
  id: string;
  to_user_id: string;
  amount_units: number;
  fee_units: number;
  note: string | null;
  created_at: number;
}

export class TransferService {
  constructor(
    private readonly db: D1Database,
    private readonly users: UserRepository,
    private readonly wallets: WalletRepository,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly now: () => number,
  ) {}

  /** Who a player number belongs to, so the sender can check before sending. */
  async recipient(playerNumber: number): Promise<TransferRecipientDto> {
    const u = await this.users.findByPlayerNumber(playerNumber);
    if (!u || u.accountStatus === 'BANNED') throw notFound('Player');
    return { playerNumber: u.playerNumber, username: u.username, displayName: u.displayName };
  }

  private async dto(r: TransferRow): Promise<TransferDto> {
    const to = await this.users.findById(r.to_user_id);
    return { id: r.id, toPlayerNumber: to?.playerNumber ?? 0, toUsername: to?.username ?? '', amountUnits: r.amount_units, feeUnits: r.fee_units, receivedUnits: r.amount_units - r.fee_units, note: r.note, createdAt: r.created_at };
  }

  async send(user: UserRecord, input: { toPlayerNumber: number; amountUnits: number; note?: string }, clientKey: string): Promise<{ transfer: TransferDto; replayed: boolean }> {
    const prior = await first<TransferRow>(this.db, 'SELECT * FROM player_transfers WHERE from_user_id = ? AND client_key = ?', user.id, clientKey);
    if (prior) return { transfer: await this.dto(prior), replayed: true };

    assertCanTransact(user);
    const s = await this.settings.get();
    assertNotMaintenance(s);
    if (!s.transfers_enabled) throw new AppError('FEATURE_DISABLED', 'Sending PMT is currently disabled.');
    const min = s.minimum_transfer_tokens * 100;
    if (input.amountUnits < min) throw new AppError('AMOUNT_OUT_OF_RANGE', `Send at least ${formatTokens(min)}.`);
    const to = await this.users.findByPlayerNumber(input.toPlayerNumber);
    if (!to) throw new AppError('NOT_FOUND', 'No player has that number.');
    if (to.id === user.id) throw new AppError('VALIDATION_ERROR', 'You cannot send PMT to yourself.');
    if (to.accountStatus !== 'ACTIVE') throw new AppError('VALIDATION_ERROR', 'That player cannot receive PMT right now.');
    const fee = Math.floor((input.amountUnits * s.transfer_fee_bps) / 10_000);
    const received = input.amountUnits - fee;
    const wallet = await this.wallets.getWallet(user.id);
    if (wallet.availableUnits < input.amountUnits) {
      throw new AppError('INSUFFICIENT_BALANCE', wallet.bonusUnits > 0 ? 'Not enough PMT to send. Bonus PMT cannot be sent — only PMT you bought or won.' : undefined);
    }

    const id = ulid();
    const now = this.now();
    const label = `#${user.playerNumber} → #${to.playerNumber}`;
    const tx = this.ledger.buildTransaction({
      idempotencyKey: `transfer:${id}`,
      type: 'PLAYER_TRANSFER',
      referenceType: 'PLAYER_TRANSFER',
      referenceId: id,
      createdBy: { type: 'PLAYER', id: user.id },
      metadata: { label, amountUnits: input.amountUnits, feeUnits: fee },
      postings: [
        { from: { userId: user.id, bucket: 'AVAILABLE' }, to: { userId: to.id, bucket: 'AVAILABLE' }, amount: received },
        ...(fee > 0 ? [{ from: { userId: user.id, bucket: 'AVAILABLE' as const }, to: { system: 'PLATFORM_FEES' as const }, amount: fee, postingType: 'TRANSFER_FEE' as const }] : []),
      ],
    });
    try {
      await runBatch(this.db, [
        // 24-hour sending limit, counted in the same transaction
        assertStmt(this.db, 'SELECT (SELECT COALESCE(SUM(amount_units), 0) FROM player_transfers WHERE from_user_id = ? AND created_at > ?) + ? <= ?', user.id, now - DAY, input.amountUnits, s.daily_transfer_limit_tokens * 100),
        ...tx.statements,
        this.db
          .prepare('INSERT INTO player_transfers (id, from_user_id, to_user_id, amount_units, fee_units, note, client_key, ledger_tx_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(id, user.id, to.id, input.amountUnits, fee, input.note || null, clientKey, tx.txId, now),
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'BALANCE') throw new AppError('INSUFFICIENT_BALANCE');
      if (err.kind === 'ASSERTION') throw new AppError('AMOUNT_OUT_OF_RANGE', `That is over your daily sending limit of ${formatTokens(s.daily_transfer_limit_tokens * 100)}.`);
      if (err.kind === 'UNIQUE' && err.mentions('client_key')) {
        const again = await first<TransferRow>(this.db, 'SELECT * FROM player_transfers WHERE from_user_id = ? AND client_key = ?', user.id, clientKey);
        if (again) return { transfer: await this.dto(again), replayed: true };
      }
      throw err;
    }

    await this.notifications.notifyPlayer(to.id, {
      type: 'TRANSFER_RECEIVED',
      title: 'You received PMT',
      body: `@${user.username} (#${user.playerNumber}) sent you ${formatTokens(received)}.${input.note ? ` “${input.note}”` : ''}`,
      link: '/wallet/transactions',
    });
    if (input.amountUnits >= s.large_transaction_tokens * 100) {
      await this.notifications.notifyAdmins('finance.view', {
        type: 'ADMIN_LARGE_TRANSACTION',
        title: 'Large PMT transfer',
        body: `Player #${user.playerNumber} sent ${formatTokens(input.amountUnits)} to player #${to.playerNumber}.`,
        link: `/admin/players`,
      });
    }
    const row = await first<TransferRow>(this.db, 'SELECT * FROM player_transfers WHERE id = ?', id);
    return { transfer: await this.dto(row!), replayed: false };
  }
}
