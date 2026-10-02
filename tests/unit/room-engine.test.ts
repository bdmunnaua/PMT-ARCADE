import { describe, expect, it } from 'vitest';
import type { GamePlayerInfo } from '@arena/shared';
import { RoomEngine } from '../../apps/api/src/games/room-engine';
import { rockPaperScissorsModule as rps } from '../../apps/api/src/games/reference/rock-paper-scissors';

const players: GamePlayerInfo[] = [
  { userId: 'u1', playerNumber: 100001, username: 'alice', displayName: 'Alice', seat: 1 },
  { userId: 'u2', playerNumber: 100002, username: 'bob', displayName: 'Bob', seat: 2 },
];
const init = { matchId: 'm1', gameId: 'game-01', stakeUnits: 1000, players };
const rand = () => 0.5;

describe('RoomEngine with the reference module', () => {
  it('starts only when every player is connected, and hides the opponent pick', () => {
    const e = RoomEngine.create(rps, init, 0, rand);
    expect(e.connect('u1', 1).start).toBe(false);
    const fx = e.connect('u2', 2);
    expect(fx.start).toBe(true);
    const pick = e.message('u1', { t: 'move', data: { pick: 'rock' } }, 3);
    const viewForBob = pick.send.find((s) => s.userId === 'u2' && s.message.t === 'state');
    expect(viewForBob?.message).toMatchObject({ t: 'state', view: { yourPick: null, opponentHasPicked: true, picks: null } });
  });

  it('produces a server-validated WIN outcome', () => {
    const e = RoomEngine.create(rps, init, 0, rand);
    e.connect('u1', 1);
    e.connect('u2', 2);
    e.message('u1', { t: 'move', data: { pick: 'rock' } }, 3);
    const fx = e.message('u2', { t: 'move', data: { pick: 'scissors' } }, 4);
    expect(fx.outcome?.outcome).toEqual({ type: 'WIN', winnerUserId: 'u1', reason: 'NORMAL' });
    expect(fx.persist.map((p) => p.type)).toContain('RESULT_VALIDATED');
    expect(e.message('u2', { t: 'move', data: { pick: 'paper' } }, 5).outcome).toBeNull();
  });

  it('forfeit by message → opponent wins', () => {
    const e = RoomEngine.create(rps, init, 0, rand);
    e.connect('u1', 1);
    e.connect('u2', 2);
    const fx = e.message('u2', { t: 'forfeit' }, 3);
    expect(fx.outcome?.outcome).toMatchObject({ type: 'WIN', winnerUserId: 'u1', reason: 'FORFEIT' });
  });

  it('disconnect → reconnect window → policy applies when it expires', () => {
    const e = RoomEngine.create(rps, init, 0, rand);
    e.connect('u1', 1);
    e.connect('u2', 2);
    const d = e.disconnect('u2', 1000);
    expect(d.alarmAt).toBe(1000 + rps.disconnectPolicy.reconnectWindowMs);
    expect(d.persist[0]?.type).toBe('PLAYER_DISCONNECTED');
    expect(e.alarm(2000).outcome).toBeNull(); // too early
    const fx = e.alarm(1000 + rps.disconnectPolicy.reconnectWindowMs);
    expect(fx.outcome?.outcome).toMatchObject({ type: 'WIN', winnerUserId: 'u1', reason: 'FORFEIT' });
  });

  it('reconnecting inside the window resumes the match', () => {
    const e = RoomEngine.create(rps, init, 0, rand);
    e.connect('u1', 1);
    e.connect('u2', 2);
    e.disconnect('u2', 1000);
    const back = e.connect('u2', 5000);
    expect(back.persist.map((p) => p.type)).toContain('PLAYER_RECONNECTED');
    expect(back.alarmAt).toBeNull();
    expect(e.alarm(1_000_000).outcome).toBeNull();
  });

  it('a VOID disconnect policy voids instead of forfeiting', () => {
    const voidModule = { ...rps, disconnectPolicy: { reconnectWindowMs: 10, onTimeout: 'VOID' as const }, validateResult: () => ({ valid: true as const, proof: 'void' }) };
    const e = RoomEngine.create(voidModule, init, 0, rand);
    e.connect('u1', 1);
    e.connect('u2', 2);
    e.disconnect('u1', 100);
    expect(e.alarm(200).outcome?.outcome.type).toBe('VOID');
  });

  it('snapshots restore after hibernation', () => {
    const e = RoomEngine.create(rps, init, 0, rand);
    e.connect('u1', 1);
    e.connect('u2', 2);
    e.message('u1', { t: 'move', data: { pick: 'paper' } }, 3);
    const restored = RoomEngine.restore(rps, JSON.parse(JSON.stringify(e.snapshot)), rand);
    const fx = restored.message('u2', { t: 'move', data: { pick: 'rock' } }, 4);
    expect(fx.outcome?.outcome).toMatchObject({ type: 'WIN', winnerUserId: 'u1' });
  });

  it('rejects strangers', () => {
    const e = RoomEngine.create(rps, init, 0, rand);
    const fx = e.connect('intruder', 1);
    expect(fx.send[0]?.message).toMatchObject({ t: 'error', code: 'FORBIDDEN' });
  });
});
