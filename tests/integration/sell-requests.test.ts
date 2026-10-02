import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

describe('token redemption (sell)', () => {
  let h: Harness;
  let admin: TestPlayer;
  let alice: TestPlayer;
  beforeEach(async () => {
    h = await createHarness();
    admin = await h.admin('SUPER_ADMIN', 'root');
    alice = await h.player('alice');
    await h.fund(admin, alice, TOKENS(20_000));
    await h.enableGame('game-06');
  });

  async function sell(units = TOKENS(12_000)) {
    return h.call('POST', '/api/wallet/sell-requests', {
      token: alice.token,
      body: { amountUnits: units, paymentMethod: 'BKASH_MANUAL', receivingNumber: '01812345678' },
      headers: { 'idempotency-key': `sell-${crypto.randomUUID()}` },
    });
  }

  it('locks tokens immediately: 20,000 available → 8,000 available + 12,000 locked; ৳100 at 120/৳', async () => {
    const r = await sell();
    expect(r.status).toBe(201);
    expect(r.body.data.request).toMatchObject({ status: 'TOKENS_LOCKED', bdtPoisha: 10_000, rateTokensPerBdt: 120 });
    expect(await h.wallet(alice.token)).toMatchObject({ availableUnits: TOKENS(8_000), lockedSellUnits: TOKENS(12_000), totalUnits: TOKENS(20_000) });
  });

  it('locked tokens cannot be staked or sold again', async () => {
    await sell();
    const stake = await h.call('POST', '/api/matches', { token: alice.token, body: { gameId: 'game-06', stakeUnits: TOKENS(9_000) } });
    expect(stake.body.error?.code).toBe('INSUFFICIENT_BALANCE');
    const again = await sell(TOKENS(9_000));
    expect(again.body.error?.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('rejection returns every locked token (TOKENS_UNLOCKED)', async () => {
    const id = (await sell()).body.data.request.id;
    await h.call('POST', `/api/admin/sell-requests/${id}/review`, { token: admin.token });
    const r = await h.call('POST', `/api/admin/sell-requests/${id}/reject`, { token: admin.token, body: { reason: 'Receiving number mismatch' } });
    expect(r.body.data.status).toBe('TOKENS_UNLOCKED');
    expect(await h.wallet(alice.token)).toMatchObject({ availableUnits: TOKENS(20_000), lockedSellUnits: 0 });
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('approve → PAYMENT_PROCESSING (not completed); payment confirmation moves LOCKED_SELL → ADMIN_TREASURY once', async () => {
    const id = (await sell()).body.data.request.id;
    const treasuryBefore = await h.systemBalance('sys_admin_treasury');
    const approved = await h.call('POST', `/api/admin/sell-requests/${id}/approve`, { token: admin.token });
    expect(approved.body.data.status).toBe('PAYMENT_PROCESSING');
    expect((await h.wallet(alice.token)).lockedSellUnits).toBe(TOKENS(12_000));

    const wrongAmount = await h.call('POST', `/api/admin/sell-requests/${id}/payment-sent`, { token: admin.token, body: { amountSentPoisha: 9_999, outgoingReference: 'OUTREF001' } });
    expect(wrongAmount.body.error?.code).toBe('VALIDATION_ERROR');

    const body = { amountSentPoisha: 10_000, outgoingReference: 'OUTREF001', note: 'sent from merchant' };
    const results = await Promise.all([1, 2].map(() => h.call('POST', `/api/admin/sell-requests/${id}/payment-sent`, { token: admin.token, body })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.find((r) => r.status !== 200)?.body.error?.code).toBe('ALREADY_PROCESSED');

    expect(await h.wallet(alice.token)).toMatchObject({ availableUnits: TOKENS(8_000), lockedSellUnits: 0, totalUnits: TOKENS(8_000) });
    expect(await h.systemBalance('sys_admin_treasury')).toBe(treasuryBefore + TOKENS(12_000));
    const player = await h.call('GET', `/api/wallet/sell-requests/${id}`, { token: alice.token });
    expect(player.body.data).toMatchObject({ status: 'COMPLETED', payment: { amountSentPoisha: 10_000, outgoingReference: 'OUTREF001' } });
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('a payment cannot be confirmed before approval, and a rejected sale cannot be paid', async () => {
    const id = (await sell()).body.data.request.id;
    const early = await h.call('POST', `/api/admin/sell-requests/${id}/payment-sent`, { token: admin.token, body: { amountSentPoisha: 10_000, outgoingReference: 'OUTREF002' } });
    expect(early.body.error?.code).toBe('INVALID_STATE_TRANSITION');
    await h.call('POST', `/api/admin/sell-requests/${id}/reject`, { token: admin.token, body: { reason: 'fraud suspected' } });
    const late = await h.call('POST', `/api/admin/sell-requests/${id}/approve`, { token: admin.token });
    expect(late.status).toBe(409);
  });

  it('the player can cancel before review and gets the tokens back', async () => {
    const id = (await sell()).body.data.request.id;
    const r = await h.call('POST', `/api/wallet/sell-requests/${id}/cancel`, { token: alice.token });
    expect(r.body.data.status).toBe('CANCELLED');
    expect((await h.wallet(alice.token)).availableUnits).toBe(TOKENS(20_000));
  });

  it('respects the sell feature flag', async () => {
    await h.call('PATCH', '/api/admin/settings', { token: admin.token, body: { changes: { sell_requests_enabled: false }, reason: 'provider paused' } });
    const r = await sell();
    expect(r.body.error?.code).toBe('FEATURE_DISABLED');
  });

  it('masks the receiving number for admins without sensitive-data permission', async () => {
    const id = (await sell()).body.data.request.id;
    const support = await h.admin('SUPPORT_ADMIN', 'support1');
    const r = await h.call('GET', `/api/admin/sell-requests/${id}`, { token: support.token });
    expect(r.body.data.request.receivingNumber).toBe('01*******78');
    const fin = await h.call('GET', `/api/admin/sell-requests/${id}`, { token: admin.token });
    expect(fin.body.data.request.receivingNumber).toBe('01812345678');
  });
});
