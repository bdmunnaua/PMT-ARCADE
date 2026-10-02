/**
 * Public transparency figures: aggregate totals only (no player can be identified), the taka
 * reserve, the ledger check and the published on-chain wallets with live balances.
 */
import type { z } from 'zod';
import type { publicWalletSchema, PublicWalletDto, TransparencyDto } from '@arena/shared';
import { all, first } from '../lib/db';
import { AppError } from '../lib/errors';
import { ulid } from '../lib/ids';
import type { AuditService } from './audit';
import type { ChainClient } from './chain';
import type { ReserveService } from './reserve';

const TOTAL_SUPPLY = 10_000_000_000;
const CACHE_MS = 60_000;

interface WalletRow {
  id: string;
  label: string;
  address: string;
  purpose: string;
  planned_tokens: number | null;
  sort: number;
}

interface Totals {
  players: number;
  issued: number | null;
  sellable: number;
  bonus: number;
  pool: number | null;
  treasury: number | null;
  fees: number | null;
  ledger: number;
  withdrawn: number;
  deposited: number;
}

/** per-database cache so a busy page does not hit the database and the chain on every view */
const cache = new WeakMap<D1Database, { at: number; dto: TransparencyDto }>();

export class TransparencyService {
  constructor(
    private readonly db: D1Database,
    private readonly reserve: ReserveService,
    private readonly chain: ChainClient,
    private readonly now: () => number,
  ) {}

  async wallets(withBalances: boolean): Promise<PublicWalletDto[]> {
    const rows = await all<WalletRow>(this.db, 'SELECT id, label, address, purpose, planned_tokens, sort FROM public_wallets ORDER BY sort, created_at');
    return Promise.all(
      rows.map(async (w) => ({
        id: w.id,
        label: w.label,
        address: w.address,
        purpose: w.purpose,
        plannedTokens: w.planned_tokens,
        sort: w.sort,
        balance: withBalances ? await this.chain.tokenBalanceOf(w.address).catch(() => null) : null,
      })),
    );
  }

  async get(fresh = false): Promise<TransparencyDto> {
    const now = this.now();
    const cached = cache.get(this.db);
    if (!fresh && cached && now - cached.at < CACHE_MS) return cached.dto;
    const [totals, reserve, integrity, wallets] = await Promise.all([
      first<Totals>(
        this.db,
        `SELECT (SELECT COUNT(*) FROM player_profiles) AS players,
                (SELECT -balance FROM wallet_accounts WHERE id = 'sys_issuance') AS issued,
                (SELECT COALESCE(SUM(balance), 0) FROM wallet_accounts WHERE owner_type = 'PLAYER' AND bucket IN ('AVAILABLE', 'LOCKED_GAME', 'LOCKED_SELL')) AS sellable,
                (SELECT COALESCE(SUM(balance), 0) FROM wallet_accounts WHERE owner_type = 'PLAYER' AND bucket = 'BONUS') AS bonus,
                (SELECT balance FROM wallet_accounts WHERE id = 'sys_rewards_pool') AS pool,
                (SELECT balance FROM wallet_accounts WHERE id = 'sys_admin_treasury') AS treasury,
                (SELECT balance FROM wallet_accounts WHERE id = 'sys_platform_fees') AS fees,
                (SELECT COALESCE(SUM(balance), 0) FROM wallet_accounts) AS ledger,
                (SELECT COALESCE(SUM(amount_units - fee_units), 0) FROM onchain_withdrawals WHERE status = 'PAID') AS withdrawn,
                (SELECT COALESCE(SUM(amount_units), 0) FROM onchain_deposits) AS deposited`,
      ),
      this.reserve.status(),
      first<{ after_json: string | null; created_at: number }>(
        this.db,
        "SELECT after_json, created_at FROM audit_logs WHERE action = 'ledger.integrity_check' ORDER BY created_at DESC LIMIT 1",
      ),
      this.wallets(true),
    ]);
    let lastIntegrityCheck: TransparencyDto['lastIntegrityCheck'] = null;
    if (integrity) {
      let status = 'UNKNOWN';
      try {
        status = String((JSON.parse(integrity.after_json ?? '{}') as { status?: string }).status ?? 'UNKNOWN');
      } catch {
        // keep UNKNOWN
      }
      lastIntegrityCheck = { status, at: integrity.created_at };
    }
    const t = totals!;
    const dto: TransparencyDto = {
      generatedAt: now,
      token: { symbol: this.chain.tokenSymbol, address: this.chain.tokenAddress, chainName: this.chain.chainName, totalSupply: TOTAL_SUPPLY },
      players: t.players,
      inApp: {
        issuedUnits: t.issued ?? 0,
        playersSellableUnits: t.sellable,
        playersBonusUnits: t.bonus,
        rewardsPoolUnits: t.pool ?? 0,
        treasuryUnits: t.treasury ?? 0,
        feesUnits: t.fees ?? 0,
      },
      reserve: { reservePoisha: reserve.reservePoisha, liabilityPoisha: reserve.liabilityPoisha, coverageBps: reserve.coverageBps, buyRate: reserve.rates.buy, sellRate: reserve.rates.sell },
      ledgerSum: t.ledger,
      lastIntegrityCheck,
      onchain: { withdrawnUnits: t.withdrawn, depositedUnits: t.deposited },
      wallets,
    };
    cache.set(this.db, { at: now, dto });
    return dto;
  }

  async addWallet(adminUserId: string, input: z.output<typeof publicWalletSchema>, audit: AuditService): Promise<PublicWalletDto> {
    const address = input.address.toLowerCase();
    if (await first(this.db, 'SELECT 1 FROM public_wallets WHERE address = ?', address)) throw new AppError('CONFLICT', 'This address is already published.');
    const id = ulid(this.now());
    await this.db
      .prepare('INSERT INTO public_wallets (id, label, address, purpose, planned_tokens, sort, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, input.label, address, input.purpose, input.plannedTokens, input.sort, this.now(), adminUserId)
      .run();
    await audit.log({ adminUserId, action: 'transparency.wallet_added', entityType: 'public_wallet', entityId: id, after: { ...input, address } });
    cache.delete(this.db);
    return { id, label: input.label, address, purpose: input.purpose, plannedTokens: input.plannedTokens, sort: input.sort, balance: null };
  }

  async removeWallet(adminUserId: string, id: string, audit: AuditService): Promise<void> {
    const row = await first<WalletRow>(this.db, 'SELECT id, label, address, purpose, planned_tokens, sort FROM public_wallets WHERE id = ?', id);
    if (!row) throw new AppError('NOT_FOUND', 'Wallet not found.');
    await this.db.prepare('DELETE FROM public_wallets WHERE id = ?').bind(id).run();
    await audit.log({ adminUserId, action: 'transparency.wallet_removed', entityType: 'public_wallet', entityId: id, before: row });
    cache.delete(this.db);
  }
}
