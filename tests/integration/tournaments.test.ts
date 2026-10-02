import { beforeEach, describe, expect, it } from 'vitest';
import { tournamentWeek, tournamentWeekStart, WEEK_MS } from '../../apps/api/src/arcade/rules';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

const BD = 6 * 3600_000;
/** Wednesday 7 October 2026, 12:00 Bangladesh time */
const WED = Date.UTC(2026, 9, 7, 12) - BD;

/** Weekly free-game tournament: best score in the featured game, prizes from the rewards pool after the week. */
describe('weekly tournaments', () => {
  let h: Harness;
  let admin: TestPlayer;
  let alice: TestPlayer;
  let bob: TestPlayer;
  const week = tournamentWeek(tournamentWeekStart(WED));
  const setNow = (ms: number) => {
    h.clock.offset = ms - Date.now();
  };
  async function play(p: TestPlayer, score: number, game = week.gameId, seconds = 120) {
    const s = await h.call('POST', '/api/arcade/runs/start', { token: p.token, body: { game } });
    h.clock.offset += seconds * 1000;
    return h.call('POST', '/api/arcade/runs/finish', { token: p.token, body: { runId: s.body.data.runId, score } });
  }
  /** settles due weeks; the empty launch week before the test week is left out of the result */
  const settle = async () => ({ settled: (await h.services().tournaments.settleDue()).settled.filter((w) => w >= week.weekStart) });

  beforeEach(async () => {
    h = await createHarness();
    admin = await h.admin('SUPER_ADMIN', 'root');
    alice = await h.player('alice');
    bob = await h.player('bob');
    await h.issue(admin, TOKENS(1_000_000));
    await h.call('POST', '/api/admin/rewards-pool/transfer', { token: admin.token, body: { direction: 'TO_POOL', amountUnits: TOKENS(1_000_000), reason: 'budget' }, headers: { 'idempotency-key': `fund-pool-${crypto.randomUUID()}` } });
    setNow(WED);
  });

  it('weeks run Monday → Monday in Bangladesh time and rotate the featured game', () => {
    expect(week.weekStart).toBe('2026-10-05');
    expect(new Date(week.startsAt + BD).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(tournamentWeekStart(week.endsAt - 1)).toBe(week.startsAt);
    expect(tournamentWeekStart(week.endsAt)).toBe(week.endsAt);
    expect(tournamentWeek(week.endsAt).gameId).not.toBe(week.gameId);
  });

  it('ranks the best score per player (other games and flagged scores do not count)', async () => {
    await play(alice, 300);
    await play(alice, 500);
    await play(bob, 400);
    await play(bob, 9_999, week.gameId === 'neon-rush' ? 'tower-stack' : 'neon-rush'); // another game
    await play(bob, 999_999_999); // impossible score → flagged
    const t = (await h.call('GET', '/api/arcade/tournament/me', { token: bob.token })).body.data;
    expect(t).toMatchObject({ enabled: true, current: { weekStart: '2026-10-05', gameId: week.gameId, players: 2, you: { rank: 2, score: 400 } } });
    expect(t.current.rows.map((r: { playerNumber: number; score: number }) => [r.playerNumber, r.score])).toEqual([
      [alice.playerNumber, 500],
      [bob.playerNumber, 400],
    ]);
    expect(t.current.rows[1]).toMatchObject({ isYou: true, prizeUnits: TOKENS(10_000) });
    expect((await h.call('GET', '/api/arcade/tournament')).body.data.current.rows[0].isYou).toBeUndefined();
  });

  it('pays the prizes once, after the week and the grace period, as BONUS from the pool', async () => {
    await play(alice, 500);
    await play(bob, 400);
    const before = await h.wallet(alice.token);

    setNow(week.endsAt + 60_000); // week over, but games started before the end may still finish
    expect((await settle()).settled).toEqual([]);
    expect((await h.call('GET', '/api/arcade/tournament')).body.data.last).toMatchObject({ weekStart: '2026-10-05', status: 'PENDING' });

    setNow(week.endsAt + 4 * 3600_000);
    expect((await settle()).settled).toEqual(['2026-10-05']);
    expect((await settle()).settled).toEqual([]); // never twice
    expect((await h.wallet(alice.token)).bonusUnits - before.bonusUnits).toBe(TOKENS(20_000));
    const last = (await h.call('GET', '/api/arcade/tournament/me', { token: alice.token })).body.data.last;
    expect(last).toMatchObject({ status: 'PAID', rows: [{ rank: 1, playerNumber: alice.playerNumber, prizeUnits: TOKENS(20_000), isYou: true }, { rank: 2, prizeUnits: TOKENS(10_000) }] });
    const notes = (await h.call('GET', '/api/notifications', { token: alice.token })).body.data;
    expect(JSON.stringify(notes)).toMatch(/weekly tournament/);
    const hist = await h.call('GET', '/api/me/transactions?category=FREE_GAME', { token: alice.token });
    expect(hist.body.data.items[0].description).toMatch(/Weekly tournament/);
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('a week nobody played is closed without a payment; banned players win nothing', async () => {
    await play(alice, 500);
    await h.db.prepare("UPDATE users SET account_status = 'BANNED' WHERE id = ?").bind(alice.id).run();
    await play(bob, 100);
    setNow(week.endsAt + WEEK_MS + 4 * 3600_000); // also the following week (no games) is due
    expect((await settle()).settled).toEqual(['2026-10-05', tournamentWeek(week.endsAt).weekStart]);
    const rows = await h.db.prepare("SELECT week_start, status, prize_units FROM arcade_tournaments WHERE week_start >= '2026-10-05' ORDER BY week_start").all();
    expect(rows.results).toEqual([
      { week_start: '2026-10-05', status: 'PAID', prize_units: TOKENS(20_000) },
      { week_start: tournamentWeek(week.endsAt).weekStart, status: 'NO_ENTRIES', prize_units: 0 },
    ]);
    const winner = await h.db.prepare('SELECT user_id FROM arcade_tournament_winners').all();
    expect(winner.results).toEqual([{ user_id: bob.id }]);
  });

  it('waits for the pool when it cannot cover the prizes, then pays', async () => {
    await play(alice, 500);
    const pool = (await h.call('GET', '/api/admin/rewards-pool', { token: admin.token })).body.data.balanceUnits;
    await h.call('POST', '/api/admin/rewards-pool/transfer', { token: admin.token, body: { direction: 'FROM_POOL', amountUnits: pool - TOKENS(100), reason: 'test' }, headers: { 'idempotency-key': 'drain-the-pool-now' } });
    setNow(week.endsAt + 4 * 3600_000);
    expect((await settle()).settled).toEqual([]);
    await h.issue(admin, TOKENS(50_000));
    await h.call('POST', '/api/admin/rewards-pool/transfer', { token: admin.token, body: { direction: 'TO_POOL', amountUnits: TOKENS(50_000), reason: 'refill' }, headers: { 'idempotency-key': 'refill-the-pool-now' } });
    expect((await settle()).settled).toEqual(['2026-10-05']);
    expect((await h.integrity()).status).toBe('PASS');
  });
});
