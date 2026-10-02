import { beforeEach, describe, expect, it } from 'vitest';
import { crashFromHmacHex, crashPointX100, multiplierAt, payoutUnits, sha256Hex, timeToReach } from '@arena/games/aviator';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

describe('Aviator crash math', () => {
  it('is provably fair: same seed + round → same crash point; hash commits to the seed', async () => {
    const seed = 'a'.repeat(64);
    expect(await crashPointX100(seed, 7, 10_000)).toBe(await crashPointX100(seed, 7, 10_000));
    expect(await sha256Hex(seed)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('≈1% of rounds crash instantly (house edge) and the cap is respected', () => {
    let instant = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const h = Math.floor(Math.random() * 2 ** 52).toString(16).padStart(13, '0');
      const x = crashFromHmacHex(h, 10_000);
      if (x === 100) instant++;
      expect(x).toBeLessThanOrEqual(10_000);
    }
    expect(instant / n).toBeGreaterThan(0.005);
    expect(instant / n).toBeLessThan(0.03);
  });
  it('multiplier curve and payouts use integer results', () => {
    expect(multiplierAt(0)).toBe(100);
    expect(multiplierAt(timeToReach(200))).toBeGreaterThanOrEqual(200);
    expect(payoutUnits(TOKENS(100), 250, TOKENS(1_000_000))).toBe(TOKENS(250));
    expect(payoutUnits(TOKENS(100), 250, TOKENS(50))).toBe(TOKENS(150)); // profit capped
  });
});

describe('Aviator bets through the ledger', () => {
  let h: Harness;
  let root: TestPlayer;
  let alice: TestPlayer;
  beforeEach(async () => {
    h = await createHarness();
    root = await h.admin('SUPER_ADMIN', 'root');
    alice = await h.player('alice');
    await h.fund(root, alice, TOKENS(1000));
    await h.issue(root, TOKENS(100_000));
    const t = await h.call('POST', '/api/admin/house-bankroll/transfer', { token: root.token, body: { direction: 'TO_BANKROLL', amountUnits: TOKENS(50_000), reason: 'seed bankroll' }, headers: { 'idempotency-key': 'bankroll-1' } });
    expect(t.status).toBe(200);
  });

  const userOf = async (p: TestPlayer) => (await h.services().users.findById(p.id))!;

  it('a cash-out pays stake × multiplier: stake back from escrow, profit from HOUSE_BANKROLL', async () => {
    const s = h.services();
    const round = await s.crash.createRound('game-04');
    const bet = await s.crash.placeBet(await userOf(alice), round, { amountUnits: TOKENS(100) }, 'k1');
    expect(await h.wallet(alice.token)).toMatchObject({ availableUnits: TOKENS(900), lockedGameUnits: TOKENS(100) });
    await s.crash.markFlying(round.id, Date.now());
    const res = await s.settlement.settleCrashBet(bet.id, { type: 'WIN', x100: 250 });
    expect(res.payoutUnits).toBe(TOKENS(250));
    expect(await h.wallet(alice.token)).toMatchObject({ availableUnits: TOKENS(1150), lockedGameUnits: 0 });
    expect(await h.db.prepare("SELECT balance FROM wallet_accounts WHERE id = 'sys_house_bankroll'").first<number>('balance')).toBe(TOKENS(50_000 - 150));
    await expect(s.settlement.settleCrashBet(bet.id, { type: 'WIN', x100: 900 })).rejects.toMatchObject({ code: 'ALREADY_PROCESSED' });
    const hist = await h.call('GET', '/api/me/transactions?category=GAME_WIN', { token: alice.token });
    expect(hist.body.data.items[0]).toMatchObject({ category: 'GAME_WIN', referenceLabel: `Aviator round #${round.round_number}` });
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('a bet paid with free (bonus) tokens wins back bonus, never sellable tokens', async () => {
    const s = h.services();
    const bob = await h.player('bobbonus');
    await h.call('POST', '/api/admin/tokens/distribute', { token: root.token, body: { playerNumber: bob.playerNumber, amountUnits: TOKENS(100), type: 'BONUS', reason: 'free reward' }, headers: { 'idempotency-key': 'bonus-grant-1' } });
    const before = await h.wallet(bob.token);
    expect(before.bonusUnits).toBe(TOKENS(100));
    const round = await s.crash.createRound('game-04');
    const bet = await s.crash.placeBet((await s.users.findById(bob.id))!, round, { amountUnits: TOKENS(100) }, 'bonus-bet');
    await s.crash.markFlying(round.id, Date.now());
    await s.settlement.settleCrashBet(bet.id, { type: 'WIN', x100: 150 });
    expect(await h.wallet(bob.token)).toMatchObject({ availableUnits: 0, bonusUnits: TOKENS(150) });
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('two independent bets per round (panels 1 and 2), never two on the same panel', async () => {
    const s = h.services();
    const round = await s.crash.createRound('game-04');
    const a = await s.crash.placeBet(await userOf(alice), round, { amountUnits: TOKENS(100), panel: 1 }, 'p1');
    const b = await s.crash.placeBet(await userOf(alice), round, { amountUnits: TOKENS(50), autoCashoutX100: 150, panel: 2 }, 'p2');
    expect([a.panel, b.panel]).toEqual([1, 2]);
    await expect(s.crash.placeBet(await userOf(alice), round, { amountUnits: TOKENS(10), panel: 1 }, 'p3')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await h.wallet(alice.token)).toMatchObject({ availableUnits: TOKENS(850), lockedGameUnits: TOKENS(150) });
    await s.crash.markFlying(round.id, Date.now());
    await s.settlement.settleCrashBet(b.id, { type: 'WIN', x100: 150 });
    await s.settlement.settleCrashBet(a.id, { type: 'LOSS' });
    expect(await h.wallet(alice.token)).toMatchObject({ availableUnits: TOKENS(925), lockedGameUnits: 0 });
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('a crashed bet goes to the bankroll; concurrent settlement happens once', async () => {
    const s = h.services();
    const round = await s.crash.createRound('game-04');
    const bet = await s.crash.placeBet(await userOf(alice), round, { amountUnits: TOKENS(200) }, 'k2');
    await s.crash.markFlying(round.id, Date.now());
    const results = await Promise.allSettled([s.settlement.settleCrashBet(bet.id, { type: 'LOSS' }), h.services().settlement.settleCrashBet(bet.id, { type: 'WIN', x100: 300 })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const w = await h.wallet(alice.token);
    expect([TOKENS(800), TOKENS(1400)]).toContain(w.availableUnits);
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('bets are refused once the round is flying, and when the bankroll cannot cover the maximum win', async () => {
    const s = h.services();
    const round = await s.crash.createRound('game-04');
    await s.crash.markFlying(round.id, Date.now());
    await expect(s.crash.placeBet(await userOf(alice), (await s.crash.round(round.id))!, { amountUnits: TOKENS(10) }, 'k3')).rejects.toMatchObject({ code: 'ROUND_CLOSED' });

    // shrink the bankroll: max profit of a 1,000-token bet at 100× (capped at 100,000 tokens) exceeds it
    const poor = await createHarness();
    const r2 = await poor.admin('SUPER_ADMIN', 'root2');
    const bob = await poor.player('bob');
    await poor.fund(r2, bob, TOKENS(1000));
    const ps = poor.services();
    const rd = await ps.crash.createRound('game-04');
    await expect(ps.crash.placeBet((await ps.users.findById(bob.id))!, rd, { amountUnits: TOKENS(1000) }, 'k4')).rejects.toMatchObject({ code: 'BANKROLL_LIMIT' });
    expect((await poor.wallet(bob.token)).availableUnits).toBe(TOKENS(1000));
  });

  it('the bankroll cannot be withdrawn below what open bets could win; refunds return the stake', async () => {
    const s = h.services();
    const round = await s.crash.createRound('game-04');
    const bet = await s.crash.placeBet(await userOf(alice), round, { amountUnits: TOKENS(100) }, 'k5');
    const w = await h.call('POST', '/api/admin/house-bankroll/transfer', { token: root.token, body: { direction: 'FROM_BANKROLL', amountUnits: TOKENS(50_000), reason: 'withdraw all' }, headers: { 'idempotency-key': 'bankroll-2' } });
    expect(w.body.error?.code).toBe('BANKROLL_LIMIT');
    await s.settlement.settleCrashBet(bet.id, { type: 'REFUND', reason: 'test' });
    expect((await h.wallet(alice.token)).availableUnits).toBe(TOKENS(1000));
    const ok = await h.call('POST', '/api/admin/house-bankroll/transfer', { token: root.token, body: { direction: 'FROM_BANKROLL', amountUnits: TOKENS(50_000), reason: 'withdraw all' }, headers: { 'idempotency-key': 'bankroll-3' } });
    expect(ok.status).toBe(200);
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('room matches cannot be created on a crash game', async () => {
    const r = await h.call('POST', '/api/matches', { token: alice.token, body: { gameId: 'game-04', stakeUnits: TOKENS(10) } });
    expect(r.body.error?.code).toBe('GAME_UNAVAILABLE');
  });
});

describe('team settlement (Twenty-Nine)', () => {
  it('4 × 1,000 stakes: fee 40 to PLATFORM_FEES, each winner gets 1,980, losers 0', async () => {
    const h = await createHarness();
    const root = await h.admin('SUPER_ADMIN', 'root');
    const ps = [await h.player('pl1'), await h.player('pl2'), await h.player('pl3'), await h.player('pl4')];
    for (const p of ps) await h.fund(root, p, TOKENS(1000));
    const created = await h.call('POST', '/api/matches', { token: ps[0]!.token, body: { gameId: 'game-03', stakeUnits: TOKENS(1000) } });
    const id = created.body.data.match.id;
    for (const p of ps.slice(1)) expect((await h.call('POST', `/api/matches/${id}/join`, { token: p.token })).status).toBe(200);
    const s = h.services();
    await s.matches.markPlaying(id, 'GAME_SERVER', null);
    const res = await s.settlement.settleMatch({ matchId: id, outcome: { type: 'WIN', winnerUserId: ps[0]!.id, teammateUserIds: [ps[2]!.id] }, source: 'GAME_SERVER' });
    expect(res).toMatchObject({ feeUnits: TOKENS(40), payoutUnits: TOKENS(3960) });
    expect((await h.wallet(ps[0]!.token)).availableUnits).toBe(TOKENS(1980));
    expect((await h.wallet(ps[2]!.token)).availableUnits).toBe(TOKENS(1980));
    expect((await h.wallet(ps[1]!.token)).totalUnits).toBe(0);
    expect(await h.systemBalance('sys_platform_fees')).toBe(TOKENS(40));
    const m = await h.call('GET', `/api/matches/${id}`, { token: ps[2]!.token });
    expect(m.body.data.myResult).toBe('WIN');
    expect((await h.integrity()).status).toBe('PASS');
  });
});
