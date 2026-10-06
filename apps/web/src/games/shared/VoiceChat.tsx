/**
 * Voice chat for the players at one private table (up to 4): direct browser-to-browser audio
 * (WebRTC). The game room only passes the connection set-up messages between the players.
 *   - "Join voice" asks for the microphone; without it you can still listen.
 *   - 🎤 mutes / unmutes yourself; 🔇 next to a player mutes them for you only.
 *   - Bots never take part.
 *   - Uses a TURN relay when the server has one (mobile networks often block direct audio),
 *     reconnects a dropped link by itself, and rejoins automatically in the next game
 *     ("Play another one") if you were talking in this one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, Mic, MicOff, PhoneOff, Volume2, VolumeX } from 'lucide-react';
import type { MatchPlayerDto } from '@arena/shared';
import { Button, Card, CardBody, CardHeader } from '../../components/ui';
import { get } from '../../lib/api';
import { inAppBrowser, openInChromeHref } from '../../lib/invite';
import { t } from '../../lib/i18n';
import type { GameRoomConnection } from '../useGameRoom';

/** `sid` identifies one "Join voice" on one device; a new sid means the player's old link is dead */
type Signal =
  | { kind: 'join'; muted?: boolean; sid?: string }
  | { kind: 'here'; muted: boolean; sid?: string }
  | { kind: 'restart' }
  | { kind: 'leave' }
  | { kind: 'mute'; muted: boolean }
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

const STUN: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const isBot = (p: MatchPlayerDto) => p.displayName.includes('(Bot)');
type LinkState = 'connecting' | 'connected' | 'failed';
/** a link that has not connected after this long is rebuilt */
const LINK_TIMEOUT_MS = 12_000;
/** remembered for this browser tab: you were in voice, so the next game joins voice by itself */
const AUTO_KEY = 'arena.voice.auto';
const remember = (on: boolean) => {
  try {
    if (on) sessionStorage.setItem(AUTO_KEY, '1');
    else sessionStorage.removeItem(AUTO_KEY);
  } catch {
    /* storage blocked */
  }
};
const wantsAuto = () => {
  try {
    return sessionStorage.getItem(AUTO_KEY) === '1';
  } catch {
    return false;
  }
};

