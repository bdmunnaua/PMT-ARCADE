import { beforeEach, describe, expect, it } from 'vitest';
import { ludoModule } from '../../packages/games/src/ludo/module';
import { autoToken } from '../../packages/games/src/ludo/rules';
import { createHarness, TOKENS, type Harness, type TestPlayer } from '../helpers/harness';

/** 🤖 Bots fill empty seats; their stakes are bonus PMT from the house bankroll. */
describe('bots in stake games', () => {
  let h: Harness;
  let admin: TestPlayer;
  let host: TestPlayer;

  beforeEach(async () => {
    h = await createHarness();
    admin = await h.admin('SUPER_ADMIN', 'root');
    host = await h.player('rahim');
    await h.issue(admin, TOKENS(1_000_000));
    await h.fund(admin, host, TOKENS(5_000));
    await h.enableGame('game-01'); // Ludo
    await h.enableGame('game-06');
  });

  const bankroll = (units: number) =>
    h.call('POST', '/api/admin/house-bankroll/transfer', { token: admin.token, body: { direction: 'TO_BANKROLL', amountUnits: units, reason: 'bots' }, headers: { 'idempotency-key': `br-${crypto.randomUUID()}` } });
  const room = async (gameId = 'game-01', stake = TOKENS(10), maxPlayers = 4) => {
    const r = await h.call('POST', '/api/matches', { token: host.token, body: { gameId, stakeUnits: stake, visibility: 'PRIVATE', maxPlayers }, headers: { 'idempotency-key': `room-${crypto.randomUUID()}` } });
    expect(r.status).toBe(201);
    return r.body.data.match as { id: string };
  };
  const fill = (id: string, who = host) => h.call('POST', `/api/matches/${id}/bots`, { token: who.token });

  it('the host fills a Ludo room with bots; the room becomes ready and bots stake bonus PMT from the bankroll', async () => {
    expect((await bankroll(TOKENS(10_000))).status).toBe(200);
    const m = await room();
    const r = await fill(m.id);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'READY', playerCount: 4 });
    const names = r.body.data.players.map((p: { displayName: string }) => p.displayName);
    expect(names.filter((n: string) => n.includes('🤖') && n.includes('(Bot)'))).toHaveLength(3);
    const stakes = await h.db.prepare("SELECT mp.stake_bonus_units AS b, mp.stake_available_units AS a FROM match_players mp JOIN users u ON u.id = mp.user_id WHERE mp.match_id = ? AND u.firebase_uid LIKE 'bot:%'").bind(m.id).all<{ b: number; a: number }>();
    expect(stakes.results).toHaveLength(3);
    for (const s of stakes.results) expect(s).toEqual({ b: TOKENS(10), a: 0 }); // bonus only
    // each bot was topped up with 5 stakes from the bankroll
    expect(await h.db.prepare("SELECT balance FROM wallet_accounts WHERE id = 'sys_house_bankroll'").first<number>('balance')).toBe(TOKENS(10_000 - 3 * 50));
    expect((await h.integrity()).status).toBe('PASS');
  });

  it('only the host, only while waiting — and not without a bankroll', async () => {
    const m = await room();
    expect((await fill(m.id)).body.error?.code).toBe('GAME_UNAVAILABLE'); // bankroll empty
    await bankroll(TOKENS(10_000));
    const friend = await h.player('karim');
    expect((await fill(m.id, friend)).body.error?.code).toBe('FORBIDDEN');
    // chess has a 🤖 bot too now
    const chess = await room('game-06', TOKENS(10), 2);
    expect((await fill(chess.id)).status).toBe(200);
    expect((await fill(m.id)).status).toBe(200);
    expect((await fill(m.id)).body.error?.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('bots pause when the daily loss limit would be exceeded, and can be switched off', async () => {
    await bankroll(TOKENS(100_000));
    const set = (k: string, v: string) => h.db.exec(`INSERT OR REPLACE INTO platform_settings (key, value, updated_at, updated_by) VALUES ('${k}', '${v}', 0, NULL)`);
    await set('bot_daily_loss_limit_tokens', '20');
    const m = await room(); // 3 bot seats × 10 PMT = 30 PMT worst case > 20
    expect((await fill(m.id)).body.error?.code).toBe('GAME_UNAVAILABLE');
    await set('bot_daily_loss_limit_tokens', '1000');
    await set('bots_enabled', 'false');
    expect((await fill(m.id)).body.error?.code).toBe('GAME_UNAVAILABLE');
  });
});

describe('Ludo bot play', () => {
  it('bots take their own turns with the server dice until the game ends', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const players = [
      { userId: 'human', playerNumber: 1, username: 'h', displayName: 'H', seat: 0 },
      { userId: 'bot1', playerNumber: 2, username: 'b1', displayName: '🤖 B1 (Bot)', seat: 1, isBot: true },
      { userId: 'bot2', playerNumber: 3, username: 'b2', displayName: '🤖 B2 (Bot)', seat: 2, isBot: true },
    ];
    let now = 0;
    const ctx = () => ({ matchId: 'm', gameId: 'g', stakeUnits: 1000, players, now, random });
    let r = ludoModule.startMatch(ludoModule.createRoom(ctx()), ctx());
    expect(r.state.bots).toEqual([false, true, true]);
    let botTurns = 0;
    for (let step = 0; step < 20_000 && r.state.phase !== 'OVER'; step++) {
      const s = r.state;
      const isBot = s.bots?.[s.turn];
      if (isBot) {
        // a bot turn is scheduled about a second ahead, not after the 12–15 s human timer
        expect(s.deadline! - now).toBeLessThanOrEqual(1_100);
        botTurns++;
        now = s.deadline!;
        r = ludoModule.handleTimeout!(s, ctx());
      } else {
        now += 500;
        r = ludoModule.handleMessage(s, 'human', s.phase === 'ROLL' ? { action: 'roll' } : { action: 'move', token: autoToken(s) }, ctx());
      }
      expect(r.state.timeouts[1]).toBe(0); // bots never collect missed turns
    }
    expect(r.state.phase).toBe('OVER');
    expect(r.outcome?.type).toBe('WIN');
    expect(botTurns).toBeGreaterThan(50);
  });
});

