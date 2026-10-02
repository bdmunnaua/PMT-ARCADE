import { describe, expect, it } from 'vitest';
import { createHarness, TOKENS } from '../helpers/harness';

describe('ledger integrity checker', () => {
  it('reports PASS for a healthy ledger and detailed errors after tampering — without fixing anything', async () => {
    const h = await createHarness();
    const root = await h.admin('SUPER_ADMIN', 'root');
    const a = await h.player('alice');
    await h.fund(root, a, TOKENS(100));
    const ok = await h.call('POST', '/api/admin/ledger/integrity', { token: root.token });
    expect(ok.body.data.status).toBe('PASS');
    expect(ok.body.data.checks.every((c: { passed: boolean }) => c.passed)).toBe(true);

    // simulate corruption of the cached balance (bypassing the service, as an attacker with DB access would)
    await h.db.prepare("UPDATE wallet_accounts SET balance = balance + 5 WHERE bucket = 'AVAILABLE' AND user_id = ?").bind(a.id).run();
    const bad = await h.call('POST', '/api/admin/ledger/integrity', { token: root.token });
    expect(bad.body.data.status).toBe('FAIL');
    const checks = bad.body.data.issues.map((i: { check: string }) => i.check);
    expect(checks).toContain('balance_reconciliation');
    expect(checks).toContain('conservation');
    // the checker never repairs balances
    const bal = await h.db.prepare("SELECT balance FROM wallet_accounts WHERE bucket = 'AVAILABLE' AND user_id = ?").bind(a.id).first<number>('balance');
    expect(bal).toBe(TOKENS(100) + 5);
  });

  it('only admins with finance.integrity may run it', async () => {
    const h = await createHarness();
    const support = await h.admin('SUPPORT_ADMIN', 'support');
    expect((await h.call('POST', '/api/admin/ledger/integrity', { token: support.token })).status).toBe(403);
  });
});
