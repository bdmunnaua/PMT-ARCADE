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
import { t } from '../../lib/i18n';
import type { GameRoomConnection } from '../useGameRoom';

type Signal =
  | { kind: 'join'; muted?: boolean }
  | { kind: 'here'; muted: boolean }
  | { kind: 'leave' }
  | { kind: 'mute'; muted: boolean }
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

const STUN: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const isBot = (p: MatchPlayerDto) => p.displayName.includes('(Bot)');
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
  const [silenced, setSilenced] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const ice = useRef<RTCIceServer[]>(STUN);
  const local = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<number, RTCPeerConnection>());
  const audios = useRef(new Map<number, HTMLAudioElement>());
  const joinedRef = useRef(false);

  // the room object changes on every update; keep the latest in a ref so callbacks stay stable
  const roomRef = useRef(room);
  roomRef.current = room;
  const signal = useCallback((data: Signal, to?: number) => roomRef.current.send({ t: 'rtc', to, data }), []);

  const closePeer = useCallback((n: number) => {
    peers.current.get(n)?.close();
    peers.current.delete(n);
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
      // a dropped link (network change, phone screen off) is rebuilt by the player who started it
      pc.onconnectionstatechange = () => {
        if (pc.connectionState !== 'failed' || peers.current.get(n) !== pc) return;
        closePeer(n);
        if (joinedRef.current && myNumber && myNumber < n) void reconnect.current(n);
      };
      return pc;
    },
    [closePeer, signal, myNumber],
  );
  const reconnect = useRef<(n: number) => Promise<void>>(async () => undefined);

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
  reconnect.current = connect;

  const { onRtc } = room;
  useEffect(
    () =>
      onRtc(async (from, raw) => {
        const s = raw as Signal;
        try {
          if (s.kind === 'join') {
            setInVoice((v) => ({ ...v, [from]: { muted: s.muted ?? false } }));
            if (joinedRef.current) {
              signal({ kind: 'here', muted: !(local.current?.getAudioTracks()[0]?.enabled ?? false) }, from);
              await connect(from);
            }
          } else if (s.kind === 'here') {
            setInVoice((v) => ({ ...v, [from]: { muted: s.muted } }));
            await connect(from);
          } else if (s.kind === 'mute') setInVoice((v) => ({ ...v, [from]: { muted: s.muted } }));
          else if (s.kind === 'leave') {
            closePeer(from);
            setInVoice((v) => {
              const next = { ...v };
              delete next[from];
              return next;
            });
          } else if (s.kind === 'offer' && joinedRef.current) {
            const pc = newPeer(from);
            await pc.setRemoteDescription(s.sdp);
            await pc.setLocalDescription(await pc.createAnswer());
            signal({ kind: 'answer', sdp: pc.localDescription!.toJSON() }, from);
          } else if (s.kind === 'answer') await peers.current.get(from)?.setRemoteDescription(s.sdp);
          else if (s.kind === 'ice') await peers.current.get(from)?.addIceCandidate(s.candidate);
        } catch {
          // a broken connection only affects that one player; they can rejoin
        }
      }),
    [onRtc, signal, connect, newPeer, closePeer],
  );

  const join = async () => {
    setError(null);
    try {
      ice.current = (await get<{ iceServers: RTCIceServer[] }>('/api/realtime/ice')).iceServers;
    } catch {
      ice.current = STUN;
    }
    try {
      local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      setHasMic(true);
      setMicOn(true);
    } catch {
      local.current = null;
      setHasMic(false);
      setError(t('No microphone access — you can still listen. Allow the microphone in your browser to talk.'));
    }
    joinedRef.current = true;
    setJoined(true);
    remember(true);
    signal({ kind: 'join', muted: !local.current });
  };

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
    local.current?.getTracks().forEach((tr) => tr.stop());
    local.current = null;
    setJoined(false);
    setMicOn(false);
  }, [signal, closePeer]);
  const leaveByHand = () => {
    remember(false);
    leave();
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
          ) : (
            <Button size="sm" icon={<Mic className="size-4" />} onClick={join}>
              {t('Join voice')}
            </Button>
          )
        }
      />
      <CardBody className="space-y-2">
        {error && <p className="text-xs text-amber-600">{error}</p>}
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
