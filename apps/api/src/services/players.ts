import {
  type AdminIdentityDto,
  type AdminRole,
  type LeaderboardEntryDto,
  type MeDto,
  type Permission,
  type PlayerTransactionDetailDto,
  type PlayerTransactionDto,
  type PlayerTxCategory,
} from '@arena/shared';
import type { RequestMeta } from '../env';
import type { VerifiedIdentity } from '../auth/verifier';
import { all, classifyDbError, runBatch } from '../lib/db';
import { AppError, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import { mapBuy, mapSell, type FinanceRepository } from '../repositories/finance';
import type { LedgerReadRepository } from '../repositories/ledger-read';
import type { MatchRepository } from '../repositories/matches';
import type { UserRecord, UserRepository } from '../repositories/users';

const LABEL_SOURCES: Record<string, { table: string; column: string; prefix: string; idColumn?: string }> = {
  MATCH: { table: 'matches', column: 'match_number', prefix: 'Match #' },
  BUY_REQUEST: { table: 'buy_requests', column: 'request_number', prefix: 'Buy request #' },
  SELL_REQUEST: { table: 'sell_requests', column: 'request_number', prefix: 'Sell request #' },
  DISPUTE: { table: 'disputes', column: 'dispute_number', prefix: 'Dispute #' },
  CRASH_BET: { table: 'crash_bets b JOIN crash_rounds r ON r.id = b.round_id', column: 'r.round_number', prefix: 'Aviator round #', idColumn: 'b.id' },
};

/** Username seed (3–20 chars of A–Z a–z 0–9 _): email local part, else provider name, else "player". */
export function usernameBase(identity: Pick<VerifiedIdentity, 'email' | 'name'>): string {
  const raw = identity.email?.split('@')[0] ?? identity.name ?? '';
  const b = raw.replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+/g, '_').slice(0, 20).replace(/^_+|_+$/g, '');
  return b.length >= 3 ? b : 'player';
}

function randomDigits(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (x) => String(x % 10)).join('');
}

export class PlayerService {
  constructor(
    private readonly db: D1Database,
    private readonly users: UserRepository,
    private readonly ledgerRead: LedgerReadRepository,
    private readonly finance: FinanceRepository,
    private readonly matches: MatchRepository,
    private readonly now: () => number,
  ) {}

  async loadAdmin(userId: string): Promise<{ role: AdminRole; permissions: Permission[] } | null> {
    const rows = await all<{ role_id: AdminRole; permission: Permission | null }>(
      this.db,
      `SELECT au.role_id, ap.permission FROM admin_users au LEFT JOIN admin_permissions ap ON ap.role_id = au.role_id
       WHERE au.user_id = ? AND au.active = 1`,
      userId,
    );
    if (rows.length === 0) return null;
    return { role: rows[0]!.role_id, permissions: rows.flatMap((r) => (r.permission ? [r.permission] : [])) };
  }

  async me(user: UserRecord): Promise<MeDto> {
    const [stats, admin] = await Promise.all([this.users.getStats(user.id), this.loadAdmin(user.id)]);
    const adminDto: AdminIdentityDto | null = admin ? { role: admin.role, permissions: admin.permissions } : null;
    return {
      id: user.id,
      playerNumber: user.playerNumber,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      emailVerified: user.emailVerified,
      avatarUrl: user.avatarUrl,
      accountStatus: user.accountStatus,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      stats,
      admin: adminDto,
    };
  }

