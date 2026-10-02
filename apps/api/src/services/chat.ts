/**
 * Private chat attached to one buy/sell request, between the requesting player and authorised
 * finance administrators. Messages are persisted in D1 first (immutable — no edit/delete), then
 * pushed to the request's realtime channel.
 */
import type { ChatMessageDto, FinanceRequestKind } from '@arena/shared';
import { all, run } from '../lib/db';
import { notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import type { FinanceRepository } from '../repositories/finance';
import type { RealtimePublisher } from '../realtime/publisher';
import type { NotificationService } from './notifications';

export type ChatSide = { side: 'PLAYER'; userId: string } | { side: 'ADMIN'; userId: string };

interface MessageRow {
  id: string;
  request_kind: FinanceRequestKind;
  request_id: string;
  sender_type: 'PLAYER' | 'ADMIN' | 'SYSTEM';
  sender_id: string | null;
  message: string;
  created_at: number;
  read_at: number | null;
}

export class ChatService {
  constructor(
    private readonly db: D1Database,
    private readonly finance: FinanceRepository,
    private readonly notifications: NotificationService,
    private readonly publisher: RealtimePublisher,
    private readonly now: () => number,
  ) {}

  /** Returns the request owner + number, verifying the player side owns it. */
  async requestContext(kind: FinanceRequestKind, requestId: string, viewer: ChatSide): Promise<{ ownerId: string; requestNumber: number; reviewedBy: string | null }> {
    const row = kind === 'BUY' ? await this.finance.findBuy(requestId) : await this.finance.findSell(requestId);
    if (!row) throw notFound('Request');
    if (viewer.side === 'PLAYER' && row.user_id !== viewer.userId) throw notFound('Request');
    return { ownerId: row.user_id, requestNumber: row.request_number, reviewedBy: row.reviewed_by };
  }

  async list(kind: FinanceRequestKind, requestId: string, viewer: ChatSide): Promise<ChatMessageDto[]> {
    await this.requestContext(kind, requestId, viewer);
    const rows = await all<MessageRow & { sender_number: number | null; sender_username: string | null }>(
      this.db,
      `SELECT m.*, p.player_number AS sender_number, p.username AS sender_username
       FROM finance_messages m LEFT JOIN player_profiles p ON p.user_id = m.sender_id
       WHERE m.request_kind = ? AND m.request_id = ? ORDER BY m.created_at, m.rowid LIMIT 500`,
      kind,
      requestId,
    );
    return rows.map((r) => ({
      id: r.id,
      requestKind: r.request_kind,
      requestId: r.request_id,
      senderType: r.sender_type,
      // players never learn which administrator wrote — only that it was support
      senderLabel: r.sender_type === 'ADMIN' ? (viewer.side === 'ADMIN' ? `Admin #${r.sender_number ?? ''} ${r.sender_username ?? ''}`.trim() : 'Support team') : r.sender_type === 'SYSTEM' ? 'System' : `Player #${r.sender_number ?? ''}`,
      isMine: r.sender_type === viewer.side && r.sender_id === viewer.userId,
      message: r.message,
      createdAt: r.created_at,
      readAt: r.read_at,
    }));
  }

  async send(kind: FinanceRequestKind, requestId: string, sender: ChatSide, message: string): Promise<ChatMessageDto> {
    const ctx = await this.requestContext(kind, requestId, sender);
    const id = ulid();
    const now = this.now();
    await run(
      this.db,
      'INSERT INTO finance_messages (id, request_kind, request_id, sender_type, sender_id, message, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
      id,
      kind,
      requestId,
      sender.side,
      sender.userId,
      message,
      now,
    );
    this.publisher.publish(`finance:${kind}:${requestId}`, { type: 'chat.message', data: { id } });
    const path = kind === 'BUY' ? 'buy' : 'sell';
    if (sender.side === 'PLAYER') {
      await this.notifications.notifyAdmins(
        'finance.chat',
        {
          type: 'ADMIN_FINANCE_CHAT',
          title: `New message on ${kind.toLowerCase()} request #${ctx.requestNumber}`,
          body: message.slice(0, 140),
          link: `/admin/finance/${path}-requests/${requestId}`,
        },
        ctx.reviewedBy ? [ctx.reviewedBy] : undefined,
      );
    } else {
      await this.notifications.notifyPlayer(ctx.ownerId, {
        type: 'ADMIN_MESSAGE',
        title: `Support replied on ${kind.toLowerCase()} request #${ctx.requestNumber}`,
        body: message.slice(0, 140),
        link: `/wallet/${path}/${requestId}`,
      });
    }
    return {
      id,
      requestKind: kind,
      requestId,
      senderType: sender.side,
      senderLabel: sender.side === 'ADMIN' ? 'You (admin)' : 'You',
      isMine: true,
      message,
      createdAt: now,
      readAt: null,
    };
  }

  /** Marks the other side's messages as read. */
  async markRead(kind: FinanceRequestKind, requestId: string, viewer: ChatSide): Promise<void> {
    await this.requestContext(kind, requestId, viewer);
    const res = await run(
      this.db,
      'UPDATE finance_messages SET read_at = ? WHERE request_kind = ? AND request_id = ? AND sender_type <> ? AND read_at IS NULL',
      this.now(),
      kind,
      requestId,
      viewer.side,
    );
    if ((res.meta?.changes ?? 0) > 0) this.publisher.publish(`finance:${kind}:${requestId}`, { type: 'chat.read', data: { side: viewer.side } });
  }
}
