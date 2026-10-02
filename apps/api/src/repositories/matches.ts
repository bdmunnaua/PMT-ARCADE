import type { MatchDto, MatchMode, MatchPlayerResult, MatchStatus, MatchVisibility } from '@arena/shared';
import { all, first, type Stmt } from '../lib/db';
import { ulid } from '../lib/ids';

export interface MatchRow {
  id: string;
  match_number: number;
  game_id: string;
  creator_id: string;
  mode: MatchMode;
  visibility: MatchVisibility;
  join_code: string | null;
  stake_units: number;
  min_players: number;
  max_players: number;
  player_count: number;
  fee_bps: number;
  game_version: string;
  status: MatchStatus;
  result_type: string | null;
  winner_user_id: string | null;
  pot_units: number;
  fee_units: number | null;
  payout_units: number | null;
  resolution_tx_id: string | null;
  result_source: string | null;
  result_proof: string | null;
  void_reason: string | null;
  created_at: number;
  updated_at: number;
  ready_at: number | null;
  started_at: number | null;
  ended_at: number | null;
  settled_at: number | null;
}

export interface MatchPlayerRow {
  id: string;
  match_id: string;
  user_id: string;
  seat: number;
  stake_units: number;
  stake_bonus_units: number;
  stake_available_units: number;
  status: 'JOINED' | 'LEFT';
  result: MatchPlayerResult | null;
  payout_units: number | null;
  joined_at: number;
  player_number: number;
  username: string;
  display_name: string;
}

