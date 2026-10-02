/**
 * Browsers cannot send an Authorization header when opening a WebSocket, so the client first asks
 * POST /api/realtime/ticket (authenticated, authorised per channel) for a 60-second HMAC-signed
 * ticket and passes it in the WebSocket URL. The ticket names exactly one channel.
 */
import { REALTIME_TICKET_TTL_MS } from '@arena/shared';
import { signPayload, verifyPayload } from '../lib/crypto';

export interface TicketPayload {
  c: string; // channel
  u: string; // user id
  n: number; // player number
  exp: number;
}

let devSecret: string | null = null;

/** Production requires REALTIME_TICKET_SECRET; local dev falls back to a per-isolate random secret. */
export function ticketSecret(configured: string | undefined, production: boolean): string | null {
  if (configured && configured.length >= 16) return configured;
  if (production) return null;
  devSecret ??= crypto.randomUUID() + crypto.randomUUID();
  return devSecret;
}

export async function issueTicket(secret: string, channel: string, userId: string, playerNumber: number, now = Date.now()): Promise<string> {
  return signPayload(secret, { c: channel, u: userId, n: playerNumber, exp: now + REALTIME_TICKET_TTL_MS } satisfies TicketPayload);
}

export async function readTicket(secret: string, token: string, now = Date.now()): Promise<TicketPayload | null> {
  const p = await verifyPayload<TicketPayload>(secret, token);
  if (!p || typeof p.c !== 'string' || typeof p.u !== 'string' || typeof p.exp !== 'number' || p.exp < now) return null;
  return p;
}
