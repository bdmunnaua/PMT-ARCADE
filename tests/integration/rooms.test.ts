import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

/** Private rooms: the host can start with whoever joined, or fill missing seats with bots. */
describe('private rooms', () => {
  let h: Harness;
  let admin: TestPlayer;
  let host: TestPlayer;
  let friend: TestPlayer;

  beforeEach(async () => {
    h = await createHarness();
    admin = await h.admin('SUPER_ADMIN', 'root');
    host = await h.player('rahim');
    friend = await h.player('karim');
    await h.issue(admin, TOKENS(1_000_000));
    for (const p of [host, friend]) await h.fund(admin, p, TOKENS(5_000));
    for (const g of ['game-01', 'game-02', 'game-03']) await h.enableGame(g);
    await h.call('POST', '/api/admin/house-bankroll/transfer', { token: admin.token, body: { direction: 'TO_BANKROLL', amountUnits: TOKENS(50_000), reason: 'bots' }, headers: { 'idempotency-key': `br-${crypto.randomUUID()}` } });
  });

  const room = async (gameId: string, maxPlayers = 4) => {
    const r = await h.call('POST', '/api/matches', { token: host.token, body: { gameId, stakeUnits: TOKENS(10), visibility: 'PRIVATE', maxPlayers }, headers: { 'idempotency-key': `room-${crypto.randomUUID()}` } });
    expect(r.status).toBe(201);
    return r.body.data.match as { id: string; joinCode: string };
  };

  it('Ludo duo: the host starts with the two people who are there, no bots', async () => {
    const m = await room('game-01', 4);
    expect((await h.call('POST', `/api/matches/${m.id}/start`, { token: host.token })).body.error?.code).toBe('VALIDATION_ERROR'); // alone
    await h.call('POST', '/api/matches/join-by-code', { token: friend.token, body: { code: m.joinCode } });
    expect((await h.call('POST', `/api/matches/${m.id}/start`, { token: friend.token })).body.error?.code).toBe('FORBIDDEN'); // not the host
    const started = await h.call('POST', `/api/matches/${m.id}/start`, { token: host.token });
    expect(started.status).toBe(200);
    expect(started.body.data).toMatchObject({ status: 'READY', playerCount: 2, maxPlayers: 2 });
    expect(started.body.data.players.some((p: { displayName: string }) => p.displayName.includes('(Bot)'))).toBe(false);
  });

  it.each([
    ['Call Bridge', 'game-02'],
    ['29', 'game-03'],
  ])('%s: two friends fill the two missing seats with bots', async (_name, gameId) => {
    const m = await room(gameId);
    await h.call('POST', '/api/matches/join-by-code', { token: friend.token, body: { code: m.joinCode } });
    const r = await h.call('POST', `/api/matches/${m.id}/bots`, { token: host.token });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'READY', playerCount: 4 });
    expect(r.body.data.players.filter((p: { displayName: string }) => p.displayName.includes('(Bot)'))).toHaveLength(2);
    expect((await h.integrity()).status).toBe('PASS');
  });
});
