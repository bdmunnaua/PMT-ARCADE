import { PLAYER_BUCKETS, playerAccountId, type AccountStatus, type PlayerStatsDto } from '@arena/shared';
import { all, counterValueSql, first, nextCounterStmt, toBool, type Stmt } from '../lib/db';

export interface UserRecord {
  id: string;
  firebaseUid: string;
  email: string | null;
  emailVerified: boolean;
  accountStatus: AccountStatus;
  statusReason: string | null;
  lastLoginAt: number | null;
  lastLoginIp: string | null;
  createdAt: number;
  updatedAt: number;
  playerNumber: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

interface UserRow {
  id: string;
  firebase_uid: string;
  email: string | null;
  email_verified: number;
  account_status: AccountStatus;
  status_reason: string | null;
  last_login_at: number | null;
  last_login_ip: string | null;
  created_at: number;
  updated_at: number;
  player_number: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export const USER_SELECT = `SELECT u.id, u.firebase_uid, u.email, u.email_verified, u.account_status, u.status_reason,
  u.last_login_at, u.last_login_ip, u.created_at, u.updated_at,
  p.player_number, p.username, p.display_name, p.avatar_url
FROM users u JOIN player_profiles p ON p.user_id = u.id`;

export function mapUser(r: UserRow): UserRecord {
  return {
    id: r.id,
    firebaseUid: r.firebase_uid,
    email: r.email,
    emailVerified: toBool(r.email_verified),
    accountStatus: r.account_status,
    statusReason: r.status_reason,
    lastLoginAt: r.last_login_at,
    lastLoginIp: r.last_login_ip,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    playerNumber: r.player_number,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
  };
}

interface StatsRow {
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  total_staked_units: number;
  total_won_units: number;
}

export function mapStats(r: StatsRow | null): PlayerStatsDto {
  const s = r ?? { games_played: 0, wins: 0, losses: 0, draws: 0, total_staked_units: 0, total_won_units: 0 };
  return {
    gamesPlayed: s.games_played,
    wins: s.wins,
    losses: s.losses,
    draws: s.draws,
    winRateBps: s.games_played > 0 ? Math.floor((s.wins * 10_000) / s.games_played) : 0,
    totalStakedUnits: s.total_staked_units,
    totalWonUnits: s.total_won_units,
  };
}

export class UserRepository {
  constructor(private readonly db: D1Database) {}

  async findByFirebaseUid(uid: string): Promise<UserRecord | null> {
    const r = await first<UserRow>(this.db, `${USER_SELECT} WHERE u.firebase_uid = ?`, uid);
    return r ? mapUser(r) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const r = await first<UserRow>(this.db, `${USER_SELECT} WHERE u.id = ?`, id);
    return r ? mapUser(r) : null;
  }

  async findByPlayerNumber(n: number): Promise<UserRecord | null> {
    const r = await first<UserRow>(this.db, `${USER_SELECT} WHERE p.player_number = ?`, n);
    return r ? mapUser(r) : null;
  }

  async findManyByIds(ids: string[]): Promise<Map<string, UserRecord>> {
    const map = new Map<string, UserRecord>();
    if (ids.length === 0) return map;
    const unique = [...new Set(ids)];
    const rows = await all<UserRow>(this.db, `${USER_SELECT} WHERE u.id IN (${unique.map(() => '?').join(',')})`, ...unique);
    for (const r of rows) map.set(r.id, mapUser(r));
    return map;
  }

  async usernameTaken(username: string): Promise<boolean> {
    return !!(await first(this.db, 'SELECT 1 AS x FROM player_profiles WHERE username_lower = ?', username.toLowerCase()));
  }

  async getStats(userId: string): Promise<PlayerStatsDto> {
    return mapStats(await first<StatsRow>(this.db, 'SELECT * FROM player_stats WHERE user_id = ?', userId));
  }

  /**
   * Registration: user + profile (next permanent player number) + stats + the four wallet buckets,
   * all in one batch. The counter only ever increments, so player numbers are never reused.
   */
  createStatements(p: { id: string; firebaseUid: string; email: string | null; emailVerified: boolean; username: string; displayName: string; ip: string | null; now: number }): Stmt[] {
    const db = this.db;
    const stmts: Stmt[] = [
      db
        .prepare(
          `INSERT INTO users (id, firebase_uid, email, email_verified, account_status, last_login_at, last_login_ip, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
        )
        .bind(p.id, p.firebaseUid, p.email, p.emailVerified ? 1 : 0, p.now, p.ip, p.now, p.now),
      nextCounterStmt(db, 'player_number'),
      db
        .prepare(
          `INSERT INTO player_profiles (user_id, player_number, username, username_lower, display_name, avatar_url, created_at, updated_at)
           VALUES (?, ${counterValueSql}, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(p.id, 'player_number', p.username, p.username.toLowerCase(), p.displayName, p.now, p.now),
      db.prepare('INSERT INTO player_stats (user_id, updated_at) VALUES (?, ?)').bind(p.id, p.now),
    ];
    for (const bucket of PLAYER_BUCKETS) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO wallet_accounts (id, owner_type, user_id, bucket, balance, allow_negative, created_at, updated_at)
             VALUES (?, 'PLAYER', ?, ?, 0, 0, ?, ?)`,
          )
          .bind(playerAccountId(p.id, bucket), p.id, bucket, p.now, p.now),
      );
    }
    return stmts;
  }

  recordLoginStmt(userId: string, p: { email: string | null; emailVerified: boolean; ip: string | null; now: number }): Stmt {
    return this.db
      .prepare('UPDATE users SET last_login_at = ?, last_login_ip = ?, email = ?, email_verified = ?, updated_at = ? WHERE id = ?')
      .bind(p.now, p.ip, p.email, p.emailVerified ? 1 : 0, p.now, userId);
  }

  updateProfileStmt(userId: string, p: { displayName?: string; avatarUrl?: string | null; now: number }): Stmt {
    return this.db
      .prepare(
        `UPDATE player_profiles SET display_name = COALESCE(?, display_name),
           avatar_url = CASE WHEN ? = 1 THEN ? ELSE avatar_url END, updated_at = ? WHERE user_id = ?`,
      )
      .bind(p.displayName ?? null, p.avatarUrl !== undefined ? 1 : 0, p.avatarUrl ?? null, p.now, userId);
  }

  setStatusStmt(userId: string, status: AccountStatus, reason: string, now: number): Stmt {
    return this.db.prepare('UPDATE users SET account_status = ?, status_reason = ?, updated_at = ? WHERE id = ?').bind(status, reason, now, userId);
  }
}
