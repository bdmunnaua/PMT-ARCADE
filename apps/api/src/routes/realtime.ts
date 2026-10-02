import { Hono, type MiddlewareHandler } from 'hono';
import { hasPermission, realtimeTicketSchema } from '@arena/shared';
import type { AppEnv } from '../env';
import { AppError, forbidden } from '../lib/errors';
import { ok, parseBody } from '../lib/http';
import { rateLimit, requireUser } from '../middleware';
import { issueTicket, readTicket, ticketSecret } from '../realtime/tickets';

const LIVE_ROOM_STATUSES = ['READY', 'PLAYING', 'RESULT_PENDING'];

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
    const ns = isRoom ? c.env.GAME_ROOMS : isCrash ? c.env.CRASH_GAMES : c.env.REALTIME;
    if (!ns) throw new AppError('FEATURE_DISABLED', 'Realtime is not available.');
    const target = isRoom ? payload.c.slice('room:'.length) : payload.c;
    const headers = new Headers(c.req.raw.headers);
    if (isCrash) headers.set('x-arena-game', payload.c.slice('crash:'.length));
    headers.set('x-arena-channel', payload.c);
    headers.set('x-arena-user', payload.u);
    headers.set('x-arena-player-number', String(payload.n));
    return ns.get(ns.idFromName(target)).fetch(new Request('https://do.internal/connect', { headers }));
  });

  return r;
}
