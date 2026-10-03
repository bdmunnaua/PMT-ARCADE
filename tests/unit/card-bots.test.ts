import { describe, expect, it } from 'vitest';
import type { GameModule, GamePlayerInfo, ModuleResult } from '@arena/shared';
import { callBridgeModule } from '../../packages/games/src/call-bridge/module';
import { twentyNineModule } from '../../packages/games/src/twenty-nine/module';

/** One person and three 🤖 bots play a whole card game; the person is auto-played by the timer. */
function playThrough<S extends { phase: string; deadline: number | null; turn: number; bots?: boolean[]; timeouts: number[] }>(module: GameModule<S>) {
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const players: GamePlayerInfo[] = [0, 1, 2, 3].map((i) => ({ userId: `u${i}`, playerNumber: i + 1, username: `u${i}`, displayName: i === 0 ? 'Person' : `🤖 B${i} (Bot)`, seat: i, isBot: i > 0 }));
  let now = 0;
  const ctx = () => ({ matchId: 'm', gameId: 'g', stakeUnits: 1000, players, now, random });
  let r: ModuleResult<S> = module.startMatch(module.createRoom(ctx()), ctx());
  expect(r.state.bots).toEqual([false, true, true, true]);
  let botTurns = 0;
  for (let step = 0; step < 50_000 && r.state.phase !== 'OVER'; step++) {
    const s = r.state;
    if (s.bots?.[s.turn] && s.deadline !== null && (s.phase === 'BIDDING' || s.phase === 'PLAYING' || s.phase === 'TRUMP')) {
      expect(s.deadline - now).toBeLessThanOrEqual(1_200); // bots act quickly, not after the 20 s human timer
      botTurns++;
    }
    now = s.deadline ?? now + 1000;
    r = module.handleTimeout!(s, ctx());
    for (let i = 1; i < 4; i++) expect(r.state.timeouts[i]).toBe(0); // bots never collect missed turns
  }
  expect(r.state.phase).toBe('OVER');
  expect(botTurns).toBeGreaterThan(30);
  return r;
}

describe('card game bots', () => {
  it('Call Bridge: three bots and a person finish a full game', () => {
    const r = playThrough(callBridgeModule);
    expect(r.outcome).toBeDefined();
  });
  it('29: three bots and a person finish a full game', () => {
    const r = playThrough(twentyNineModule);
    expect(r.outcome).toBeDefined();
  });
});