export function VoiceChat({ room, players }: { room: GameRoomConnection; players: MatchPlayerDto[] }) {
  const me = players.find((p) => p.isYou);
  const myNumber = me?.playerNumber;
  const others = players.filter((p) => !p.isYou && !isBot(p));
  const [joined, setJoined] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [hasMic, setHasMic] = useState(true);
  const [inVoice, setInVoice] = useState<Record<number, { muted: boolean }>>({});
  const [links, setLinks] = useState<Record<number, LinkState>>({});
  const setLink = useCallback(
    (n: number, st: LinkState | null) =>
      setLinks((l) => {
        const next = { ...l };
        if (st) next[n] = st;
        else delete next[n];
        return next;
      }),
    [],
  );
  const [silenced, setSilenced] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  /** the browser already remembers "block" for the microphone on this site */
  const [denied, setDenied] = useState(false);
  const inApp = inAppBrowser();
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection !== 'undefined';

  useEffect(() => {
    // not every browser can report this (Safari on older iPhones cannot) — then we simply ask on "Join voice"
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((st) => {
        setDenied(st.state === 'denied');
        st.onchange = () => setDenied(st.state === 'denied');
      })
      .catch(() => undefined);
  }, []);
  const ice = useRef<RTCIceServer[]>(STUN);
  const local = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<number, RTCPeerConnection>());
  /** network paths (ICE candidates) that arrived before the offer/answer was applied */
  const pendingIce = useRef(new Map<number, RTCIceCandidateInit[]>());
  /** voice messages are handled strictly one after another, in arrival order */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const audios = useRef(new Map<number, HTMLAudioElement>());
  const joinedRef = useRef(false);
  const sid = useRef('');
  const remoteSid = useRef(new Map<number, string>());
  /** per player: when the current link was started and how often it was rebuilt in a row */
  const linkStarted = useRef(new Map<number, number>());
  const rebuilds = useRef(new Map<number, number>());
  const disconnectTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // the room object changes on every update; keep the latest in a ref so callbacks stay stable
  const roomRef = useRef(room);
  roomRef.current = room;
  const signal = useCallback((data: Signal, to?: number) => roomRef.current.send({ t: 'rtc', to, data }), []);

  const closePeer = useCallback((n: number) => {
    peers.current.get(n)?.close();
    peers.current.delete(n);
    pendingIce.current.delete(n);
    linkStarted.current.delete(n);
    clearTimeout(disconnectTimers.current.get(n));
    disconnectTimers.current.delete(n);
    const a = audios.current.get(n);
    if (a) a.srcObject = null;
  }, []);

  const newPeer = useCallback(
    (n: number) => {
      closePeer(n);
      const pc = new RTCPeerConnection({ iceServers: ice.current });
      peers.current.set(n, pc);
      const stream = local.current;
      if (stream) for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
      else pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.onicecandidate = (e) => e.candidate && signal({ kind: 'ice', candidate: e.candidate.toJSON() }, n);
      pc.ontrack = (e) => {
        const a = audios.current.get(n);
        if (a) {
          a.srcObject = e.streams[0] ?? new MediaStream([e.track]);
          // phones (iPhone especially) may refuse to start sound without a tap
          void a.play().then(() => setBlocked(false), () => setBlocked(true));
        }
      };
      linkStarted.current.set(n, Date.now());
      setLink(n, 'connecting');
      // a dropped link (network change, phone screen off) is started again
      pc.onconnectionstatechange = () => {
        if (peers.current.get(n) !== pc) return;
        const st = pc.connectionState;
        clearTimeout(disconnectTimers.current.get(n));
        if (st === 'connected') {
          setLink(n, 'connected');
          linkStarted.current.delete(n);
          rebuilds.current.set(n, 0);
        } else if (st === 'failed') rebuild.current(n);
        else if (st === 'disconnected') {
          // often comes back by itself within a few seconds; if not, start the link again
          disconnectTimers.current.set(
            n,
            setTimeout(() => peers.current.get(n) === pc && pc.connectionState !== 'connected' && rebuild.current(n), 5000),
          );
        }
      };
      return pc;
    },
    [closePeer, signal, setLink],
  );
  /** throws away the link to player n and makes a new one (the starter does it; the other side asks for it) */
  const rebuild = useRef<(n: number) => void>(() => undefined);

  /** the player with the lower number starts each pair's connection, so two never collide */
  const connect = useCallback(
    async (n: number) => {
      if (!joinedRef.current || !myNumber || myNumber > n || peers.current.has(n)) return;
      const pc = newPeer(n);
      await pc.setLocalDescription(await pc.createOffer());
      signal({ kind: 'offer', sdp: pc.localDescription!.toJSON() }, n);
    },
    [myNumber, newPeer, signal],
  );
  rebuild.current = (n: number) => {
    if (!joinedRef.current) return;
    const tries = (rebuilds.current.get(n) ?? 0) + 1;
    rebuilds.current.set(n, tries);
    closePeer(n);
    if (tries > 6) {
      setLink(n, 'failed');
      return;
    }
    setLink(n, 'connecting');
    if (myNumber && myNumber < n) void connect(n).catch(() => undefined);
    else {
      signal({ kind: 'restart' }, n);
      // waiting for their new offer counts as a link being made (the watchdog asks again if it never comes)
      linkStarted.current.set(n, Date.now());
    }
  };

  // watchdog: a link that never connects (lost message, blocked path) is started again
  useEffect(() => {
    if (!joined) return;
    const id = setInterval(() => {
      for (const [n, at] of [...linkStarted.current]) {
        if (Date.now() - at > LINK_TIMEOUT_MS && peers.current.get(n)?.connectionState !== 'connected') rebuild.current(n);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [joined]);

  /** applies the remote offer/answer, then any network paths that were waiting for it */
  const applyRemote = useCallback(async (from: number, pc: RTCPeerConnection, sdp: RTCSessionDescriptionInit) => {
    await pc.setRemoteDescription(sdp);
    const waiting = pendingIce.current.get(from) ?? [];
    pendingIce.current.delete(from);
    for (const c of waiting) await pc.addIceCandidate(c).catch(() => undefined);
  }, []);

  const { onRtc } = room;
  useEffect(
    () =>
      onRtc((from, raw) => {
        // chain every message so an offer is fully applied before its network paths are added
        queue.current = queue.current.then(() => handle(from, raw as Signal)).catch(() => undefined);
      }),
    [onRtc],
  );
  const handleRef = useRef<(from: number, s: Signal) => Promise<void>>(async () => undefined);
  const handle = (from: number, s: Signal) => handleRef.current(from, s);
  handleRef.current = async (from: number, s: Signal) => {
        try {
          if (s.kind === 'join' || s.kind === 'here') {
            setInVoice((v) => ({ ...v, [from]: { muted: s.muted ?? false } }));
            // a new "Join voice" on their side (page reloaded, rejoined): the old link is dead
            const known = remoteSid.current.get(from);
            if (s.sid && known && known !== s.sid) {
              closePeer(from);
              rebuilds.current.set(from, 0);
            }
            if (s.sid) remoteSid.current.set(from, s.sid);
            if (!joinedRef.current) return;
            if (s.kind === 'join') signal({ kind: 'here', muted: !(local.current?.getAudioTracks()[0]?.enabled ?? false), sid: sid.current }, from);
            const pc = peers.current.get(from);
            if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) closePeer(from);
            if (myNumber && myNumber < from) await connect(from);
            else if (!peers.current.has(from)) linkStarted.current.set(from, Date.now());
          } else if (s.kind === 'restart') {
            if (joinedRef.current && myNumber && myNumber < from) {
              closePeer(from);
              await connect(from);
            }
          } else if (s.kind === 'mute') setInVoice((v) => ({ ...v, [from]: { muted: s.muted } }));
          else if (s.kind === 'leave') {
            closePeer(from);
            setLink(from, null);
            remoteSid.current.delete(from);
            setInVoice((v) => {
              const next = { ...v };
              delete next[from];
              return next;
            });
          } else if (s.kind === 'offer' && joinedRef.current) {
            const early = pendingIce.current.get(from);
            const pc = newPeer(from);
            if (early) pendingIce.current.set(from, early);
            await applyRemote(from, pc, s.sdp);
            await pc.setLocalDescription(await pc.createAnswer());
            signal({ kind: 'answer', sdp: pc.localDescription!.toJSON() }, from);
          } else if (s.kind === 'answer') {
            const pc = peers.current.get(from);
            if (pc && pc.signalingState === 'have-local-offer') await applyRemote(from, pc, s.sdp);
          } else if (s.kind === 'ice') {
            const pc = peers.current.get(from);
            // too early (no offer/answer applied yet, or the offer is still on its way): keep it for later
            if (!pc || !pc.remoteDescription) pendingIce.current.set(from, [...(pendingIce.current.get(from) ?? []), s.candidate]);
            else await pc.addIceCandidate(s.candidate).catch(() => undefined);
          }
        } catch {
          // a broken connection only affects that one player; the link rebuilds or they rejoin
        }
  };

  const join = async () => {
    setError(null);
    try {
      ice.current = (await get<{ iceServers: RTCIceServer[] }>('/api/realtime/ice')).iceServers;
    } catch {
      ice.current = STUN;
    }
    try {
      // this is where the browser shows "Allow pmtarcade.com to use your microphone?"
      local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      setHasMic(true);
      setMicOn(true);
      setDenied(false);
    } catch (e) {
      local.current = null;
      setHasMic(false);
      const name = (e as { name?: string })?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setDenied(true);
        setError(t('The microphone was not allowed — you can still listen.'));
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') setError(t('No microphone was found on this device — you can still listen.'));
      else if (name === 'NotReadableError' || name === 'AbortError') setError(t('Your microphone is being used by another app (a call?). Close it, then tap "Try the microphone again".'));
      else setError(t('No microphone access — you can still listen. Allow the microphone in your browser to talk.'));
    }
    sid.current = Math.random().toString(36).slice(2, 10);
    rebuilds.current.clear();
    joinedRef.current = true;
    setJoined(true);
    remember(true);
    signal({ kind: 'join', muted: !local.current, sid: sid.current });
  };

  // the game connection came back after a drop: say hello again so missed links are made
  const { openCount } = room;
  useEffect(() => {
    if (openCount > 1 && joinedRef.current) signal({ kind: 'join', muted: !(local.current?.getAudioTracks()[0]?.enabled ?? false), sid: sid.current });
  }, [openCount, signal]);

  // you were talking in the last game: join this table's voice too (no new permission prompt)
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || !wantsAuto() || joinedRef.current) return;
    autoTried.current = true;
    void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unblock = () => {
    for (const a of audios.current.values()) void a.play().catch(() => undefined);
    setBlocked(false);
  };

  const leave = useCallback(() => {
    if (!joinedRef.current) return;
    joinedRef.current = false;
    signal({ kind: 'leave' });
    for (const n of [...peers.current.keys()]) closePeer(n);
    linkStarted.current.clear();
    local.current?.getTracks().forEach((tr) => tr.stop());
    local.current = null;
    setLinks({});
    setJoined(false);
    setMicOn(false);
  }, [signal, closePeer]);
  const leaveByHand = () => {
    remember(false);
    leave();
  };
  const retryMic = () => {
    leave();
    void join();
  };

  // leave voice only when the panel really goes away (page closed / game over), not on re-renders
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => () => leaveRef.current(), []);

  const toggleMic = () => {
    const track = local.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
    signal({ kind: 'mute', muted: !track.enabled });
  };

  const toggleSilence = (n: number) => {
    const next = !silenced[n];
    setSilenced({ ...silenced, [n]: next });
    const a = audios.current.get(n);
    if (a) a.muted = next;
  };

  const talkers = others.filter((p) => inVoice[p.playerNumber]).map((p) => p.displayName || p.username);
  const linkLabel = (n: number) => {
    const st = links[n];
    if (!joined || !inVoice[n]) return null;
    if (st === 'connected') return null;
    if (st === 'failed') return t('could not connect — tap Leave voice, then Join voice');
    return t('connecting…');
  };

  if (!me || others.length === 0) return null;
  return (
    <Card>
      <CardHeader
        title={t('Voice chat')}
        subtitle={t('Only the players at this table can hear you.')}
        icon={<Headphones className="size-4" />}
        actions={
          joined ? (
            <div className="flex gap-2">
              {hasMic && (
                <Button size="sm" variant={micOn ? 'success' : 'secondary'} icon={micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />} onClick={toggleMic} aria-label={micOn ? t('Mute my microphone') : t('Unmute my microphone')}>
                  {micOn ? t('Mic on') : t('Muted')}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<PhoneOff className="size-4" />} onClick={leaveByHand}>
                {t('Leave voice')}
              </Button>
            </div>
          ) : supported ? (
            <Button size="sm" icon={<Mic className="size-4" />} onClick={join}>
              {t('Join voice')}
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-2">
        {!supported && (
          <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <p>{inApp ? t('Voice chat does not work inside {app}. Open the game in Chrome or Safari to talk.', { app: inApp }) : t('This browser cannot use voice chat. Use Chrome, Safari, Edge or Firefox.')}</p>
            {inApp && openInChromeHref() && (
              <a href={openInChromeHref()!} className="inline-flex rounded-lg bg-brand-600 px-3 py-1.5 font-semibold text-white">
                {t('Open in Chrome to continue')}
              </a>
            )}
          </div>
        )}
        {supported && !joined && talkers.length > 0 && (
          <button type="button" onClick={join} className="flex w-full items-center gap-2 rounded-xl bg-emerald-50 p-3 text-left text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
            <Mic className="size-4 shrink-0" />
            {t('{names} is in voice — tap here to talk', { names: talkers.join(', ') })}
          </button>
        )}
        {supported && !joined && (
          <p className="text-xs text-ink-500">{t('Tap "Join voice". Your browser will ask to use the microphone — tap Allow.')}</p>
        )}
        {error && <p className="text-xs text-amber-600">{error}</p>}
        {error && inApp && openInChromeHref() && (
          <a href={openInChromeHref()!} className="inline-flex rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white">
            {t('Open in Chrome to continue')}
          </a>
        )}
        {supported && denied && (
          <div className="space-y-1 rounded-xl bg-ink-100 p-3 text-xs dark:bg-ink-800">
            <p className="font-semibold">{t('To talk, allow the microphone for pmtarcade.com:')}</p>
            <p>{t('Phone (Chrome): tap the icon left of pmtarcade.com in the address bar → Permissions → Microphone → Allow.')}</p>
            <p>{t('iPhone (Safari): tap "aA" in the address bar → Website Settings → Microphone → Allow.')}</p>
            <p>{t('Laptop: click the icon left of the address → Microphone → Allow, then reload the page.')}</p>
          </div>
        )}
        {joined && !hasMic && (
          <Button size="sm" variant="secondary" icon={<Mic className="size-4" />} onClick={retryMic} className="w-full">
            {t('Try the microphone again')}
          </Button>
        )}
        {joined && blocked && (
          <Button size="sm" variant="secondary" icon={<Volume2 className="size-4" />} onClick={unblock} className="w-full">
            {t('Tap to hear the other players')}
          </Button>
        )}
        <ul className="space-y-1.5">
          {others.map((p) => {
            const v = inVoice[p.playerNumber];
            return (
              <li key={p.playerNumber} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className={`size-2.5 rounded-full ${v ? 'bg-emerald-500' : 'bg-ink-300 dark:bg-ink-600'}`} />
                  {p.displayName || p.username}
                  <span className="text-xs text-ink-500">{v ? (v.muted ? t('muted') : t('in voice')) : t('not in voice')}</span>
                  {linkLabel(p.playerNumber) && <span className={`text-xs ${links[p.playerNumber] === 'failed' ? 'text-rose-500' : 'text-amber-600'}`}>· {linkLabel(p.playerNumber)}</span>}
                </span>
                {joined && v && (
                  <button type="button" onClick={() => toggleSilence(p.playerNumber)} className="grid size-8 place-items-center rounded-lg hover:bg-ink-100 dark:hover:bg-ink-800" aria-label={silenced[p.playerNumber] ? t('Unmute player') : t('Mute player')} title={silenced[p.playerNumber] ? t('Unmute player') : t('Mute player')}>
                    {silenced[p.playerNumber] ? <VolumeX className="size-4 text-rose-500" /> : <Volume2 className="size-4" />}
                  </button>
                )}
                <audio
                  ref={(el) => {
                    if (el) audios.current.set(p.playerNumber, el);
                    else audios.current.delete(p.playerNumber);
                  }}
                  autoPlay
                  playsInline
                  muted={!!silenced[p.playerNumber]}
                />
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
