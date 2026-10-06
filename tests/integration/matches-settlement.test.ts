import { beforeEach, describe, expect, it } from 'vitest';
import { hmacSign } from '../../apps/api/src/lib/crypto';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

describe('matches, escrow and the 1% settlement engine', () => {
  let h: Harness;
  let admin: TestPlayer;
  let a: TestPlayer;
  let b: TestPlayer;

  async function readyMatch(stake = TOKENS(1000)): Promise<string> {
    const created = await h.call('POST', '/api/matches', { token: a.token, body: { gameId: 'game-06', stakeUnits: stake }, headers: { 'idempotency-key': `create-${crypto.randomUUID()}` } });
    expect(created.status).toBe(201);
    const id = created.body.data.match.id as string;
    const joined = await h.call('POST', `/api/matches/${id}/join`, { token: b.token });
    expect(joined.status).toBe(200);
    expect(joined.body.data.status).toBe('READY');
    return id;
  }

  beforeEach(async () => {
    h = await createHarness();
    admin = await h.admin('SUPER_ADMIN', 'root');
    a = await h.player('alice');
    b = await h.player('bob');
    await h.fund(admin, a, TOKENS(5000));
    await h.fund(admin, b, TOKENS(5000));
    await h.enableGame('game-06');
  });

  it('refuses disabled games and stakes outside the allowed range', async () => {
    const off = await h.call('POST', '/api/matches', { token: a.token, body: { gameId: 'game-07', stakeUnits: TOKENS(10) } });
    expect(off.body.error?.code).toBe('GAME_UNAVAILABLE');
    const tiny = await h.call('POST', '/api/matches', { token: a.token, body: { gameId: 'game-06', stakeUnits: 1 } });
    expect(tiny.body.error?.code).toBe('STAKE_OUT_OF_RANGE');
  });

  it('locks the stake AVAILABLE → LOCKED_GAME and rejects stakes above the balance', async () => {
    const r = await h.call('POST', '/api/matches', { token: a.token, body: { gameId: 'game-06', stakeUnits: TOKENS(1000) } });
    expect(r.body.data.match.status).toBe('WAITING_FOR_OPPONENT');
    expect(await h.wallet(a.token)).toMatchObject({ availableUnits: TOKENS(4000), lockedGameUnits: TOKENS(1000), totalUnits: TOKENS(5000) });
    const tooBig = await h.call('POST', '/api/matches', { token: b.token, body: { gameId: 'game-06', stakeUnits: TOKENS(6000) } });
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error?.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('double-clicking "create" with the same Idempotency-Key creates one room', async () => {
    const headers = { 'idempotency-key': 'create-room-once' };
    const body = { gameId: 'game-06', stakeUnits: TOKENS(100) };
    const [r1, r2] = await Promise.all([h.call('POST', '/api/matches', { token: a.token, body, headers }), h.call('POST', '/api/matches', { token: a.token, body, headers })]);
    expect(r1.body.data.match.id).toBe(r2.body.data.match.id);
    expect((await h.wallet(a.token)).lockedGameUnits).toBe(TOKENS(100));
  });

  it('two-player escrow → winner gets 1,980, loser 0, platform fee 20 to PLATFORM_FEES only', async () => {
    const id = await readyMatch();
    expect(await h.wallet(b.token)).toMatchObject({ availableUnits: TOKENS(4000), lockedGameUnits: TOKENS(1000) });
    const treasuryBefore = await h.systemBalance('sys_admin_treasury');
    const s = h.services();
    await s.matches.markPlaying(id, 'GAME_SERVER', null);
    const res = await s.settlement.settleMatch({ matchId: id, outcome: { type: 'WIN', winnerUserId: a.id }, source: 'GAME_SERVER', resultProof: 'test' });
    expect(res).toMatchObject({ status: 'SETTLED', potUnits: TOKENS(2000), feeUnits: TOKENS(20), payoutUnits: TOKENS(1980) });
    expect(await h.wallet(a.token)).toMatchObject({ availableUnits: TOKENS(5980), lockedGameUnits: 0 });
    expect(await h.wallet(b.token)).toMatchObject({ availableUnits: TOKENS(4000), lockedGameUnits: 0, totalUnits: TOKENS(4000) });
    expect(await h.systemBalance('sys_platform_fees')).toBe(TOKENS(20));
    expect(await h.systemBalance('sys_admin_treasury')).toBe(treasuryBefore);

    const m = await h.call('GET', `/api/matches/${id}`, { token: b.token });
    expect(m.body.data).toMatchObject({ status: 'SETTLED', winnerPlayerNumber: a.playerNumber, myResult: 'LOSS', feeUnits: TOKENS(20) });
    const me = await h.call('GET', '/api/me', { token: a.token });
    expect(me.body.data.stats).toMatchObject({ gamesPlayed: 1, wins: 1, winRateBps: 10_000 });
    const hist = await h.call('GET', '/api/me/transactions?category=GAME_LOSS', { token: b.token });
    expect(hist.body.data.items[0]).toMatchObject({ category: 'GAME_LOSS', netUnits: -TOKENS(1000) });
    const win = await h.call('GET', '/api/me/transactions?category=GAME_WIN', { token: a.token });
    expect(win.body.data.items[0]).toMatchObject({ category: 'GAME_WIN', effects: { AVAILABLE: TOKENS(1980), LOCKED_GAME: -TOKENS(1000) } });
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('a match settles exactly once — repeated and concurrent settlement is refused', async () => {
    const id = await readyMatch();
    const s = h.services();
    await s.matches.markPlaying(id, 'GAME_SERVER', null);
    const attempts = await Promise.allSettled([
      s.settlement.settleMatch({ matchId: id, outcome: { type: 'WIN', winnerUserId: a.id }, source: 'GAME_SERVER' }),
      h.services().settlement.settleMatch({ matchId: id, outcome: { type: 'WIN', winnerUserId: b.id }, source: 'GAME_SERVER' }),
      h.services().settlement.settleMatch({ matchId: id, outcome: { type: 'DRAW' }, source: 'GAME_SERVER' }),
    ]);
    expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    await expect(s.settlement.settleMatch({ matchId: id, outcome: { type: 'WIN', winnerUserId: a.id }, source: 'GAME_SERVER' })).rejects.toMatchObject({ code: 'ALREADY_PROCESSED' });
    const txs = await h.db.prepare("SELECT COUNT(*) AS n FROM ledger_transactions WHERE idempotency_key = ?").bind(`match:${id}:resolution`).first<number>('n');
    expect(txs).toBe(1);
    const total = (await h.wallet(a.token)).totalUnits + (await h.wallet(b.token)).totalUnits + (await h.systemBalance('sys_platform_fees'));
    expect(total).toBe(TOKENS(10_000));
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('"play another one": the first ask opens the next room, the second joins it, both see the link', async () => {
    const id = await readyMatch(TOKENS(500));
    const s = h.services();
    expect((await h.call('POST', `/api/matches/${id}/rematch`, { token: a.token })).body.error?.code).toBe('INVALID_STATE_TRANSITION'); // not finished
    await s.settlement.settleMatch({ matchId: id, outcome: { type: 'WIN', winnerUserId: a.id }, source: 'GAME_SERVER', resultProof: 'test' });
    const outsider = await h.player('zed');
    expect((await h.call('POST', `/api/matches/${id}/rematch`, { token: outsider.token })).body.error?.code).toBe('FORBIDDEN');

    const first = await h.call('POST', `/api/matches/${id}/rematch`, { token: b.token });
    expect(first.status).toBe(200);
    const next = first.body.data as { id: string; status: string; stakeUnits: number; maxPlayers: number };
    expect(next).toMatchObject({ status: 'WAITING_FOR_OPPONENT', stakeUnits: TOKENS(500), maxPlayers: 2 });
    // asking again is harmless; the old match now points to the new room
    expect((await h.call('POST', `/api/matches/${id}/rematch`, { token: b.token })).body.data.id).toBe(next.id);
    expect((await h.call('GET', `/api/matches/${id}`, { token: a.token })).body.data.rematchMatchId).toBe(next.id);
    // the other player was told, and joins with one tap
    const note = await h.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'MATCH_REMATCH' AND user_id = ?").bind(a.id).first<number>('n');
    expect(note).toBe(1);
    const second = await h.call('POST', `/api/matches/${id}/rematch`, { token: a.token });
    expect(second.body.data).toMatchObject({ id: next.id, status: 'READY', playerCount: 2 });
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('draw refunds both stakes with no fee', async () => {
    const id = await readyMatch();
    const s = h.services();
    await s.matches.markPlaying(id, 'GAME_SERVER', null);
    const res = await s.settlement.settleMatch({ matchId: id, outcome: { type: 'DRAW' }, source: 'GAME_SERVER' });
    expect(res.status).toBe('DRAW');
    expect(res.feeUnits).toBe(0);
    expect(await h.wallet(a.token)).toMatchObject({ availableUnits: TOKENS(5000), lockedGameUnits: 0 });
    expect(await h.wallet(b.token)).toMatchObject({ availableUnits: TOKENS(5000), lockedGameUnits: 0 });
    expect(await h.systemBalance('sys_platform_fees')).toBe(0);
  });

  it('cancel before start (creator leaves) refunds everyone', async () => {
    const id = await readyMatch();
    const r = await h.call('POST', `/api/matches/${id}/leave`, { token: a.token });
    expect(r.body.data.status).toBe('CANCELLED');
    expect((await h.wallet(a.token)).availableUnits).toBe(TOKENS(5000));
    expect((await h.wallet(b.token)).availableUnits).toBe(TOKENS(5000));
  });

  it('a non-creator leaving a waiting room gets only their own stake back', async () => {
    await h.db.prepare('UPDATE games SET maximum_players = 3 WHERE id = ?').bind('game-06').run();
    const c = await h.player('carol');
    await h.fund(admin, c, TOKENS(100));
    const created = await h.call('POST', '/api/matches', { token: a.token, body: { gameId: 'game-06', stakeUnits: TOKENS(100), maxPlayers: 3 } });
    const id = created.body.data.match.id;
    await h.call('POST', `/api/matches/${id}/join`, { token: c.token });
    const left = await h.call('POST', `/api/matches/${id}/leave`, { token: c.token });
    expect(left.body.data).toMatchObject({ status: 'WAITING_FOR_OPPONENT', playerCount: 1, potUnits: TOKENS(100) });
    expect((await h.wallet(c.token)).availableUnits).toBe(TOKENS(100));
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('server failure (VOID) refunds both players with no fee', async () => {
    const id = await readyMatch();
    const s = h.services();
    await s.matches.markPlaying(id, 'GAME_SERVER', null);
    const res = await s.settlement.settleMatch({ matchId: id, outcome: { type: 'VOID', reason: 'SERVER_FAILURE' }, source: 'GAME_SERVER' });
    expect(res.status).toBe('VOID');
    expect((await h.wallet(a.token)).totalUnits).toBe(TOKENS(5000));
  });

  it('the fee is snapshotted at match creation', async () => {
    const id = await readyMatch();
    await h.call('PATCH', '/api/admin/settings', { token: admin.token, body: { changes: { MATCH_FEE_BPS: 500 }, reason: 'raise fee' } });
    const s = h.services();
    await s.matches.markPlaying(id, 'GAME_SERVER', null);
    const res = await s.settlement.settleMatch({ matchId: id, outcome: { type: 'WIN', winnerUserId: b.id }, source: 'GAME_SERVER' });
    expect(res.feeUnits).toBe(TOKENS(20));
  });

  it('a bonus-funded stake is refunded back to BONUS', async () => {
    await h.issue(admin, TOKENS(300));
    await h.call('POST', '/api/admin/tokens/distribute', {
      token: admin.token,
      body: { playerNumber: a.playerNumber, amountUnits: TOKENS(300), type: 'BONUS', reason: 'bonus' },
      headers: { 'idempotency-key': 'bonus-a-001' },
    });
    const id = await readyMatch();
    expect(await h.wallet(a.token)).toMatchObject({ bonusUnits: 0, availableUnits: TOKENS(4300), lockedGameUnits: TOKENS(1000) });
    await h.call('POST', `/api/matches/${id}/leave`, { token: a.token });
    expect(await h.wallet(a.token)).toMatchObject({ bonusUnits: TOKENS(300), availableUnits: TOKENS(5000), lockedGameUnits: 0 });
  });

  it('players cannot declare a winner — there is no such public endpoint', async () => {
    const id = await readyMatch();
    for (const path of [`/api/matches/${id}/result`, `/api/matches/${id}/winner`, `/api/matches/${id}/settle`, '/api/match/winner']) {
      const r = await h.call('POST', path, { token: a.token, body: { winner: 'me' } });
      expect(r.status).toBe(404);
    }
    expect((await h.call('POST', `/internal/matches/${id}/result`, { token: a.token, body: { outcome: { type: 'WIN', winnerPlayerNumber: a.playerNumber } } })).status).toBe(401);
    expect((await h.wallet(a.token)).lockedGameUnits).toBe(TOKENS(1000));
  });

  it('the signed internal API settles for trusted game servers', async () => {
    const id = await readyMatch();
    const sign = async (path: string, body: string) => {
      const ts = Date.now();
      return { 'x-arena-timestamp': String(ts), 'x-arena-signature': await hmacSign(h.env.INTERNAL_API_SECRET!, `${ts}.POST.${path}.${body}`), 'content-type': 'application/json' };
    };
    const startPath = `/internal/matches/${id}/start`;
    const start = await h.app.request(startPath, { method: 'POST', headers: await sign(startPath, ''), body: '' }, h.env);
    expect(start.status).toBe(200);
    const path = `/internal/matches/${id}/result`;
    const body = JSON.stringify({ outcome: { type: 'WIN', winnerPlayerNumber: b.playerNumber }, resultProof: 'replay-hash' });
    const forged = await h.app.request(path, { method: 'POST', headers: { ...(await sign(path, body)), 'x-arena-signature': 'AAAA' }, body }, h.env);
    expect(forged.status).toBe(401);
    const res = await h.app.request(path, { method: 'POST', headers: await sign(path, body), body }, h.env);
    expect(res.status).toBe(200);
    expect((await h.wallet(b.token)).availableUnits).toBe(TOKENS(5980));
  });

  it('a disputed match is frozen for the game server and resolved by an admin through settlement', async () => {
    const id = await readyMatch();
    const s = h.services();
    await s.matches.markPlaying(id, 'GAME_SERVER', null);
    const d = await h.call('POST', `/api/matches/${id}/disputes`, { token: b.token, body: { category: 'SUSPECTED_CHEATING', description: 'Opponent seemed to know my moves in advance.' } });
    expect(d.status).toBe(201);
    await expect(s.settlement.settleMatch({ matchId: id, outcome: { type: 'WIN', winnerUserId: a.id }, source: 'GAME_SERVER' })).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    const r = await h.call('POST', `/api/admin/disputes/${d.body.data.id}/resolve`, { token: admin.token, body: { resolution: 'VOID_REFUND', note: 'Evidence inconclusive; refunding both.' } });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('RESOLVED');
    expect((await h.wallet(a.token)).totalUnits).toBe(TOKENS(5000));
    expect((await h.wallet(b.token)).totalUnits).toBe(TOKENS(5000));
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('admin can settle a disputed match for a winner, then compensate through the treasury', async () => {
    const id = await readyMatch();
    const s = h.services();
    await s.matches.markPlaying(id, 'GAME_SERVER', null);
    const d1 = await h.call('POST', `/api/matches/${id}/disputes`, { token: a.token, body: { category: 'INCORRECT_RESULT', description: 'The game froze while I was clearly winning.' } });
    const d2 = await h.call('POST', `/api/matches/${id}/disputes`, { token: b.token, body: { category: 'CONNECTION_PROBLEM', description: 'My connection dropped during the final round.' } });
    expect(d2.status).toBe(201);
    const wrong = await h.call('POST', `/api/admin/disputes/${d1.body.data.id}/resolve`, { token: admin.token, body: { resolution: 'REJECT', note: 'not allowed while frozen' } });
    expect(wrong.body.error?.code).toBe('INVALID_STATE_TRANSITION');
    const settled = await h.call('POST', `/api/admin/disputes/${d1.body.data.id}/resolve`, { token: admin.token, body: { resolution: 'SETTLE_WINNER', winnerPlayerNumber: a.playerNumber, note: 'Replay shows Alice won.' } });
    expect(settled.status).toBe(200);
    expect((await h.wallet(a.token)).availableUnits).toBe(TOKENS(5980));
    expect(await h.systemBalance('sys_platform_fees')).toBe(TOKENS(20));
    await h.issue(admin, TOKENS(100));
    const comp = await h.call('POST', `/api/admin/disputes/${d2.body.data.id}/resolve`, {
      token: admin.token,
      body: { resolution: 'COMPENSATE', compensationPlayerNumber: b.playerNumber, compensationUnits: TOKENS(50), note: 'Goodwill for the disconnect.' },
    });
    expect(comp.status).toBe(200);
    expect((await h.wallet(b.token)).availableUnits).toBe(TOKENS(4050));
    const again = await h.call('POST', `/api/admin/disputes/${d2.body.data.id}/resolve`, { token: admin.token, body: { resolution: 'COMPENSATE', compensationPlayerNumber: b.playerNumber, compensationUnits: TOKENS(50), note: 'double click' } });
    expect(again.body.error?.code).toBe('ALREADY_PROCESSED');
    expect((await h.wallet(b.token)).availableUnits).toBe(TOKENS(4050));
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('quick match pairs two players into one READY room; private rooms join by code', async () => {
    const q1 = await h.call('POST', '/api/matches/quick', { token: a.token, body: { gameId: 'game-06', stakeUnits: TOKENS(50) } });
    expect(q1.body.data.joined).toBe(false);
    const q2 = await h.call('POST', '/api/matches/quick', { token: b.token, body: { gameId: 'game-06', stakeUnits: TOKENS(50) } });
    expect(q2.body.data.joined).toBe(true);
    expect(q2.body.data.match.id).toBe(q1.body.data.match.id);
    expect(q2.body.data.match.status).toBe('READY');

    const priv = await h.call('POST', '/api/matches', { token: a.token, body: { gameId: 'game-06', stakeUnits: TOKENS(10), visibility: 'PRIVATE' } });
    const code = priv.body.data.match.joinCode as string;
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    const asOther = await h.call('GET', `/api/matches/${priv.body.data.match.id}`, { token: b.token });
    expect(asOther.body.data.joinCode).toBeNull();
    const joined = await h.call('POST', '/api/matches/join-by-code', { token: b.token, body: { code } });
    expect(joined.body.data.status).toBe('READY');
  });

  it('the development simulator works outside production and settles through the same service', async () => {
    const created = await h.call('POST', '/api/dev/matches', { token: admin.token, body: { gameId: 'game-08', stakeUnits: TOKENS(100), playerNumbers: [a.playerNumber, b.playerNumber] } });
    expect(created.status).toBe(201);
    const sim = await h.call('POST', `/api/dev/matches/${created.body.data.id}/simulate`, { token: admin.token, body: { outcome: 'FORFEIT', forfeitPlayerNumber: a.playerNumber } });
    expect(sim.status).toBe(200);
    expect(sim.body.data.result).toMatchObject({ status: 'SETTLED', feeUnits: 200, payoutUnits: TOKENS(198) });
    expect((await h.wallet(b.token)).availableUnits).toBe(TOKENS(5098));
  });

  it('the development simulator does not exist in production', async () => {
    const prod = await createHarness({ environment: 'production' });
    const root = await prod.admin('SUPER_ADMIN', 'prodroot');
    const r = await prod.call('POST', '/api/dev/matches', { token: root.token, body: { gameId: 'game-06', stakeUnits: 100, playerNumbers: [1, 2] } });
    expect(r.status).toBe(404);
  });

  it('cron expires rooms that waited too long and refunds the stake', async () => {
    await h.call('POST', '/api/matches', { token: a.token, body: { gameId: 'game-06', stakeUnits: TOKENS(100) } });
    const res = await h.services().matches.expireStale(Date.now() + 31 * 60 * 1000);
    expect(res.cancelled).toBe(1);
    expect((await h.wallet(a.token)).availableUnits).toBe(TOKENS(5000));
  });
});
