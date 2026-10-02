import { addUnits, SYSTEM_ACCOUNT_IDS, type PlayerBucket, type SystemAccount, type WalletDto } from '@arena/shared';
import { all, first } from '../lib/db';

export function emptyWallet(): WalletDto {
  return { availableUnits: 0, lockedGameUnits: 0, lockedSellUnits: 0, bonusUnits: 0, totalUnits: 0 };
}

export function walletFromRows(rows: { bucket: string; balance: number }[]): WalletDto {
  const w = emptyWallet();
  for (const r of rows) {
    const b = Number(r.balance);
    if (r.bucket === 'AVAILABLE') w.availableUnits = b;
    else if (r.bucket === 'LOCKED_GAME') w.lockedGameUnits = b;
    else if (r.bucket === 'LOCKED_SELL') w.lockedSellUnits = b;
    else if (r.bucket === 'BONUS') w.bonusUnits = b;
  }
  w.totalUnits = addUnits(w.availableUnits, w.lockedGameUnits, w.lockedSellUnits, w.bonusUnits);
  return w;
}

/** Read-only access to cached balances. Writes happen exclusively in LedgerService. */
export class WalletRepository {
  constructor(private readonly db: D1Database) {}

  async getWallet(userId: string): Promise<WalletDto> {
    const rows = await all<{ bucket: PlayerBucket; balance: number }>(this.db, 'SELECT bucket, balance FROM wallet_accounts WHERE user_id = ?', userId);
    return walletFromRows(rows);
  }

  async getWallets(userIds: string[]): Promise<Map<string, WalletDto>> {
    const out = new Map<string, WalletDto>();
    if (userIds.length === 0) return out;
    const unique = [...new Set(userIds)];
    const rows = await all<{ user_id: string; bucket: string; balance: number }>(
      this.db,
      `SELECT user_id, bucket, balance FROM wallet_accounts WHERE user_id IN (${unique.map(() => '?').join(',')})`,
      ...unique,
    );
    const grouped = new Map<string, { bucket: string; balance: number }[]>();
    for (const r of rows) {
      const list = grouped.get(r.user_id) ?? [];
      list.push(r);
      grouped.set(r.user_id, list);
    }
    for (const id of unique) out.set(id, walletFromRows(grouped.get(id) ?? []));
    return out;
  }

  async getSystemBalance(account: SystemAccount): Promise<number> {
    const r = await first<{ balance: number }>(this.db, 'SELECT balance FROM wallet_accounts WHERE id = ?', SYSTEM_ACCOUNT_IDS[account]);
    return r ? Number(r.balance) : 0;
  }
}
