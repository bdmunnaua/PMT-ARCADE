/**
 * Weekly free-game tournaments. One featured free game per Bangladesh week; every finished
 * (not flagged) game of that week counts on its own — players do not join or pay anything.
 * The best score per player ranks (ties: whoever reached it first). After the week ends, and a
 * grace period for games still in progress, the prizes are paid once as BONUS PMT from the
 * REWARDS_POOL: the results row, the winners and the ledger transaction are one batch, so a
 * week is paid completely or not at all, and a retry can never pay twice.
 */
import type { TournamentDto, TournamentRowDto } from '@arena/shared';
import { ARCADE_GAMES, TOURNAMENT_FIRST_WEEK, TOURNAMENT_GRACE_MS, tournamentWeek, tournamentWeekStart, WEEK_MS } from '../arcade/rules';
import { all, classifyDbError, first, runBatch, type Stmt } from '../lib/db';
import type { LedgerService } from './ledger';
import type { NotificationService } from './notifications';
import type { SettingsService } from './settings';

const U = 100; // units per PMT

interface RankRow {
  user_id: string;
  score: number;
  player_number: number;
  display_name: string;
}
interface ResultRow {
  week_start: string;
  game: string;
  starts_at: number;
  ends_at: number;
  status: 'PAID' | 'NO_ENTRIES' | 'OFF';
}

export class TournamentService {
  constructor(
    private readonly db: D1Database,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly now: () => number,
  ) {}

  /** Best score per eligible player in the featured game during the week, best first. */
  private ranking(game: string, startsAt: number, endsAt: number, limit: number): Promise<RankRow[]> {
    return all<RankRow>(
      this.db,
      `WITH best AS (
         SELECT user_id, score, finished_at,
                ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC, finished_at ASC) AS rn
         FROM arcade_runs
         WHERE game = ? AND status = 'DONE' AND score > 0 AND started_at >= ? AND started_at < ?
       )
       SELECT b.user_id, b.score, p.player_number, p.display_name
       FROM best b JOIN player_profiles p ON p.user_id = b.user_id JOIN users u ON u.id = b.user_id
       WHERE b.rn = 1 AND u.account_status NOT IN ('BANNED', 'SUSPENDED')
       ORDER BY b.score DESC, b.finished_at ASC, p.player_number ASC
       LIMIT ?`,
      game,
      startsAt,
      endsAt,
      limit,
    );
  }

  private async players(game: string, startsAt: number, endsAt: number): Promise<number> {
    const r = await first<{ n: number }>(this.db, "SELECT COUNT(DISTINCT user_id) AS n FROM arcade_runs WHERE game = ? AND status = 'DONE' AND score > 0 AND started_at >= ? AND started_at < ?", game, startsAt, endsAt);
    return r?.n ?? 0;
  }

  private rows(ranked: RankRow[], prizesUnits: number[], viewerId: string | null): TournamentRowDto[] {
    return ranked.map((r, i) => ({
      rank: i + 1,
      playerNumber: r.player_number,
      name: r.display_name.slice(0, 18),
      score: r.score,
      prizeUnits: prizesUnits[i] ?? 0,
      ...(viewerId ? { isYou: r.user_id === viewerId } : {}),
    }));
  }

  async view(viewerId: string | null): Promise<TournamentDto> {
    const s = await this.settings.get();
    const now = this.now();
    const prizesUnits = s.tournament_prizes_tokens.map((t) => t * U);
    const show = Math.max(20, prizesUnits.length);
    const cur = tournamentWeek(tournamentWeekStart(now));
    const ranked = await this.ranking(cur.gameId, cur.startsAt, cur.endsAt, 500);
    const mine = viewerId ? ranked.findIndex((r) => r.user_id === viewerId) : -1;

    let last: TournamentDto['last'] = null;
    const prev = tournamentWeek(cur.startsAt - WEEK_MS);
    if (prev.weekStart >= TOURNAMENT_FIRST_WEEK) {
      const done = await first<ResultRow>(this.db, 'SELECT * FROM arcade_tournaments WHERE week_start = ?', prev.weekStart);
      if (done) {
        const winners = await all<RankRow & { prize_units: number }>(
          this.db,
          `SELECT w.user_id, w.score, w.prize_units, p.player_number, p.display_name
           FROM arcade_tournament_winners w JOIN player_profiles p ON p.user_id = w.user_id
           WHERE w.week_start = ? ORDER BY w.rank`,
          prev.weekStart,
        );
        last = { ...prev, gameId: done.game, status: done.status, rows: this.rows(winners, winners.map((w) => w.prize_units), viewerId) };
      } else {
        const top = await this.ranking(prev.gameId, prev.startsAt, prev.endsAt, show);
        last = { ...prev, status: 'PENDING', rows: this.rows(top, prizesUnits, viewerId) };
      }
    }

    return {
      enabled: s.tournament_enabled,
      current: {
        ...cur,
        prizesUnits,
        players: await this.players(cur.gameId, cur.startsAt, cur.endsAt),
        rows: this.rows(ranked.slice(0, show), prizesUnits, viewerId),
        you: mine >= 0 ? { rank: mine + 1, score: ranked[mine]!.score } : null,
      },
      next: tournamentWeek(cur.endsAt),
      last,
    };
  }

