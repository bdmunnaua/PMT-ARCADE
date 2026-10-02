/**
 * PMT on BNB Chain: withdrawals to a player's own wallet and deposits back.
 *
 * Withdrawal  request  player BONUS (first) / AVAILABLE → ONCHAIN_BRIDGE        (PENDING)
 *             pay      admin presses Pay: status PENDING → PROCESSING (atomic, so it can never
 *                      be sent twice), the hot wallet sends amount − fee on-chain, then
 *                      ONCHAIN_BRIDGE → PLATFORM_FEES (the fee)                  (PAID)
 *             reject   ONCHAIN_BRIDGE → the buckets it came from                (REJECTED)
 * Deposit     the player pastes a transaction ID; the server reads the receipt from the chain:
 *             a PMT Transfer from the player's linked address to the deposit address, with
 *             enough confirmations. ONCHAIN_BRIDGE → player BONUS, once per (tx, log).
 */
import { formatTokens, type CryptoDepositDto, type CryptoStatusDto, type CryptoWithdrawalDto, type HotWalletDto } from '@arena/shared';
import type { AdminContext } from '../env';
import { all, assertStmt, classifyDbError, first, runBatch } from '../lib/db';
import { AppError, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import type { UserRecord } from '../repositories/users';
import type { WalletRepository } from '../repositories/wallets';
import type { AuditService } from './audit';
import type { ChainClient } from './chain';
import { assertCanTransact, assertNotMaintenance } from './guards';
import type { LedgerService, Posting } from './ledger';
import type { NotificationService } from './notifications';
import type { SettingsService } from './settings';

interface WithdrawalRow {
  id: string;
  user_id: string;
  address: string;
  amount_units: number;
  fee_units: number;
  from_bonus_units: number;
  from_available_units: number;
  status: CryptoWithdrawalDto['status'];
  tx_hash: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
  player_number?: number;
  username?: string;
}

const mapW = (r: WithdrawalRow): CryptoWithdrawalDto => ({
  id: r.id,
  ...(r.player_number ? { playerNumber: r.player_number, username: r.username } : {}),
  address: r.address,
  amountUnits: r.amount_units,
  feeUnits: r.fee_units,
  sentUnits: r.amount_units - r.fee_units,
  status: r.status,
  txHash: r.tx_hash,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class OnchainService {
  constructor(
    private readonly db: D1Database,
    private readonly wallets: WalletRepository,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly chain: ChainClient,
    private readonly now: () => number,
  ) {}

  private async myAddress(userId: string): Promise<string | null> {
    return (await first<{ address: string }>(this.db, 'SELECT address FROM player_crypto_wallets WHERE user_id = ?', userId))?.address ?? null;
  }

  async status(user: UserRecord): Promise<CryptoStatusDto> {
    const s = await this.settings.get();
    const [address, withdrawals, deposits] = await Promise.all([
      this.myAddress(user.id),
      all<WithdrawalRow>(this.db, 'SELECT * FROM onchain_withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', user.id),
      all<{ id: string; tx_hash: string; amount_units: number; created_at: number }>(this.db, 'SELECT id, tx_hash, amount_units, created_at FROM onchain_deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', user.id),
    ]);
    return {
      configured: this.chain.configured,
      withdrawalsEnabled: s.onchain_withdrawals_enabled && this.chain.configured,
      depositsEnabled: s.onchain_deposits_enabled && this.chain.configured && !!this.chain.depositAddress(),
      tokenSymbol: this.chain.tokenSymbol,
      tokenAddress: this.chain.tokenAddress,
      chainName: this.chain.chainName,
      explorerTx: this.chain.explorerTx,
      depositAddress: this.chain.depositAddress(),
      minWithdrawTokens: s.onchain_min_withdraw_tokens,
      withdrawFeeTokens: s.onchain_withdraw_fee_tokens,
      minDepositTokens: s.onchain_min_deposit_tokens,
      confirmations: s.onchain_confirmations,
      myAddress: address,
      withdrawals: withdrawals.map(mapW),
      deposits: deposits.map((d): CryptoDepositDto => ({ id: d.id, txHash: d.tx_hash, amountUnits: d.amount_units, createdAt: d.created_at })),
    };
  }

  async setAddress(user: UserRecord, address: string): Promise<{ address: string }> {
    assertCanTransact(user);
    const a = address.toLowerCase();
    const pending = await first<{ n: number }>(this.db, "SELECT COUNT(*) AS n FROM onchain_withdrawals WHERE user_id = ? AND status IN ('PENDING', 'PROCESSING', 'FAILED')", user.id);
    if (pending?.n) throw new AppError('CONFLICT', 'You can’t change your wallet while a withdrawal is waiting.');
    const now = this.now();
    try {
      await this.db
        .prepare('INSERT INTO player_crypto_wallets (user_id, address, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET address = excluded.address, updated_at = excluded.updated_at')
        .bind(user.id, a, now, now)
        .run();
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'UNIQUE') throw new AppError('CONFLICT', 'This wallet address is already linked to another player.');
      throw err;
    }
    return { address: a };
  }

  async withdraw(user: UserRecord, amountUnits: number, clientKey: string): Promise<{ withdrawal: CryptoWithdrawalDto; replayed: boolean }> {
    const prior = await first<WithdrawalRow>(this.db, 'SELECT * FROM onchain_withdrawals WHERE user_id = ? AND client_key = ?', user.id, clientKey);
    if (prior) return { withdrawal: mapW(prior), replayed: true };
    assertCanTransact(user);
    const s = await this.settings.get();
    assertNotMaintenance(s);
    if (!s.onchain_withdrawals_enabled || !this.chain.configured) throw new AppError('FEATURE_DISABLED', 'Withdrawals to crypto wallets are not open yet.');
    if (!user.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED', 'Please verify your email address first (check your inbox).');
    const address = await this.myAddress(user.id);
    if (!address) throw new AppError('VALIDATION_ERROR', 'Add your BNB Chain wallet address first.');
    const min = s.onchain_min_withdraw_tokens * 100;
    const fee = s.onchain_withdraw_fee_tokens * 100;
    if (amountUnits < min || amountUnits <= fee) throw new AppError('AMOUNT_OUT_OF_RANGE', `The minimum withdrawal is ${formatTokens(Math.max(min, fee + 100))}.`);
    const open = await first<{ n: number }>(this.db, "SELECT COUNT(*) AS n FROM onchain_withdrawals WHERE user_id = ? AND status IN ('PENDING', 'PROCESSING', 'FAILED')", user.id);
    if (open?.n) throw new AppError('CONFLICT', 'You already have a withdrawal in progress.');
    const wallet = await this.wallets.getWallet(user.id);
    // bonus first: free PMT leaves before bought PMT
    const fromBonus = Math.min(wallet.bonusUnits, amountUnits);
    const fromAvailable = amountUnits - fromBonus;
    if (fromAvailable > wallet.availableUnits) throw new AppError('INSUFFICIENT_BALANCE');

    const id = ulid();
    const now = this.now();
    const postings: Posting[] = [];
    if (fromBonus > 0) postings.push({ from: { userId: user.id, bucket: 'BONUS' }, to: { system: 'ONCHAIN_BRIDGE' }, amount: fromBonus });
    if (fromAvailable > 0) postings.push({ from: { userId: user.id, bucket: 'AVAILABLE' }, to: { system: 'ONCHAIN_BRIDGE' }, amount: fromAvailable });
    const tx = this.ledger.buildTransaction({
      idempotencyKey: `onchain:withdraw:${id}`,
      type: 'ONCHAIN_WITHDRAW',
      referenceType: 'ONCHAIN_WITHDRAWAL',
      referenceId: id,
      createdBy: { type: 'PLAYER', id: user.id },
      metadata: { label: `to ${address.slice(0, 6)}…${address.slice(-4)}`, amountUnits, feeUnits: fee },
      postings,
    });
    try {
      await runBatch(this.db, [
        ...tx.statements,
        this.db
          .prepare(
            `INSERT INTO onchain_withdrawals (id, user_id, address, amount_units, fee_units, from_bonus_units, from_available_units, status, client_key, lock_tx_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
          )
          .bind(id, user.id, address, amountUnits, fee, fromBonus, fromAvailable, clientKey, tx.txId, now, now),
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'BALANCE') throw new AppError('INSUFFICIENT_BALANCE');
      if (err.kind === 'UNIQUE' && err.mentions('client_key')) {
        const again = await first<WithdrawalRow>(this.db, 'SELECT * FROM onchain_withdrawals WHERE user_id = ? AND client_key = ?', user.id, clientKey);
        if (again) return { withdrawal: mapW(again), replayed: true };
      }
      throw err;
    }
    await this.notifications.notifyAdmins('finance.sell.manage', {
      type: 'ADMIN_CRYPTO_WITHDRAWAL',
      title: 'New crypto withdrawal',
      body: `Player #${user.playerNumber} asked to withdraw ${formatTokens(amountUnits - fee)} to ${address}.`,
      link: '/admin/finance/crypto',
    });
    const row = await first<WithdrawalRow>(this.db, 'SELECT * FROM onchain_withdrawals WHERE id = ?', id);
    return { withdrawal: mapW(row!), replayed: false };
  }

  async adminList(status: string | null): Promise<CryptoWithdrawalDto[]> {
    const rows = await all<WithdrawalRow>(
      this.db,
      `SELECT w.*, p.player_number, p.username FROM onchain_withdrawals w JOIN player_profiles p ON p.user_id = w.user_id
       ${status ? 'WHERE w.status = ?' : ''} ORDER BY w.created_at DESC LIMIT 100`,
      ...(status ? [status] : []),
    );
    return rows.map(mapW);
  }

  async hotWallet(): Promise<HotWalletDto> {
    const pending = await first<{ s: number }>(this.db, "SELECT COALESCE(SUM(amount_units - fee_units), 0) AS s FROM onchain_withdrawals WHERE status IN ('PENDING', 'PROCESSING', 'FAILED')");
    let info: Awaited<ReturnType<ChainClient['hotWallet']>> = null;
    try {
      info = await this.chain.hotWallet();
    } catch (e) {
      console.warn('hot wallet lookup failed', e instanceof Error ? e.message : e);
    }
    return {
      configured: !!info,
      address: info?.address ?? null,
      gasBnb: info?.gasBnb ?? null,
      tokenBalance: info?.tokenBalance ?? null,
      pendingUnits: pending?.s ?? 0,
      blockedAddress: this.chain.payoutBlocked(),
    };
  }

  /** Sends the PMT on-chain. Only PENDING or FAILED withdrawals can be paid, and only by one request at a time. */
  async pay(admin: AdminContext, id: string, audit: AuditService): Promise<CryptoWithdrawalDto> {
    const now = this.now();
    const lock = await this.db
      .prepare("UPDATE onchain_withdrawals SET status = 'PROCESSING', processed_by = ?, updated_at = ? WHERE id = ? AND status IN ('PENDING', 'FAILED')")
      .bind(admin.userId, now, id)
      .run();
    if (!lock.meta.changes) throw new AppError('ALREADY_PROCESSED', 'This withdrawal is not waiting for payment (maybe it is already being paid).');
    const w = (await first<WithdrawalRow>(this.db, 'SELECT * FROM onchain_withdrawals WHERE id = ?', id))!;
    let hash: string;
    try {
      hash = await this.chain.send(w.address, w.amount_units - w.fee_units);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.db.prepare("UPDATE onchain_withdrawals SET status = 'FAILED', note = ?, updated_at = ? WHERE id = ?").bind(`Payout failed: ${msg.slice(0, 300)}. Check the explorer for the payout wallet before paying again.`, this.now(), id).run();
      throw new AppError('PAYOUT_FAILED', `The payout did not go through: ${msg.slice(0, 200)}`);
    }
    // the network fee kept from the withdrawal goes to platform fees once the payout is sent
    const feeTx =
      w.fee_units > 0
        ? this.ledger.buildTransaction({
            idempotencyKey: `onchain:paid:${id}`,
            type: 'ONCHAIN_WITHDRAW_PAID',
            referenceType: 'ONCHAIN_WITHDRAWAL',
            referenceId: id,
            createdBy: { type: 'ADMIN', id: admin.userId },
            metadata: { txHash: hash },
            postings: [{ from: { system: 'ONCHAIN_BRIDGE' }, to: { system: 'PLATFORM_FEES' }, amount: w.fee_units, postingType: 'WITHDRAW_FEE' }],
          })
        : null;
    await runBatch(this.db, [
      ...(feeTx?.statements ?? []),
      this.db.prepare("UPDATE onchain_withdrawals SET status = 'PAID', tx_hash = ?, note = NULL, resolution_tx_id = ?, updated_at = ? WHERE id = ?").bind(hash, feeTx?.txId ?? null, this.now(), id),
      audit.stmt({ adminUserId: admin.userId, action: 'crypto.withdrawal_paid', entityType: 'onchain_withdrawal', entityId: id, after: { txHash: hash, sentUnits: w.amount_units - w.fee_units } }),
    ]);
    await this.notifications.notifyPlayer(w.user_id, { type: 'CRYPTO_WITHDRAWAL', title: 'PMT sent to your wallet', body: `${formatTokens(w.amount_units - w.fee_units)} is on its way to ${w.address}.`, link: '/wallet/crypto' });
    return mapW((await first<WithdrawalRow>(this.db, 'SELECT * FROM onchain_withdrawals WHERE id = ?', id))!);
  }

  async reject(admin: AdminContext, id: string, reason: string, audit: AuditService): Promise<CryptoWithdrawalDto> {
    const w = await first<WithdrawalRow>(this.db, 'SELECT * FROM onchain_withdrawals WHERE id = ?', id);
    if (!w) throw notFound('Withdrawal');
    if (!['PENDING', 'FAILED'].includes(w.status)) throw new AppError('ALREADY_PROCESSED', 'Only waiting withdrawals can be rejected.');
    const postings: Posting[] = [];
    if (w.from_bonus_units > 0) postings.push({ from: { system: 'ONCHAIN_BRIDGE' }, to: { userId: w.user_id, bucket: 'BONUS' }, amount: w.from_bonus_units });
    if (w.from_available_units > 0) postings.push({ from: { system: 'ONCHAIN_BRIDGE' }, to: { userId: w.user_id, bucket: 'AVAILABLE' }, amount: w.from_available_units });
    const tx = this.ledger.buildTransaction({
      idempotencyKey: `onchain:refund:${id}`,
      type: 'ONCHAIN_WITHDRAW_REFUND',
      referenceType: 'ONCHAIN_WITHDRAWAL',
      referenceId: id,
      createdBy: { type: 'ADMIN', id: admin.userId },
      metadata: { reason },
      postings,
    });
    try {
      await runBatch(this.db, [
        assertStmt(this.db, "SELECT status IN ('PENDING', 'FAILED') FROM onchain_withdrawals WHERE id = ?", id),
        ...tx.statements,
        this.db.prepare("UPDATE onchain_withdrawals SET status = 'REJECTED', note = ?, resolution_tx_id = ?, processed_by = ?, updated_at = ? WHERE id = ?").bind(reason, tx.txId, admin.userId, this.now(), id),
        audit.stmt({ adminUserId: admin.userId, action: 'crypto.withdrawal_rejected', entityType: 'onchain_withdrawal', entityId: id, reason }),
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'ASSERTION' || err.kind === 'IDEMPOTENCY') throw new AppError('ALREADY_PROCESSED', 'This withdrawal was already handled.');
      throw err;
    }
    await this.notifications.notifyPlayer(w.user_id, { type: 'CRYPTO_WITHDRAWAL', title: 'Withdrawal returned', body: `Your withdrawal was not sent and ${formatTokens(w.amount_units)} is back in your balance. Reason: ${reason}`, link: '/wallet/crypto' });
    return mapW((await first<WithdrawalRow>(this.db, 'SELECT * FROM onchain_withdrawals WHERE id = ?', id))!);
  }

  /** Credits a PMT transfer from the player's linked wallet to the deposit address (as BONUS). */
  async deposit(user: UserRecord, txHash: string): Promise<CryptoDepositDto> {
    assertCanTransact(user);
    const s = await this.settings.get();
    const depositAddress = this.chain.depositAddress();
    if (!s.onchain_deposits_enabled || !this.chain.configured || !depositAddress) throw new AppError('FEATURE_DISABLED', 'Deposits from crypto wallets are not open yet.');
    const hash = txHash.toLowerCase();
    const address = await this.myAddress(user.id);
    if (!address) throw new AppError('VALIDATION_ERROR', 'Add the wallet address you will send from first.');
    const done = await first<{ user_id: string }>(this.db, 'SELECT user_id FROM onchain_deposits WHERE tx_hash = ?', hash);
    if (done) throw new AppError('ALREADY_PROCESSED', 'This transaction was already credited.');
    const check = await this.chain.checkTransaction(hash);
    if (check.status === 'NOT_FOUND') throw new AppError('VALIDATION_ERROR', 'That transaction was not found yet. Wait a minute and try again.');
    if (check.status === 'FAILED') throw new AppError('VALIDATION_ERROR', 'That transaction failed on the blockchain.');
    const transfer = check.transfers.find((t) => t.from === address && t.to === depositAddress);
    if (!transfer) throw new AppError('VALIDATION_ERROR', `That transaction is not a PMT transfer from your linked wallet to ${depositAddress}.`);
    if (check.confirmations < s.onchain_confirmations) throw new AppError('VALIDATION_ERROR', `Almost there: waiting for ${s.onchain_confirmations - check.confirmations} more block confirmations. Try again in a minute.`);
    if (transfer.units < s.onchain_min_deposit_tokens * 100) throw new AppError('AMOUNT_OUT_OF_RANGE', `The minimum deposit is ${formatTokens(s.onchain_min_deposit_tokens * 100)}.`);

    const id = ulid();
    const tx = this.ledger.buildTransaction({
      idempotencyKey: `onchain:deposit:${hash}:${transfer.logIndex}`,
      type: 'ONCHAIN_DEPOSIT',
      referenceType: 'ONCHAIN_DEPOSIT',
      referenceId: id,
      createdBy: { type: 'PLAYER', id: user.id },
      metadata: { label: `${hash.slice(0, 10)}…`, txHash: hash },
      // credited as BONUS before the public launch: deposited PMT can be played and withdrawn, not sold for taka
      postings: [{ from: { system: 'ONCHAIN_BRIDGE' }, to: { userId: user.id, bucket: 'BONUS' }, amount: transfer.units }],
    });
    try {
      await runBatch(this.db, [
        ...tx.statements,
        this.db
          .prepare('INSERT INTO onchain_deposits (id, user_id, tx_hash, log_index, from_address, amount_units, ledger_tx_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(id, user.id, hash, transfer.logIndex, transfer.from, transfer.units, tx.txId, this.now()),
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'UNIQUE' || err.kind === 'IDEMPOTENCY') throw new AppError('ALREADY_PROCESSED', 'This transaction was already credited.');
      throw err;
    }
    await this.notifications.notifyPlayer(user.id, { type: 'CRYPTO_DEPOSIT', title: 'Deposit received', body: `${formatTokens(transfer.units)} from your crypto wallet was added to your bonus balance.`, link: '/wallet/crypto' });
    return { id, txHash: hash, amountUnits: transfer.units, createdAt: this.now() };
  }
}
