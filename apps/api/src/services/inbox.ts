/**
 * Messages from players to the team (advice, requests, problems). Players see their own messages
 * and the team's reply; admins with support access see every message with its sender.
 */
import type { PlayerMessageDto } from '@arena/shared';
import { all, first } from '../lib/db';
import { AppError, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import type { UserRecord } from '../repositories/users';
import type { AuditService } from './audit';
import type { NotificationService } from './notifications';

interface MessageRow {
  id: string;
  user_id: string;
  category: PlayerMessageDto['category'];
  body: string;
  status: PlayerMessageDto['status'];
  admin_reply: string | null;
  replied_at: number | null;
  created_at: number;
  player_number?: number;
  username?: string;
  display_name?: string;
  email?: string | null;
}

const toDto = (r: MessageRow, admin: boolean): PlayerMessageDto => ({
  id: r.id,
  category: r.category,
  body: r.body,
  status: r.status,
  adminReply: r.admin_reply,
  repliedAt: r.replied_at,
  createdAt: r.created_at,
  ...(admin ? { sender: { userId: r.user_id, playerNumber: r.player_number ?? 0, username: r.username ?? '', displayName: r.display_name ?? '', email: r.email ?? null } } : {}),
});

const ADMIN_SELECT = `SELECT m.*, p.player_number, p.username, p.display_name, u.email
  FROM player_messages m JOIN player_profiles p ON p.user_id = m.user_id JOIN users u ON u.id = m.user_id`;

export class InboxService {
  constructor(
    private readonly db: D1Database,
    private readonly notifications: NotificationService,
    private readonly now: () => number,
  ) {}

  async send(user: UserRecord, input: { category: PlayerMessageDto['category']; body: string }): Promise<PlayerMessageDto> {
    const open = await first<{ n: number }>(this.db, "SELECT COUNT(*) AS n FROM player_messages WHERE user_id = ? AND status IN ('NEW', 'READ')", user.id);
    if ((open?.n ?? 0) >= 5) throw new AppError('CONFLICT', 'You already have 5 messages waiting for an answer. Please wait for a reply.');
    const id = ulid(this.now());
    const now = this.now();
    await this.db
      .prepare('INSERT INTO player_messages (id, user_id, category, body, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, user.id, input.category, input.body, 'NEW', now, now)
      .run();
    await this.notifications.notifyAdmins('support.view', {
      type: 'ADMIN_PLAYER_MESSAGE',
      title: `New message from #${user.playerNumber} @${user.username}`,
      body: input.body.slice(0, 140),
      link: '/admin/messages',
    });
    return toDto({ id, user_id: user.id, category: input.category, body: input.body, status: 'NEW', admin_reply: null, replied_at: null, created_at: now }, false);
  }

  async mine(userId: string): Promise<PlayerMessageDto[]> {
    const rows = await all<MessageRow>(this.db, 'SELECT * FROM player_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', userId);
    return rows.map((r) => toDto(r, false));
  }

  async adminList(status: string | undefined, page: number, pageSize: number): Promise<{ items: PlayerMessageDto[]; hasMore: boolean; counts: Record<string, number> }> {
    const rows = await all<MessageRow>(
      this.db,
      `${ADMIN_SELECT} ${status ? 'WHERE m.status = ?' : ''} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      ...(status ? [status] : []),
      pageSize + 1,
      (page - 1) * pageSize,
    );
    const counts = await all<{ status: string; n: number }>(this.db, 'SELECT status, COUNT(*) AS n FROM player_messages GROUP BY status');
    return { items: rows.slice(0, pageSize).map((r) => toDto(r, true)), hasMore: rows.length > pageSize, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  }

  private async find(id: string): Promise<MessageRow> {
    const row = await first<MessageRow>(this.db, `${ADMIN_SELECT} WHERE m.id = ?`, id);
    if (!row) throw notFound('Message');
    return row;
  }

  async setStatus(adminUserId: string, id: string, status: PlayerMessageDto['status'], audit: AuditService): Promise<PlayerMessageDto> {
    const row = await this.find(id);
    await this.db.prepare('UPDATE player_messages SET status = ?, updated_at = ? WHERE id = ?').bind(status, this.now(), id).run();
    await audit.log({ adminUserId, action: 'message.status', entityType: 'player_message', entityId: id, before: { status: row.status }, after: { status } });
    return toDto({ ...row, status }, true);
  }

  async reply(adminUserId: string, id: string, reply: string, audit: AuditService): Promise<PlayerMessageDto> {
    const row = await this.find(id);
    const now = this.now();
    await this.db
      .prepare("UPDATE player_messages SET admin_reply = ?, replied_by = ?, replied_at = ?, status = 'REPLIED', updated_at = ? WHERE id = ?")
      .bind(reply, adminUserId, now, now, id)
      .run();
    await audit.log({ adminUserId, action: 'message.reply', entityType: 'player_message', entityId: id, after: { reply } });
    await this.notifications.notifyPlayer(row.user_id, { type: 'ADMIN_MESSAGE', title: 'The PMT Arcade team replied to your message', body: reply.slice(0, 200), link: '/support' });
    return toDto({ ...row, admin_reply: reply, replied_at: now, status: 'REPLIED' }, true);
  }
}
