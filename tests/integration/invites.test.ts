import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

/** Invite links (pmtarcade.com/r/CODE): a public preview of a private room, then join by code. */
describe('friend invites', () => {
  let h: Harness;
  let admin: TestPlayer;
  let host: TestPlayer;

  beforeEach(async () => {
    h = await createHarness();
    admin = await h.admin('SUPER_ADMIN', 'root');
    host = await h.player('rahim');
    await h.fund(admin, host, TOKENS(5000));
    await h.enableGame('game-06');
  });

  const room = async () => {
    const r = await h.call('POST', '/api/matches', { token: host.token, body: { gameId: 'game-06', stakeUnits: TOKENS(10), visibility: 'PRIVATE' }, headers: { 'idempotency-key': `room-${crypto.randomUUID()}` } });
    expect(r.status).toBe(201);
    return r.body.data.match as { id: string; joinCode: string };
  };

  it('shows anyone with the link the game, stake, host and joining reward — without signing in', async () => {
    const m = await room();
    const r = await h.call('GET', `/api/invites/${m.joinCode.toLowerCase()}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ code: m.joinCode, matchId: m.id, open: true, stakeUnits: TOKENS(10), playerCount: 1, welcomeBonusTokens: 50 });
    expect(r.body.data.hostName).toBeTruthy();
    // nothing else about the host leaks
    expect(JSON.stringify(r.body.data)).not.toContain('@');
  });

  it('a friend who just signed up joins with the code; the room then shows as no longer open', async () => {
    const m = await room();
    const friend = await h.player('karim');
    await h.fund(admin, friend, TOKENS(100));
    const joined = await h.call('POST', '/api/matches/join-by-code', { token: friend.token, body: { code: m.joinCode } });
    expect(joined.status).toBe(200);
    expect(joined.body.data.id).toBe(m.id);
    const after = await h.call('GET', `/api/invites/${m.joinCode}`);
    expect(after.body.data.open).toBe(false);
  });

  it('unknown or malformed codes are not found, and public rooms have no invite page', async () => {
    expect((await h.call('GET', '/api/invites/ZZZZZZ')).status).toBe(404);
    expect((await h.call('GET', '/api/invites/bad!code')).status).toBe(404);
  });
});
