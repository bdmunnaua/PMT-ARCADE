/**
 * Voice chat for the players at one private table (up to 4): direct browser-to-browser audio
 * (WebRTC). The room's voice connection only passes the connection set-up messages between the players.
 * Works from the moment the players are in the private room: in the lobby, during and after the game.
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
import { get, post } from '../../lib/api';
import { inAppBrowser, openInChromeHref } from '../../lib/invite';
import { t } from '../../lib/i18n';
import type { VoiceLink } from '../useVoiceRoom';
import { MicCheck } from './MicCheck';

/** `sid` identifies one "Join voice" on one device; a new sid means the player's old link is dead */
type Signal =
  | { kind: 'join'; muted?: boolean; noMic?: boolean; sid?: string }
  | { kind: 'here'; muted: boolean; noMic?: boolean; sid?: string }
  | { kind: 'restart' }
  | { kind: 'who' }
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

const isPhone = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
/** how loud the other players are played: phones default to "Loud" (call audio is quiet on phones) */
const VOLUME_LEVELS = [
  { key: 'normal', gain: 1, label: 'Normal' },
  { key: 'loud', gain: 2.2, label: 'Loud' },
  { key: 'max', gain: 3.5, label: 'Extra loud' },
] as const;
type VolumeKey = (typeof VOLUME_LEVELS)[number]['key'];
const VOLUME_KEY = 'arena.voice.volume';
const savedVolume = (): VolumeKey => {
  try {
    const v = localStorage.getItem(VOLUME_KEY);
    if (v === 'normal' || v === 'loud' || v === 'max') return v;
  } catch {
    /* storage blocked */
  }
  return isPhone ? 'loud' : 'normal';
};
const canPickOutput = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
/** a headset/earphones/bluetooth output, if one is connected */
const isHeadset = (d: MediaDeviceInfo) => /head|ear|bluetooth|bt|airpods|wired|usb/i.test(d.label);

/** what the voice check shows for one link */
interface LinkCheck {
  state: string;
  ice: string;
  /** kinds of network paths this phone found: host = same Wi-Fi, srflx = internet, relay = Cloudflare relay */
  found: string[];
  /** the path in use, e.g. "relay/udp → srflx" */
  path: string | null;
  heardKb: number;
  sentKb: number;
  playing: boolean;
}

async function checkLink(pc: RTCPeerConnection, found: Set<string>, audio: HTMLAudioElement | undefined): Promise<LinkCheck> {
  let path: string | null = null;
  let heard = 0;
  let sent = 0;
  try {
    const stats = await pc.getStats();
    const byId = new Map<string, Record<string, unknown>>();
    stats.forEach((x: Record<string, unknown>) => byId.set(x.id as string, x));
    stats.forEach((x: Record<string, unknown>) => {
      if (x.type === 'inbound-rtp' && x.kind === 'audio') heard += Number(x.bytesReceived ?? 0);
      if (x.type === 'outbound-rtp' && x.kind === 'audio') sent += Number(x.bytesSent ?? 0);
      if (x.type === 'transport' && x.selectedCandidatePairId) {
        const pair = byId.get(x.selectedCandidatePairId as string);
        const l = pair && byId.get(pair.localCandidateId as string);
        const r = pair && byId.get(pair.remoteCandidateId as string);
        if (l && r) path = `${l.candidateType}/${l.protocol} → ${r.candidateType}`;
      }
    });
  } catch {
    /* stats not available */
  }
  return {
    state: pc.connectionState,
    ice: pc.iceConnectionState,
    found: [...found],
    path,
    heardKb: Math.round(heard / 1024),
    sentKb: Math.round(sent / 1024),
    playing: !!audio && !!audio.srcObject && !audio.paused,
  };
}
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

