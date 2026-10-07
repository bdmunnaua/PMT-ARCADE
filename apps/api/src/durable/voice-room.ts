/**
 * VoiceRoom — one per private match (voice:<matchId>). Passes voice-chat set-up messages
 * (WebRTC offers, answers, network paths) between the players at that table, from the moment
 * they join the room until after the game, independent of the game itself. No audio passes
 * through here (that goes phone-to-phone or via the TURN relay) and nothing is stored.
 * Uses the WebSocket Hibernation API, so a quiet room costs nothing.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

const MAX_MESSAGE = 16_384;

export class VoiceRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const n = Number(request.headers.get('x-arena-player-number'));
    if (!Number.isInteger(n) || n <= 0) return new Response('Bad player', { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [String(n)]);
    server.serializeAttachment({ n });
    server.send(JSON.stringify({ t: 'welcome', you: n }));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) return;
    const { n } = (ws.deserializeAttachment() ?? {}) as { n?: number };
    if (!n) return;
    let m: { t?: unknown; to?: unknown; data?: unknown };
    try {
      m = JSON.parse(message) as typeof m;
    } catch {
      return;
    }
    if (m.t !== 'rtc' || typeof m.data !== 'object' || m.data === null) return;
    this.relay(n, typeof m.to === 'number' ? m.to : null, m.data);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const { n } = (ws.deserializeAttachment() ?? {}) as { n?: number };
    if (!n) return;
    // page closed or phone lost the connection for good: tell the others this player left voice
    if (this.ctx.getWebSockets(String(n)).some((s) => s !== ws && s.readyState === WebSocket.OPEN)) return;
    this.relay(n, null, { kind: 'leave' });
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private relay(from: number, to: number | null, data: unknown): void {
    const out = JSON.stringify({ t: 'rtc', from, data });
    const targets = to === null ? this.ctx.getWebSockets() : this.ctx.getWebSockets(String(to));
    for (const s of targets) {
      const { n } = (s.deserializeAttachment() ?? {}) as { n?: number };
      if (n === from) continue;
      try {
        s.send(out);
      } catch {
        /* closing */
      }
    }
  }
}
