import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

const buyBody = (ref: string, amountPoisha = 10_000) => ({ amountPoisha, paymentMethod: 'BKASH_MANUAL', senderNumber: '01712345689', paymentReference: ref });

describe('manual token purchases', () => {
  let h: Harness;
  let admin: TestPlayer;
  let alice: TestPlayer;
  beforeEach(async () => {
    h = await createHarness();
    admin = await h.admin('SUPER_ADMIN', 'root');
    alice = await h.player('alice');
    await h.issue(admin, TOKENS(1_000_000));
  });

  async function submit(ref: string, who = alice, extra: Record<string, unknown> = {}) {
    return h.call('POST', '/api/wallet/buy-requests', { token: who.token, body: { ...buyBody(ref), ...extra }, headers: { 'idempotency-key': `buy-${crypto.randomUUID()}` } });
  }

  it('৳100 at the server rate (110) requests 11,000 TOKEN; the browser cannot choose the rate', async () => {
    const r = await submit('TRX0001AB', alice, { rateTokensPerBdt: 1000, tokenUnits: 999_999_999 });
    expect(r.status).toBe(201);
    expect(r.body.data.request).toMatchObject({ status: 'SUBMITTED', tokenUnits: TOKENS(11_000), rateTokensPerBdt: 110, senderNumber: '01712345689' });
    expect((await h.wallet(alice.token)).totalUnits).toBe(0); // nothing credited until approval
  });

  it('approval credits exactly once (sequential and concurrent)', async () => {
    const r = await submit('TRX0002AB');
    const id = r.body.data.request.id;
    await h.call('POST', `/api/admin/buy-requests/${id}/review`, { token: admin.token });
    const results = await Promise.all([1, 2, 3].map(() => h.call('POST', `/api/admin/buy-requests/${id}/approve`, { token: admin.token })));
    expect(results.filter((x) => x.status === 200)).toHaveLength(1);
    expect(results.filter((x) => x.status === 409).every((x) => x.body.error?.code === 'ALREADY_PROCESSED')).toBe(true);
    const again = await h.call('POST', `/api/admin/buy-requests/${id}/approve`, { token: admin.token });
    expect(again.body.error?.code).toBe('ALREADY_PROCESSED');
    expect((await h.wallet(alice.token)).availableUnits).toBe(TOKENS(11_000));
    const detail = await h.call('GET', `/api/wallet/buy-requests/${id}`, { token: alice.token });
    expect(detail.body.data.status).toBe('COMPLETED');
    expect(detail.body.data.events.map((e: { status: string }) => e.status)).toEqual(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'TOKEN_CREDITED', 'COMPLETED']);
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('rejects a reused bKash reference (normalised) and flags it for review', async () => {
    expect((await submit('trx-777-abc')).status).toBe(201);
    const bob = await h.player('bob');
    const dup = await submit('  TRX-777-ABC ', bob);
    expect(dup.status).toBe(409);
    expect(dup.body.error?.code).toBe('DUPLICATE_PAYMENT_REFERENCE');
    const flag = await h.db.prepare("SELECT user_id FROM fraud_flags WHERE type = 'DUPLICATE_PAYMENT_REFERENCE'").first<string>('user_id');
    expect(flag).toBe(bob.id);
    const bobStatus = await h.db.prepare('SELECT account_status FROM users WHERE id = ?').bind(bob.id).first<string>('account_status');
    expect(bobStatus).toBe('ACTIVE'); // flagged, never auto-banned
  });

  it('a reference from a rejected request may be resubmitted', async () => {
    const r = await submit('TRXREJECT1');
    const reject = await h.call('POST', `/api/admin/buy-requests/${r.body.data.request.id}/reject`, { token: admin.token, body: { reason: 'Amount did not match' } });
    expect(reject.body.data.status).toBe('REJECTED');
    expect((await submit('TRXREJECT1')).status).toBe(201);
  });

  it('rejection requires a reason', async () => {
    const r = await submit('TRXNOREASON');
    const res = await h.call('POST', `/api/admin/buy-requests/${r.body.data.request.id}/reject`, { token: admin.token, body: { reason: '' } });
    expect(res.status).toBe(400);
  });

  it('cannot credit more than the treasury holds', async () => {
    const fresh = await createHarness();
    const root = await fresh.admin('SUPER_ADMIN', 'rootb');
    const p = await fresh.player('poor');
    const r = await fresh.call('POST', '/api/wallet/buy-requests', { token: p.token, body: buyBody('TRXTREASURY'), headers: { 'idempotency-key': 'k-treasury-1' } });
    const res = await fresh.call('POST', `/api/admin/buy-requests/${r.body.data.request.id}/approve`, { token: root.token });
    expect(res.body.error?.code).toBe('TREASURY_INSUFFICIENT');
    const status = await fresh.db.prepare('SELECT status FROM buy_requests WHERE id = ?').bind(r.body.data.request.id).first<string>('status');
    expect(status).toBe('SUBMITTED');
  });

  it('changing today’s rate never changes an existing request', async () => {
    const r = await submit('TRXRATE01');
    await h.call('PATCH', '/api/admin/settings', { token: admin.token, body: { changes: { BUY_TOKENS_PER_BDT: 100, SELL_TOKENS_PER_BDT: 130 }, reason: 'rate update' } });
    await h.call('POST', `/api/admin/buy-requests/${r.body.data.request.id}/approve`, { token: admin.token });
    expect((await h.wallet(alice.token)).availableUnits).toBe(TOKENS(11_000));
  });

  it('the same Idempotency-Key never creates two requests', async () => {
    const headers = { 'idempotency-key': 'buy-once-key' };
    const [x, y] = await Promise.all([
      h.call('POST', '/api/wallet/buy-requests', { token: alice.token, body: buyBody('TRXIDEM01'), headers }),
      h.call('POST', '/api/wallet/buy-requests', { token: alice.token, body: buyBody('TRXIDEM01'), headers }),
    ]);
    expect(x.body.data.request.id).toBe(y.body.data.request.id);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM buy_requests').first<number>('n')).toBe(1);
  });

  it('enforces the configured BDT range and validates the bKash number', async () => {
    expect((await h.call('POST', '/api/wallet/buy-requests', { token: alice.token, body: buyBody('TRXSMALL1', 100) })).body.error?.code).toBe('AMOUNT_OUT_OF_RANGE');
    const bad = await h.call('POST', '/api/wallet/buy-requests', { token: alice.token, body: { ...buyBody('TRXBADNUM'), senderNumber: '12345' } });
    expect(bad.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('finance chat: player ↔ admin, unread indicators, immutable messages, private to the owner', async () => {
    const r = await submit('TRXCHAT01');
    const id = r.body.data.request.id;
    await h.call('POST', `/api/wallet/buy-requests/${id}/messages`, { token: alice.token, body: { message: 'I sent the money at 3pm' } });
    const adminList = await h.call('GET', '/api/admin/buy-requests', { token: admin.token });
    expect(adminList.body.data.items[0].unreadMessages).toBe(1);
    const thread = await h.call('GET', `/api/admin/buy-requests/${id}/messages`, { token: admin.token });
    expect(thread.body.data[0]).toMatchObject({ senderType: 'PLAYER', message: 'I sent the money at 3pm' });
    await h.call('POST', `/api/admin/buy-requests/${id}/messages/read`, { token: admin.token });
    await h.call('POST', `/api/admin/buy-requests/${id}/messages`, { token: admin.token, body: { message: 'Verified, crediting now.' } });
    const playerView = await h.call('GET', `/api/wallet/buy-requests/${id}`, { token: alice.token });
    expect(playerView.body.data.unreadMessages).toBe(1);
    const playerThread = await h.call('GET', `/api/wallet/buy-requests/${id}/messages`, { token: alice.token });
    expect(playerThread.body.data[1].senderLabel).toBe('Support team');
    await expect(h.db.prepare("UPDATE finance_messages SET message = 'edited'").run()).rejects.toThrow(/APPEND_ONLY/);
    await expect(h.db.prepare('DELETE FROM finance_messages').run()).rejects.toThrow(/APPEND_ONLY/);
    const bob = await h.player('bob');
    expect((await h.call('GET', `/api/wallet/buy-requests/${id}/messages`, { token: bob.token })).status).toBe(404);
    expect((await h.call('GET', `/api/wallet/buy-requests/${id}`, { token: bob.token })).status).toBe(404);
  });

  it('a restricted player cannot submit purchases', async () => {
    await h.call('POST', `/api/admin/players/${alice.playerNumber}/status`, { token: admin.token, body: { status: 'RESTRICTED', reason: 'Under investigation' } });
    const r = await submit('TRXRESTRICT');
    expect(r.body.error?.code).toBe('ACCOUNT_RESTRICTED');
  });
});