export function VoiceChat({ room, players }: { room: VoiceLink; players: MatchPlayerDto[] }) {
  const me = players.find((p) => p.isYou);
  const myNumber = me?.playerNumber;
  const others = players.filter((p) => !p.isYou && !isBot(p));
  const [joined, setJoined] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [hasMic, setHasMic] = useState(true);
  const [inVoice, setInVoice] = useState<Record<number, { muted: boolean; noMic?: boolean }>>({});
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
  /** null = this browser cannot tell before asking */
  const [micAllowed, setMicAllowed] = useState<boolean | null>(null);
  const inApp = inAppBrowser();
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection !== 'undefined';

  useEffect(() => {
    // not every browser can report this (Safari on older iPhones cannot) — then we simply ask on "Join voice"
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((st) => {
        setDenied(st.state === 'denied');
        setMicAllowed(st.state === 'granted');
        st.onchange = () => {
          setDenied(st.state === 'denied');
          setMicAllowed(st.state === 'granted');
        };
      })
      .catch(() => undefined);
  }, []);
  const ice = useRef<RTCIceServer[]>(STUN);
  // ---- playback: the other players' voices go through a volume booster, to the chosen speaker
  const [volume, setVolume] = useState<VolumeKey>(savedVolume);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [output, setOutput] = useState('');
  /** created on the "Join voice" tap (phones only allow sound processing that starts with a tap) */
  const audioCtx = useRef<AudioContext | null>(null);
  const gains = useRef(new Map<number, { gain: GainNode; source: MediaStreamAudioSourceNode }>());
  const silencedRef = useRef<Record<number, boolean>>({});
  /** players whose voice goes through the booster (their <audio> element stays muted) */
  const [boosted, setBoosted] = useState<Record<number, boolean>>({});
  /**
   * Plays player n louder than a normal call, through the volume booster. The <audio> element then
   * stays muted but must keep playing, or Chrome delivers no sound to the booster.
   */
  const boost = useRef((n: number, stream: MediaStream) => {
    const ctx = audioCtx.current;
    if (!ctx || gains.current.has(n) || !stream.getAudioTracks().length) return;
    try {
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = silencedRef.current[n] ? 0 : (VOLUME_LEVELS.find((v) => v.key === volumeRef.current)?.gain ?? 1);
      source.connect(gain).connect(ctx.destination);
      gains.current.set(n, { gain, source });
      const el = audios.current.get(n);
      if (el) el.muted = true;
      setBoosted((b) => ({ ...b, [n]: true }));
      void ctx.resume().catch(() => undefined);
    } catch {
      /* this browser cannot boost a call: plain playback */
    }
  });
  /** phones cancel echo for all sound; laptops only for plain call sound, so they boost only when asked */
  const startBooster = () => {
    if (audioCtx.current) return;
    try {
      audioCtx.current = new AudioContext();
    } catch {
      audioCtx.current = null;
    }
  };
  const [relay, setRelay] = useState<boolean | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [showCheck, setShowCheck] = useState(false);
  const [showMic, setShowMic] = useState(false);
  const [checks, setChecks] = useState<Record<number, LinkCheck>>({});
  /** path kinds found per link, for the voice check */
  const found = useRef(new Map<number, Set<string>>());
  const reported = useRef(new Set<string>());
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
  /** my microphone state, as the others should see it */
  const myVoice = () => ({ muted: !(local.current?.getAudioTracks()[0]?.enabled ?? false), noMic: !local.current });

  const closePeer = useCallback((n: number) => {
    peers.current.get(n)?.close();
    peers.current.delete(n);
    pendingIce.current.delete(n);
    linkStarted.current.delete(n);
    clearTimeout(disconnectTimers.current.get(n));
    disconnectTimers.current.delete(n);
    const g = gains.current.get(n);
    if (g) {
      g.source.disconnect();
      g.gain.disconnect();
      gains.current.delete(n);
      setBoosted((b) => ({ ...b, [n]: false }));
    }
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
      const kinds = new Set<string>();
      found.current.set(n, kinds);
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        if (e.candidate.type) kinds.add(`${e.candidate.type}/${e.candidate.protocol ?? ''}`);
        signal({ kind: 'ice', candidate: e.candidate.toJSON() }, n);
      };
      pc.ontrack = (e) => {
        const a = audios.current.get(n);
        if (a) {
          const stream = e.streams[0] ?? new MediaStream([e.track]);
          a.srcObject = stream;
          boost.current(n, stream);
          // phones (iPhone especially) may refuse to start sound without a tap
          const start = () => void a.play().then(() => setBlocked(false), () => setBlocked(true));
          start();
          // sound starts flowing only once the link is up: make sure the player is really playing then
          e.track.onunmute = start;
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
          if (s.kind === 'who') {
            if (joinedRef.current) signal({ kind: 'here', ...myVoice(), sid: sid.current }, from);
          } else if (s.kind === 'join' || s.kind === 'here') {
            setInVoice((v) => ({ ...v, [from]: { muted: s.muted ?? false, noMic: !!s.noMic } }));
            // a new "Join voice" on their side (page reloaded, rejoined): the old link is dead
            const known = remoteSid.current.get(from);
            if (s.sid && known && known !== s.sid) {
              closePeer(from);
              rebuilds.current.set(from, 0);
            }
            if (s.sid) remoteSid.current.set(from, s.sid);
            if (!joinedRef.current) return;
            if (s.kind === 'join') signal({ kind: 'here', ...myVoice(), sid: sid.current }, from);
            const pc = peers.current.get(from);
            if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) closePeer(from);
            if (myNumber && myNumber < from) await connect(from);
            else if (!peers.current.has(from)) linkStarted.current.set(from, Date.now());
          } else if (s.kind === 'restart') {
            if (joinedRef.current && myNumber && myNumber < from) {
              closePeer(from);
              await connect(from);
            }
          } else if (s.kind === 'mute') setInVoice((v) => ({ ...v, [from]: { ...v[from], muted: s.muted } }));
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
    // iPhone: a voice call session (microphone + sound together)
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'play-and-record';
    } catch {
      /* not supported */
    }
    if (isPhone || volumeRef.current !== 'normal') startBooster();
    void audioCtx.current?.resume().catch(() => undefined);
    ice.current = STUN;
    setRelay(false);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await get<{ iceServers: RTCIceServer[]; relay?: boolean }>('/api/realtime/ice');
        ice.current = r.iceServers;
        setRelay(!!r.relay);
        break;
      } catch {
        await new Promise((ok) => setTimeout(ok, 800));
      }
    }
    try {
      // this is where the browser shows "Allow pmtarcade.com to use your microphone?"
      local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      setHasMic(true);
      setMicOn(true);
      setDenied(false);
      setMicError(null);
      void loadOutputs();
    } catch (e) {
      local.current = null;
      setHasMic(false);
      const name = (e as { name?: string })?.name ?? '';
      setMicError(name || 'error');
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
    signal({ kind: 'join', ...myVoice(), sid: sid.current });
  };

  // the game connection (re)opened: ask who is talking; if we are in voice, say hello again so missed links are made
  const { openCount } = room;
  useEffect(() => {
    if (openCount < 1) return;
    if (joinedRef.current) signal({ kind: 'join', ...myVoice(), sid: sid.current });
    else signal({ kind: 'who' });
  }, [openCount, signal]);

  // voice check: refreshed every 2 s while in voice; each link's outcome is also logged once on the server
  useEffect(() => {
    if (!joined) return;
    const tick = async () => {
      const next: Record<number, LinkCheck> = {};
      for (const [n, pc] of peers.current) next[n] = await checkLink(pc, found.current.get(n) ?? new Set(), audios.current.get(n));
      setChecks(next);
      for (const [n, c] of Object.entries(next)) {
        const outcome = c.state === 'connected' && c.heardKb > 0 ? 'ok' : c.state === 'failed' ? 'failed' : null;
        const key = `${sid.current}:${n}:${outcome}`;
        if (!outcome || reported.current.has(key)) continue;
        reported.current.add(key);
        void post('/api/realtime/voice-report', { outcome, to: Number(n), relay, mic: micError ?? 'ok', ua: navigator.userAgent.slice(0, 160), ...c }).catch(() => undefined);
      }
    };
    const id = setInterval(() => void tick(), 2000);
    return () => clearInterval(id);
  }, [joined, relay, micError]);

  // you were talking in the last game: join this table's voice too (no new permission prompt)
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || !wantsAuto() || joinedRef.current) return;
    autoTried.current = true;
    void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unblock = () => {
    void audioCtx.current?.resume().catch(() => undefined);
    for (const a of audios.current.values()) void a.play().catch(() => undefined);
    setBlocked(false);
  };

  /** speakers this device can play to (laptops, some phones); a phone without earphones uses its loudspeaker */
  const loadOutputs = async () => {
    if (!canPickOutput) return;
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput' && d.deviceId);
      setOutputs(list);
      // earphones connected → use them; otherwise prefer the loudspeaker
      const pick = list.find(isHeadset) ?? list.find((d) => /speaker/i.test(d.label)) ?? list.find((d) => d.deviceId === 'default');
      if (pick) applyOutput(pick.deviceId);
    } catch {
      /* not allowed */
    }
  };
  const applyOutput = (id: string) => {
    setOutput(id);
    const ctx = audioCtx.current as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (ctx?.setSinkId) void ctx.setSinkId(id).catch(() => undefined);
    for (const a of audios.current.values()) void (a as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(id).catch(() => undefined);
  };
  useEffect(() => {
    if (!joined || !canPickOutput) return;
    const onChange = () => void loadOutputs();
    navigator.mediaDevices.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);

  const changeVolume = (key: VolumeKey) => {
    setVolume(key);
    try {
      localStorage.setItem(VOLUME_KEY, key);
    } catch {
      /* storage blocked */
    }
    volumeRef.current = key;
    const gain = VOLUME_LEVELS.find((v) => v.key === key)?.gain ?? 1;
    if (key !== 'normal' && !audioCtx.current) {
      startBooster();
      for (const [n, a] of audios.current) if (a.srcObject instanceof MediaStream) boost.current(n, a.srcObject);
    }
    for (const [n, g] of gains.current) g.gain.gain.value = silencedRef.current[n] ? 0 : gain;
    void audioCtx.current?.resume().catch(() => undefined);
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
  useEffect(
    () => () => {
      leaveRef.current();
      void audioCtx.current?.close().catch(() => undefined);
    },
    [],
  );

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
    silencedRef.current = { ...silencedRef.current, [n]: next };
    const g = gains.current.get(n);
    if (g) g.gain.gain.value = next ? 0 : (VOLUME_LEVELS.find((v) => v.key === volumeRef.current)?.gain ?? 1);
    const a = audios.current.get(n);
    if (a && !g) a.muted = next;
  };

  const talkers = others.filter((p) => inVoice[p.playerNumber]).map((p) => p.displayName || p.username);
  const linkLabel = (n: number) => {
    const st = links[n];
    if (!joined || !inVoice[n]) return null;
    if (st === 'connected') return null;
    if (st === 'failed') return t('could not connect — tap Leave voice, then Join voice');
    return t('connecting…');
  };

  if (!me) return null;
  if (others.length === 0)
    return (
      <Card>
        <CardBody>
          <p className="flex items-center gap-2 text-xs text-ink-500">
            <Headphones className="size-4 shrink-0" />
            {players.some(isBot)
              ? t('Voice chat works with real players only — bots cannot talk. Share the room code with a friend to talk while you play.')
              : t('Voice chat starts when a friend joins this room — you can talk before, during and after the game.')}
          </p>
        </CardBody>
      </Card>
    );
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
        <button type="button" onClick={() => setShowMic(!showMic)} className="text-xs font-semibold text-brand-600 underline">
          {showMic || denied || (error && !hasMic) ? t('Microphone permission & test') : t('Check microphone permission')}
        </button>
        {/* not allowed yet: the "Allow microphone" button is shown right away, no need to look for it */}
        {(showMic || denied || (joined && !hasMic) || (!joined && micAllowed === false)) && <MicCheck compact onAllowed={joined && !hasMic ? retryMic : undefined} />}
        {joined && !hasMic && (
          <Button size="sm" variant="secondary" icon={<Mic className="size-4" />} onClick={retryMic} className="w-full">
            {t('Try the microphone again')}
          </Button>
        )}
        {joined && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Volume2 className="size-4 text-ink-500" />
            <span className="text-ink-500">{t('Volume')}:</span>
            {VOLUME_LEVELS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => changeVolume(v.key)}
                className={`rounded-lg px-2.5 py-1 font-semibold ${volume === v.key ? 'bg-brand-600 text-white' : 'bg-ink-100 dark:bg-ink-800'}`}
              >
                {t(v.label)}
              </button>
            ))}
            {outputs.length > 1 && (
              <select value={output} onChange={(e) => applyOutput(e.target.value)} className="rounded-lg bg-ink-100 px-2 py-1 dark:bg-ink-800" aria-label={t('Sound comes from')}>
                {outputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || t('Speaker')}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {joined && isPhone && (
          <p className="text-xs text-ink-500">{t('Too quiet? Press the volume-up button on the side of your phone while someone talks, and take out earphones to use the loudspeaker.')}</p>
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
                  <span className="text-xs text-ink-500">{v ? (v.noMic ? t('no microphone — cannot be heard') : v.muted ? t('muted') : t('in voice')) : t('not in voice')}</span>
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
                  muted={!!silenced[p.playerNumber] || !!boosted[p.playerNumber]}
                />
              </li>
            );
          })}
        </ul>
        {joined && (
          <button type="button" onClick={() => setShowCheck(!showCheck)} className="text-xs font-semibold text-brand-600 underline">
            {showCheck ? t('Hide voice check') : t('Voice check (if you cannot hear)')}
          </button>
        )}
        {joined && showCheck && (
          <div className="space-y-1 rounded-xl bg-ink-100 p-3 font-mono text-[11px] leading-relaxed dark:bg-ink-800">
            <p>
              {t('Microphone')}: {micError ? `✗ ${micError}` : micOn ? '✓' : t('muted')} · {t('Relay')}: {relay ? '✓' : '✗'} · {t('Voice connection')}: {room.status}
            </p>
            {others.filter((p) => inVoice[p.playerNumber]).map((p) => {
              const c = checks[p.playerNumber];
              return (
                <p key={p.playerNumber}>
                  {p.displayName || p.username}: {c ? `${c.state} (${c.ice}) · ${c.path ?? '—'} · ${t('heard')} ${c.heardKb} KB · ${t('sent')} ${c.sentKb} KB · ${c.playing ? '🔊' : '🔇'} · ${c.found.join(' ') || '—'}` : t('no link yet')}
                </p>
              );
            })}
            <p className="font-sans text-ink-500">{t('Take a screenshot of this box and send it to support if voice does not work.')}</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
