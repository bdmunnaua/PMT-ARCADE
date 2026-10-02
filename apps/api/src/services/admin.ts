import {
  ACCOUNT_STATUSES,
  hasPermission,
  LIVE_MATCH_STATUSES,
  maskEmail,
  type AccountStatus,
  type AdminDashboardDto,
  type AdminFinanceContextDto,
  type AdminPlayerDetailDto,
  type AdminPlayerRowDto,
  type AdminRole,
  type AdminUserDto,
  type LoginEventDto,
  type MatchStatus,
} from '@arena/shared';
import type { AdminContext } from '../env';
import { all, first, runBatch } from '../lib/db';
import { AppError, forbidden, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import { mapBuy, mapSell, type FinanceRepository } from '../repositories/finance';
import type { MatchRepository } from '../repositories/matches';
import { mapUser, USER_SELECT, type UserRecord, type UserRepository } from '../repositories/users';
import type { WalletRepository } from '../repositories/wallets';
import type { AuditService } from './audit';
import type { BuyService } from './buy';
import type { FraudService } from './fraud';
import type { MatchService } from './matches';
import type { NotificationService } from './notifications';
import type { PlayerService } from './players';
import type { SellService } from './sell';

const DAY = 24 * 60 * 60 * 1000;

export class AdminService {
  constructor(
    private readonly db: D1Database,
    private readonly users: UserRepository,
    private readonly wallets: WalletRepository,
    private readonly finance: FinanceRepository,
    private readonly matchesRepo: MatchRepository,
    private readonly matches: MatchService,
    private readonly players: PlayerService,
    private readonly buys: BuyService,
    private readonly sells: SellService,
    private readonly fraud: FraudService,
    private readonly notifications: NotificationService,
    private readonly now: () => number,
  ) {}

  private showEmail(admin: AdminContext, email: string | null): string | null {
    return hasPermission(admin.permissions, 'players.view_sensitive') ? email : maskEmail(email);
  }

  async listPlayers(admin: AdminContext, q: { page: number; pageSize: number; status?: AccountStatus; flagged?: boolean; q?: string }): Promise<{ items: AdminPlayerRowDto[]; hasMore: boolean }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) {
      where.push('u.account_status = ?');
      params.push(q.status);
    }
    if (q.flagged) where.push("EXISTS (SELECT 1 FROM fraud_flags f WHERE f.user_id = u.id AND f.status = 'OPEN')");
    if (q.q) {
      const term = q.q.trim().replace(/^#/, '');
      const num = Number(term);
      const clauses = ['p.username_lower LIKE ?', 'u.email = ?'];
      params.push(`${term.toLowerCase()}%`, term.toLowerCase());
      if (Number.isSafeInteger(num) && num > 0) {
        clauses.push('p.player_number = ?');
        params.push(num);
      }
      where.push(`(${clauses.join(' OR ')})`);
    }
    const rows = await all<Parameters<typeof mapUser>[0] & { open_flags: number }>(
      this.db,
      `${USER_SELECT.replace('FROM users u', ", (SELECT COUNT(*) FROM fraud_flags f WHERE f.user_id = u.id AND f.status = 'OPEN') AS open_flags FROM users u")}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.player_number DESC LIMIT ? OFFSET ?`,
      ...params,
      q.pageSize + 1,
      (q.page - 1) * q.pageSize,
    );
    const page = rows.slice(0, q.pageSize);
    const wallets = await this.wallets.getWallets(page.map((r) => r.id));
    return {
      hasMore: rows.length > q.pageSize,
      items: page.map((r) => {
        const u = mapUser(r);
        return {
          id: u.id,
          playerNumber: u.playerNumber,
          username: u.username,
          displayName: u.displayName,
          email: this.showEmail(admin, u.email),
          accountStatus: u.accountStatus,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt,
          openFlags: r.open_flags,
          wallet: wallets.get(u.id)!,
        };
      }),
    };
  }

  async resolvePlayer(idOrNumber: string): Promise<UserRecord> {
    const n = Number(idOrNumber.replace(/^#/, ''));
    const user = Number.isSafeInteger(n) && n > 0 ? await this.users.findByPlayerNumber(n) : await this.users.findById(idOrNumber);
    if (!user) throw notFound('Player');
    return user;
  }

  async playerDetail(admin: AdminContext, idOrNumber: string): Promise<AdminPlayerDetailDto> {
    const u = await this.resolvePlayer(idOrNumber);
    const [wallet, stats, flags, notes, txs, buys, sells, matches, adminRow] = await Promise.all([
      this.wallets.getWallet(u.id),
      this.users.getStats(u.id),
      this.fraud.flagsFor(u.id),
      all<{ id: string; note: string; created_at: number; admin_number: number; admin_username: string }>(
        this.db,
        `SELECT n.id, n.note, n.created_at, p.player_number AS admin_number, p.username AS admin_username
         FROM player_notes n JOIN player_profiles p ON p.user_id = n.admin_user_id WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 50`,
        u.id,
      ),
      this.players.transactions(u.id, { page: 1, pageSize: 20 }),
      this.buys.adminList(admin, { page: 1, pageSize: 10, q: String(u.playerNumber) }),
      this.sells.adminList(admin, { page: 1, pageSize: 10, q: String(u.playerNumber) }),
      this.matches.listMine(u.id, { page: 1, pageSize: 10 }),
      first<{ role_id: AdminRole; active: number }>(this.db, 'SELECT role_id, active FROM admin_users WHERE user_id = ?', u.id),
    ]);
    return {
      id: u.id,
      playerNumber: u.playerNumber,
      username: u.username,
      displayName: u.displayName,
      email: this.showEmail(admin, u.email),
      emailVerified: u.emailVerified,
      avatarUrl: u.avatarUrl,
      accountStatus: u.accountStatus,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      lastLoginAt: u.lastLoginAt,
      accountAgeDays: Math.floor((this.now() - u.createdAt) / DAY),
      openFlags: flags.filter((f) => f.status === 'OPEN').length,
      wallet,
      stats,
      adminRole: adminRow?.active ? adminRow.role_id : null,
      flags,
      notes: notes.map((n) => ({ id: n.id, note: n.note, adminLabel: `#${n.admin_number} ${n.admin_username}`, createdAt: n.created_at })),
      recentTransactions: txs.items,
      recentBuyRequests: buys.items.filter((b) => b.player.id === u.id),
      recentSellRequests: sells.items.filter((s) => s.player.id === u.id),
      recentMatches: matches.items,
    };
  }

  async changeStatus(admin: AdminContext, idOrNumber: string, status: AccountStatus, reason: string, audit: AuditService): Promise<AdminPlayerDetailDto> {
    if (!ACCOUNT_STATUSES.includes(status)) throw new AppError('VALIDATION_ERROR');
    const u = await this.resolvePlayer(idOrNumber);
    if (u.id === admin.userId) throw forbidden('You cannot change your own account status.');
    const targetAdmin = await this.players.loadAdmin(u.id);
    if (targetAdmin && admin.role !== 'SUPER_ADMIN') throw forbidden('Only a Super Admin can change the status of another administrator.');
    if (u.accountStatus === status) throw new AppError('INVALID_STATE_TRANSITION', `The account is already ${status}.`);
    await runBatch(this.db, [
      this.users.setStatusStmt(u.id, status, reason, this.now()),
      audit.stmt({
        adminUserId: admin.userId,
        action: `player.status.${status.toLowerCase()}`,
        entityType: 'player',
        entityId: u.id,
        before: { accountStatus: u.accountStatus },
        after: { accountStatus: status },
        reason,
      }),
    ]);
    await this.notifications.notifyPlayer(u.id, {
      type: 'ACCOUNT_STATUS',
      title: status === 'ACTIVE' ? 'Your account is active again' : `Your account is now ${status.toLowerCase()}`,
      body: reason,
      link: '/profile',
    });
    return this.playerDetail(admin, u.id);
  }

  async addNote(admin: AdminContext, idOrNumber: string, note: string, audit: AuditService): Promise<void> {
    const u = await this.resolvePlayer(idOrNumber);
    await runBatch(this.db, [
      this.db.prepare('INSERT INTO player_notes (id, user_id, admin_user_id, note, created_at) VALUES (?, ?, ?, ?, ?)').bind(ulid(), u.id, admin.userId, note, this.now()),
      audit.stmt({ adminUserId: admin.userId, action: 'player.note', entityType: 'player', entityId: u.id, after: { note } }),
    ]);
  }

  /** Everything an admin needs next to a buy/sell request to make a decision. */
  async financeContext(admin: AdminContext, userId: string, senderNumber?: string): Promise<AdminFinanceContextDto> {
    const [wallet, flags, buyStats, sellStats, recentBuys, recentSells, stats, txs] = await Promise.all([
      this.wallets.getWallet(userId),
      this.fraud.openFlagsFor(userId),
      this.finance.buyStats(userId),
      this.finance.sellStats(userId),
      this.finance.listBuys({ page: 1, pageSize: 5, userId }),
      this.finance.listSells({ page: 1, pageSize: 5, userId }),
      this.users.getStats(userId),
      this.players.transactions(userId, { page: 1, pageSize: 10 }),
    ]);
    const sensitive = hasPermission(admin.permissions, 'players.view_sensitive') || hasPermission(admin.permissions, 'finance.buy.manage');
    let senderNumberAccountCount: number | undefined;
    if (senderNumber) {
      const r = await first<{ n: number }>(this.db, 'SELECT COUNT(DISTINCT user_id) AS n FROM buy_requests WHERE sender_number = ?', senderNumber);
      senderNumberAccountCount = r?.n ?? 0;
    }
    return {
      wallet,
      riskFlags: flags,
      previousBuys: { ...buyStats, recent: recentBuys.slice(0, 5).map((r) => mapBuy(r, { kind: 'ADMIN', sensitive })) },
      previousSells: { ...sellStats, recent: recentSells.slice(0, 5).map((r) => mapSell(r, { kind: 'ADMIN', sensitive })) },
      matchSummary: stats,
      recentTransactions: txs.items,
      senderNumberAccountCount,
    };
  }

  /** the core figures; the dashboard route adds reserve, free-game and crypto figures */
  async dashboard(): Promise<Omit<AdminDashboardDto, 'reserve' | 'freeGames' | 'crypto'>> {
    const now = this.now();
    const dayAgo = now - DAY;
    const r = await first<Record<string, number | null>>(
      this.db,
      `SELECT
        (SELECT COUNT(*) FROM users) AS players_total,
        (SELECT COUNT(*) FROM users WHERE created_at >= ?) AS players_new,
        (SELECT COUNT(*) FROM users WHERE account_status = 'RESTRICTED') AS restricted,
        (SELECT COUNT(*) FROM users WHERE account_status = 'SUSPENDED') AS suspended,
        (SELECT COUNT(*) FROM users WHERE account_status = 'BANNED') AS banned,
        (SELECT COUNT(*) FROM buy_requests WHERE status IN ('SUBMITTED','UNDER_REVIEW')) AS pending_buy,
        (SELECT COUNT(*) FROM sell_requests WHERE status IN ('TOKENS_LOCKED','UNDER_REVIEW','PAYMENT_PROCESSING')) AS pending_sell,
        (SELECT balance FROM wallet_accounts WHERE id = 'sys_admin_treasury') AS treasury,
        (SELECT balance FROM wallet_accounts WHERE id = 'sys_platform_fees') AS fees,
        (SELECT -balance FROM wallet_accounts WHERE id = 'sys_issuance') AS issued,
        (SELECT balance FROM wallet_accounts WHERE id = 'sys_house_bankroll') AS bankroll,
        (SELECT COALESCE(SUM(amount_poisha), 0) FROM buy_requests WHERE status = 'COMPLETED' AND completed_at >= ?) AS buy_volume,
        (SELECT COALESCE(SUM(bdt_poisha), 0) FROM sell_requests WHERE status = 'COMPLETED' AND completed_at >= ?) AS sell_volume,
        (SELECT COUNT(*) FROM matches WHERE status IN (${LIVE_MATCH_STATUSES.map((s) => `'${s}'`).join(',')})) AS live,
        (SELECT COUNT(*) FROM matches WHERE status = 'WAITING_FOR_OPPONENT') AS waiting,
        (SELECT COUNT(*) FROM disputes WHERE status IN ('OPEN','UNDER_REVIEW')) AS open_disputes,
        (SELECT COUNT(*) FROM matches WHERE status = 'SETTLED' AND settled_at >= ?) AS settled_24h,
        (SELECT COALESCE(SUM(fee_units), 0) FROM matches WHERE status = 'SETTLED' AND settled_at >= ?) AS fees_24h,
        (SELECT COUNT(*) FROM fraud_flags WHERE status = 'OPEN') AS open_flags,
        (SELECT COUNT(*) FROM fraud_flags WHERE status = 'OPEN' AND severity = 'HIGH') AS high_flags`,
      dayAgo,
      dayAgo,
      dayAgo,
      dayAgo,
      dayAgo,
    );
    const n = (k: string) => Number(r?.[k] ?? 0);
    return {
      players: { total: n('players_total'), newToday: n('players_new'), restricted: n('restricted'), suspended: n('suspended'), banned: n('banned') },
      finance: {
        pendingBuy: n('pending_buy'),
        pendingSell: n('pending_sell'),
        treasuryUnits: n('treasury'),
        platformFeesUnits: n('fees'),
        issuedUnits: n('issued'),
        houseBankrollUnits: n('bankroll'),
        buyVolume24hPoisha: n('buy_volume'),
        sellVolume24hPoisha: n('sell_volume'),
      },
      games: { liveMatches: n('live'), waitingMatches: n('waiting'), openDisputes: n('open_disputes'), settled24h: n('settled_24h'), fees24hUnits: n('fees_24h') },
      risk: { openFlags: n('open_flags'), highFlags: n('high_flags') },
    };
  }

  async loginActivity(q: { page: number; pageSize: number; playerNumber?: number; type?: string }): Promise<{ items: LoginEventDto[]; hasMore: boolean }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.playerNumber) {
      where.push('e.user_id = (SELECT user_id FROM player_profiles WHERE player_number = ?)');
      params.push(q.playerNumber);
    }
    if (q.type) {
      where.push('e.event_type = ?');
      params.push(q.type);
    }
    const rows = await all<{ id: string; user_id: string | null; player_number: number | null; event_type: LoginEventDto['eventType']; ip: string | null; country: string | null; user_agent: string | null; detail: string | null; created_at: number }>(
      this.db,
      `SELECT e.*, p.player_number FROM login_security_events e LEFT JOIN player_profiles p ON p.user_id = e.user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      q.pageSize + 1,
      (q.page - 1) * q.pageSize,
    );
    return {
      hasMore: rows.length > q.pageSize,
      items: rows.slice(0, q.pageSize).map((r) => ({
        id: r.id,
        userId: r.user_id,
        playerNumber: r.player_number,
        eventType: r.event_type,
        ip: r.ip,
        country: r.country,
        userAgent: r.user_agent,
        detail: r.detail,
        createdAt: r.created_at,
      })),
    };
  }

  // ---------------------------------------------------------------- administrators

  async listAdmins(): Promise<AdminUserDto[]> {
    const rows = await all<{ user_id: string; role_id: AdminRole; active: number; created_at: number; updated_at: number; player_number: number; username: string; email: string | null }>(
      this.db,
      `SELECT au.*, p.player_number, p.username, u.email FROM admin_users au
       JOIN player_profiles p ON p.user_id = au.user_id JOIN users u ON u.id = au.user_id ORDER BY au.created_at`,
    );
    return rows.map((r) => ({
      userId: r.user_id,
      playerNumber: r.player_number,
      username: r.username,
      email: r.email,
      role: r.role_id,
      active: r.active === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  private async activeSuperAdmins(): Promise<number> {
    const r = await first<{ n: number }>(this.db, "SELECT COUNT(*) AS n FROM admin_users WHERE role_id = 'SUPER_ADMIN' AND active = 1");
    return r?.n ?? 0;
  }

  async assignAdmin(admin: AdminContext, playerNumber: number, role: AdminRole, reason: string, audit: AuditService): Promise<AdminUserDto[]> {
    const u = await this.users.findByPlayerNumber(playerNumber);
    if (!u) throw notFound('Player');
    if (u.accountStatus !== 'ACTIVE') throw new AppError('INVALID_STATE_TRANSITION', 'Only an ACTIVE account can become an administrator.');
    const existing = await first<{ role_id: AdminRole; active: number }>(this.db, 'SELECT role_id, active FROM admin_users WHERE user_id = ?', u.id);
    if (existing) throw new AppError('CONFLICT', 'This player is already an administrator. Edit their role instead.');
    const now = this.now();
    await runBatch(this.db, [
      this.db.prepare('INSERT INTO admin_users (user_id, role_id, active, created_by, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)').bind(u.id, role, admin.userId, now, now),
      audit.stmt({ adminUserId: admin.userId, action: 'admin.role_assign', entityType: 'admin_user', entityId: u.id, after: { role, playerNumber }, reason }),
    ]);
    return this.listAdmins();
  }

  async updateAdmin(admin: AdminContext, userId: string, p: { role?: AdminRole; active?: boolean; reason: string }, audit: AuditService): Promise<AdminUserDto[]> {
    const existing = await first<{ role_id: AdminRole; active: number }>(this.db, 'SELECT role_id, active FROM admin_users WHERE user_id = ?', userId);
    if (!existing) throw notFound('Administrator');
    if (userId === admin.userId) throw forbidden('You cannot change your own administrator role.');
    const nextRole = p.role ?? existing.role_id;
    const nextActive = p.active ?? existing.active === 1;
    const losingSuper = existing.role_id === 'SUPER_ADMIN' && existing.active === 1 && (nextRole !== 'SUPER_ADMIN' || !nextActive);
    if (losingSuper && (await this.activeSuperAdmins()) <= 1) throw forbidden('At least one active Super Admin must remain.');
    await runBatch(this.db, [
      this.db.prepare('UPDATE admin_users SET role_id = ?, active = ?, updated_at = ? WHERE user_id = ?').bind(nextRole, nextActive ? 1 : 0, this.now(), userId),
      audit.stmt({
        adminUserId: admin.userId,
        action: 'admin.role_change',
        entityType: 'admin_user',
        entityId: userId,
        before: { role: existing.role_id, active: existing.active === 1 },
        after: { role: nextRole, active: nextActive },
        reason: p.reason,
      }),
    ]);
    return this.listAdmins();
  }

  async listMatches(q: { page: number; pageSize: number; status?: MatchStatus; gameId?: string; live?: boolean }) {
    const rows = await this.matchesRepo.listAdmin({
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      gameId: q.gameId,
      statuses: q.live ? [...LIVE_MATCH_STATUSES, 'WAITING_FOR_OPPONENT', 'DISPUTED'] : undefined,
    });
    return { items: await this.matches.toDtos(rows.slice(0, q.pageSize), null), hasMore: rows.length > q.pageSize };
  }
}
