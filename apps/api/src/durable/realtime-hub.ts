/**
 * RealtimeHub — one instance per channel (user:<id>, finance:<kind>:<id>, match:<id>).
 * Uses the WebSocket Hibernation API: idle sockets cost nothing, and "ping" is answered by the
 * runtime without waking the object. Messages flow server → client only; clients re-fetch
 * authoritative data over REST when notified.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

export class RealtimeHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/publish' && request.method === 'POST') {
      const body = await request.text();
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(body);
        } catch {
          /* socket already closing */
        }
      }
      return new Response('ok');
    }
    if (url.pathname === '/connect') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const userId = request.headers.get('x-arena-user') ?? 'unknown';
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server, [userId]);
      server.send(JSON.stringify({ type: 'subscribed', channel: request.headers.get('x-arena-channel') }));
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not found', { status: 404 });
  }

  override async webSocketMessage(): Promise<void> {
    // clients do not send data on notification channels (ping is auto-answered)
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }
}
