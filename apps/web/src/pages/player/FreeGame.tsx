/**
 * Plays a free arcade game (static page under /games/<id>/) inside the app. The game never talks
 * to the server: it asks this page to start/finish a session (postMessage, same protocol as the
 * old pmtarcade.com hub) and the server decides the PMT reward.
 */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Link, useNavigate, useParams } from 'react-router';
import { Medal, Trophy } from 'lucide-react';
import type { ArcadeLeaderboardDto, ArcadeRunResultDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { BackLink } from '../../components/Common';
import { useArcadeConfig } from '../../components/Arcade';
import { useWallet } from '../../components/Wallet';
import { Card, CardHeader, ErrorState, PageLoader, useToast } from '../../components/ui';
import { ApiError, post } from '../../lib/api';
import { tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import { timeLeft, useTournament } from '../../components/Tournament';
import { isPlayEdition } from '../../lib/edition';
import { t } from '../../lib/i18n';

interface GameMessage {
  src?: string;
  type?: 'ready' | 'exit' | 'start' | 'finish' | 'fullscreen';
  on?: boolean;
  reqId?: number;
  runId?: string;
  score?: number;
  quiet?: boolean;
}

export default function FreeGamePage() {
  const { id = '' } = useParams();
  const config = useArcadeConfig();
  const me = useMe();
  const wallet = useWallet();
  const toast = useToast();
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  /** the game asked to fill the screen (works even where real full screen is refused, e.g. iPhone) */
  const [immersive, setImmersive] = useState(false);
  const board = useApi<ArcadeLeaderboardDto>(`/api/arcade/leaderboard?game=${encodeURIComponent(id)}`);
  const game = config.data?.games.find((g) => g.id === id);
  const tour = useTournament();
  const featured = tour.data?.enabled && tour.data.current.gameId === id ? tour.data.current : null;
  useDocumentTitle(game?.name ?? t('Free game'));

  useEffect(() => {
    const toGame = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ src: 'arcade-hub', ...msg }, window.location.origin);
    const onMessage = async (e: MessageEvent<GameMessage>) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== window.location.origin) return;
      const m = e.data;
      if (!m || m.src !== 'arcade-game') return;
      const reply = (data: Record<string, unknown>) => toGame({ replyTo: m.reqId, ...data });
      if (m.type === 'ready') toGame({ type: 'hello', signedIn: true, name: me.displayName });
      if (m.type === 'fullscreen') setImmersive(!!m.on);
      if (m.type === 'exit') navigate('/play');
      if (m.type === 'start') {
        try {
          reply(await post<{ runId: string }>('/api/arcade/runs/start', { game: id }));
        } catch (err) {
          reply({ error: t(err instanceof ApiError ? err.message : 'Could not start the game session.') });
        }
      }
      if (m.type === 'finish') {
        try {
          const r = await post<ArcadeRunResultDto>('/api/arcade/runs/finish', { runId: m.runId, score: m.score });
          reply({ coins: r.rewardUnits / 100, message: r.message && t(r.message) });
          if (m.quiet) toast.success(r.rewardUnits > 0 ? t('Score saved: +{amount}', { amount: tokens(r.rewardUnits) }) : r.message || t('Score saved.'));
          if (r.rewardUnits > 0) wallet.reload();
          board.reload();
          tour.reload();
        } catch (err) {
          const msg = t(err instanceof ApiError ? err.message : 'Could not save your score.');
          reply({ error: msg });
          if (m.quiet) toast.error(msg);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, me.displayName]);

  if (config.loading && !config.data) return <PageLoader />;
  if (config.error) return <ErrorState error={config.error} onRetry={config.reload} />;
  if (!game) return <ErrorState error={t("This game does not exist.")} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <BackLink to="/play">{t("All games")}</BackLink>
        {!isPlayEdition && <span className="text-sm text-ink-500">
          {t('Earn up to {a} PMT per game · {b} PMT per day', { a: game.maxPerRunTokens, b: config.data?.dailyCapTokens ?? 0 })}
        </span>}
      </div>
      {!isPlayEdition && config.data && !config.data.enabled && <p className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{t("Free-game rewards are switched off right now — you can still play.")}</p>}
      {featured && !isPlayEdition && (
        <Link to="/tournament" className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-200">
          <Medal className="size-4" /> {t('This week’s tournament game! Your best score counts · {left}', { left: timeLeft(featured.endsAt) })}
          {featured.you && <span className="ml-auto">{t('You are #{rank}', { rank: featured.you.rank })}</span>}
        </Link>
      )}
      <div className={clsx('overflow-hidden bg-black', immersive ? 'fixed inset-0 z-[80]' : 'rounded-3xl shadow-[0_24px_48px_-16px_rgb(0_0_0/0.6)] ring-1 ring-white/10')}>
        <iframe ref={frame} src={`/games/${id}/index.html`} title={game.name} className={clsx('block w-full', immersive ? 'h-dvh' : 'h-[calc(100dvh-13rem)] min-h-[480px]')} allow="fullscreen; autoplay" />
      </div>
      <Card>
        <CardHeader title={t('{game} — best this week', { game: game.name })} icon={<Trophy className="size-4" />} />
        <ol className="divide-y divide-ink-100 dark:divide-ink-800">
          {board.data?.rows.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">{t("No scores yet this week — be the first!")}</li>}
          {board.data?.rows.map((r, i) => (
            <li key={r.playerNumber} className="flex items-center justify-between px-5 py-2.5 text-sm">
              <span className="flex items-center gap-3">
                <span className="w-6 text-center font-black text-ink-400">{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
                <span className="font-semibold">{r.name}</span>
                <span className="text-xs text-ink-500">#{r.playerNumber}</span>
              </span>
              <span className="font-mono font-bold">{r.score.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
