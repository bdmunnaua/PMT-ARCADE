/**
 * 🤖 Bots for stake games. A bot is a real player account the server plays for (sign-in id
 * `bot:N`, which no Google / email sign-in can produce), so stakes, escrow, settlement and the
 * ledger work exactly as for people.
 *
 * Money rules:
 *   - A bot's stake is BONUS PMT moved to it from the house bankroll just before it sits down.
 *     Bonus-funded escrow is always paid out as bonus, so a player who beats a bot wins bonus
 *     PMT: the house can never lose sellable PMT to bots, and farming free accounts gains nothing.
 *   - The house may lose at most `bot_daily_loss_limit_tokens` per Bangladesh day; then bots pause.
 *   - Bots never see hidden information: they use the same public state and server dice.
 */
import type { MatchDto, PlatformSettings } from '@arena/shared';
import { bdDayStart } from '../arcade/rules';
import { all, classifyDbError, first, runBatch } from '../lib/db';
import { AppError, invalidState, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import type { MatchRepository } from '../repositories/matches';
import type { UserRecord, UserRepository } from '../repositories/users';
import type { GameService } from './games';
import type { LedgerService } from './ledger';
import type { MatchService } from './matches';
import type { SettingsService } from './settings';

/** the bot players, always shown with 🤖 and "(Bot)" so nobody mistakes them for people */
export const BOTS = [
  { uid: 'bot:1', username: 'bot_asha', displayName: '🤖 Asha (Bot)' },
  { uid: 'bot:2', username: 'bot_rafi', displayName: '🤖 Rafi (Bot)' },
  { uid: 'bot:3', username: 'bot_mitu', displayName: '🤖 Mitu (Bot)' },
] as const;

/** game modules that have a bot player */
export const BOT_GAMES = new Set(['ludo', 'call-bridge', 'twenty-nine']);

/** a bot is topped up to this many stakes at a time, so it does not need a transfer every game */
const TOP_UP_STAKES = 5;

export const isBotUid = (uid: string) => uid.startsWith('bot:');

export class BotService {
  constructor(
    private readonly db: D1Database,
    private readonly users: UserRepository,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly games: GameService,
    private readonly matches: MatchService,
    private readonly repo: MatchRepository,
    private readonly now: () => number,
  ) {}

  /** Which of these user ids are bots. */
  async botIds(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await all<{ id: string }>(this.db, `SELECT id FROM users WHERE firebase_uid LIKE 'bot:%' AND id IN (${userIds.map(() => '?').join(',')})`, ...userIds);
    return new Set(rows.map((r) => r.id));
  }

  private async ensureBot(i: number): Promise<UserRecord> {
    const spec = BOTS[i]!;
    const existing = await this.users.findByFirebaseUid(spec.uid);
    if (existing) return existing;
    try {
      await runBatch(this.db, this.users.createStatements({ id: ulid(this.now()), firebaseUid: spec.uid, email: null, emailVerified: false, username: spec.username, displayName: spec.displayName, ip: null, now: this.now() }));
    } catch (e) {
      if (classifyDbError(e).kind !== 'UNIQUE') throw e; // created concurrently
    }
    const bot = await this.users.findByFirebaseUid(spec.uid);
    if (!bot) throw new AppError('INTERNAL_ERROR');
    return bot;
  }

  /** PMT the house lost to players in bot games today (negative = the house won), in units. */
  async houseLossTodayUnits(): Promise<number> {
    const r = await first<{ net: number }>(
      this.db,
      `SELECT COALESCE(SUM(mp.stake_units - COALESCE(mp.payout_units, 0)), 0) AS net
         FROM match_players mp JOIN users u ON u.id = mp.user_id JOIN matches m ON m.id = mp.match_id
        WHERE u.firebase_uid LIKE 'bot:%' AND mp.result IS NOT NULL AND mp.result <> 'REFUNDED' AND m.ended_at >= ?`,
      bdDayStart(this.now()),
    );
    return r?.net ?? 0;
  }

  private async topUp(bot: UserRecord, stakeUnits: number): Promise<void> {
    const w = await first<{ balance: number }>(this.db, "SELECT balance FROM wallet_accounts WHERE user_id = ? AND bucket = 'BONUS'", bot.id);
    if ((w?.balance ?? 0) >= stakeUnits) return;
    const amount = stakeUnits * TOP_UP_STAKES - (w?.balance ?? 0);
    const tx = this.ledger.buildTransaction({
      idempotencyKey: `bot-topup:${bot.id}:${ulid(this.now())}`,
      type: 'HOUSE_BANKROLL_TRANSFER',
      referenceType: 'BOT',
      referenceId: bot.id,
      createdBy: { type: 'SYSTEM', id: null },
      metadata: { bot: bot.username, stakeUnits },
      postings: [{ from: { system: 'HOUSE_BANKROLL' }, to: { userId: bot.id, bucket: 'BONUS' }, amount }],
    });
    try {
      await runBatch(this.db, tx.statements);
    } catch (e) {
      if (classifyDbError(e).kind === 'BALANCE') throw new AppError('GAME_UNAVAILABLE', 'Bots are resting right now. Invite a friend instead!');
      throw e;
    }
  }

  private assertEnabled(s: PlatformSettings): void {
    if (!s.bots_enabled) throw new AppError('GAME_UNAVAILABLE', 'Bots are switched off right now.');
  }

  /**
   * The room's host fills every empty seat with a bot, which starts the game.
   * Only the creator can do this, only while the room is waiting.
   */
  async fill(host: UserRecord, matchId: string): Promise<MatchDto> {
    const s = await this.settings.get();
    this.assertEnabled(s);
    const match = await this.repo.find(matchId);
    if (!match) throw notFound('Match');
    if (match.creator_id !== host.id) throw new AppError('FORBIDDEN', 'Only the player who opened the room can add bots.');
    if (match.status !== 'WAITING_FOR_OPPONENT') throw invalidState('This room is not waiting for players.');
    const game = await this.games.get(match.game_id);
    if (!game.moduleKey || !BOT_GAMES.has(game.moduleKey)) throw new AppError('GAME_UNAVAILABLE', 'Bots can play Ludo, Call Bridge and 29 for now. Invite a friend for this game.');
    const seats = match.max_players - match.player_count;
    if (seats <= 0) throw new AppError('MATCH_FULL');
    // worst case the house loses every bot stake in this room
    if ((await this.houseLossTodayUnits()) + seats * match.stake_units > s.bot_daily_loss_limit_tokens * 100) {
      throw new AppError('GAME_UNAVAILABLE', 'Bots are resting for today. Invite a friend instead!');
    }
    const seated = new Set((await this.repo.players(matchId)).map((p) => p.user_id));
    let dto: MatchDto | null = null;
    for (let i = 0; i < BOTS.length && seats > 0 && (dto?.playerCount ?? match.player_count) < match.max_players; i++) {
      const bot = await this.ensureBot(i);
      if (seated.has(bot.id)) continue;
      await this.topUp(bot, match.stake_units);
      dto = await this.matches.join(bot, matchId, { asBot: true });
    }
    if (!dto) throw new AppError('GAME_UNAVAILABLE', 'No bot could join this room.');
    return this.matches.get(matchId, host.id);
  }
}
