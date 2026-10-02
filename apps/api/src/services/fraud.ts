/**
 * Risk signals. These only FLAG activity for human review — nothing here blocks, bans or
 * restricts an account automatically. Flags are de-duplicated by `dedupe_key`.
 */
import { FRAUD_RULES, tokensToUnits, type FraudFlagDto, type FraudFlagStatus, type FraudFlagType, type FraudSeverity } from '@arena/shared';
import { all, first, parseJson, runBatch } from '../lib/db';
import { AppError, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import type { AuditService } from './audit';
import type { NotificationService } from './notifications';

export interface FlagInput {
  userId: string | null;
  type: FraudFlagType;
  severity: FraudSeverity;
  details: Record<string, unknown>;
  relatedType?: string;
  relatedId?: string;
  dedupeKey: string;
}

interface FlagRow {
  id: string;
  user_id: string | null;
  player_number: number | null;
  username: string | null;
  type: FraudFlagType;
  severity: FraudSeverity;
  status: FraudFlagStatus;
  details: string;
  related_type: string | null;
  related_id: string | null;
  created_at: number;
  reviewed_at: number | null;
  review_note: string | null;
}

const FLAG_SELECT = `SELECT f.*, p.player_number, p.username FROM fraud_flags f LEFT JOIN player_profiles p ON p.user_id = f.user_id`;

export function mapFlag(r: FlagRow): FraudFlagDto {
  return {
    id: r.id,
    userId: r.user_id,
    playerNumber: r.player_number,
    username: r.username,
    type: r.type,
    severity: r.severity,
    status: r.status,
    details: parseJson(r.details, {}),
    relatedType: r.related_type,
    relatedId: r.related_id,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
  };
}

export class FraudService {
  constructor(
    private readonly db: D1Database,
    private readonly notifications: NotificationService,
    private readonly now: () => number,
  ) {}

  async flag(f: FlagInput): Promise<boolean> {
    const now = this.now();
    const res = await this.db
      .prepare(
        `INSERT OR IGNORE INTO fraud_flags (id, user_id, type, severity, status, details, related_type, related_id, dedupe_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(ulid(), f.userId, f.type, f.severity, JSON.stringify(f.details), f.relatedType ?? null, f.relatedId ?? null, f.dedupeKey, now, now)
      .run();
    const created = (res.meta?.changes ?? 0) > 0;
    if (created) {
      await this.notifications.notifyAdmins('risk.view', {
        type: 'ADMIN_FRAUD_FLAG',
        title: `Risk flag: ${f.type.replace(/_/g, ' ').toLowerCase()}`,
        body: `${f.severity} severity signal raised for review.`,
        link: '/admin/security/fraud-flags',
      });
    }
    return created;
  }

  /** Signals evaluated after a buy request is created. */
  async checkBuyRequest(r: { id: string; userId: string; senderNumber: string; tokenUnits: number; largeTokens: number }): Promise<void> {
    const shared = await first<{ n: number }>(this.db, 'SELECT COUNT(DISTINCT user_id) AS n FROM buy_requests WHERE sender_number = ?', r.senderNumber);
    if ((shared?.n ?? 0) >= FRAUD_RULES.sharedSenderAccountsThreshold) {
      await this.flag({
        userId: r.userId,
        type: 'SHARED_SENDER_NUMBER',
        severity: 'MEDIUM',
        details: { senderNumber: r.senderNumber, accounts: shared?.n },
        relatedType: 'BUY_REQUEST',
        relatedId: r.id,
        dedupeKey: `SHARED_SENDER:${r.senderNumber}:${r.userId}`,
      });
    }
    const dayAgo = this.now() - 24 * 60 * 60 * 1000;
    const velocity = await first<{ n: number }>(this.db, 'SELECT COUNT(*) AS n FROM buy_requests WHERE user_id = ? AND created_at >= ?', r.userId, dayAgo);
    if ((velocity?.n ?? 0) > FRAUD_RULES.purchaseVelocityPerDay) {
      await this.flag({
        userId: r.userId,
        type: 'HIGH_PURCHASE_VELOCITY',
        severity: 'LOW',
        details: { requestsLast24h: velocity?.n },
        relatedType: 'BUY_REQUEST',
        relatedId: r.id,
        dedupeKey: `VELOCITY:${r.userId}:${Math.floor(this.now() / 86_400_000)}`,
      });
    }
    if (r.tokenUnits >= tokensToUnits(r.largeTokens)) {
      await this.flag({
        userId: r.userId,
        type: 'LARGE_TRANSACTION',
        severity: 'LOW',
        details: { kind: 'BUY', tokenUnits: r.tokenUnits },
        relatedType: 'BUY_REQUEST',
        relatedId: r.id,
        dedupeKey: `LARGE:BUY:${r.id}`,
      });
    }
  }

  async flagDuplicateReference(userId: string, reference: string, method: string): Promise<void> {
    await this.flag({
      userId,
      type: 'DUPLICATE_PAYMENT_REFERENCE',
      severity: 'HIGH',
      details: { reference, method },
      dedupeKey: `DUPREF:${method}:${reference}:${userId}`,
    });
  }

  async checkSellRequest(r: { id: string; userId: string; receivingNumber: string; amountUnits: number; accountCreatedAt: number; largeTokens: number }): Promise<void> {
    const shared = await first<{ n: number }>(this.db, 'SELECT COUNT(DISTINCT user_id) AS n FROM sell_requests WHERE receiving_number = ?', r.receivingNumber);
    if ((shared?.n ?? 0) >= FRAUD_RULES.sharedSenderAccountsThreshold) {
      await this.flag({
        userId: r.userId,
        type: 'SHARED_RECEIVING_NUMBER',
        severity: 'MEDIUM',
        details: { receivingNumber: r.receivingNumber, accounts: shared?.n },
        relatedType: 'SELL_REQUEST',
        relatedId: r.id,
        dedupeKey: `SHARED_RECEIVING:${r.receivingNumber}:${r.userId}`,
      });
    }
    if (this.now() - r.accountCreatedAt < FRAUD_RULES.newAccountAgeMs && r.amountUnits >= tokensToUnits(FRAUD_RULES.newAccountLargeSellTokens)) {
      await this.flag({
        userId: r.userId,
        type: 'NEW_ACCOUNT_LARGE_SELL',
        severity: 'MEDIUM',
        details: { amountUnits: r.amountUnits },
        relatedType: 'SELL_REQUEST',
        relatedId: r.id,
        dedupeKey: `NEWSELL:${r.id}`,
      });
    }
    if (r.amountUnits >= tokensToUnits(r.largeTokens)) {
      await this.flag({
        userId: r.userId,
        type: 'LARGE_TRANSACTION',
        severity: 'LOW',
        details: { kind: 'SELL', amountUnits: r.amountUnits },
        relatedType: 'SELL_REQUEST',
        relatedId: r.id,
        dedupeKey: `LARGE:SELL:${r.id}`,
      });
    }
  }

  /** Opponents who share the last login IP are flagged (possible multi-accounting). */
  async checkMatchOpponents(matchId: string, userIds: string[]): Promise<void> {
    if (userIds.length < 2) return;
    const rows = await all<{ id: string; last_login_ip: string | null }>(
      this.db,
      `SELECT id, last_login_ip FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`,
      ...userIds,
    );
    const byIp = new Map<string, string[]>();
    for (const r of rows) {
      if (!r.last_login_ip) continue;
      byIp.set(r.last_login_ip, [...(byIp.get(r.last_login_ip) ?? []), r.id]);
    }
    for (const [, ids] of byIp) {
      if (ids.length < 2) continue;
      for (const id of ids) {
        await this.flag({
          userId: id,
          type: 'SAME_IP_OPPONENTS',
          severity: 'MEDIUM',
          details: { matchId, opponents: ids.filter((x) => x !== id) },
          relatedType: 'MATCH',
          relatedId: matchId,
          dedupeKey: `SAMEIP:${matchId}:${id}`,
        });
      }
    }
  }

  async list(q: { page: number; pageSize: number; status?: FraudFlagStatus; userId?: string }): Promise<{ items: FraudFlagDto[]; hasMore: boolean }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) {
      where.push('f.status = ?');
      params.push(q.status);
    }
    if (q.userId) {
      where.push('f.user_id = ?');
      params.push(q.userId);
    }
    const rows = await all<FlagRow>(
      this.db,
      `${FLAG_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      q.pageSize + 1,
      (q.page - 1) * q.pageSize,
    );
    return { items: rows.slice(0, q.pageSize).map(mapFlag), hasMore: rows.length > q.pageSize };
  }

  async openFlagsFor(userId: string): Promise<FraudFlagDto[]> {
    const rows = await all<FlagRow>(this.db, `${FLAG_SELECT} WHERE f.user_id = ? AND f.status = 'OPEN' ORDER BY f.created_at DESC LIMIT 50`, userId);
    return rows.map(mapFlag);
  }

  async flagsFor(userId: string): Promise<FraudFlagDto[]> {
    const rows = await all<FlagRow>(this.db, `${FLAG_SELECT} WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 50`, userId);
    return rows.map(mapFlag);
  }

  async updateStatus(id: string, status: FraudFlagStatus, note: string, adminUserId: string, audit: AuditService): Promise<FraudFlagDto> {
    const row = await first<FlagRow>(this.db, `${FLAG_SELECT} WHERE f.id = ?`, id);
    if (!row) throw notFound('Flag');
    if (status === 'OPEN' && row.status === 'OPEN') throw new AppError('INVALID_STATE_TRANSITION');
    const now = this.now();
    await runBatch(this.db, [
      this.db
        .prepare('UPDATE fraud_flags SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ?')
        .bind(status, adminUserId, now, note, now, id),
      audit.stmt({ adminUserId, action: 'risk.flag_update', entityType: 'fraud_flag', entityId: id, before: { status: row.status }, after: { status }, reason: note }),
    ]);
    return mapFlag({ ...row, status, reviewed_at: now, review_note: note });
  }
}
