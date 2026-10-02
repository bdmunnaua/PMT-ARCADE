/**
 * GameRoom — one Durable Object per match, the authoritative realtime coordinator for a game.
 *
 * Gameplay messages stay inside this object (never written to D1 per move/frame). The engine
 * snapshot is kept in Durable Object storage so a hibernated/evicted room resumes where it was.
 * Only important events (connect/disconnect/forfeit/result) are persisted to match_events, and
 * the validated outcome is handed to the single SettlementService.
 *
 * Server failure: if the match is PLAYING but this room has no snapshot (state lost), the match
 * is VOIDed and every stake refunded (no fee).
 */
import { DurableObject } from 'cloudflare:workers';
import type { GameModule, GamePlayerInfo } from '@arena/shared';
import type { Env } from '../env';
import { secureRandom } from '../lib/ids';
import { getGameModule } from '../games/modules';
import { RoomEngine, type EngineEffects, type EngineSnapshot } from '../games/room-engine';
import { DurableObjectPublisher, NoopPublisher } from '../realtime/publisher';
import { createServices } from '../services/container';

const LIVE = ['READY', 'PLAYING', 'RESULT_PENDING'];

export class GameRoom extends DurableObject<Env> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private engine: RoomEngine<any> | null = null;

  private services() {
    const publisher = this.env.REALTIME ? new DurableObjectPublisher(this.env.REALTIME, (p) => this.ctx.waitUntil(p)) : new NoopPublisher();
    return createServices(this.env, { requestId: `room-${crypto.randomUUID()}`, ip: null, userAgent: 'game-room', country: null }, { publisher });
  }

  /** Loads (or creates) the engine for this match. Returns an error string when the room cannot run. */
  private async ensureEngine(matchId: string): Promise<string | null> {
    if (this.engine) return null;
    const s = this.services();
    const match = await s.matchesRepo.find(matchId);
    if (!match) return 'Match not found.';
    const game = await s.games.get(match.game_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const module: GameModule<any> | null = getGameModule(game.moduleKey);
    if (!module) return 'This game has no installed game module.';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshot = await this.ctx.storage.get<EngineSnapshot<any>>('engine');
    if (snapshot) {
      this.engine = RoomEngine.restore(module, snapshot, secureRandom);
      return null;
    }
    if (match.status === 'PLAYING' || match.status === 'RESULT_PENDING') {
      await s.settlement
        .settleMatch({ matchId, outcome: { type: 'VOID', reason: 'SERVER_FAILURE: room state was lost' }, source: 'GAME_SERVER' })
        .catch((e: unknown) => console.error('void after state loss failed', matchId, e));
      return 'The game server lost this match. It has been voided and all stakes refunded.';
    }
    if (!LIVE.includes(match.status)) return 'This match is not live.';
    const rows = await s.matchesRepo.players(matchId);
    const bots = await s.bots.botIds(rows.map((p) => p.user_id));
    const players: GamePlayerInfo[] = rows.map((p) => ({
      userId: p.user_id,
      playerNumber: p.player_number,
      username: p.username,
      displayName: p.display_name,
      seat: p.seat,
      isBot: bots.has(p.user_id),
    }));
    this.engine = RoomEngine.create(module, { matchId, gameId: match.game_id, stakeUnits: match.stake_units, players }, Date.now(), secureRandom);
    await this.ctx.storage.put('engine', this.engine.snapshot);
    return null;
  }

  private async applyEffects(fx: EngineEffects): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    const matchId = engine.snapshot.matchId;
    for (const s of fx.send) {
      for (const ws of this.ctx.getWebSockets(s.userId)) {
        try {
          ws.send(JSON.stringify(s.message));
        } catch {
          /* closing */
        }
      }
    }
    await this.ctx.storage.put('engine', engine.snapshot);
    if (fx.alarmAt) await this.ctx.storage.setAlarm(fx.alarmAt);
    else await this.ctx.storage.deleteAlarm();

    if (fx.persist.length === 0 && !fx.start && !fx.outcome) return;
    const services = this.services();
    for (const ev of fx.persist) await services.matches.recordEvent(matchId, ev.type, ev.payload, 'GAME_SERVER', null);
    if (fx.start) await services.matches.markPlaying(matchId, 'GAME_SERVER', null);
    if (fx.outcome) {
      try {
        await services.settlement.settleMatch({ matchId, outcome: fx.outcome.outcome, source: 'GAME_SERVER', resultProof: fx.outcome.proof });
      } catch (e) {
        // already settled / disputed in the meantime — the database stays authoritative
        console.warn('settlement from game room refused', matchId, e instanceof Error ? e.message : e);
      }
    }
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const channel = request.headers.get('x-arena-channel') ?? '';
    const userId = request.headers.get('x-arena-user') ?? '';
    const matchId = channel.startsWith('room:') ? channel.slice(5) : '';
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId, matchId });
    const problem = await this.ensureEngine(matchId);
    if (problem || !this.engine) {
      server.send(JSON.stringify({ t: 'error', code: 'ROOM_UNAVAILABLE', message: problem ?? 'Room unavailable.' }));
      server.close(1011, 'room unavailable');
      return new Response(null, { status: 101, webSocket: client });
    }
    await this.applyEffects(this.engine.connect(userId, Date.now()));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const { userId, matchId } = (ws.deserializeAttachment() ?? {}) as { userId?: string; matchId?: string };
    if (!userId || !matchId || typeof message !== 'string' || message.length > 16_384) return;
    if (await this.ensureEngine(matchId)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    await this.applyEffects(this.engine!.message(userId, parsed, Date.now()));
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const { userId, matchId } = (ws.deserializeAttachment() ?? {}) as { userId?: string; matchId?: string };
    if (!userId || !matchId) return;
    // only treat as a disconnect if this was the player's last socket
    if (this.ctx.getWebSockets(userId).some((s) => s !== ws && s.readyState === WebSocket.OPEN)) return;
    if (await this.ensureEngine(matchId)) return;
    await this.applyEffects(this.engine!.disconnect(userId, Date.now()));
  }

  override async alarm(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshot = await this.ctx.storage.get<EngineSnapshot<any>>('engine');
    if (!snapshot) return;
    if (await this.ensureEngine(snapshot.matchId)) return;
    await this.applyEffects(this.engine!.alarm(Date.now()));
  }
}
