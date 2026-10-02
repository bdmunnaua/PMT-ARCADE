import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

describe('sending PMT to another player', () => {
  let h: Harness;
  let admin: TestPlayer;
  let alice: TestPlayer;
  let bob: TestPlayer;
  beforeEach(async () => {
    h = await createHarness();
    admin = await h.admin('SUPER_ADMIN', 'root');
    alice = await h.player('alice');
    bob = await h.player('bob');
    await h.fund(admin, alice, TOKENS(50_000));
  });

  const send = (from: TestPlayer, toPlayerNumber: number, units: number, key = `t-${crypto.randomUUID()}`, note?: string) =>
    h.call('POST', '/api/wallet/transfers', { token: from.token, body: { toPlayerNumber, amountUnits: units, note }, headers: { 'idempotency-key': key } });

  it('moves PMT by player number; the platform keeps a 1% fee; the recipient is notified', async () => {
    const who = await h.call('GET', `/api/wallet/transfers/recipient/${bob.playerNumber}`, { token: alice.token });
    expect(who.body.data).toMatchObject({ username: 'bob' });
    const r = await send(alice, bob.playerNumber, TOKENS(10_000), undefined, 'for the match');
    expect(r.status).toBe(201);
    expect(r.body.data.transfer).toMatchObject({ amountUnits: TOKENS(10_000), feeUnits: TOKENS(100), receivedUnits: TOKENS(9_900), toUsername: 'bob' });
    expect((await h.wallet(alice.token)).availableUnits).toBe(TOKENS(40_000));
    expect((await h.wallet(bob.token)).availableUnits).toBe(TOKENS(9_900));
    const notes = await h.call('GET', '/api/notifications', { token: bob.token });
    expect(JSON.stringify(notes.body.data)).toContain('sent you 9,900');
    const hist = await h.call('GET', '/api/me/transactions?category=TRANSFER', { token: bob.token });
    expect(hist.body.data.items[0]).toMatchObject({ category: 'TRANSFER' });
    const report = await h.integrity();
    expect(report.checks.filter((c: { passed: boolean }) => !c.passed)).toEqual([]);
  });

  it('a double-click with the same key sends once', async () => {
    const results = await Promise.all([1, 2, 3].map(() => send(alice, bob.playerNumber, TOKENS(5_000), 'same-key-1')));
    expect(results.every((x) => x.status === 200 || x.status === 201)).toBe(true);
    expect((await h.wallet(alice.token)).availableUnits).toBe(TOKENS(45_000));
  });

  it('bonus (free) PMT cannot be sent, nor to yourself, nor below the minimum', async () => {
    const carol = await h.player('carol');
    await h.issue(admin, TOKENS(100_000));
    await h.call('POST', '/api/admin/tokens/distribute', { token: admin.token, body: { playerNumber: carol.playerNumber, amountUnits: TOKENS(20_000), type: 'BONUS', reason: 'free reward' }, headers: { 'idempotency-key': 'bonus-carol' } });
    expect((await h.wallet(carol.token)).bonusUnits).toBe(TOKENS(20_000));
    const r = await send(carol, bob.playerNumber, TOKENS(5_000));
    expect(r.body.error?.code).toBe('INSUFFICIENT_BALANCE');
    expect(r.body.error?.message).toMatch(/Bonus PMT cannot be sent/);
    expect((await send(alice, alice.playerNumber, TOKENS(5_000))).body.error?.code).toBe('VALIDATION_ERROR');
    expect((await send(alice, bob.playerNumber, TOKENS(999))).body.error?.code).toBe('AMOUNT_OUT_OF_RANGE');
    expect((await send(alice, 999_999, TOKENS(5_000))).body.error?.code).toBe('NOT_FOUND');
  });

  it('enforces the 24-hour sending limit', async () => {
    await h.db.exec("UPDATE platform_settings SET value = '15000' WHERE key = 'daily_transfer_limit_tokens'");
    expect((await send(alice, bob.playerNumber, TOKENS(10_000))).status).toBe(201);
    const over = await send(alice, bob.playerNumber, TOKENS(6_000));
    expect(over.body.error?.code).toBe('AMOUNT_OUT_OF_RANGE');
    expect(over.body.error?.message).toMatch(/daily sending limit/);
    expect((await send(alice, bob.playerNumber, TOKENS(5_000))).status).toBe(201);
  });
});