  /**
   * Creates user + profile + wallets on the first verified sign-in (there is no separate
   * registration step: the host project's sign-in is the account). Idempotent per uid.
   * The username is derived from the identity and made unique with a numeric suffix.
   */
  async provision(identity: VerifiedIdentity, meta: RequestMeta): Promise<{ user: UserRecord; created: boolean }> {
    const existing = await this.users.findByFirebaseUid(identity.uid);
    if (existing) return { user: existing, created: false };
    const base = usernameBase(identity);
    for (let attempt = 0; attempt < 8; attempt++) {
      const username = attempt === 0 ? base : attempt < 7 ? `${base.slice(0, 15)}_${randomDigits(4)}` : `player_${randomDigits(8)}`;
      if (await this.users.usernameTaken(username)) continue;
      const id = ulid();
      const now = this.now();
      try {
        await runBatch(this.db, [
          ...this.users.createStatements({
            id,
            firebaseUid: identity.uid,
            email: identity.email,
            emailVerified: identity.emailVerified,
            username,
            displayName: identity.name ?? username,
            ip: meta.ip,
            now,
          }),
          this.loginEventStmt('REGISTER', id, identity.uid, meta),
        ]);
      } catch (e) {
        const err = classifyDbError(e);
        if (err.kind === 'UNIQUE' && err.mentions('firebase_uid')) {
          const again = await this.users.findByFirebaseUid(identity.uid);
          if (again) return { user: again, created: false };
        }
        if (err.kind === 'UNIQUE' && err.mentions('username_lower')) continue;
        throw err;
      }
      const user = await this.users.findById(id);
      if (!user) throw new AppError('INTERNAL_ERROR');
      return { user, created: true };
    }
    throw new AppError('USERNAME_TAKEN', 'Could not allocate a username. Please try again.');
  }

  async recordSession(user: UserRecord, identity: VerifiedIdentity, meta: RequestMeta): Promise<void> {
    const blocked = user.accountStatus === 'BANNED' || user.accountStatus === 'SUSPENDED';
    await runBatch(this.db, [
      this.users.recordLoginStmt(user.id, { email: identity.email, emailVerified: identity.emailVerified, ip: meta.ip, now: this.now() }),
      this.loginEventStmt(blocked ? 'BLOCKED_STATUS' : 'LOGIN', user.id, identity.uid, meta, blocked ? user.accountStatus : null),
    ]);
  }