  /**
   * Pays every finished week that has not been settled yet (run by the cron every 10 minutes;
   * safe to run any number of times, also concurrently). Looks back four weeks.
   */
  async settleDue(): Promise<{ settled: string[] }> {
    const settled: string[] = [];
    const now = this.now();
    let start = tournamentWeekStart(now) - 4 * WEEK_MS;
    for (; start + WEEK_MS + TOURNAMENT_GRACE_MS <= now; start += WEEK_MS) {
      const week = tournamentWeek(start);
      if (week.weekStart < TOURNAMENT_FIRST_WEEK) continue;
      if (await first(this.db, 'SELECT 1 AS x FROM arcade_tournaments WHERE week_start = ?', week.weekStart)) continue;
      if (await this.settle(week)) settled.push(week.weekStart);
    }
    return { settled };
  }

  private async settle(week: ReturnType<typeof tournamentWeek>): Promise<boolean> {
    const s = await this.settings.get();
    const now = this.now();
    const prizes = s.tournament_prizes_tokens.map((t) => t * U);
    const ranked = s.tournament_enabled ? await this.ranking(week.gameId, week.startsAt, week.endsAt, prizes.length) : [];
    const winners = ranked.map((r, i) => ({ ...r, rank: i + 1, prize: prizes[i] ?? 0 }));
    const total = winners.reduce((a, w) => a + w.prize, 0);
    const status = !s.tournament_enabled ? 'OFF' : winners.length ? 'PAID' : 'NO_ENTRIES';
    const gameName = ARCADE_GAMES[week.gameId]?.name ?? week.gameId;

    const tx =
      total > 0
        ? this.ledger.buildTransaction({
            idempotencyKey: `arcade:tournament:${week.weekStart}`,
            type: 'ARCADE_REWARD',
            referenceType: 'ARCADE',
            referenceId: 'tournament',
            createdBy: { type: 'SYSTEM', id: null },
            metadata: { label: `Weekly tournament (${gameName}, week of ${week.weekStart})`, kind: 'tournament', week: week.weekStart },
            postings: winners.filter((w) => w.prize > 0).map((w) => ({ from: { system: 'REWARDS_POOL' as const }, to: { userId: w.user_id, bucket: 'BONUS' as const }, amount: w.prize })),
          })
        : null;
    const stmts: Stmt[] = [
      this.db
        .prepare('INSERT INTO arcade_tournaments (week_start, game, starts_at, ends_at, status, prize_units, ledger_tx_id, settled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(week.weekStart, week.gameId, week.startsAt, week.endsAt, status, total, tx?.txId ?? null, now),
      ...winners.map((w) => this.db.prepare('INSERT INTO arcade_tournament_winners (week_start, rank, user_id, score, prize_units) VALUES (?, ?, ?, ?, ?)').bind(week.weekStart, w.rank, w.user_id, w.score, w.prize)),
      ...(tx?.statements ?? []),
    ];
    try {
      await runBatch(this.db, stmts);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'BALANCE') {
        // the pool cannot cover the prizes: nothing is recorded, the next cron run retries
        console.warn(JSON.stringify({ level: 'warn', cron: 'tournament', week: week.weekStart, message: 'rewards pool too small for the prizes' }));
        return false;
      }
      if (err.kind === 'UNIQUE' || err.kind === 'IDEMPOTENCY') return false; // settled concurrently
      throw err;
    }
    for (const w of winners) {
      if (w.prize <= 0) continue;
      await this.notifications.notifyPlayer(w.user_id, {
        type: 'TOURNAMENT_PRIZE',
        title: `You placed #${w.rank} in the weekly tournament 🏆`,
        body: `${gameName}: your best score ${w.score.toLocaleString('en-US')} won ${(w.prize / U).toLocaleString('en-US')} PMT (bonus).`,
        link: '/tournament',
      });
    }
    return true;
  }
}
