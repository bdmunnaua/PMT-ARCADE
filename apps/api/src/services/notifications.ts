import type { NotificationDto, NotificationType, Permission } from '@arena/shared';
import { all, first, run, runBatch, type Stmt } from '../lib/db';
import { ulid } from '../lib/ids';
import type { RealtimePublisher } from '../realtime/publisher';

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
}

interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read_at: number | null;
  created_at: number;
}

function mapRow(r: NotificationRow): NotificationDto {
  return { id: r.id, type: r.type, title: r.title, body: r.body, link: r.link, readAt: r.read_at, createdAt: r.created_at };
}

export class NotificationService {
  constructor(
    private readonly db: D1Database,
    private readonly publisher: RealtimePublisher,
    private readonly now: () => number,
  ) {}

  private insertStmt(userId: string, audience: 'PLAYER' | 'ADMIN', n: NotificationInput): Stmt {
    return this.db
      .prepare('INSERT INTO notifications (id, user_id, audience, type, title, body, link, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)')
      .bind(ulid(), userId, audience, n.type, n.title, n.body, n.link ?? null, this.now());
  }

  /** In-app notification for a player (best effort — never blocks the business action). */
  async notifyPlayer(userId: string, n: NotificationInput): Promise<void> {
    try {
      await this.insertStmt(userId, 'PLAYER', n).run();
      this.publisher.publish(`user:${userId}`, { type: 'notification', data: { audience: 'PLAYER', type: n.type } });
    } catch (e) {
      console.warn('notifyPlayer failed', e instanceof Error ? e.message : e);
    }
  }

  /** Fans out an admin notification to every active admin whose role has `permission`. */
  async notifyAdmins(permission: Permission, n: NotificationInput, onlyUserIds?: string[]): Promise<void> {
    try {
      const admins = await all<{ user_id: string }>(
        this.db,
        `SELECT au.user_id FROM admin_users au JOIN admin_permissions ap ON ap.role_id = au.role_id
         WHERE au.active = 1 AND ap.permission = ?`,
        permission,
      );
      const targets = admins.map((a) => a.user_id).filter((id) => !onlyUserIds || onlyUserIds.includes(id));
      if (targets.length === 0) return;
      await runBatch(this.db, targets.map((id) => this.insertStmt(id, 'ADMIN', n)));
      for (const id of targets) this.publisher.publish(`user:${id}`, { type: 'notification', data: { audience: 'ADMIN', type: n.type } });
    } catch (e) {
      console.warn('notifyAdmins failed', e instanceof Error ? e.message : e);
    }
  }

  async list(userId: string, audience: 'PLAYER' | 'ADMIN', page: number, pageSize: number, unreadOnly = false): Promise<{ items: NotificationDto[]; hasMore: boolean }> {
    const rows = await all<NotificationRow>(
      this.db,
      `SELECT id, type, title, body, link, read_at, created_at FROM notifications
       WHERE user_id = ? AND audience = ? ${unreadOnly ? 'AND read_at IS NULL' : ''}
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      userId,
      audience,
      pageSize + 1,
      (page - 1) * pageSize,
    );
    return { items: rows.slice(0, pageSize).map(mapRow), hasMore: rows.length > pageSize };
  }

  async unreadCount(userId: string, audience: 'PLAYER' | 'ADMIN'): Promise<number> {
    const r = await first<{ n: number }>(this.db, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND audience = ? AND read_at IS NULL', userId, audience);
    return r?.n ?? 0;
  }

  async markRead(userId: string, audience: 'PLAYER' | 'ADMIN', ids: string[] | 'all'): Promise<void> {
    const now = this.now();
    if (ids === 'all') {
      await run(this.db, 'UPDATE notifications SET read_at = ? WHERE user_id = ? AND audience = ? AND read_at IS NULL', now, userId, audience);
      return;
    }
    if (ids.length === 0) return;
    await run(
      this.db,
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND audience = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
      now,
      userId,
      audience,
      ...ids,
    );
  }
}
