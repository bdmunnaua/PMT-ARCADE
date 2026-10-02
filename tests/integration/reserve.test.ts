import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

/**
 * The taka reserve: PMT sell-backs are paid only from what buyers paid in, the owner can only
 * take out income above what is owed, and (in production) the price can only rise when backed.
 * Test economy: buy 110 PMT per ৳1, sell-back 120 PMT per ৳1.
 */
describe('taka reserve behind PMT sell-backs', () => {
  let h: Harness;
  let admin: TestPlayer;
  let alice: TestPlayer;

  async function setup(environment = 'test') {
    h = await createHarness({ environment });
    await h.db.exec("UPDATE platform_settings SET value = 'true' WHERE key = 'reserve_guard_enabled'");
    admin = await h.admin('SUPER_ADMIN', 'root');
    alice = await h.player('alice');
    await h.issue(admin, TOKENS(1_000_000));
  }
  beforeEach(() => setup());

  /** a real bKash purchase: ৳100 → 11,000 PMT, approved by the admin */
  async function buy100(who: TestPlayer, ref: string) {
    const r = await h.call('POST', '/api/wallet/buy-requests', {
      token: who.token,
      body: { amountPoisha: 10_000, paymentMethod: 'BKASH_MANUAL', senderNumber: '01712345689', paymentReference: ref },
      headers: { 'idempotency-key': `buy-${ref}` },
    });
    const id = r.body.data.request.id;
    await h.call('POST', `/api/admin/buy-requests/${id}/review`, { token: admin.token });
    const ok = await h.call('POST', `/api/admin/buy-requests/${id}/approve`, { token: admin.token });
    expect(ok.status).toBe(200);
  }
  const sell = (who: TestPlayer, units: number) =>
    h.call('POST', '/api/wallet/sell-requests', { token: who.token, body: { amountUnits: units, paymentMethod: 'BKASH_MANUAL', receivingNumber: '01812345678' }, headers: { 'idempotency-key': `sell-${crypto.randomUUID()}` } });
  const status = async () => (await h.call('GET', '/api/admin/reserve', { token: admin.token })).body.data;
  const move = (direction: 'WITHDRAW' | 'DEPOSIT', amountPoisha: number) =>
    h.call('POST', '/api/admin/reserve/move', { token: admin.token, body: { direction, amountPoisha, reason: 'owner income' }, headers: { 'idempotency-key': `mv-${crypto.randomUUID()}` } });

  it('refuses sell-backs when nobody has paid taka in (free or granted PMT cannot drain the owner)', async () => {
    await h.fund(admin, alice, TOKENS(20_000));
    const r = await sell(alice, TOKENS(12_000));
    expect(r.body.error?.code).toBe('RESERVE_LIMIT');
    expect(await h.wallet(alice.token)).toMatchObject({ availableUnits: TOKENS(20_000), lockedSellUnits: 0 });
  });

  it('sell-backs are paid only from the reserve, counting sells still waiting for payment', async () => {
    await buy100(alice, 'TRXRES001'); // reserve ৳100
    const bob = await h.player('bob');
    await h.fund(admin, bob, TOKENS(20_000));
    expect((await sell(alice, TOKENS(6_000))).status).toBe(201); // ৳50 promised, ৳50 left
    expect((await sell(bob, TOKENS(7_200))).body.error?.code).toBe('RESERVE_LIMIT'); // ৳60 > ৳50
    expect((await sell(bob, TOKENS(6_000))).status).toBe(201); // exactly ৳50
    expect((await status()).freeReservePoisha).toBe(0);
  });

  it('the owner can take out only what stays above 100% of what is owed; deposits add to it', async () => {
    await buy100(alice, 'TRXRES002');
    const s = await status();
    // alice holds 11,000 PMT = 1,100,000 units; at 120 PMT per ৳1 that is ৳91.67 owed (rounded up)
    expect(s).toMatchObject({ receivedPoisha: 10_000, reservePoisha: 10_000, sellableUnits: 1_100_000, liabilityPoisha: 9_167, safeToWithdrawPoisha: 833 });
    expect((await move('WITHDRAW', 900)).body.error?.code).toBe('RESERVE_LIMIT');
    expect((await move('WITHDRAW', 833)).status).toBe(200);
    expect((await status()).safeToWithdrawPoisha).toBe(0);
    expect((await move('DEPOSIT', 5_000)).status).toBe(200);
    expect(await status()).toMatchObject({ safeToWithdrawPoisha: 5_000, ownerNetWithdrawnPoisha: 833 - 5_000 });
    // every movement is audited and append-only
    await expect(h.db.prepare('DELETE FROM reserve_movements').run()).rejects.toThrow(/APPEND_ONLY/);
  });

  it('in production the PMT price can only rise while the reserve covers at least 50% at the new rate', async () => {
    await setup('production');
    await buy100(alice, 'TRXRES003'); // ৳100 reserve, 11,000 PMT held
    const patch = (sell: number, buy: number) => h.call('PATCH', '/api/admin/settings', { token: admin.token, body: { changes: { SELL_TOKENS_PER_BDT: sell, BUY_TOKENS_PER_BDT: buy }, reason: 'price step' } });
    // 40 PMT per ৳1: owed ৳275 → 36% covered → refused
    expect((await patch(40, 35)).body.error?.code).toBe('UNSAFE_CONFIGURATION');
    // 60 PMT per ৳1: owed ৳183.34 → 54% covered → allowed
    expect((await patch(60, 55)).status).toBe(200);
  });
});
