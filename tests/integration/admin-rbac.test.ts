import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_ROLES, ROLE_PERMISSIONS } from '@arena/shared';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

describe('admin authorization (server-side RBAC)', () => {
  let h: Harness;
  let root: TestPlayer;
  let alice: TestPlayer;
  beforeEach(async () => {
    h = await createHarness();
    root = await h.admin('SUPER_ADMIN', 'root');
    alice = await h.player('alice');
  });

  it('a normal player cannot reach any admin API', async () => {
    for (const [m, p] of [
      ['GET', '/api/admin/dashboard'],
      ['GET', '/api/admin/players'],
      ['POST', '/api/admin/tokens/distribute'],
      ['PATCH', '/api/admin/settings'],
      ['POST', '/api/admin/treasury/issue'],
    ] as const) {
      const r = await h.call(m, p, { token: alice.token, body: m === 'GET' ? undefined : {} });
      expect(r.status, `${m} ${p}`).toBe(403);
    }
    const denied = await h.db.prepare("SELECT COUNT(*) AS n FROM login_security_events WHERE event_type = 'ADMIN_ACCESS_DENIED'").first<number>('n');
    expect(denied).toBeGreaterThan(0);
  });

  it('database role permissions match the shared matrix', async () => {
    for (const role of ADMIN_ROLES) {
      const rows = await h.db.prepare('SELECT permission FROM admin_permissions WHERE role_id = ? ORDER BY permission').bind(role).all<{ permission: string }>();
      expect(rows.results.map((r) => r.permission)).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });

  it('SUPPORT_ADMIN can view players but cannot move tokens', async () => {
    const support = await h.admin('SUPPORT_ADMIN', 'support');
    expect((await h.call('GET', '/api/admin/players', { token: support.token })).status).toBe(200);
    const grant = await h.call('POST', '/api/admin/tokens/distribute', {
      token: support.token,
      body: { playerNumber: alice.playerNumber, amountUnits: 100, type: 'MANUAL_GRANT', reason: 'nope' },
    });
    expect(grant.status).toBe(403);
    expect((await h.call('POST', '/api/admin/buy-requests/x/approve', { token: support.token })).status).toBe(403);
  });

  it('FINANCE_ADMIN cannot change settings or administrators; GAME_ADMIN cannot see finance', async () => {
    const fin = await h.admin('FINANCE_ADMIN', 'finance');
    expect((await h.call('PATCH', '/api/admin/settings', { token: fin.token, body: { changes: { MATCH_FEE_BPS: 0 }, reason: 'try' } })).status).toBe(403);
    expect((await h.call('POST', '/api/admin/admins', { token: fin.token, body: { playerNumber: fin.playerNumber, role: 'SUPER_ADMIN', reason: 'escalate' } })).status).toBe(403);
    const game = await h.admin('GAME_ADMIN', 'games');
    expect((await h.call('GET', '/api/admin/buy-requests', { token: game.token })).status).toBe(403);
    expect((await h.call('GET', '/api/admin/disputes', { token: game.token })).status).toBe(200);
  });

  it('settings changes are validated and audited; unsafe exchange rates are refused in production', async () => {
    const r = await h.call('PATCH', '/api/admin/settings', { token: root.token, body: { changes: { BUY_TOKENS_PER_BDT: 115, MATCH_FEE_BPS: 150 }, reason: 'quarterly review' } });
    expect(r.status).toBe(200);
    const actions = await h.db.prepare("SELECT action FROM audit_logs WHERE action LIKE 'settings.%' ORDER BY action").all<{ action: string }>();
    expect(actions.results.map((a) => a.action)).toEqual(['settings.exchange_rate_change', 'settings.match_fee_change', 'settings.update']);
    const bad = await h.call('PATCH', '/api/admin/settings', { token: root.token, body: { changes: { MATCH_FEE_BPS: 1.5 }, reason: 'x y z' } });
    expect(bad.status).toBe(400);

    const prod = await createHarness({ environment: 'production' });
    const prodRoot = await prod.admin('SUPER_ADMIN', 'prodroot');
    const unsafe = await prod.call('PATCH', '/api/admin/settings', { token: prodRoot.token, body: { changes: { SELL_TOKENS_PER_BDT: 100 }, reason: 'mistake' } });
    expect(unsafe.status).toBe(422);
    expect(unsafe.body.error?.code).toBe('UNSAFE_CONFIGURATION');
    const equal = await prod.call('PATCH', '/api/admin/settings', { token: prodRoot.token, body: { changes: { SELL_TOKENS_PER_BDT: 110 }, reason: 'mistake' } });
    expect(equal.body.error?.code).toBe('UNSAFE_CONFIGURATION');

    const dev = await h.call('PATCH', '/api/admin/settings', { token: root.token, body: { changes: { SELL_TOKENS_PER_BDT: 100 }, reason: 'dev testing only' } });
    expect(dev.status).toBe(200);
    expect(dev.body.data.warnings.length).toBeGreaterThan(0);
  });

  it('in production the admin panel requires a verified email', async () => {
    const prod = await createHarness({ environment: 'production' });
    const p = await prod.admin('SUPER_ADMIN', 'unverified');
    const unverified = await prod.token(p.uid, { emailVerified: false });
    expect((await prod.call('GET', '/api/admin/dashboard', { token: unverified })).body.error?.code).toBe('EMAIL_NOT_VERIFIED');
    expect((await prod.call('GET', '/api/admin/dashboard', { token: p.token })).status).toBe(200);
  });

  it('suspension needs a reason, is audited, notifies the player and blocks transactions', async () => {
    expect((await h.call('POST', `/api/admin/players/${alice.playerNumber}/status`, { token: root.token, body: { status: 'SUSPENDED' } })).status).toBe(400);
    const r = await h.call('POST', `/api/admin/players/${alice.playerNumber}/status`, { token: root.token, body: { status: 'SUSPENDED', reason: 'Chargeback investigation' } });
    expect(r.body.data.accountStatus).toBe('SUSPENDED');
    const audit = await h.db.prepare("SELECT reason FROM audit_logs WHERE action = 'player.status.suspended'").first<string>('reason');
    expect(audit).toBe('Chargeback investigation');
    await h.enableGame();
    const m = await h.call('POST', '/api/matches', { token: alice.token, body: { gameId: 'game-06', stakeUnits: TOKENS(10) } });
    expect(m.body.error?.code).toBe('ACCOUNT_SUSPENDED');
    const notes = await h.call('GET', '/api/notifications', { token: alice.token });
    expect(notes.body.data.items.some((n: { type: string }) => n.type === 'ACCOUNT_STATUS')).toBe(true);
  });

  it('administrators: assign roles, never demote the last Super Admin, never edit yourself', async () => {
    const assign = await h.call('POST', '/api/admin/admins', { token: root.token, body: { playerNumber: alice.playerNumber, role: 'FINANCE_ADMIN', reason: 'New finance hire' } });
    expect(assign.status).toBe(201);
    const self = await h.call('PATCH', `/api/admin/admins/${root.id}`, { token: root.token, body: { role: 'SUPPORT_ADMIN', reason: 'oops' } });
    expect(self.status).toBe(403);
    const audit = await h.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'admin.role_assign'").first<number>('n');
    expect(audit).toBe(1);
  });

  it('audit logs are append-only', async () => {
    await h.call('POST', `/api/admin/players/${alice.playerNumber}/notes`, { token: root.token, body: { note: 'Called the player' } });
    await expect(h.db.prepare('DELETE FROM audit_logs').run()).rejects.toThrow(/APPEND_ONLY/);
    await expect(h.db.prepare("UPDATE audit_logs SET reason = 'x'").run()).rejects.toThrow(/APPEND_ONLY/);
  });

  it('rate limits sensitive actions with HTTP 429', async () => {
    const limited = await createHarness();
    limited.env.RATE_LIMIT_OVERRIDES = JSON.stringify({ buy_create: { limit: 2, windowSec: 60 } });
    const p = await limited.player('spammer');
    const send = (i: number) =>
      limited.call('POST', '/api/wallet/buy-requests', {
        token: p.token,
        body: { amountPoisha: 10_000, paymentMethod: 'BKASH_MANUAL', senderNumber: '01712345689', paymentReference: `SPAMREF${i}0` },
      });
    expect((await send(1)).status).toBe(201);
    expect((await send(2)).status).toBe(201);
    const third = await send(3);
    expect(third.status).toBe(429);
    expect(third.body.error?.code).toBe('RATE_LIMITED');
  });
});
