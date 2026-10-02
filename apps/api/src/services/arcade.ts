/**
 * Free arcade games (the original pmtarcade.com games) on the PMT ledger.
 *   - Games report a score; the server judges it (ARCADE_GAMES rules) and pays BONUS PMT from the
 *     REWARDS_POOL — never more than the daily cap, and nothing once the pool is empty.
 *   - Daily check-in streak, welcome bonus and referral bonus, all BONUS from the same pool.
 *   - Balances from the old arcade database are credited once, as BONUS, at the first visit.
 * Every payment is one ledger transaction with an idempotency key, so retries and double clicks
 * can never pay twice.
 */
import type { ArcadeConfigDto, ArcadeLeaderboardDto, ArcadeMeDto, ArcadeRunResultDto, RewardsPoolDto } from '@arena/shared';
import { ARCADE_GAMES, bdDate, bdDayStart, CHECKIN_TOKENS, judgeRun, MAX_RUNS_PER_HOUR, RUN_MAX_MS } from '../arcade/rules';
import { all, assertStmt, classifyDbError, first, runBatch, type Stmt } from '../lib/db';
import { AppError, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import type { UserRecord } from '../repositories/users';
import type { LedgerService, Posting } from './ledger';
import type { SettingsService } from './settings';

const DAY = 86_400_000;
const U = 100; // units per PMT

interface ProfileRow {
  user_id: string;
  ref_code: string;
  referred_by: string | null;
  ref_paid: number;
  ref_count: number;
  streak: number;
  last_checkin: string | null;
  lifetime_units: number;
  created_at: number;
}
interface RunRow {
  id: string;
  user_id: string;
  game: string;
  started_at: number;
  status: 'OPEN' | 'DONE' | 'FLAGGED' | 'ABANDONED';
}
interface LegacyRow {
  firebase_uid: string;
  coins: number;
  lifetime: number;
  ref_code: string | null;
  streak: number;
  last_checkin: string | null;
}

function randomCode(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(7))].map((x) => a[x % a.length]).join('');
}

