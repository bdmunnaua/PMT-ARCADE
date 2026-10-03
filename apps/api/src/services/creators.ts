/**
 * Creator rewards: a player who has really played makes an ORIGINAL post about PMT Arcade
 * (Facebook / Instagram / TikTok / YouTube), submits the link, and an admin checks it.
 * Approved creators receive the reward as BONUS PMT from the rewards pool.
 *
 * Abuse limits: one submission per account and one per social account per campaign, the post link
 * can be used once, at least one finished game first, a cap on approved creators, and the admin
 * sees accounts sharing the same network before approving. Rewards are never paid for likes,
 * follows or shares — only for original content (Meta's rules).
 */
import { CREATOR_PLATFORMS, type CreatorInfoDto, type CreatorMeDto, type CreatorSubmissionDto } from '@arena/shared';
import { all, assertStmt, classifyDbError, first, runBatch } from '../lib/db';
import { AppError, invalidState, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import type { UserRecord } from '../repositories/users';
import type { AuditService } from './audit';
import type { LedgerService } from './ledger';
import type { NotificationService } from './notifications';
import type { SettingsService } from './settings';

export const CAMPAIGN = 1;
type Platform = (typeof CREATOR_PLATFORMS)[number];

const HOSTS: Record<Platform, RegExp | null> = {
  FACEBOOK: /(^|\.)(facebook\.com|fb\.com|fb\.watch)$/i,
  INSTAGRAM: /(^|\.)instagram\.com$/i,
  TIKTOK: /(^|\.)tiktok\.com$/i,
  YOUTUBE: /(^|\.)(youtube\.com|youtu\.be)$/i,
  OTHER: null,
};

interface SubmissionRow {
  id: string;
  user_id: string;
  platform: Platform;
  post_url: string;
  social_handle: string;
  status: CreatorSubmissionDto['status'];
  review_note: string | null;
  reward_units: number | null;
  created_at: number;
  reviewed_at: number | null;
  player_number?: number;
  username?: string;
  email?: string | null;
  user_created_at?: number;
  same_ip?: number;
  games?: number;
}

const toDto = (r: SubmissionRow, admin: boolean): CreatorSubmissionDto => ({
  id: r.id,
  platform: r.platform,
  postUrl: r.post_url,
  socialHandle: r.social_handle,
  status: r.status,
  reviewNote: r.review_note,
  rewardUnits: r.reward_units,
  createdAt: r.created_at,
  reviewedAt: r.reviewed_at,
  ...(admin
    ? {
        sender: { userId: r.user_id, playerNumber: r.player_number ?? 0, username: r.username ?? '', email: r.email ?? null, createdAt: r.user_created_at ?? 0 },
        risk: { sameIpAccounts: r.same_ip ?? 0, gamesPlayed: r.games ?? 0 },
      }
    : {}),
});

const GAMES_SQL = `(SELECT COUNT(*) FROM arcade_runs ar WHERE ar.user_id = s.user_id AND ar.status = 'DONE')
  + (SELECT COUNT(*) FROM match_players mp WHERE mp.user_id = s.user_id AND mp.result IS NOT NULL)`;
const ADMIN_SELECT = `SELECT s.*, p.player_number, p.username, u.email, u.created_at AS user_created_at,
    (SELECT COUNT(*) FROM users o WHERE o.last_login_ip = u.last_login_ip AND o.id <> u.id AND u.last_login_ip IS NOT NULL) AS same_ip,
    ${GAMES_SQL} AS games
  FROM creator_submissions s JOIN player_profiles p ON p.user_id = s.user_id JOIN users u ON u.id = s.user_id`;

export class CreatorService {
  constructor(
    private readonly db: D1Database,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly meta: { ip: string | null; userAgent: string | null },
    private readonly now: () => number,
  ) {}

  async info(): Promise<CreatorInfoDto> {
    const s = await this.settings.get();
    const r = await first<{ n: number }>(this.db, "SELECT COUNT(*) AS n FROM creator_submissions WHERE campaign = ? AND status = 'APPROVED'", CAMPAIGN);
    const approved = r?.n ?? 0;
    return { enabled: s.creator_rewards_enabled, rewardTokens: s.creator_reward_tokens, maxCreators: s.creator_reward_max, approved, remaining: Math.max(0, s.creator_reward_max - approved) };
  }

  private async gamesPlayed(userId: string): Promise<number> {
    const r = await first<{ n: number }>(
      this.db,
      `SELECT (SELECT COUNT(*) FROM arcade_runs WHERE user_id = ? AND status = 'DONE') + (SELECT COUNT(*) FROM match_players WHERE user_id = ? AND result IS NOT NULL) AS n`,
      userId,
      userId,
    );
    return r?.n ?? 0;
  }

  async me(user: UserRecord): Promise<CreatorMeDto> {
    const [info, games, row] = await Promise.all([
      this.info(),
      this.gamesPlayed(user.id),
      first<SubmissionRow>(this.db, 'SELECT * FROM creator_submissions WHERE campaign = ? AND user_id = ?', CAMPAIGN, user.id),
    ]);
    return { ...info, eligible: games > 0, submission: row ? toDto(row, false) : null };
  }

  async submit(user: UserRecord, input: { platform: Platform; postUrl: string; socialHandle: string }): Promise<CreatorSubmissionDto> {
    const info = await this.info();
    if (!info.enabled) throw new AppError('GAME_UNAVAILABLE', 'Creator rewards are closed right now.');
    if (info.remaining <= 0) throw new AppError('GAME_UNAVAILABLE', 'All creator rewards for this campaign have been given out.');
    if ((await this.gamesPlayed(user.id)) === 0) throw new AppError('VALIDATION_ERROR', 'Finish at least one game on PMT Arcade first, then submit your post.');
    const url = new URL(input.postUrl);
    const allowed = HOSTS[input.platform];
    if (allowed && !allowed.test(url.hostname)) throw new AppError('VALIDATION_ERROR', `That link is not a ${input.platform.toLowerCase()} link.`);
    url.hash = '';
    const handle = input.socialHandle.trim().replace(/^@+/, '');
    const id = ulid(this.now());
    const now = this.now();
    try {
      await this.db
        .prepare(
          `INSERT INTO creator_submissions (id, user_id, campaign, platform, post_url, social_handle, social_key, status, ip, user_agent, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
        )
        .bind(id, user.id, CAMPAIGN, input.platform, url.toString(), handle, `${input.platform}:${handle.toLowerCase()}`, this.meta.ip, this.meta.userAgent?.slice(0, 300) ?? null, now, now)
        .run();
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'UNIQUE') {
        if (err.mentions('post_url')) throw new AppError('CONFLICT', 'This post was already submitted.');
        if (err.mentions('social_key')) throw new AppError('CONFLICT', 'This social account already took part in this campaign.');
        throw new AppError('CONFLICT', 'You already submitted a post for this campaign.');
      }
      throw err;
    }
    await this.notifications.notifyAdmins('support.view', {
      type: 'ADMIN_CREATOR_SUBMISSION',
      title: `Creator post from #${user.playerNumber} @${user.username}`,
      body: `${input.platform}: ${url.toString()}`,
      link: '/admin/creators',
    });
    const row = await first<SubmissionRow>(this.db, 'SELECT * FROM creator_submissions WHERE id = ?', id);
    return toDto(row!, false);
  }

  async adminList(status: string | undefined, page: number, pageSize: number): Promise<{ items: CreatorSubmissionDto[]; hasMore: boolean; info: CreatorInfoDto }> {
    const rows = await all<SubmissionRow>(
      this.db,
      `${ADMIN_SELECT} WHERE s.campaign = ? ${status ? 'AND s.status = ?' : ''} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      CAMPAIGN,
      ...(status ? [status] : []),
      pageSize + 1,
      (page - 1) * pageSize,
    );
    return { items: rows.slice(0, pageSize).map((r) => toDto(r, true)), hasMore: rows.length > pageSize, info: await this.info() };
  }

  private async findPending(id: string): Promise<SubmissionRow> {
    const row = await first<SubmissionRow>(this.db, `${ADMIN_SELECT} WHERE s.id = ?`, id);
    if (!row) throw notFound('Submission');
    if (row.status !== 'PENDING') throw invalidState('This submission was already reviewed.');
    return row;
  }

  /** Pays the reward (bonus PMT from the rewards pool) and marks the post approved, in one step. */
  async approve(adminUserId: string, id: string, note: string | undefined, audit: AuditService): Promise<CreatorSubmissionDto> {
    const row = await this.findPending(id);
    const s = await this.settings.get();
    const units = s.creator_reward_tokens * 100;
    const now = this.now();
    const tx = this.ledger.buildTransaction({
      idempotencyKey: `creator:${CAMPAIGN}:${row.user_id}`,
      type: 'ARCADE_REWARD',
      referenceType: 'CREATOR_SUBMISSION',
      referenceId: id,
      createdBy: { type: 'ADMIN', id: adminUserId },
      metadata: { kind: 'creator', campaign: CAMPAIGN, postUrl: row.post_url },
      postings: [{ from: { system: 'REWARDS_POOL' }, to: { userId: row.user_id, bucket: 'BONUS' }, amount: units }],
    });
    try {
      await runBatch(this.db, [
        assertStmt(this.db, "SELECT (SELECT COUNT(*) FROM creator_submissions WHERE campaign = ? AND status = 'APPROVED') < ?", CAMPAIGN, s.creator_reward_max),
        this.db
          .prepare("UPDATE creator_submissions SET status = 'APPROVED', review_note = ?, reviewed_by = ?, reviewed_at = ?, reward_units = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'")
          .bind(note ?? null, adminUserId, now, units, now, id),
        ...tx.statements,
        this.db.prepare('UPDATE creator_submissions SET reward_tx_id = ? WHERE id = ?').bind(tx.txId, id),
        audit.stmt({ adminUserId, action: 'creator.approve', entityType: 'creator_submission', entityId: id, after: { units, ledgerTxId: tx.txId }, reason: note ?? null }),
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'BALANCE') throw new AppError('REWARDS_PAUSED', 'The rewards pool does not have enough PMT for this reward.');
      if (err.kind === 'ASSERTION') throw new AppError('GAME_UNAVAILABLE', 'The creator limit for this campaign is reached.');
      if (err.kind === 'IDEMPOTENCY') throw invalidState('This player already received a creator reward.');
      throw err;
    }
    await this.notifications.notifyPlayer(row.user_id, {
      type: 'CREATOR_REWARD',
      title: `Creator reward: ${s.creator_reward_tokens.toLocaleString('en-US')} PMT`,
      body: 'Thank you for your post about PMT Arcade! The reward was added to your balance as bonus PMT.',
      link: '/creator-rewards',
    });
    return toDto({ ...row, status: 'APPROVED', review_note: note ?? null, reviewed_at: now, reward_units: units }, true);
  }

  async reject(adminUserId: string, id: string, note: string, audit: AuditService): Promise<CreatorSubmissionDto> {
    const row = await this.findPending(id);
    const now = this.now();
    await runBatch(this.db, [
      this.db.prepare("UPDATE creator_submissions SET status = 'REJECTED', review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'").bind(note, adminUserId, now, now, id),
      audit.stmt({ adminUserId, action: 'creator.reject', entityType: 'creator_submission', entityId: id, reason: note }),
    ]);
    await this.notifications.notifyPlayer(row.user_id, { type: 'CREATOR_REWARD', title: 'Your creator post was not approved', body: note, link: '/creator-rewards' });
    return toDto({ ...row, status: 'REJECTED', review_note: note, reviewed_at: now }, true);
  }
}
