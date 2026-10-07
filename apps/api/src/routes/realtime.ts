import { Hono, type MiddlewareHandler } from 'hono';
import { hasPermission, realtimeTicketSchema } from '@arena/shared';
import type { AppEnv } from '../env';
import { AppError, forbidden } from '../lib/errors';
import { ok, parseBody } from '../lib/http';
import { rateLimit, requireUser } from '../middleware';
import { issueTicket, readTicket, ticketSecret } from '../realtime/tickets';

const LIVE_ROOM_STATUSES = ['READY', 'PLAYING', 'RESULT_PENDING'];
/** private-room voice: open from the lobby until a while after the game (time to talk and rematch) */
const VOICE_CLOSED_STATUSES = ['CANCELLED', 'REFUNDED', 'VOID'];
const VOICE_AFTER_GAME_MS = 30 * 60_000;

export function realtimeRoutes(auth: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();

  /** Authorises a channel and returns a 60-second signed ticket for the WebSocket URL. */
  r.post('/realtime/ticket', auth, requireUser, rateLimit('realtime_ticket'), async (c) => {
    const { channel } = await parseBody(c, realtimeTicketSchema);
    const services = c.get('services');
    const user = c.get('user');
    const [kind, a, b] = channel.split(':');
    const admin = await services.players.loadAdmin(user.id);
    let allowed = false;
    if (kind === 'user') allowed = a === user.id;
    else if (kind === 'crash' && a) allowed = (await services.games.get(a)).kind === 'CRASH';
    else if (kind === 'finance' && (a === 'BUY' || a === 'SELL') && b) {
      const row = a === 'BUY' ? await services.finance.findBuy(b) : await services.finance.findSell(b);
      allowed = !!row && (row.user_id === user.id || (!!admin && (hasPermission(admin.permissions, 'finance.chat') || hasPermission(admin.permissions, 'finance.view'))));
    } else if (kind === 'voice' && a) {
      const match = await services.matchesRepo.find(a);
      const players = match ? await services.matchesRepo.players(a) : [];
      allowed =
        !!match &&
        match.visibility === 'PRIVATE' &&
        players.some((p) => p.user_id === user.id) &&
        !VOICE_CLOSED_STATUSES.includes(match.status) &&
        (!match.ended_at || Date.now() - match.ended_at < VOICE_AFTER_GAME_MS);
    } else if ((kind === 'match' || kind === 'room') && a) {
      const match = await services.matchesRepo.find(a);
      const players = match ? await services.matchesRepo.players(a, kind === 'match') : [];
      const isPlayer = players.some((p) => p.user_id === user.id);
      if (kind === 'match') allowed = isPlayer || (!!admin && hasPermission(admin.permissions, 'matches.view'));
      else allowed = isPlayer && !!match && LIVE_ROOM_STATUSES.includes(match.status);
    }
    if (!allowed) throw forbidden('You cannot subscribe to this channel.');
    const secret = ticketSecret(c.env.REALTIME_TICKET_SECRET, services.production);
    if (!secret) throw new AppError('FEATURE_DISABLED', 'Realtime is not configured (REALTIME_TICKET_SECRET).');
    return ok(c, { ticket: await issueTicket(secret, channel, user.id, user.playerNumber), channel });
  });

  /** WebSocket upgrade. Notification/chat/match channels → RealtimeHub; room:<id> → GameRoom. */
  r.get('/realtime/connect', async (c) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') throw new AppError('BAD_REQUEST', 'Expected a WebSocket upgrade.');
    const secret = ticketSecret(c.env.REALTIME_TICKET_SECRET, c.get('services').production);
    const ticket = c.req.query('ticket') ?? '';
    const payload = secret ? await readTicket(secret, ticket) : null;
    if (!payload) throw new AppError('UNAUTHENTICATED', 'Invalid or expired realtime ticket.');
    const isRoom = payload.c.startsWith('room:');
    const isCrash = payload.c.startsWith('crash:');
    const isVoice = payload.c.startsWith('voice:');
    const ns = isRoom ? c.env.GAME_ROOMS : isCrash ? c.env.CRASH_GAMES : isVoice ? c.env.VOICE_ROOMS : c.env.REALTIME;
    if (!ns) throw new AppError('FEATURE_DISABLED', 'Realtime is not available.');
    const target = isRoom ? payload.c.slice('room:'.length) : payload.c;
    const headers = new Headers(c.req.raw.headers);
    if (isCrash) headers.set('x-arena-game', payload.c.slice('crash:'.length));
    headers.set('x-arena-channel', payload.c);
    headers.set('x-arena-user', payload.u);
    headers.set('x-arena-player-number', String(payload.n));
    return ns.get(ns.idFromName(target)).fetch(new Request('https://do.internal/connect', { headers }));
  });

  /**
   * ICE servers for voice chat. STUN finds a direct path; on many mobile networks (carrier NAT)
   * only a TURN relay works, so when a Cloudflare TURN key is configured each player gets
   * short-lived relay credentials (never the key itself).
   */
  r.get('/realtime/ice', auth, requireUser, rateLimit('voice_ice'), async (c) => {
    const stun = { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] };
    const { TURN_KEY_ID: id, TURN_KEY_API_TOKEN: token } = c.env;
    if (id && token) {
      try {
        const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ttl: 6 * 60 * 60 }),
        });
        if (res.ok) {
          const body = (await res.json()) as { iceServers?: unknown };
          const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
          if (list.length) return ok(c, { iceServers: [stun, ...list], relay: true });
        } else console.warn('turn credentials failed', res.status);
      } catch (e) {
        console.warn('turn credentials error', e instanceof Error ? e.message : e);
      }
    }
    return ok(c, { iceServers: [stun], relay: false });
  });

  /**
   * Voice check results from a player's browser (how each link connected or why it failed).
   * Only written to the Worker log (Cloudflare → Workers → pmt-arcade → Logs), never stored.
   */
  r.post('/realtime/voice-report', auth, requireUser, rateLimit('voice_report'), async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    const text = JSON.stringify(body ?? null).slice(0, 4000);
    console.log('voice-report', c.get('user').playerNumber, text);
    return ok(c, { logged: true });
  });

  return r;
}
