/**
 * Realtime subscriptions over WebSockets (RealtimeHub Durable Object). A short-lived ticket is
 * fetched for each (re)connection; reconnects use exponential backoff. Events are hints to
 * re-fetch — the REST API remains the source of truth.
 */
import { useEffect, useRef } from 'react';
import { post, wsUrl } from './api';

export interface RealtimeMessage {
  type: string;
  data?: unknown;
}

export function subscribe(channel: string, onMessage: (m: RealtimeMessage) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const connect = async () => {
    if (closed) return;
    try {
      const { ticket } = await post<{ ticket: string }>('/api/realtime/ticket', { channel });
      if (closed) return;
      ws = new WebSocket(wsUrl(`/api/realtime/connect?ticket=${encodeURIComponent(ticket)}`));
      ws.onopen = () => {
        attempt = 0;
        pingTimer = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 25_000);
      };
      ws.onmessage = (ev) => {
        if (ev.data === 'pong') return;
        try {
          onMessage(JSON.parse(String(ev.data)) as RealtimeMessage);
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        schedule();
      };
    } catch {
      schedule();
    }
  };
  const schedule = () => {
    if (closed) return;
    attempt += 1;
    retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
  };
  void connect();
  return () => {
    closed = true;
    clearInterval(pingTimer);
    clearTimeout(retryTimer);
    ws?.close();
  };
}

/** Subscribes while mounted; the handler may change without resubscribing. */
export function useRealtime(channel: string | null, handler: (m: RealtimeMessage) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!channel) return;
    return subscribe(channel, (m) => ref.current(m));
  }, [channel]);
}
