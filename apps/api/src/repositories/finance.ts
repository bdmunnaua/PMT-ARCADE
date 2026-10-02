import {
  maskAccount,
  type BuyRequestDto,
  type BuyStatus,
  type FinanceRequestKind,
  type PaymentMethod,
  type RequestEventDto,
  type SellRequestDto,
  type SellStatus,
  type SenderType,
} from '@arena/shared';
import { all, first, type Stmt } from '../lib/db';
import { ulid } from '../lib/ids';

export interface BuyRow {
  id: string;
  request_number: number;
  user_id: string;
  status: BuyStatus;
  amount_poisha: number;
  token_units: number;
  rate_tokens_per_bdt: number;
  payment_method: PaymentMethod;
  sender_number: string;
  payment_reference: string;
  payment_reference_normalized: string;
  note: string | null;
  client_key: string;
  rejection_reason: string | null;
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  completed_at: number | null;
  ledger_tx_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface SellRow {
  id: string;
  request_number: number;
  user_id: string;
  status: SellStatus;
  amount_units: number;
  bdt_poisha: number;
  rate_tokens_per_bdt: number;
  payment_method: PaymentMethod;
  receiving_number: string;
  note: string | null;
  client_key: string;
  rejection_reason: string | null;
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  approved_by: string | null;
  approved_at: number | null;
  payment_amount_poisha: number | null;
  payment_reference: string | null;
  payment_note: string | null;
  payment_sent_by: string | null;
  payment_sent_at: number | null;
  completed_at: number | null;
  lock_tx_id: string | null;
  resolution_tx_id: string | null;
  created_at: number;
  updated_at: number;
}

export type Viewer = { kind: 'OWNER' } | { kind: 'ADMIN'; sensitive: boolean };

function showNumber(value: string, viewer: Viewer): string {
  return viewer.kind === 'OWNER' || viewer.sensitive ? value : maskAccount(value);
}

export function mapBuy(r: BuyRow, viewer: Viewer, unread = 0, events: RequestEventDto[] = []): BuyRequestDto {
  return {
    id: r.id,
    requestNumber: r.request_number,
    status: r.status,
    amountPoisha: r.amount_poisha,
    tokenUnits: r.token_units,
    rateTokensPerBdt: r.rate_tokens_per_bdt,
    paymentMethod: r.payment_method,
    senderNumber: showNumber(r.sender_number, viewer),
    paymentReference: r.payment_reference,
    note: r.note,
    rejectionReason: r.rejection_reason,
    ledgerTxId: r.ledger_tx_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    reviewedAt: r.reviewed_at,
    completedAt: r.completed_at,
    unreadMessages: unread,
    events,
  };
}

export function mapSell(r: SellRow, viewer: Viewer, unread = 0, events: RequestEventDto[] = []): SellRequestDto {
  return {
    id: r.id,
    requestNumber: r.request_number,
    status: r.status,
    amountUnits: r.amount_units,
    bdtPoisha: r.bdt_poisha,
    rateTokensPerBdt: r.rate_tokens_per_bdt,
    paymentMethod: r.payment_method,
    receivingNumber: showNumber(r.receiving_number, viewer),
    note: r.note,
    rejectionReason: r.rejection_reason,
    payment:
      r.payment_sent_at && r.payment_amount_poisha && r.payment_reference
        ? { amountSentPoisha: r.payment_amount_poisha, outgoingReference: r.payment_reference, note: r.payment_note, sentAt: r.payment_sent_at }
        : null,
    ledgerTxId: r.resolution_tx_id ?? r.lock_tx_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    reviewedAt: r.reviewed_at,
    completedAt: r.completed_at,
    unreadMessages: unread,
    events,
  };
}

export class FinanceRepository {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number,
  ) {}

  findBuy(id: string): Promise<BuyRow | null> {
    return first<BuyRow>(this.db, 'SELECT * FROM buy_requests WHERE id = ?', id);
  }
  findBuyByClientKey(userId: string, key: string): Promise<BuyRow | null> {
    return first<BuyRow>(this.db, 'SELECT * FROM buy_requests WHERE user_id = ? AND client_key = ?', userId, key);
  }
  findSell(id: string): Promise<SellRow | null> {
    return first<SellRow>(this.db, 'SELECT * FROM sell_requests WHERE id = ?', id);
  }
  findSellByClientKey(userId: string, key: string): Promise<SellRow | null> {
    return first<SellRow>(this.db, 'SELECT * FROM sell_requests WHERE user_id = ? AND client_key = ?', userId, key);
  }