function assertCanPlay(user: UserRecord): void {
  if (user.accountStatus === 'BANNED') throw new AppError('ACCOUNT_BANNED');
  if (user.accountStatus === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED');
}

export class ArcadeService {
  constructor(
    private readonly db: D1Database,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly now: () => number,
  ) {}

  /** One ledger transaction paying BONUS from the rewards pool. */
  private reward(key: string, label: string, kind: string, payouts: { userId: string; units: number }[]) {
    const postings: Posting[] = payouts.filter((p) => p.units > 0).map((p) => ({ from: { system: 'REWARDS_POOL' }, to: { userId: p.userId, bucket: 'BONUS' }, amount: p.units }));
    return this.ledger.buildTransaction({
      idempotencyKey: key,
      type: 'ARCADE_REWARD',
      referenceType: 'ARCADE',
      referenceId: kind,
      createdBy: { type: 'SYSTEM', id: null },
      metadata: { label, kind },
      postings,
    });
  }

  async config(): Promise<ArcadeConfigDto> {
    const s = await this.settings.get();
    const pool = await first<{ balance: number }>(this.db, "SELECT balance FROM wallet_accounts WHERE id = 'sys_rewards_pool'");
    return {
      enabled: s.arcade_enabled,
      games: Object.entries(ARCADE_GAMES).map(([id, g]) => ({ id, name: g.name, genre: g.genre, emoji: g.emoji, tag: g.tag, colors: g.colors, isNew: g.isNew, divisor: g.divisor, maxPerRunTokens: g.maxPerRun })),
      checkin: CHECKIN_TOKENS,
      dailyCapTokens: s.arcade_daily_cap_tokens,
      welcomeBonusTokens: s.arcade_welcome_bonus_tokens,
      referralBonusTokens: s.arcade_referral_bonus_tokens,
      referralWelcomeTokens: s.arcade_referral_welcome_tokens,
      referralUnlockTokens: s.arcade_referral_unlock_tokens,
      poolUnits: pool?.balance ?? 0,
    };
  }

  /**
   * The player's arcade profile, created at the first visit: carries over an old arcade balance
   * (once) or pays the welcome bonus. If the rewards pool cannot pay yet, the profile is still
   * created and the old balance is claimed on a later visit.
   */
  private async ensureProfile(user: UserRecord): Promise<ProfileRow> {
    const existing = await first<ProfileRow>(this.db, 'SELECT * FROM arcade_profiles WHERE user_id = ?', user.id);
    if (existing) {
      await this.claimLegacy(user);
      return existing;
    }
    const s = await this.settings.get();
    const legacy = await first<LegacyRow>(this.db, 'SELECT * FROM arcade_legacy_accounts WHERE firebase_uid = ? AND claimed_by IS NULL', user.firebaseUid);
    const now = this.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = attempt === 0 && legacy?.ref_code ? legacy.ref_code : randomCode();
      const insert = this.db
        .prepare('INSERT INTO arcade_profiles (user_id, ref_code, streak, last_checkin, lifetime_units, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(user.id, code, legacy?.streak ?? 0, legacy?.last_checkin ?? null, (legacy?.lifetime ?? 0) * U, now, now);
      const welcome = !legacy && s.arcade_welcome_bonus_tokens > 0 ? this.reward(`arcade:welcome:${user.id}`, 'Welcome bonus', 'welcome', [{ userId: user.id, units: s.arcade_welcome_bonus_tokens * U }]) : null;
      try {
        await runBatch(this.db, [insert, ...(welcome?.statements ?? [])]);
      } catch (e) {
        const err = classifyDbError(e);
        if (err.kind === 'BALANCE' && welcome) {
          await runBatch(this.db, [insert]).catch(() => undefined); // pool empty: no welcome bonus
        } else if (err.kind === 'UNIQUE' && err.mentions('ref_code')) continue;
        else if (!(err.kind === 'UNIQUE' || err.kind === 'IDEMPOTENCY')) throw err;
      }
      break;
    }
    await this.claimLegacy(user);
    const row = await first<ProfileRow>(this.db, 'SELECT * FROM arcade_profiles WHERE user_id = ?', user.id);
    if (!row) throw new AppError('INTERNAL_ERROR');
    return row;
  }

  /** Credits an old arcade balance once (1 coin = 1 PMT, as BONUS). */
  private async claimLegacy(user: UserRecord): Promise<void> {
    const legacy = await first<LegacyRow>(this.db, 'SELECT * FROM arcade_legacy_accounts WHERE firebase_uid = ? AND claimed_by IS NULL', user.firebaseUid);
    if (!legacy) return;
    const now = this.now();
    const stmts: Stmt[] = [
      this.db.prepare('UPDATE arcade_legacy_accounts SET claimed_by = ?, claimed_at = ? WHERE firebase_uid = ? AND claimed_by IS NULL').bind(user.id, now, legacy.firebase_uid),
      assertStmt(this.db, 'SELECT claimed_by = ? FROM arcade_legacy_accounts WHERE firebase_uid = ?', user.id, legacy.firebase_uid),
    ];
    if (legacy.coins > 0) stmts.push(...this.reward(`arcade:legacy:${legacy.firebase_uid}`, 'Coins from the old PMT Arcade', 'legacy', [{ userId: user.id, units: legacy.coins * U }]).statements);
    try {
      await runBatch(this.db, stmts);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'BALANCE') return; // pool not funded yet — claimed at a later visit
      if (err.kind === 'ASSERTION' || err.kind === 'IDEMPOTENCY') return; // claimed concurrently
      throw err;
    }
  }

  private async earnedToday(userId: string): Promise<number> {
    const r = await first<{ s: number }>(this.db, 'SELECT COALESCE(SUM(reward_units), 0) AS s FROM arcade_runs WHERE user_id = ? AND finished_at >= ?', userId, bdDayStart(this.now()));
    return r?.s ?? 0;
  }

  async me(user: UserRecord): Promise<ArcadeMeDto> {
    const p = await this.ensureProfile(user);
    const s = await this.settings.get();
    const today = bdDate(this.now());
    const yesterday = bdDate(this.now() - DAY);
    const alive = p.last_checkin === today || p.last_checkin === yesterday;
    const streak = alive ? p.streak : 0;
    const nextStreak = p.last_checkin === today ? streak : alive ? streak + 1 : 1;
    const best = await all<{ game: string; best: number }>(this.db, "SELECT game, MAX(score) AS best FROM arcade_runs WHERE user_id = ? AND status = 'DONE' GROUP BY game", user.id);
    return {
      refCode: p.ref_code,
      refCount: p.ref_count,
      referred: !!p.referred_by,
      refPaid: !!p.ref_paid,
      streak,
      checkedInToday: p.last_checkin === today,
      nextCheckinTokens: CHECKIN_TOKENS[Math.min(nextStreak, CHECKIN_TOKENS.length) - 1]!,
      earnedTodayUnits: await this.earnedToday(user.id),
      dailyCapUnits: s.arcade_daily_cap_tokens * U,
      lifetimeUnits: p.lifetime_units,
      bestScores: Object.fromEntries(best.map((b) => [b.game, b.best])),
    };
  }

  async checkin(user: UserRecord): Promise<{ amountUnits: number; streak: number }> {
    assertCanPlay(user);
    const s = await this.settings.get();
    if (!s.arcade_enabled) throw new AppError('FEATURE_DISABLED', 'Free games are switched off right now.');
    const p = await this.ensureProfile(user);
    const today = bdDate(this.now());
    if (p.last_checkin === today) throw new AppError('CONFLICT', 'Already checked in today. Come back tomorrow!');
    const streak = p.last_checkin === bdDate(this.now() - DAY) ? p.streak + 1 : 1;
    const tokens = CHECKIN_TOKENS[Math.min(streak, CHECKIN_TOKENS.length) - 1]!;
    const tx = this.reward(`arcade:checkin:${user.id}:${today}`, `Day ${streak} check-in`, 'checkin', [{ userId: user.id, units: tokens * U }]);
    try {
      await runBatch(this.db, [
        this.db.prepare('UPDATE arcade_profiles SET streak = ?, last_checkin = ?, updated_at = ? WHERE user_id = ?').bind(streak, today, this.now(), user.id),
        ...tx.statements,
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'IDEMPOTENCY') throw new AppError('CONFLICT', 'Already checked in today. Come back tomorrow!');
      if (err.kind === 'BALANCE') throw new AppError('REWARDS_PAUSED');
      throw err;
    }
    return { amountUnits: tokens * U, streak };
  }

  /** Attach an invite code (once, within 7 days of joining, before it can pay out). */
  async useReferral(user: UserRecord, code: string): Promise<{ ok: true }> {
    const p = await this.ensureProfile(user);
    if (p.referred_by) throw new AppError('CONFLICT', 'You already used an invite code.');
    if (this.now() - user.createdAt > 7 * DAY) throw new AppError('VALIDATION_ERROR', 'Invite codes can only be used in your first 7 days.');
    const inviter = await first<{ user_id: string }>(this.db, 'SELECT user_id FROM arcade_profiles WHERE ref_code = ?', code.toUpperCase());
    if (!inviter || inviter.user_id === user.id) throw new AppError('NOT_FOUND', 'That invite code does not exist.');
    await this.db.prepare('UPDATE arcade_profiles SET referred_by = ?, updated_at = ? WHERE user_id = ? AND referred_by IS NULL').bind(inviter.user_id, this.now(), user.id).run();
    await this.maybePayReferral(user.id);
    return { ok: true };
  }

  /** Pays the inviter (and the friend) once the friend has earned enough from games. */
  private async maybePayReferral(userId: string): Promise<void> {
    const s = await this.settings.get();
    const p = await first<ProfileRow>(this.db, 'SELECT * FROM arcade_profiles WHERE user_id = ?', userId);
    if (!p?.referred_by || p.ref_paid || p.lifetime_units < s.arcade_referral_unlock_tokens * U) return;
    const tx = this.reward(`arcade:referral:${userId}`, 'Invite bonus', 'referral', [
      { userId, units: s.arcade_referral_welcome_tokens * U },
      { userId: p.referred_by, units: s.arcade_referral_bonus_tokens * U },
    ]);
    try {
      await runBatch(this.db, [
        this.db.prepare('UPDATE arcade_profiles SET ref_paid = 1, updated_at = ? WHERE user_id = ? AND ref_paid = 0').bind(this.now(), userId),
        this.db.prepare('UPDATE arcade_profiles SET ref_count = ref_count + 1, updated_at = ? WHERE user_id = ?').bind(this.now(), p.referred_by),
        ...tx.statements,
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'IDEMPOTENCY' || err.kind === 'BALANCE') return; // already paid / pool empty (paid later)
      throw err;
    }
  }

  async startRun(user: UserRecord, game: string): Promise<{ runId: string }> {
    assertCanPlay(user);
    if (!ARCADE_GAMES[game]) throw new AppError('VALIDATION_ERROR', 'Unknown game.');
    const s = await this.settings.get();
    if (!s.arcade_enabled) throw new AppError('FEATURE_DISABLED', 'Free games are switched off right now.');
    await this.ensureProfile(user);
    const now = this.now();
    const recent = await first<{ n: number }>(this.db, 'SELECT COUNT(*) AS n FROM arcade_runs WHERE user_id = ? AND started_at > ?', user.id, now - 3600_000);
    if ((recent?.n ?? 0) >= MAX_RUNS_PER_HOUR) throw new AppError('RATE_LIMITED', 'Too many games this hour. Take a short break!');
    const id = ulid();
    await runBatch(this.db, [
      this.db.prepare("UPDATE arcade_runs SET status = 'ABANDONED' WHERE user_id = ? AND status = 'OPEN'").bind(user.id),
      this.db.prepare('INSERT INTO arcade_runs (id, user_id, game, started_at) VALUES (?, ?, ?, ?)').bind(id, user.id, game, now),
    ]);
    return { runId: id };
  }

  async finishRun(user: UserRecord, runId: string, rawScore: number): Promise<ArcadeRunResultDto> {
    const run = await first<RunRow>(this.db, 'SELECT * FROM arcade_runs WHERE id = ? AND user_id = ?', runId, user.id);
    if (!run) throw notFound('Game session');
    if (run.status !== 'OPEN') throw new AppError('CONFLICT', run.status === 'ABANDONED' ? 'You started another game, so this one was closed.' : 'This game was already saved.');
    const g = ARCADE_GAMES[run.game]!;
    const now = this.now();
    if (now - run.started_at > RUN_MAX_MS) throw new AppError('VALIDATION_ERROR', 'This game session expired.');
    const score = Math.floor(rawScore);
    const verdict = judgeRun(g, score, (now - run.started_at) / 1000);
    let units = verdict.tokens * U;
    let message = verdict.message;
    if (units > 0) {
      const s = await this.settings.get();
      const cap = s.arcade_daily_cap_tokens * U;
      const done = await this.earnedToday(user.id);
      if (done + units > cap) {
        units = Math.max(0, cap - done);
        message = units ? 'You hit today’s earning limit.' : 'Daily limit reached. New PMT tomorrow!';
      }
    }
    const save = (reward: number, msg: string): Stmt[] => [
      assertStmt(this.db, "SELECT status = 'OPEN' FROM arcade_runs WHERE id = ?", run.id),
      this.db
        .prepare('UPDATE arcade_runs SET status = ?, finished_at = ?, score = ?, reward_units = ?, message = ? WHERE id = ?')
        .bind(verdict.flagged ? 'FLAGGED' : 'DONE', now, score, reward, msg || null, run.id),
      ...(reward > 0
        ? [
            ...this.reward(`arcade:run:${run.id}`, g.name, 'game', [{ userId: user.id, units: reward }]).statements,
            this.db.prepare('UPDATE arcade_profiles SET lifetime_units = lifetime_units + ?, updated_at = ? WHERE user_id = ?').bind(reward, now, user.id),
          ]
        : []),
    ];
    try {
      await runBatch(this.db, save(units, message));
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'ASSERTION' || err.kind === 'IDEMPOTENCY') throw new AppError('CONFLICT', 'This game was already saved.');
      if (err.kind !== 'BALANCE') throw err;
      units = 0;
      message = 'Rewards are paused right now — your score was saved.';
      await runBatch(this.db, save(0, message));
    }
    if (units > 0) await this.maybePayReferral(user.id);
    return { rewardUnits: units, score, message };
  }

  async leaderboard(game: string, viewerId: string | null): Promise<ArcadeLeaderboardDto> {
    if (!ARCADE_GAMES[game]) throw new AppError('VALIDATION_ERROR', 'Unknown game.');
    const since = this.now() - 7 * DAY;
    const rows = await all<{ user_id: string; player_number: number; display_name: string; score: number }>(
      this.db,
      `SELECT r.user_id, p.player_number, p.display_name, MAX(r.score) AS score
       FROM arcade_runs r JOIN player_profiles p ON p.user_id = r.user_id JOIN users u ON u.id = r.user_id
       WHERE r.game = ? AND r.status = 'DONE' AND r.finished_at > ? AND u.account_status <> 'BANNED'
       GROUP BY r.user_id ORDER BY score DESC LIMIT 20`,
      game,
      since,
    );
    return { game, since, rows: rows.map((r) => ({ playerNumber: r.player_number, name: r.display_name.slice(0, 18), score: r.score, ...(viewerId ? { isYou: r.user_id === viewerId } : {}) })) };
  }

  async popular(): Promise<Record<string, number>> {
    const rows = await all<{ game: string; plays: number }>(this.db, 'SELECT game, COUNT(*) AS plays FROM arcade_runs WHERE started_at > ? GROUP BY game', this.now() - 7 * DAY);
    return Object.fromEntries(rows.map((r) => [r.game, r.plays]));
  }

  /** Admin view of the rewards pool and free-game activity. */
  async pool(): Promise<RewardsPoolDto> {
    const now = this.now();
    const r = await first<{ balance: number; today: number; week: number; plays: number; players: number; flagged: number }>(
      this.db,
      `SELECT (SELECT balance FROM wallet_accounts WHERE id = 'sys_rewards_pool') AS balance,
              (SELECT COALESCE(-SUM(amount), 0) FROM ledger_entries WHERE account_id = 'sys_rewards_pool' AND amount < 0 AND created_at >= ?) AS today,
              (SELECT COALESCE(-SUM(amount), 0) FROM ledger_entries WHERE account_id = 'sys_rewards_pool' AND amount < 0 AND created_at >= ?) AS week,
              (SELECT COUNT(*) FROM arcade_runs WHERE started_at >= ?) AS plays,
              (SELECT COUNT(DISTINCT user_id) FROM arcade_runs WHERE started_at >= ?) AS players,
              (SELECT COUNT(*) FROM arcade_runs WHERE status = 'FLAGGED' AND started_at >= ?) AS flagged`,
      bdDayStart(now),
      now - 7 * DAY,
      now - 7 * DAY,
      now - 7 * DAY,
      now - 7 * DAY,
    );
    return { balanceUnits: r?.balance ?? 0, paidTodayUnits: r?.today ?? 0, paid7dUnits: r?.week ?? 0, plays7d: r?.plays ?? 0, players7d: r?.players ?? 0, flagged7d: r?.flagged ?? 0 };
  }
}
