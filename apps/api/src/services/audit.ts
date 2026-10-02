/**
 * Append-only audit log. Important admin actions add their audit statement to the SAME batch as
 * the action, so an action can never succeed without its audit record (and vice versa).
 */
import type { AuditLogDto } from '@arena/shared';
import type { RequestMeta } from '../env';
import { all, parseJson, run, type Stmt } from '../lib/db';
import { ulid } from '../lib/ids';

export interface AuditEntry {
  actorType?: 'ADMIN' | 'SYSTEM' | 'PLAYER';
  adminUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

interface AuditRow {
  id: string;
  admin_user_id: string | null;
  admin_label: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: number;
}

export class AuditService {
  constructor(
    private readonly db: D1Database,
    private readonly meta: RequestMeta,
    private readonly now: () => number,
  ) {}

  stmt(e: AuditEntry): Stmt {
    return this.db
      .prepare(
        `INSERT INTO audit_logs (id, actor_type, admin_user_id, action, entity_type, entity_id, before_json, after_json, reason, ip, user_agent, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        ulid(),
        e.actorType ?? (e.adminUserId ? 'ADMIN' : 'SYSTEM'),
        e.adminUserId,
        e.action,
        e.entityType,
        e.entityId ?? null,
        e.before === undefined ? null : JSON.stringify(e.before),
        e.after === undefined ? null : JSON.stringify(e.after),
        e.reason ?? null,
        this.meta.ip,
        this.meta.userAgent?.slice(0, 300) ?? null,
        this.meta.requestId,
        this.now(),
      );
  }

  async log(e: AuditEntry): Promise<void> {
    const s = this.stmt(e);
    await s.run();
  }

  async list(q: { page: number; pageSize: number; action?: string; entityType?: string; entityId?: string; adminUserId?: string }): Promise<{ items: AuditLogDto[]; hasMore: boolean }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.action) {
      where.push('a.action LIKE ?');
      params.push(`${q.action}%`);
    }
    if (q.entityType) {
      where.push('a.entity_type = ?');
      params.push(q.entityType);
    }
    if (q.entityId) {
      where.push('a.entity_id = ?');
      params.push(q.entityId);
    }
    if (q.adminUserId) {
      where.push('a.admin_user_id = ?');
      params.push(q.adminUserId);
    }
    const rows = await all<AuditRow>(
      this.db,
      `SELECT a.*, CASE WHEN p.player_number IS NULL THEN NULL ELSE '#' || p.player_number || ' ' || p.username END AS admin_label
       FROM audit_logs a LEFT JOIN player_profiles p ON p.user_id = a.admin_user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
      ...params,
      q.pageSize + 1,
      (q.page - 1) * q.pageSize,
    );
    return {
      hasMore: rows.length > q.pageSize,
      items: rows.slice(0, q.pageSize).map((r) => ({
        id: r.id,
        adminUserId: r.admin_user_id,
        adminLabel: r.admin_label,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        before: parseJson(r.before_json, null),
        after: parseJson(r.after_json, null),
        reason: r.reason,
        ip: r.ip,
        userAgent: r.user_agent,
        requestId: r.request_id,
        createdAt: r.created_at,
      })),
    };
  }
}

/** Logs a system action outside a request (cron). */
export async function systemAudit(db: D1Database, e: Omit<AuditEntry, 'adminUserId'>): Promise<void> {
  await run(
    db,
    `INSERT INTO audit_logs (id, actor_type, admin_user_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
     VALUES (?, 'SYSTEM', NULL, ?, ?, ?, ?, ?, ?, ?)`,
    ulid(),
    e.action,
    e.entityType,
    e.entityId ?? null,
    e.before === undefined ? null : JSON.stringify(e.before),
    e.after === undefined ? null : JSON.stringify(e.after),
    e.reason ?? null,
    Date.now(),
  );
}