  loginEventStmt(type: 'REGISTER' | 'LOGIN' | 'AUTH_FAILED' | 'ADMIN_ACCESS_DENIED' | 'BLOCKED_STATUS', userId: string | null, uid: string | null, meta: RequestMeta, detail: string | null = null) {
    return this.db
      .prepare('INSERT INTO login_security_events (id, user_id, firebase_uid, event_type, ip, country, user_agent, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(ulid(), userId, uid, type, meta.ip, meta.country, meta.userAgent?.slice(0, 300) ?? null, detail, this.now());
  }

  async logSecurityEvent(type: 'AUTH_FAILED' | 'ADMIN_ACCESS_DENIED', userId: string | null, uid: string | null, meta: RequestMeta, detail: string | null): Promise<void> {
    try {
      await this.loginEventStmt(type, userId, uid, meta, detail).run();
    } catch (e) {
      console.warn('security event log failed', e instanceof Error ? e.message : e);
    }
  }

  async updateProfile(user: UserRecord, p: { displayName?: string; avatarUrl?: string }): Promise<UserRecord> {
    await runBatch(this.db, [this.users.updateProfileStmt(user.id, { displayName: p.displayName, avatarUrl: p.avatarUrl === undefined ? undefined : p.avatarUrl || null, now: this.now() })]);
    return (await this.users.findById(user.id)) ?? user;
  }

  /** Fills human labels ("Match #1004") for history rows from their references. */
  async labelTransactions<T extends PlayerTransactionDto>(items: T[]): Promise<T[]> {
    const byType = new Map<string, Set<string>>();
    for (const t of items) {
      if (t.referenceLabel || !t.referenceType || !t.referenceId || !LABEL_SOURCES[t.referenceType]) continue;
      byType.set(t.referenceType, (byType.get(t.referenceType) ?? new Set()).add(t.referenceId));
    }
    const labels = new Map<string, string>();
    for (const [type, ids] of byType) {
      const src = LABEL_SOURCES[type]!;
      const list = [...ids];
      const rows = await all<{ id: string; n: number }>(this.db, `SELECT ${src.idColumn ?? 'id'} AS id, ${src.column} AS n FROM ${src.table} WHERE ${src.idColumn ?? 'id'} IN (${list.map(() => '?').join(',')})`, ...list);
      for (const r of rows) labels.set(`${type}:${r.id}`, `${src.prefix}${r.n}`);
    }
    return items.map((t) => {
      const label = t.referenceLabel ?? (t.referenceType && t.referenceId ? labels.get(`${t.referenceType}:${t.referenceId}`) : undefined) ?? null;
      return label && !t.referenceLabel ? { ...t, referenceLabel: label, description: `${t.description} — ${label}` } : t;
    });
  }

  async transactions(userId: string, q: { page: number; pageSize: number; category?: PlayerTxCategory; from?: number; to?: number; gameId?: string; txId?: string }) {
    const page = await this.ledgerRead.playerTransactions(userId, q);
    return { ...page, items: await this.labelTransactions(page.items) };
  }

  async transactionDetail(userId: string, txId: string): Promise<PlayerTransactionDetailDto> {
    const found = await this.ledgerRead.playerTransaction(userId, txId);
    if (!found) throw notFound('Transaction');
    const [tx] = await this.labelTransactions([found.tx]);
    let match: PlayerTransactionDetailDto['match'] = null;
    let buyRequest: PlayerTransactionDetailDto['buyRequest'] = null;
    let sellRequest: PlayerTransactionDetailDto['sellRequest'] = null;
    if (tx!.referenceType === 'MATCH' && tx!.referenceId) {
      const m = await this.matches.find(tx!.referenceId);
      if (m) {
        const names = await this.matches.gameNames([m.game_id]);
        match = { id: m.id, matchNumber: m.match_number, gameName: names.get(m.game_id) ?? m.game_id, status: m.status };
      }
    } else if (tx!.referenceType === 'BUY_REQUEST' && tx!.referenceId) {
      const b = await this.finance.findBuy(tx!.referenceId);
      if (b && b.user_id === userId) buyRequest = mapBuy(b, { kind: 'OWNER' });
    } else if (tx!.referenceType === 'SELL_REQUEST' && tx!.referenceId) {
      const s = await this.finance.findSell(tx!.referenceId);
      if (s && s.user_id === userId) sellRequest = mapSell(s, { kind: 'OWNER' });
    }
    return { ...tx!, entries: found.entries, match, buyRequest, sellRequest };
  }

  async leaderboard(page: number, pageSize: number): Promise<{ items: LeaderboardEntryDto[]; hasMore: boolean }> {
    const rows = await all<{ player_number: number; username: string; display_name: string; games_played: number; wins: number; losses: number; draws: number }>(
      this.db,
      `SELECT p.player_number, p.username, p.display_name, s.games_played, s.wins, s.losses, s.draws
       FROM player_stats s JOIN player_profiles p ON p.user_id = s.user_id JOIN users u ON u.id = s.user_id
       WHERE s.games_played > 0 AND u.account_status <> 'BANNED'
       ORDER BY s.wins DESC, s.games_played ASC, p.player_number ASC LIMIT ? OFFSET ?`,
      pageSize + 1,
      (page - 1) * pageSize,
    );
    return {
      hasMore: rows.length > pageSize,
      items: rows.slice(0, pageSize).map((r, i) => ({
        rank: (page - 1) * pageSize + i + 1,
        playerNumber: r.player_number,
        username: r.username,
        displayName: r.display_name,
        gamesPlayed: r.games_played,
        wins: r.wins,
        losses: r.losses,
        draws: r.draws,
        winRateBps: r.games_played ? Math.floor((r.wins * 10_000) / r.games_played) : 0,
      })),
    };
  }
}
