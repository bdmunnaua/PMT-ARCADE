import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

/** Player messages to the team, and creator rewards for original posts. */
describe('messages and creator rewards', () => {
  let h: Harness;
  let admin: TestPlayer;
  let alice: TestPlayer;

  const fundPool = async (units: number) => {
    await h.issue(admin, units);
    await h.call('POST', '/api/admin/rewards-pool/transfer', { token: admin.token, body: { direction: 'TO_POOL', amountUnits: units, reason: 'campaign' }, headers: { 'idempotency-key': `pool-${crypto.randomUUID()}` } });
  };
  /** finishes one free game, which unlocks the creator form */
  const playOnce = async (p: TestPlayer) => {
    const s = await h.call('POST', '/api/arcade/runs/start', { token: p.token, body: { game: 'neon-rush' } });
    h.clock.offset += 60_000;
    await h.call('POST', '/api/arcade/runs/finish', { token: p.token, body: { runId: s.body.data.runId, score: 400 } });
  };
  const submit = (p: TestPlayer, postUrl = 'https://www.facebook.com/reel/123', socialHandle = '@alice.games', platform = 'FACEBOOK') =>
    h.call('POST', '/api/me/creator', { token: p.token, body: { platform, postUrl, socialHandle } });

  beforeEach(async () => {
    h = await createHarness();
    admin = await h.admin('SUPER_ADMIN', 'root');
    alice = await h.player('alice');
    await fundPool(TOKENS(1_000_000));
  });

  it('a player sends advice; admins see the sender and reply; the player sees the reply', async () => {
    const sent = await h.call('POST', '/api/me/messages', { token: alice.token, body: { category: 'ADVICE', body: 'Please add a Carrom tournament!' } });
    expect(sent.status).toBe(201);
    expect((await h.call('POST', '/api/me/messages', { token: alice.token, body: { category: 'ADVICE', body: 'hi' } })).status).toBe(400);
    expect((await h.call('GET', '/api/admin/messages', { token: alice.token })).status).toBe(403);
    const list = (await h.call('GET', '/api/admin/messages', { token: admin.token })).body.data;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ category: 'ADVICE', status: 'NEW', sender: { username: 'alice' } });
    expect(list.counts.NEW).toBe(1);
    const reply = await h.call('POST', `/api/admin/messages/${sent.body.data.id}/reply`, { token: admin.token, body: { reply: 'Great idea, coming soon.' } });
    expect(reply.status).toBe(200);
    const mine = (await h.call('GET', '/api/me/messages', { token: alice.token })).body.data;
    expect(mine[0]).toMatchObject({ status: 'REPLIED', adminReply: 'Great idea, coming soon.' });
    expect(mine[0].sender).toBeUndefined();
  });

  it('creators must play first; one post per account and per social account; admin approval pays bonus PMT once', async () => {
    expect((await h.call('GET', '/api/creator/info')).body.data).toMatchObject({ enabled: true, rewardTokens: 100_000, maxCreators: 1_000, remaining: 1_000 });
    expect((await submit(alice)).body.error?.code).toBe('VALIDATION_ERROR'); // has not played
    await playOnce(alice);
    expect((await h.call('GET', '/api/me/creator', { token: alice.token })).body.data.eligible).toBe(true);
    expect((await submit(alice, 'https://evil.example.com/post')).body.error?.code).toBe('VALIDATION_ERROR'); // not a facebook link
    const ok = await submit(alice);
    expect(ok.status).toBe(201);
    expect((await submit(alice, 'https://www.facebook.com/reel/999')).body.error?.code).toBe('CONFLICT'); // one per account

    const bob = await h.player('bob');
    await playOnce(bob);
    expect((await submit(bob, 'https://www.facebook.com/reel/555', 'ALICE.GAMES')).body.error?.code).toBe('CONFLICT'); // same social account
    expect((await submit(bob, 'https://www.facebook.com/reel/123', '@bob')).body.error?.code).toBe('CONFLICT'); // same post

    const before = await h.wallet(alice.token);
    const listed = (await h.call('GET', '/api/admin/creators?status=PENDING', { token: admin.token })).body.data;
    expect(listed.items[0]).toMatchObject({ socialHandle: 'alice.games', sender: { username: 'alice' }, risk: { gamesPlayed: 1 } });
    const approved = await h.call('POST', `/api/admin/creators/${ok.body.data.id}/approve`, { token: admin.token, body: {} });
    expect(approved.status).toBe(200);
    const after = await h.wallet(alice.token);
    expect(after.bonusUnits - before.bonusUnits).toBe(TOKENS(100_000)); // bonus, not sellable
    expect(after.availableUnits).toBe(before.availableUnits);
    expect((await h.call('POST', `/api/admin/creators/${ok.body.data.id}/approve`, { token: admin.token, body: {} })).body.error?.code).toBe('INVALID_STATE_TRANSITION');
    expect((await h.call('GET', '/api/creator/info')).body.data).toMatchObject({ approved: 1, remaining: 999 });
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('rejects with a reason, and stops at the creator limit', async () => {
    await h.db.exec("INSERT OR REPLACE INTO platform_settings (key, value, updated_at, updated_by) VALUES ('creator_reward_max', '1', 0, NULL)");
    await playOnce(alice);
    const a = await submit(alice);
    const bob = await h.player('bob');
    await playOnce(bob);
    const b = await submit(bob, 'https://www.instagram.com/p/abc', '@bob', 'INSTAGRAM');
    expect((await h.call('POST', `/api/admin/creators/${a.body.data.id}/reject`, { token: admin.token, body: { note: 'Copied content' } })).body.data).toMatchObject({ status: 'REJECTED', reviewNote: 'Copied content' });
    expect((await h.call('POST', `/api/admin/creators/${b.body.data.id}/approve`, { token: admin.token, body: {} })).status).toBe(200);
    const carol = await h.player('carol');
    await playOnce(carol);
    expect((await submit(carol, 'https://www.tiktok.com/@c/video/1', '@carol', 'TIKTOK')).body.error?.code).toBe('GAME_UNAVAILABLE'); // campaign full
  });
});
