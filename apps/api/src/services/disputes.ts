/**
 * Match disputes. Opening a dispute on a match that is still in play freezes it (DISPUTED) so the
 * game server can no longer settle it; an administrator then resolves it. Every resolution that
 * moves tokens goes through SettlementService or TreasuryService (ledger), never a balance edit.
 */
import {
  DISPUTE_CATEGORY_LABELS,
  DISPUTE_RESOLUTION_LABELS,
  DISPUTE_WINDOW_MS,
  isTerminal,
  type AdminDisputeDto,
  type DisputeCategory,
  type DisputeDto,
  type DisputeResolution,
  type DisputeStatus,
  hasPermission,
} from '@arena/shared';
import type { AdminContext } from '../env';
import { all, assertStmt, classifyDbError, counterValueSql, first, nextCounterStmt, parseJson, runBatch, type Stmt } from '../lib/db';
import { AppError, invalidState, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import type { MatchRepository } from '../repositories/matches';
import type { UserRecord, UserRepository } from '../repositories/users';
import type { AuditService } from './audit';
import type { MatchService } from './matches';
import type { NotificationService } from './notifications';
import { playerSummary } from './player-summary';
import type { SettlementService } from './settlement';
import type { TreasuryService } from './treasury';

interface DisputeRow {
  id: string;
  dispute_number: number;
  match_id: string;
  user_id: string;
  category: DisputeCategory;
  description: string;
  status: DisputeStatus;
  match_status_at_open: string;
  resolution: DisputeResolution | null;
  resolution_note: string | null;
  resolution_tx_id: string | null;
  resolved_by: string | null;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
  match_number: number;
  game_name: string;
}

const SELECT = `SELECT d.*, m.match_number, g.name AS game_name FROM disputes d
  JOIN matches m ON m.id = d.match_id JOIN games g ON g.id = m.game_id`;

function mapDispute(r: DisputeRow): DisputeDto {
  return {
    id: r.id,
    disputeNumber: r.dispute_number,
    matchId: r.match_id,
    matchNumber: r.match_number,
    gameName: r.game_name,
    category: r.category,
    description: r.description,
    status: r.status,
    resolution: r.resolution,
    resolutionNote: r.resolution_note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
  };
}

export class DisputeService {
  constructor(
    private readonly db: D1Database,
    private readonly matchesRepo: MatchRepository,
    private readonly matches: MatchService,
    private readonly settlement: SettlementService,
    private readonly treasury: TreasuryService,
    private readonly users: UserRepository,
    private readonly notifications: NotificationService,
    private readonly now: () => number,
  ) {}

  async create(user: UserRecord, matchId: string, category: DisputeCategory, description: string): Promise<DisputeDto> {
    if (user.accountStatus === 'BANNED') throw new AppError('ACCOUNT_BANNED');
    const match = await this.matchesRepo.find(matchId);
    if (!match) throw notFound('Match');
    const players = await this.matchesRepo.players(matchId, true);
    if (!players.some((p) => p.user_id === user.id)) throw notFound('Match');
    if (['CREATED', 'WAITING_FOR_OPPONENT', 'STAKE_LOCKING'].includes(match.status)) throw invalidState('The match has not started yet.');
    const endedAt = match.settled_at ?? match.ended_at;
    if (endedAt && this.now() - endedAt > DISPUTE_WINDOW_MS) throw invalidState('The dispute window for this match has closed.');

    const id = ulid();
    const now = this.now();
    const freeze = ['PLAYING', 'RESULT_PENDING'].includes(match.status);
    const stmts: Stmt[] = [
      nextCounterStmt(this.db, 'dispute'),
      this.db
        .prepare(
          `INSERT INTO disputes (id, dispute_number, match_id, user_id, category, description, status, match_status_at_open, created_at, updated_at)
           VALUES (?, ${counterValueSql}, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
        )
        .bind(id, 'dispute', matchId, user.id, category, description, match.status, now, now),
      this.matchesRepo.eventStmt(matchId, 'DISPUTE_OPENED', { disputeId: id, category, playerNumber: user.playerNumber }, 'PLAYER', user.id),
    ];
    if (freeze) {
      stmts.push(
        this.db.prepare("UPDATE matches SET status = 'DISPUTED', updated_at = ? WHERE id = ? AND status IN ('PLAYING', 'RESULT_PENDING')").bind(now, matchId),
      );
    }
    try {
      await runBatch(this.db, stmts);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'UNIQUE' && err.mentions('disputes')) throw new AppError('CONFLICT', 'You already have an open dispute for this match.');
      throw err;
    }
    await this.notifications.notifyAdmins('disputes.manage', {
      type: 'ADMIN_NEW_DISPUTE',
      title: `New dispute on Match #${match.match_number}`,
      body: `${DISPUTE_CATEGORY_LABELS[category]} — Player #${user.playerNumber}`,
      link: `/admin/games/disputes/${id}`,
    });
    return this.getForOwner(user.id, id);
  }

  async listForOwner(userId: string, page: number, pageSize: number): Promise<{ items: DisputeDto[]; hasMore: boolean }> {
    const rows = await all<DisputeRow>(this.db, `${SELECT} WHERE d.user_id = ? ORDER BY d.created_at DESC LIMIT ? OFFSET ?`, userId, pageSize + 1, (page - 1) * pageSize);
    return { items: rows.slice(0, pageSize).map(mapDispute), hasMore: rows.length > pageSize };
  }

  async getForOwner(userId: string, id: string): Promise<DisputeDto> {
    const r = await first<DisputeRow>(this.db, `${SELECT} WHERE d.id = ? AND d.user_id = ?`, id, userId);
    if (!r) throw notFound('Dispute');
    return mapDispute(r);
  }

  async adminList(q: { page: number; pageSize: number; status?: DisputeStatus }): Promise<{ items: DisputeDto[]; hasMore: boolean }> {
    const rows = await all<DisputeRow>(
      this.db,
      `${SELECT} ${q.status ? 'WHERE d.status = ?' : ''} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
      ...(q.status ? [q.status] : []),
      q.pageSize + 1,
      (q.page - 1) * q.pageSize,
    );
    return { items: rows.slice(0, q.pageSize).map(mapDispute), hasMore: rows.length > q.pageSize };
  }

  async adminGet(id: string): Promise<AdminDisputeDto> {
    const r = await first<DisputeRow>(this.db, `${SELECT} WHERE d.id = ?`, id);
    if (!r) throw notFound('Dispute');
    const user = await this.users.findById(r.user_id);
    if (!user) throw notFound('Player');
    const match = await this.matches.get(r.match_id, null);
    const mrow = await this.matchesRepo.find(r.match_id);
    const events = await this.matchesRepo.events(r.match_id);
    return {
      ...mapDispute(r),
      player: playerSummary(user, this.now()),
      match,
      events: events.map((e) => ({ type: e.type, payload: parseJson(e.payload, {}), createdAt: e.created_at })),
      settlementTxId: mrow?.resolution_tx_id ?? null,
    };
  }

  async startReview(admin: AdminContext, id: string, audit: AuditService): Promise<AdminDisputeDto> {
    const r = await first<DisputeRow>(this.db, `${SELECT} WHERE d.id = ?`, id);
    if (!r) throw notFound('Dispute');
    if (r.status !== 'OPEN') throw invalidState('Dispute is not open.');
    await runBatch(this.db, [
      assertStmt(this.db, "SELECT EXISTS (SELECT 1 FROM disputes WHERE id = ? AND status = 'OPEN')", id),
      this.db.prepare("UPDATE disputes SET status = 'UNDER_REVIEW', updated_at = ? WHERE id = ?").bind(this.now(), id),
      audit.stmt({ adminUserId: admin.userId, action: 'dispute.start_review', entityType: 'dispute', entityId: id, before: { status: 'OPEN' }, after: { status: 'UNDER_REVIEW' } }),
    ]);
    return this.adminGet(id);
  }

  async resolve(
    admin: AdminContext,
    id: string,
    p: { resolution: DisputeResolution; note: string; winnerPlayerNumber?: number; compensationPlayerNumber?: number; compensationUnits?: number },
    audit: AuditService,
  ): Promise<AdminDisputeDto> {
    const r = await first<DisputeRow>(this.db, `${SELECT} WHERE d.id = ?`, id);
    if (!r) throw notFound('Dispute');
    if (r.status === 'RESOLVED' || r.status === 'REJECTED') throw new AppError('ALREADY_PROCESSED', 'This dispute is already closed.');
    const match = await this.matchesRepo.find(r.match_id);
    if (!match) throw notFound('Match');
    const players = await this.matchesRepo.players(match.id);
    const settles = ['SETTLE_WINNER', 'SETTLE_DRAW', 'VOID_REFUND'].includes(p.resolution);
    if (match.status === 'DISPUTED' && !settles) throw invalidState('This match is frozen: resolve it with a winner, a draw or a void/refund.');
    if (settles && match.status !== 'DISPUTED') throw invalidState(isTerminal(match.status) ? 'The match is already settled. Use compensation instead.' : 'Only a disputed match can be settled from a dispute.');

    let txId: string | null = null;
    if (p.resolution === 'SETTLE_WINNER') {
      const winner = players.find((pl) => pl.player_number === p.winnerPlayerNumber);
      if (!winner) throw new AppError('VALIDATION_ERROR', 'Choose the winning player.');
      const res = await this.settlement.settleMatch({
        matchId: match.id,
        outcome: { type: 'WIN', winnerUserId: winner.user_id, reason: 'ADMIN_DECISION' },
        source: 'ADMIN',
        actorId: admin.userId,
        resultProof: `dispute:${id}`,
        extraStatements: [audit.stmt({ adminUserId: admin.userId, action: 'match.settle_by_admin', entityType: 'match', entityId: match.id, after: { winnerPlayerNumber: winner.player_number, disputeId: id }, reason: p.note })],
      });
      txId = res.transactionId;
    } else if (p.resolution === 'SETTLE_DRAW' || p.resolution === 'VOID_REFUND') {
      const res = await this.settlement.settleMatch({
        matchId: match.id,
        outcome: p.resolution === 'SETTLE_DRAW' ? { type: 'DRAW' } : { type: 'VOID', reason: `Dispute #${r.dispute_number}: ${p.note}` },
        source: 'ADMIN',
        actorId: admin.userId,
        resultProof: `dispute:${id}`,
        extraStatements: [audit.stmt({ adminUserId: admin.userId, action: `match.${p.resolution === 'SETTLE_DRAW' ? 'draw' : 'void'}_by_admin`, entityType: 'match', entityId: match.id, after: { disputeId: id }, reason: p.note })],
      });
      txId = res.transactionId;
    } else if (p.resolution === 'COMPENSATE') {
      if (!hasPermission(admin.permissions, 'finance.distribute')) throw new AppError('FORBIDDEN', 'Compensation needs the finance.distribute permission.');
      const target = p.compensationPlayerNumber ? players.find((pl) => pl.player_number === p.compensationPlayerNumber) : players.find((pl) => pl.user_id === r.user_id);
      if (!target || !p.compensationUnits) throw new AppError('VALIDATION_ERROR', 'Choose a player in this match and a compensation amount.');
      const grant = await this.treasury.grant(
        admin,
        {
          playerNumber: target.player_number,
          amountUnits: p.compensationUnits,
          type: 'COMPENSATION',
          reason: `Dispute #${r.dispute_number}: ${p.note}`,
          idempotencyKey: `dispute:${id}:compensation`,
          referenceType: 'DISPUTE',
          referenceId: id,
        },
        audit,
      );
      txId = grant.transactionId;
    }

    const finalStatus: DisputeStatus = p.resolution === 'REJECT' ? 'REJECTED' : 'RESOLVED';
    const now = this.now();
    await runBatch(this.db, [
      this.db
        .prepare('UPDATE disputes SET status = ?, resolution = ?, resolution_note = ?, resolution_tx_id = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
        .bind(finalStatus, p.resolution, p.note, txId, admin.userId, now, now, id),
      this.matchesRepo.eventStmt(match.id, 'DISPUTE_RESOLVED', { disputeId: id, resolution: p.resolution, transactionId: txId }, 'ADMIN', admin.userId),
      audit.stmt({ adminUserId: admin.userId, action: 'dispute.resolve', entityType: 'dispute', entityId: id, before: { status: r.status }, after: { status: finalStatus, resolution: p.resolution, transactionId: txId }, reason: p.note }),
    ]);
    await this.notifications.notifyPlayer(r.user_id, {
      type: 'DISPUTE_UPDATE',
      title: `Dispute #${r.dispute_number}: ${DISPUTE_RESOLUTION_LABELS[p.resolution]}`,
      body: p.note,
      link: `/support/disputes/${id}`,
    });
    return this.adminGet(id);
  }
}
