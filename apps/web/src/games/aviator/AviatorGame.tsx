import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ShieldCheck } from 'lucide-react';
import { crashPointX100, formatX, multiplierAt, sha256Hex } from '@arena/games/aviator';
import { BetPanel } from './BetPanel';
import { drawScene } from './scene';
import { playSound } from '../shared/sound';
import { SoundToggle } from '../shared/GameUi';
import { formatMinor, type CrashRoundDto, type CrashStateDto, type GameDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { Button, Card, CardBody, CardHeader, useToast } from '../../components/ui';
import { ApiError, get } from '../../lib/api';
import { tokens } from '../../lib/format';
import { subscribe } from '../../lib/realtime';
import { useWallet } from '../../components/Wallet';

type Msg = { t?: string; serverNow?: number; round?: CrashRoundDto | null; bets?: CrashStateDto['bets'] };

export function AviatorGame({ game }: { game: GameDto }) {
  const me = useMe();
  const toast = useToast();
  const wallet = useWallet();
  const [state, setState] = useState<CrashStateDto | null>(null);
  const [offset, setOffset] = useState(0);
  const [x100, setX100] = useState(100);
  const [bettingLeft, setBettingLeft] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async () => {
    try {
      const s = await get<CrashStateDto>(`/api/crash/${game.id}/state`);
      setOffset(s.serverNow - Date.now());
      setState(s);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not load the game.');
    }
  }, [game.id, toast]);

  useEffect(() => {
    void load();
    return subscribe(`crash:${game.id}`, (raw) => {
      const m = raw as unknown as Msg;
      if (m.serverNow) setOffset(m.serverNow - Date.now());
      if (m.t === 'round' || m.t === 'crash') {
        if (m.t === 'crash') playSound('crash');
        void load();
        if (m.t === 'crash') wallet.reload();
      } else if (m.t === 'bets' && m.bets) setState((s) => (s ? { ...s, bets: m.bets!.map((b) => ({ ...b, isYou: b.playerNumber === me.playerNumber })) } : s));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  const round = state?.round ?? null;
  const flying = round?.phase === 'FLYING' && !!round.startedAt;

  // animation loop
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const now = Date.now() + offset;
      const current = round?.phase === 'CRASHED' ? (round.crashX100 ?? 100) : flying ? multiplierAt(now - round!.startedAt!) : 100;
      setX100(current);
      // whole seconds only, so React re-renders once per second during betting
      setBettingLeft(round?.phase === 'BETTING' ? Math.max(0, Math.ceil((round.bettingEndsAt - now) / 1000)) : 0);
      const c = canvas.current;
      if (c) {
        const ctx = c.getContext('2d')!;
        const w = (c.width = c.clientWidth * devicePixelRatio);
        const h = (c.height = c.clientHeight * devicePixelRatio);
        const crashedAt = round?.phase === 'CRASHED' ? (round.crashedAt ?? now) : null;
        drawScene(ctx, w, h, devicePixelRatio, {
          phase: round ? round.phase : 'NONE',
          elapsed: round?.startedAt ? (crashedAt ?? now) - round.startedAt : 0,
          sinceCrash: crashedAt ? now - crashedAt : 0,
          now,
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [round, flying, offset]);

  return (
    <div className="space-y-6">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Recent crash points">
        {state?.history.map((h) => (
          <span key={h.roundNumber} className={clsx('shrink-0 rounded-full px-2.5 py-1 text-xs font-bold', h.crashX100 >= 1000 ? 'bg-fuchsia-500/20 text-fuchsia-500' : h.crashX100 >= 200 ? 'bg-sky-500/20 text-sky-500' : 'bg-ink-200 text-ink-600 dark:bg-ink-800 dark:text-ink-300')}>
            {formatX(h.crashX100)}
          </span>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="relative overflow-hidden rounded-3xl bg-[#070a1f] shadow-[0_20px_40px_-12px_rgb(0_0_0/0.6)] ring-1 ring-white/10">
            <canvas ref={canvas} className="h-72 w-full sm:h-96" />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-white">
              {!round ? (
                <p className="text-lg font-semibold">Connecting…</p>
              ) : round.phase === 'BETTING' ? (
                <>
                  <p className="text-sm tracking-widest text-white/70 uppercase">Place your bets</p>
                  <p className="text-6xl font-black tabular-nums">{bettingLeft}s</p>
                </>
              ) : round.phase === 'FLYING' ? (
                <p className="text-7xl font-black tabular-nums [text-shadow:0_4px_0_rgb(76_29_149),0_8px_24px_rgb(0_0_0/0.6)]">{formatX(x100)}</p>
              ) : (
                <>
                  <p className="text-sm tracking-widest text-rose-300 uppercase">Flew away</p>
                  <p className="text-6xl font-black text-rose-400 tabular-nums">{formatX(round.crashX100 ?? 100)}</p>
                </>
              )}
            </div>
            {round && <p className="absolute bottom-2 left-3 text-xs text-white/50">Round #{round.roundNumber}</p>}
            <SoundToggle className="absolute top-2 right-2 text-white/70 hover:bg-white/10 hover:text-white" />
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-sm text-ink-500">Available {wallet.data ? tokens(wallet.data.availableUnits + wallet.data.bonusUnits) : '…'}</p>
          {([1, 2] as const).map((panel) => (
            <BetPanel
              key={panel}
              gameId={game.id}
              panel={panel}
              round={round}
              bet={state?.myBets.find((b) => b.panel === panel)}
              x100={x100}
              onChanged={() => {
                void load();
                wallet.reload();
              }}
            />
          ))}
          {state && (
            <p className="text-xs text-ink-500">
              Bets {tokens(state.limits.minBetUnits)} – {tokens(state.limits.maxBetUnits)} · max {formatX(state.limits.maxX100)} · max win per bet {tokens(state.limits.maxProfitUnits)}
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Live bets" subtitle={`${state?.bets.length ?? 0} ${state?.bets.length === 1 ? 'player' : 'players'} this round`} />
          <ul className="max-h-80 divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
            {state?.bets.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No bets yet this round.</li>}
            {state?.bets.map((b) => (
              <li key={b.id} className={clsx('flex items-center justify-between px-5 py-2.5 text-sm', b.isYou && 'bg-brand-50 dark:bg-brand-500/10')}>
                <span>
                  {b.username} <span className="text-ink-500">#{b.playerNumber}</span>
                </span>
                <span className="font-semibold">{tokens(b.stakeUnits)}</span>
                <span className={clsx('w-28 text-right font-semibold', b.status === 'CASHED_OUT' ? 'text-emerald-600' : b.status === 'LOST' ? 'text-rose-500' : 'text-ink-400')}>
                  {b.status === 'CASHED_OUT' ? `${formatX(b.cashoutX100!)} · ${formatMinor(b.payoutUnits!)}` : b.status === 'LOST' ? 'lost' : b.status === 'REFUNDED' ? 'refunded' : '…'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <FairnessPanel gameId={game.id} current={round} maxX100={state?.limits.maxX100 ?? 10000} />
      </div>
    </div>
  );
}

/** Lets anyone recompute a finished round from its revealed seed. */
function FairnessPanel({ gameId, current, maxX100 }: { gameId: string; current: CrashRoundDto | null; maxX100: number }) {
  const [rounds, setRounds] = useState<CrashRoundDto[]>([]);
  const [check, setCheck] = useState<Record<number, string>>({});
  useEffect(() => {
    get<CrashRoundDto[]>(`/api/crash/${gameId}/history`).then(setRounds, () => undefined);
  }, [gameId, current?.phase]);
  const verify = async (r: CrashRoundDto) => {
    const hashOk = (await sha256Hex(r.serverSeed!)) === r.serverSeedHash;
    const x = await crashPointX100(r.serverSeed!, r.roundNumber, maxX100);
    setCheck((c) => ({ ...c, [r.roundNumber]: hashOk && x === r.crashX100 ? `✔ verified (${formatX(x)})` : `✘ mismatch (computed ${formatX(x)})` }));
  };
  return (
    <Card>
      <CardHeader title="Provably fair" icon={<ShieldCheck className="size-4" />} subtitle="The crash point is fixed before betting opens" />
      <CardBody className="space-y-3 text-sm">
        {current && (
          <p className="break-all">
            Round #{current.roundNumber} seed hash: <code className="text-xs">{current.serverSeedHash}</code>
          </p>
        )}
        <ul className="max-h-60 space-y-2 overflow-y-auto">
          {rounds.slice(0, 10).map((r) => (
            <li key={r.roundNumber} className="flex items-center justify-between gap-2 rounded-lg bg-ink-50 px-3 py-2 dark:bg-ink-850">
              <span>
                #{r.roundNumber} → <strong>{formatX(r.crashX100 ?? 100)}</strong>
              </span>
              {check[r.roundNumber] ? (
                <span className="text-xs font-semibold">{check[r.roundNumber]}</span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => void verify(r)}>
                  Verify
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-500">crash = HMAC-SHA256(seed, round number) → 1% of rounds end at 1.00×. The seed is revealed after each round; its SHA-256 was shown before betting.</p>
      </CardBody>
    </Card>
  );
}