describe('room engine with bots', () => {
  it('starts as soon as the people are connected, and the bot plays its turns on the room timer', async () => {
    const { RoomEngine } = await import('../../apps/api/src/games/room-engine');
    const players = [
      { userId: 'human', playerNumber: 1, username: 'h', displayName: 'H', seat: 0 },
      { userId: 'bot', playerNumber: 2, username: 'b', displayName: '🤖 B (Bot)', seat: 1, isBot: true },
    ];
    let seed = 3;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const engine = RoomEngine.create(ludoModule, { matchId: 'm', gameId: 'g', stakeUnits: 1000, players }, 0, random);
    const fx = engine.connect('human', 0);
    expect(fx.start).toBe(true); // the bot does not need to connect
    // play until the bot has had a turn: human rolls, then the alarm lets the bot act
    let now = 0;
    let botActed = false;
    for (let i = 0; i < 200 && !botActed; i++) {
      const s = engine.snapshot.state as { turn: number; phase: string; dice: number | null; movable: number[]; lastRoll: { player: number } | null };
      if (s.turn === 0) {
        now += 100;
        engine.message('human', { t: 'move', data: s.phase === 'ROLL' ? { action: 'roll' } : { action: 'move', token: s.movable[0] } }, now);
      } else {
        now += 1_200;
        engine.alarm(now);
        botActed = (engine.snapshot.state as { lastRoll: { player: number } | null }).lastRoll?.player === 1;
      }
    }
    expect(botActed).toBe(true);
  });
});
