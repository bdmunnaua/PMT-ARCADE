import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, PROJECT_ID, type Harness } from '../helpers/harness';

describe('automatic profile creation & authentication', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });

  it('creates a profile with permanent player number #100001 and four empty wallet buckets', async () => {
    const a = await h.player('alice');
    expect(a.playerNumber).toBe(100001);
    expect(a.me.accountStatus).toBe('ACTIVE');
    const buckets = await h.db.prepare('SELECT bucket, balance FROM wallet_accounts WHERE user_id = ? ORDER BY bucket').bind(a.id).all<{ bucket: string; balance: number }>();
    expect(buckets.results.map((b) => b.bucket)).toEqual(['AVAILABLE', 'BONUS', 'LOCKED_GAME', 'LOCKED_SELL']);
    expect(buckets.results.every((b) => b.balance === 0)).toBe(true);
    expect(await h.wallet(a.token)).toEqual({ availableUnits: 0, lockedGameUnits: 0, lockedSellUnits: 0, bonusUnits: 0, totalUnits: 0 });
  });

  it('assigns unique sequential numbers and later sessions reuse the profile', async () => {
    const a = await h.player('alice');
    const b = await h.player('bob');
    expect(b.playerNumber).toBe(100002);
    const again = await h.call('POST', '/api/auth/session', { token: a.token });
    expect(again.status).toBe(200);
    expect(again.body.data.playerNumber).toBe(100001);
    expect(again.body.data.username).toBe('alice');
    const count = await h.db.prepare('SELECT COUNT(*) AS n FROM player_profiles').first<number>('n');
    expect(count).toBe(2);
  });

  it('has no registration endpoint (sign-in belongs to the host project)', async () => {
    const t = await h.token('uid-x');
    expect((await h.call('POST', '/api/auth/register', { token: t, body: { username: 'x_user', displayName: 'x' } })).status).toBe(404);
  });

  it('derives the username from the identity and uses the provider name as display name', async () => {
    const t = await h.token('uid-rahim', { email: 'Rahim.Uddin+games@gmail.example', name: 'Rahim Uddin' });
    const r = await h.call('POST', '/api/auth/session', { token: t });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ username: 'rahim_uddin_games', displayName: 'Rahim Uddin' });
    const noEmail = await h.token('uid-anon', { email: null });
    expect((await h.call('POST', '/api/auth/session', { token: noEmail })).body.data.username).toBe('player');
  });

  it('player numbers can never change or be reused', async () => {
    const a = await h.player('alice');
    await expect(h.db.prepare('UPDATE player_profiles SET player_number = 999999 WHERE user_id = ?').bind(a.id).run()).rejects.toThrow(/PLAYER_NUMBER_IMMUTABLE/);
    await expect(h.db.prepare('DELETE FROM player_profiles WHERE user_id = ?').bind(a.id).run()).rejects.toThrow(/DELETE_FORBIDDEN/);
  });

  it('makes a colliding username unique (case-insensitive) instead of failing', async () => {
    await h.player('alice');
    const t = await h.token('uid-other', { email: 'ALICE@other.example' });
    const r = await h.call('POST', '/api/auth/session', { token: t });
    expect(r.status).toBe(201);
    expect(r.body.data.username).toMatch(/^alice_\d{4}$/);
    expect(r.body.data.playerNumber).toBe(100002);
  });

  it('refuses a banned account at session start and records the attempt', async () => {
    const a = await h.player('alice');
    await h.db.prepare("UPDATE users SET account_status = 'BANNED' WHERE id = ?").bind(a.id).run();
    const r = await h.call('POST', '/api/auth/session', { token: a.token });
    expect(r.body.error?.code).toBe('ACCOUNT_BANNED');
    const ev = await h.db.prepare("SELECT COUNT(*) AS n FROM login_security_events WHERE user_id = ? AND event_type = 'BLOCKED_STATUS'").bind(a.id).first<number>('n');
    expect(ev).toBe(1);
  });

  it('accepts dev identities only in development with DEV_AUTH=true', async () => {
    const dev = await createHarness({ environment: 'development', devAuth: true });
    const ok = await dev.call('POST', '/api/auth/session', { token: 'dev.alice' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.username).toBe('alice');
    expect((await dev.call('GET', '/api/me', { token: 'dev.A!' })).body.error?.code).toBe('INVALID_TOKEN');
    for (const o of [{ environment: 'development' }, { environment: 'production', devAuth: true }, { environment: 'test', devAuth: true }]) {
      const other = await createHarness(o);
      expect((await other.call('POST', '/api/auth/session', { token: 'dev.alice' })).body.error?.code).toBe('INVALID_TOKEN');
    }
  });

  it('requires a valid Firebase token (signature, audience, issuer, expiry)', async () => {
    expect((await h.call('GET', '/api/me')).status).toBe(401);
    expect((await h.call('GET', '/api/me', { token: 'not-a-jwt' })).body.error?.code).toBe('INVALID_TOKEN');
    const wrongAud = await h.token('uid-x', { audience: 'other-project' });
    expect((await h.call('GET', '/api/me', { token: wrongAud })).status).toBe(401);
    const wrongIss = await h.token('uid-x', { issuer: 'https://evil.example' });
    expect((await h.call('GET', '/api/me', { token: wrongIss })).status).toBe(401);
    const expired = await h.token('uid-x', { expiresIn: '-10m' });
    expect((await h.call('GET', '/api/me', { token: expired })).status).toBe(401);
    expect(PROJECT_ID).toBeTruthy();
  });

  it('asks for a session first when the user has no profile yet', async () => {
    const t = await h.token('uid-new');
    const r = await h.call('GET', '/api/me', { token: t });
    expect(r.status).toBe(404);
    expect(r.body.error?.code).toBe('PROFILE_REQUIRED');
  });

  it('records a login security event on session start', async () => {
    const a = await h.player('alice');
    const r = await h.call('POST', '/api/auth/session', { token: a.token });
    expect(r.status).toBe(200);
    const events = await h.db.prepare('SELECT event_type FROM login_security_events WHERE user_id = ?').bind(a.id).all<{ event_type: string }>();
    expect(events.results.map((e) => e.event_type).sort()).toEqual(['LOGIN', 'REGISTER']);
  });

  it('responds with the standard envelope and a request id', async () => {
    const r = await h.call('GET', '/api/health');
    expect(r.body.success).toBe(true);
    expect(typeof r.body.requestId).toBe('string');
    const bad = await h.call('GET', '/api/nope');
    expect(bad.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });
});
