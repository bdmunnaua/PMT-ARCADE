import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

describe('wallet & ledger', () => {
  let h: Harness;
  let admin: TestPlayer;
  let alice: TestPlayer;
  beforeEach(async () => {
    h = await createHarness();
    admin = await h.admin('SUPER_ADMIN', 'root');
    alice = await h.player('alice');
  });

  it('treasury issuance + admin grant move tokens through balanced ledger entries', async () => {
    await h.issue(admin, TOKENS(5000));
    expect(await h.systemBalance('sys_admin_treasury')).toBe(TOKENS(5000));
    expect(await h.systemBalance('sys_issuance')).toBe(-TOKENS(5000));
    const r = await h.call('POST', '/api/admin/tokens/distribute', {
      token: admin.token,
      body: { playerNumber: alice.playerNumber, amountUnits: TOKENS(1000), type: 'PROMOTION', reason: 'Welcome bonus' },
      headers: { 'idempotency-key': 'grant-key-0001' },
    });
    expect(r.status).toBe(200);
    expect((await h.wallet(alice.token)).availableUnits).toBe(TOKENS(1000));
    expect(await h.systemBalance('sys_admin_treasury')).toBe(TOKENS(4000));
    const sums = await h.db.prepare('SELECT transaction_id, SUM(amount) AS s FROM ledger_entries GROUP BY transaction_id').all<{ s: number }>();
    expect(sums.results.every((x) => x.s === 0)).toBe(true);
    const audit = await h.db.prepare("SELECT reason FROM audit_logs WHERE action = 'tokens.distribute'").first<string>('reason');
    expect(audit).toBe('Welcome bonus');
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('BONUS grants land in the BONUS bucket', async () => {
    await h.issue(admin, TOKENS(100));
    await h.call('POST', '/api/admin/tokens/distribute', {
      token: admin.token,
      body: { playerNumber: alice.playerNumber, amountUnits: TOKENS(100), type: 'BONUS', reason: 'Event bonus' },
      headers: { 'idempotency-key': 'grant-bonus-01' },
    });
    const w = await h.wallet(alice.token);
    expect(w.bonusUnits).toBe(TOKENS(100));
    expect(w.availableUnits).toBe(0);
  });

  it('refuses a grant the treasury cannot cover (no money is created)', async () => {
    const r = await h.call('POST', '/api/admin/tokens/distribute', {
      token: admin.token,
      body: { playerNumber: alice.playerNumber, amountUnits: TOKENS(1), type: 'MANUAL_GRANT', reason: 'no funds' },
      headers: { 'idempotency-key': 'grant-nofunds' },
    });
    expect(r.status).toBe(422);
    expect(r.body.error?.code).toBe('TREASURY_INSUFFICIENT');
    expect((await h.wallet(alice.token)).totalUnits).toBe(0);
  });

  it('is idempotent: the same Idempotency-Key distributes only once (sequential and concurrent)', async () => {
    await h.issue(admin, TOKENS(10_000));
    const body = { playerNumber: alice.playerNumber, amountUnits: TOKENS(100), type: 'MANUAL_GRANT', reason: 'double click' };
    const headers = { 'idempotency-key': 'same-key-123' };
    const results = await Promise.all(Array.from({ length: 5 }, () => h.call('POST', '/api/admin/tokens/distribute', { token: admin.token, body, headers })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.transactionId)).size).toBe(1);
    const again = await h.call('POST', '/api/admin/tokens/distribute', { token: admin.token, body, headers });
    expect(again.body.data.replayed).toBe(true);
    expect((await h.wallet(alice.token)).availableUnits).toBe(TOKENS(100));
    const conflict = await h.call('POST', '/api/admin/tokens/distribute', { token: admin.token, body: { ...body, amountUnits: TOKENS(999) }, headers });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error?.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('ledger rows are immutable and wallets cannot go negative', async () => {
    await h.fund(admin, alice, TOKENS(10));
    await expect(h.db.prepare('UPDATE ledger_entries SET amount = 1').run()).rejects.toThrow(/LEDGER_IMMUTABLE/);
    await expect(h.db.prepare('DELETE FROM ledger_transactions').run()).rejects.toThrow(/LEDGER_IMMUTABLE/);
    await expect(h.db.prepare("UPDATE wallet_accounts SET balance = -1 WHERE id = 'sys_admin_treasury'").run()).rejects.toThrow(/wallet_balance_non_negative/);
  });

  it('a debit adjustment cannot overdraw AVAILABLE (insufficient balance rejection)', async () => {
    await h.fund(admin, alice, TOKENS(10));
    const r = await h.call('POST', '/api/admin/adjustments', {
      token: admin.token,
      body: { playerNumber: alice.playerNumber, direction: 'DEBIT', amountUnits: TOKENS(11), reason: 'correction' },
      headers: { 'idempotency-key': 'adjust-0001' },
    });
    expect(r.status).toBe(422);
    expect(r.body.error?.code).toBe('INSUFFICIENT_BALANCE');
    const ok = await h.call('POST', '/api/admin/adjustments', {
      token: admin.token,
      body: { playerNumber: alice.playerNumber, direction: 'DEBIT', amountUnits: TOKENS(4), reason: 'correction of a mistaken grant' },
      headers: { 'idempotency-key': 'adjust-0002' },
    });
    expect(ok.status).toBe(200);
    expect((await h.wallet(alice.token)).availableUnits).toBe(TOKENS(6));
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('there is no way to set a balance from the API', async () => {
    const r = await h.call('PATCH', '/api/me', { token: alice.token, body: { availableUnits: 999999 } });
    expect(r.status).toBe(400);
    expect((await h.call('POST', '/api/admin/players/100001/balance', { token: admin.token, body: { balance: 5 } })).status).toBe(404);
    expect((await h.wallet(alice.token)).totalUnits).toBe(0);
  });

  it('player transaction history categorises ledger movements', async () => {
    await h.fund(admin, alice, TOKENS(50));
    const r = await h.call('GET', '/api/me/transactions', { token: alice.token });
    expect(r.body.data.items).toHaveLength(1);
    expect(r.body.data.items[0]).toMatchObject({ category: 'ADMIN_GRANT', netUnits: TOKENS(50), effects: { AVAILABLE: TOKENS(50) } });
    const detail = await h.call('GET', `/api/me/transactions/${r.body.data.items[0].id}`, { token: alice.token });
    expect(detail.body.data.entries[0]).toMatchObject({ bucket: 'AVAILABLE', amountUnits: TOKENS(50), balanceAfterUnits: TOKENS(50) });
  });
});
