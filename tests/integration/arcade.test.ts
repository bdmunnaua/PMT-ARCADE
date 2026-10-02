import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

/** Free arcade games: rewards come from the rewards pool, always as BONUS, under the same rules as the old site. */
describe('free arcade games', () => {
  let h: Harness;
  let admin: TestPlayer;
  let alice: TestPlayer;

  const fundPool = async (units: number) => {
    await h.issue(admin, units);
    const r = await h.call('POST', '/api/admin/rewards-pool/transfer', { token: admin.token, body: { direction: 'TO_POOL', amountUnits: units, reason: 'launch budget' }, headers: { 'idempotency-key': `pool-${crypto.randomUUID()}` } });
    expect(r.status).toBe(200);
  };
  const start = (p: TestPlayer, game = 'neon-rush') => h.call('POST', '/api/arcade/runs/start', { token: p.token, body: { game } });
  const finish = (p: TestPlayer, runId: string, score: number) => h.call('POST', '/api/arcade/runs/finish', { token: p.token, body: { runId, score } });
  /** plays a game that "lasted" `seconds` (the server clock is moved forward) */
  async function play(p: TestPlayer, score: number, seconds = 60, game = 'neon-rush') {
    const s = await start(p, game);
    h.clock.offset += seconds * 1000;
    return finish(p, s.body.data.runId, score);
  }

  beforeEach(async () => {
    h = await createHarness();
    admin = await h.admin('SUPER_ADMIN', 'root');
    alice = await h.player('alice');
    await fundPool(TOKENS(100_000));
  });

  it('pays the welcome bonus once and game rewards as BONUS from the pool (score ÷ divisor, capped per game)', async () => {
    const me = await h.call('GET', '/api/arcade/me', { token: alice.token });
    expect(me.body.data).toMatchObject({ streak: 0, checkedInToday: false, earnedTodayUnits: 0, dailyCapUnits: TOKENS(1000) });
    expect(await h.wallet(alice.token)).toMatchObject({ bonusUnits: TOKENS(50), availableUnits: 0 }); // welcome bonus
    const r = await play(alice, 2_000); // neon-rush: 2000 / 40 = 50 PMT
    expect(r.body.data).toMatchObject({ rewardUnits: TOKENS(50), score: 2_000 });
    const big = await play(alice, 9_000); // 225 → capped at 100 per game
    expect(big.body.data.rewardUnits).toBe(TOKENS(100));
    expect(await h.wallet(alice.token)).toMatchObject({ bonusUnits: TOKENS(200), availableUnits: 0 });
    const hist = await h.call('GET', '/api/me/transactions?category=FREE_GAME', { token: alice.token });
    expect(hist.body.data.items[0].description).toMatch(/Free game reward — Neon Rush/);
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('a game can only be saved once; too-short and impossible scores earn nothing', async () => {
    const s = await start(alice);
    h.clock.offset += 60_000;
    expect((await finish(alice, s.body.data.runId, 400)).status).toBe(200);
    expect((await finish(alice, s.body.data.runId, 400)).body.error?.code).toBe('CONFLICT');
    expect((await play(alice, 400, 3)).body.data).toMatchObject({ rewardUnits: 0, message: expect.stringMatching(/longer/) }); // minSec 8
    expect((await play(alice, 300_000, 20)).body.data).toMatchObject({ rewardUnits: 0, message: expect.stringMatching(/could not be verified/) });
  });

  it('respects the daily cap (Bangladesh day)', async () => {
    await h.db.exec("UPDATE platform_settings SET value = '120' WHERE key = 'arcade_daily_cap_tokens'");
    expect((await play(alice, 4_000)).body.data.rewardUnits).toBe(TOKENS(100));
    const second = await play(alice, 4_000);
    expect(second.body.data).toMatchObject({ rewardUnits: TOKENS(20), message: expect.stringMatching(/limit/) });
    expect((await play(alice, 4_000)).body.data.rewardUnits).toBe(0);
  });

  it('daily check-in pays the streak reward once per day', async () => {
    const c1 = await h.call('POST', '/api/arcade/checkin', { token: alice.token });
    expect(c1.body.data).toMatchObject({ amountUnits: TOKENS(10), streak: 1 });
    expect((await h.call('POST', '/api/arcade/checkin', { token: alice.token })).body.error?.code).toBe('CONFLICT');
    h.clock.offset += 86_400_000;
    const c2 = await h.call('POST', '/api/arcade/checkin', { token: alice.token });
    expect(c2.body.data).toMatchObject({ amountUnits: TOKENS(15), streak: 2 });
  });

  it('referral: inviter +300, friend +100 once the friend has earned 500 from games', async () => {
    const aliceCode = (await h.call('GET', '/api/arcade/me', { token: alice.token })).body.data.refCode;
    const bob = await h.player('bob');
    expect((await h.call('POST', '/api/arcade/referral', { token: bob.token, body: { code: aliceCode } })).status).toBe(200);
    for (let i = 0; i < 5; i++) await play(bob, 4_000); // 5 × 100 = 500
    expect(await h.wallet(alice.token)).toMatchObject({ bonusUnits: TOKENS(50 + 300) });
    expect(await h.wallet(bob.token)).toMatchObject({ bonusUnits: TOKENS(50 + 500 + 100) });
    expect((await h.call('POST', '/api/arcade/referral', { token: bob.token, body: { code: aliceCode } })).body.error?.code).toBe('CONFLICT');
  });

  it('an empty pool pauses rewards instead of creating PMT; old arcade balances are credited once', async () => {
    // a balance carried over from the old arcade database for a Firebase account that has not visited yet
    await h.db.exec("INSERT INTO arcade_legacy_accounts (firebase_uid, email, coins, lifetime, ref_code) VALUES ('uid-carol', 'carol@example.test', 431, 371, 'ZL7JHRC')");
    const carol = await h.player('carol');
    const me = await h.call('GET', '/api/arcade/me', { token: carol.token });
    expect(me.body.data).toMatchObject({ refCode: 'ZL7JHRC', lifetimeUnits: TOKENS(371) });
    expect(await h.wallet(carol.token)).toMatchObject({ bonusUnits: TOKENS(431) }); // old coins, no second welcome bonus
    await h.call('GET', '/api/arcade/me', { token: carol.token });
    expect((await h.wallet(carol.token)).bonusUnits).toBe(TOKENS(431));

    // drain the pool: rewards pause, scores are still saved
    const pool = (await h.call('GET', '/api/admin/rewards-pool', { token: admin.token })).body.data.balanceUnits;
    await h.call('POST', '/api/admin/rewards-pool/transfer', { token: admin.token, body: { direction: 'FROM_POOL', amountUnits: pool, reason: 'test' }, headers: { 'idempotency-key': 'drain-the-pool' } });
    const r = await play(alice, 2_000);
    expect(r.body.data).toMatchObject({ rewardUnits: 0, message: expect.stringMatching(/paused/) });
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('public leaderboard shows the best score per player for the last 7 days', async () => {
    await play(alice, 2_000);
    await play(alice, 3_000);
    const lb = await h.call('GET', '/api/arcade/leaderboard?game=neon-rush');
    expect(lb.body.data.rows[0]).toMatchObject({ playerNumber: alice.playerNumber, score: 3_000 });
    expect((await h.call('GET', '/api/arcade/config')).body.data.games).toHaveLength(16);
  });
});
