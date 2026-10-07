import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, post, wsUrl } from '../lib/api';

/** What voice chat needs from a connection: send/receive set-up messages, and know when it (re)opened. */
export interface VoiceLink {
  status: 'connecting' | 'open' | 'closed' | 'error';
  send: (m: { t: 'rtc'; to?: number; data: unknown }) => void;
  onRtc: (fn: (from: number, data: unknown) => void) => () => void;
  /** goes up by one every time the connection (re)opens */
  openCount: number;
}

/**
 * The voice connection of one private room (voice:<matchId>). It is separate from the game, so the
 * players can talk from the moment they join the room — in the lobby, during and after the game.
 */
export function useVoiceRoom(matchId: string, enabled: boolean): VoiceLink {
  const [status, setStatus] = useState<VoiceLink['status']>('connecting');
  const [openCount, setOpenCount] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  /** messages written while the connection was down; sent as soon as it is back */
  const outbox = useRef<{ at: number; text: string }[]>([]);
  const listeners = useRef(new Set<(from: number, data: unknown) => void>());

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const retry = () => {
      if (!closed) timer = setTimeout(connect, Math.min(10_000, 1000 * 2 ** Math.min(attempt++, 4)));
    };
    const connect = async () => {
      try {
        setStatus('connecting');
        const { ticket } = await post<{ ticket: string }>('/api/realtime/ticket', { channel: `voice:${matchId}` });
        if (closed) return;
        const sock = new WebSocket(wsUrl(`/api/realtime/connect?ticket=${encodeURIComponent(ticket)}`));
        ws.current = sock;
        sock.onopen = () => {
          attempt = 0;
          setStatus('open');
          setOpenCount((n) => n + 1);
          const fresh = outbox.current.filter((m) => Date.now() - m.at < 20_000);
          outbox.current = [];
          for (const m of fresh) sock.send(m.text);
          // keeps mobile networks from silently dropping an idle connection (answered without waking the server)
          clearInterval(ping);
          ping = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send('ping'), 25_000);
        };
        sock.onmessage = (ev) => {
          if (ev.data === 'pong') return;
          try {
            const m = JSON.parse(String(ev.data)) as { t?: string; from?: number; data?: unknown };
            if (m.t === 'rtc' && typeof m.from === 'number') for (const fn of listeners.current) fn(m.from, m.data);
          } catch {
            /* not for us */
          }
        };
        sock.onclose = () => {
          clearInterval(ping);
          setStatus('closed');
          retry();
        };
      } catch (e) {
        setStatus('error');
        // not allowed any more (room cancelled, or long after the game): stop trying
        if (!(e instanceof ApiError && (e.status === 403 || e.status === 404))) retry();
      }
    };
    void connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(ping);
      ws.current?.close();
    };
  }, [matchId, enabled]);

  const send = useCallback((m: { t: 'rtc'; to?: number; data: unknown }) => {
    const text = JSON.stringify(m);
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(text);
    else outbox.current = [...outbox.current.slice(-199), { at: Date.now(), text }];
  }, []);

  const onRtc = useCallback((fn: (from: number, data: unknown) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return { status, send, onRtc, openCount };
}