  async listBuys(q: { page: number; pageSize: number; userId?: string; status?: BuyStatus; statuses?: readonly BuyStatus[]; search?: string }): Promise<BuyRow[]> {
    const { where, params } = this.filters(q, 'b', 'sender_number', 'payment_reference_normalized');
    return all<BuyRow>(
      this.db,
      `SELECT b.* FROM buy_requests b ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      q.pageSize + 1,
      (q.page - 1) * q.pageSize,
    );
  }

  async listSells(q: { page: number; pageSize: number; userId?: string; status?: SellStatus; statuses?: readonly SellStatus[]; search?: string }): Promise<SellRow[]> {
    const { where, params } = this.filters(q, 's', 'receiving_number', 'payment_reference');
    return all<SellRow>(
      this.db,
      `SELECT s.* FROM sell_requests s ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      q.pageSize + 1,
      (q.page - 1) * q.pageSize,
    );
  }

  private filters(
    q: { userId?: string; status?: string; statuses?: readonly string[]; search?: string },
    alias: string,
    numberColumn: string,
    referenceColumn: string,
  ): { where: string[]; params: unknown[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.userId) {
      where.push(`${alias}.user_id = ?`);
      params.push(q.userId);
    }
    if (q.status) {
      where.push(`${alias}.status = ?`);
      params.push(q.status);
    } else if (q.statuses?.length) {
      where.push(`${alias}.status IN (${q.statuses.map(() => '?').join(',')})`);
      params.push(...q.statuses);
    }
    if (q.search) {
      const s = q.search.trim();
      const num = Number(s.replace(/^#/, ''));
      const clauses = [`${alias}.${numberColumn} = ?`, `${alias}.${referenceColumn} = ?`];
      params.push(s, s.toUpperCase());
      if (Number.isSafeInteger(num) && num > 0) {
        clauses.push(`${alias}.request_number = ?`, `${alias}.user_id = (SELECT user_id FROM player_profiles WHERE player_number = ?)`);
        params.push(num, num);
      }
      where.push(`(${clauses.join(' OR ')})`);
    }
    return { where, params };
  }

  eventStmt(kind: FinanceRequestKind, requestId: string, status: string, actorType: SenderType, actorId: string | null, note: string | null = null): Stmt {
    return this.db
      .prepare('INSERT INTO finance_request_events (id, request_kind, request_id, status, note, actor_type, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(ulid(), kind, requestId, status, note, actorType, actorId, this.now());
  }

  async events(kind: FinanceRequestKind, requestId: string): Promise<RequestEventDto[]> {
    const rows = await all<{ status: string; note: string | null; actor_type: SenderType; created_at: number }>(
      this.db,
      'SELECT status, note, actor_type, created_at FROM finance_request_events WHERE request_kind = ? AND request_id = ? ORDER BY created_at, rowid',
      kind,
      requestId,
    );
    return rows.map((r) => ({ status: r.status, note: r.note, actorType: r.actor_type, createdAt: r.created_at }));
  }

  /** Unread messages for one side of the chat, per request id. */
  async unreadCounts(kind: FinanceRequestKind, requestIds: string[], viewerSide: 'PLAYER' | 'ADMIN'): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (requestIds.length === 0) return out;
    const rows = await all<{ request_id: string; n: number }>(
      this.db,
      `SELECT request_id, COUNT(*) AS n FROM finance_messages
       WHERE request_kind = ? AND request_id IN (${requestIds.map(() => '?').join(',')}) AND sender_type <> ? AND read_at IS NULL
       GROUP BY request_id`,
      kind,
      ...requestIds,
      viewerSide,
    );
    for (const r of rows) out.set(r.request_id, r.n);
    return out;
  }

  async buyStats(userId: string): Promise<{ count: number; completedCount: number; completedPoisha: number }> {
    const r = await first<{ c: number; cc: number; cp: number | null }>(
      this.db,
      "SELECT COUNT(*) AS c, SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS cc, SUM(CASE WHEN status = 'COMPLETED' THEN amount_poisha ELSE 0 END) AS cp FROM buy_requests WHERE user_id = ?",
      userId,
    );
    return { count: r?.c ?? 0, completedCount: r?.cc ?? 0, completedPoisha: r?.cp ?? 0 };
  }

  async sellStats(userId: string): Promise<{ count: number; completedCount: number; completedPoisha: number }> {
    const r = await first<{ c: number; cc: number; cp: number | null }>(
      this.db,
      "SELECT COUNT(*) AS c, SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS cc, SUM(CASE WHEN status = 'COMPLETED' THEN bdt_poisha ELSE 0 END) AS cp FROM sell_requests WHERE user_id = ?",
      userId,
    );
    return { count: r?.c ?? 0, completedCount: r?.cc ?? 0, completedPoisha: r?.cp ?? 0 };
  }
}