export class MatchRepository {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number,
  ) {}

  async find(id: string): Promise<MatchRow | null> {
    return first<MatchRow>(this.db, 'SELECT * FROM matches WHERE id = ?', id);
  }

  async findByNumber(n: number): Promise<MatchRow | null> {
    return first<MatchRow>(this.db, 'SELECT * FROM matches WHERE match_number = ?', n);
  }

  async findOpenByCode(code: string): Promise<MatchRow | null> {
    return first<MatchRow>(this.db, "SELECT * FROM matches WHERE join_code = ? AND status = 'WAITING_FOR_OPPONENT'", code);
  }

  async players(matchId: string, includeLeft = false): Promise<MatchPlayerRow[]> {
    return all<MatchPlayerRow>(
      this.db,
      `SELECT mp.*, p.player_number, p.username, p.display_name FROM match_players mp
       JOIN player_profiles p ON p.user_id = mp.user_id
       WHERE mp.match_id = ? ${includeLeft ? '' : "AND mp.status = 'JOINED'"} ORDER BY mp.seat`,
      matchId,
    );
  }

  async playersForMatches(ids: string[]): Promise<Map<string, MatchPlayerRow[]>> {
    const out = new Map<string, MatchPlayerRow[]>();
    if (ids.length === 0) return out;
    const rows = await all<MatchPlayerRow>(
      this.db,
      `SELECT mp.*, p.player_number, p.username, p.display_name FROM match_players mp
       JOIN player_profiles p ON p.user_id = mp.user_id
       WHERE mp.match_id IN (${ids.map(() => '?').join(',')}) AND mp.status = 'JOINED' ORDER BY mp.seat`,
      ...ids,
    );
    for (const r of rows) out.set(r.match_id, [...(out.get(r.match_id) ?? []), r]);
    return out;
  }

  async activeCountFor(userId: string): Promise<number> {
    const r = await first<{ n: number }>(
      this.db,
      `SELECT COUNT(*) AS n FROM match_players mp JOIN matches m ON m.id = mp.match_id
       WHERE mp.user_id = ? AND mp.status = 'JOINED'
         AND m.status IN ('CREATED','WAITING_FOR_OPPONENT','STAKE_LOCKING','READY','PLAYING','RESULT_PENDING','SETTLING','DISPUTED')`,
      userId,
    );
    return r?.n ?? 0;
  }

  /** Oldest public quick-match rooms with the same game and stake that the player is not in. */
  async quickCandidates(gameId: string, stakeUnits: number, userId: string, limit = 3): Promise<MatchRow[]> {
    return all<MatchRow>(
      this.db,
      `SELECT m.* FROM matches m
       WHERE m.status = 'WAITING_FOR_OPPONENT' AND m.game_id = ? AND m.visibility = 'PUBLIC' AND m.mode = 'QUICK' AND m.stake_units = ?
         AND m.player_count < m.max_players
         AND NOT EXISTS (SELECT 1 FROM match_players mp WHERE mp.match_id = m.id AND mp.user_id = ?)
       ORDER BY m.created_at ASC LIMIT ?`,
      gameId,
      stakeUnits,
      userId,
      limit,
    );
  }

  async openPublic(gameId: string | undefined, limit = 50): Promise<MatchRow[]> {
    return all<MatchRow>(
      this.db,
      `SELECT * FROM matches WHERE status = 'WAITING_FOR_OPPONENT' AND visibility = 'PUBLIC' ${gameId ? 'AND game_id = ?' : ''}
       ORDER BY created_at DESC LIMIT ?`,
      ...(gameId ? [gameId, limit] : [limit]),
    );
  }

  async listForUser(userId: string, q: { page: number; pageSize: number; status?: MatchStatus }): Promise<MatchRow[]> {
    return all<MatchRow>(
      this.db,
      `SELECT m.* FROM match_players mp JOIN matches m ON m.id = mp.match_id
       WHERE mp.user_id = ? ${q.status ? 'AND m.status = ?' : ''}
       ORDER BY mp.joined_at DESC LIMIT ? OFFSET ?`,
      ...(q.status ? [userId, q.status] : [userId]),
      q.pageSize + 1,
      (q.page - 1) * q.pageSize,
    );
  }

  async listAdmin(q: { page: number; pageSize: number; status?: MatchStatus; gameId?: string; statuses?: readonly MatchStatus[] }): Promise<MatchRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) {
      where.push('status = ?');
      params.push(q.status);
    } else if (q.statuses?.length) {
      where.push(`status IN (${q.statuses.map(() => '?').join(',')})`);
      params.push(...q.statuses);
    }
    if (q.gameId) {
      where.push('game_id = ?');
      params.push(q.gameId);
    }
    return all<MatchRow>(
      this.db,
      `SELECT * FROM matches ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      q.pageSize + 1,
      (q.page - 1) * q.pageSize,
    );
  }

  async events(matchId: string): Promise<{ type: string; payload: string; actor_type: string; created_at: number }[]> {
    return all(this.db, 'SELECT type, payload, actor_type, created_at FROM match_events WHERE match_id = ? ORDER BY created_at, rowid', matchId);
  }

  eventStmt(matchId: string, type: string, payload: unknown, actorType: string, actorId: string | null): Stmt {
    return this.db
      .prepare('INSERT INTO match_events (id, match_id, type, payload, actor_type, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(ulid(), matchId, type, JSON.stringify(payload ?? {}), actorType, actorId, this.now());
  }

  async gameNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return out;
    const rows = await all<{ id: string; name: string }>(this.db, `SELECT id, name FROM games WHERE id IN (${unique.map(() => '?').join(',')})`, ...unique);
    for (const r of rows) out.set(r.id, r.name);
    return out;
  }
}

export function toMatchDto(m: MatchRow, players: MatchPlayerRow[], gameName: string, viewerId: string | null): MatchDto {
  const me = viewerId ? players.find((p) => p.user_id === viewerId) : undefined;
  const winner = m.winner_user_id ? players.find((p) => p.user_id === m.winner_user_id) : undefined;
  return {
    id: m.id,
    matchNumber: m.match_number,
    gameId: m.game_id,
    gameName,
    status: m.status,
    mode: m.mode,
    visibility: m.visibility,
    joinCode: viewerId && viewerId === m.creator_id ? m.join_code : null,
    stakeUnits: m.stake_units,
    potUnits: m.pot_units,
    feeBps: m.fee_bps,
    feeUnits: m.fee_units,
    payoutUnits: m.payout_units,
    minPlayers: m.min_players,
    maxPlayers: m.max_players,
    playerCount: m.player_count,
    players: players.map((p) => ({
      playerNumber: p.player_number,
      username: p.username,
      displayName: p.display_name,
      seat: p.seat,
      isYou: p.user_id === viewerId,
      result: p.result,
      payoutUnits: p.payout_units,
    })),
    winnerPlayerNumber: winner?.player_number ?? null,
    resultType: m.result_type,
    isCreator: viewerId === m.creator_id,
    isParticipant: !!me,
    myResult: me?.result ?? null,
    createdAt: m.created_at,
    startedAt: m.started_at,
    endedAt: m.ended_at,
  };
}
