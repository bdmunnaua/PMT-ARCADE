import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientToRoomMessage, RoomToClientMessage } from '@arena/shared';
import { ApiError, post, wsUrl } from '../lib/api';

export interface GameRoomConnection {
  status: 'connecting' | 'open' | 'closed' | 'error';
  error: string | null;
  /** latest per-player view sent by the server (module.viewFor) */
  view: unknown;
  presence: { playerNumber: number; connected: boolean }[];
  reconnectDeadline: number | null;
  result: Extract<RoomToClientMessage, { t: 'result' }>['outcome'] | null;
  events: unknown[];
  /** serverTime ≈ Date.now() + serverOffset (for turn countdowns) */
  serverOffset: number;
  /** last per-player error message from the game (e.g. an illegal move) */
  lastError: string | null;
  send: (m: ClientToRoomMessage) => void;
  /** voice chat signalling from other players at the table */
  onRtc: (fn: (from: number, data: unknown) => void) => () => void;
  /** goes up by one every time the room connection (re)opens */
  openCount: number;
}

/** Connects to the match's GameRoom Durable Object; reconnects automatically while mounted. */
export function useGameRoom(matchId: string, enabled: boolean): GameRoomConnection {
  const [status, setStatus] = useState<GameRoomConnection['status']>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<unknown>(null);
  const [presence, setPresence] = useState<GameRoomConnection['presence']>([]);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [result, setResult] = useState<GameRoomConnection['result']>(null);
  const [events, setEvents] = useState<unknown[]>([]);
  const [serverOffset, setServerOffset] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  /** voice messages written while the connection was down; sent as soon as it is back */
  const outbox = useRef<{ at: number; text: string }[]>([]);
  const rtcListeners = useRef(new Set<(from: number, data: unknown) => void>());

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      try {
        setStatus('connecting');
        const { ticket } = await post<{ ticket: string }>('/api/realtime/ticket', { channel: `room:${matchId}` });
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
        };
        sock.onmessage = (ev) => {
          const m = JSON.parse(String(ev.data)) as RoomToClientMessage;
          if (m.t === 'state') {
            setView(m.view);
            if (m.now) setServerOffset(m.now - Date.now());
          }
          else if (m.t === 'presence' || m.t === 'welcome') {
            setPresence(m.players);
            if (m.t === 'presence') setDeadline(m.reconnectDeadline ?? null);
          } else if (m.t === 'result') setResult(m.outcome);
          else if (m.t === 'event') {
            setEvents((xs) => [...xs.slice(-49), m.data]);
            const err = (m.data as { error?: string } | null)?.error;
            setLastError(err ?? null);
          }
          else if (m.t === 'error') setError(m.message);
          else if (m.t === 'rtc') for (const fn of rtcListeners.current) fn(m.from, m.data);
        };
        sock.onclose = (ev) => {
          setStatus('closed');
          // 1011 = the room itself is gone (game over / cancelled): nothing to reconnect to
          if (ev.code === 1011) return;
          // phones drop the connection often (screen off, Wi-Fi ↔ mobile data): keep retrying
          if (!closed) timer = setTimeout(connect, Math.min(10_000, 1000 * 2 ** Math.min(attempt++, 4)));
        };
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Could not connect to the game room.');
        const refused = e instanceof ApiError && (e.status === 403 || e.status === 404);
        if (!closed && !refused) timer = setTimeout(connect, Math.min(10_000, 1000 * 2 ** Math.min(attempt++, 4)));
      }
    };
    void connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws.current?.close();
    };
  }, [matchId, enabled]);

  const send = useCallback((m: ClientToRoomMessage) => {
    setLastError(null);
    const text = JSON.stringify(m);
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(text);
    else if (m.t === 'rtc') outbox.current = [...outbox.current.slice(-199), { at: Date.now(), text }];
  }, []);

  const onRtc = useCallback((fn: (from: number, data: unknown) => void) => {
    rtcListeners.current.add(fn);
    return () => {
      rtcListeners.current.delete(fn);
    };
  }, []);

  return { status, error, view, presence, reconnectDeadline: deadline, result, events, serverOffset, lastError, send, onRtc, openCount };
}
