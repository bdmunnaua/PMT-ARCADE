import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { GamePlayerInfo, ModuleResult } from '@arena/shared';
import { chessModule, type ChessState, CHESS_BOT_MS } from '../../packages/games/src/chess/module';
import { carromModule, type CarromRoomState } from '../../packages/games/src/carrom/module';
import { autoShot } from '../../packages/games/src/carrom/rules';

let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const players = (botSeat: number): GamePlayerInfo[] =>
  [0, 1].map((i) => ({ userId: `u${i}`, playerNumber: i + 1, username: `u${i}`, displayName: i === botSeat ? '🤖 Bot (Bot)' : 'Person', seat: i, isBot: i === botSeat }));

describe('🤖 board-game bots', () => {
  it('chess: a bot plays legal moves quickly, the clock still runs, and a game reaches a result', () => {
    const ps = players(1);
    let now = 0;
    const ctx = () => ({ matchId: 'm', gameId: 'g', stakeUnits: 1, players: ps, now, random });
    let r: ModuleResult<ChessState> = chessModule.startMatch(chessModule.createRoom(ctx()), ctx());
    expect(r.state.bots).toEqual(r.state.white === 'u1' ? { w: true } : { b: true });
    let botMoves = 0;
    for (let i = 0; i < 400 && !r.state.result; i++) {
      const turn = r.state.moves.length % 2 === 0 ? 'w' : 'b';
      if (r.state.bots?.[turn]) {
        expect(r.timerAt! - now).toBeLessThanOrEqual(CHESS_BOT_MS);
        now = r.timerAt!;
        const before = r.state.moves.length;
        r = chessModule.handleTimeout!(r.state, ctx());
        expect(r.state.moves.length).toBe(before + 1);
        botMoves++;
      } else {
        // the person plays a random legal move
        now += 700;
        const game = new Chess(r.state.fen);
        const legal = game.moves({ verbose: true });
        const m = legal[Math.floor(random() * legal.length)]!;
        r = chessModule.handleMessage(r.state, turn === 'w' ? r.state.white : r.state.black, { action: 'move', from: m.from, to: m.to, promotion: m.promotion }, ctx());
      }
    }
    expect(botMoves).toBeGreaterThan(10);
    expect(r.state.result).not.toBeNull();
  });

  it('carrom: a bot shoots by itself after the replay pause and can finish a board', () => {
    const ps = players(0);
    let now = 0;
    const ctx = () => ({ matchId: 'm', gameId: 'g', stakeUnits: 1, players: ps, now, random });
    let r: ModuleResult<CarromRoomState> = carromModule.startMatch(carromModule.createRoom(ctx()), ctx());
    expect(r.state.bots).toEqual([true, false]);
    let botShots = 0;
    for (let i = 0; i < 2000 && r.state.phase !== 'OVER'; i++) {
      const turn = r.state.turn;
      const before = r.state.shots;
      if (turn === 0) {
        expect(r.timerAt! - now).toBeLessThanOrEqual(6_000 + 2_500); // replay pause + aim, not the 30 s human timer
        now = r.timerAt!;
        r = carromModule.handleTimeout!(r.state, ctx());
        expect(r.state.shots).toBe(before + 1); // the bot really shot
        botShots++;
      } else {
        now += 1_000; // the person takes a simple shot at their nearest coin
        const aim = autoShot(r.state);
        r = carromModule.handleMessage(r.state, 'u1', { action: 'shoot', ...aim }, ctx());
      }
    }
    expect(botShots).toBeGreaterThan(3);
    expect(r.state.phase).toBe('OVER');
  }, 60_000);
});
