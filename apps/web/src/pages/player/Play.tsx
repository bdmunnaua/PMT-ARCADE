import { Gamepad2, Swords } from 'lucide-react';
import type { GameDto } from '@arena/shared';
import { useConfig } from '../../auth/AuthProvider';
import { FreeGamesGrid, useArcadeConfig } from '../../components/Arcade';
import { GameCard } from '../../components/Common';
import { ErrorState, Notice, PageHeader, Skeleton } from '../../components/ui';
import { percentFromBps } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

/** The lobby: free games that earn PMT, and games played against other players for stakes. */
export default function PlayPage() {
  useDocumentTitle('Play');
  const config = useConfig();
  const games = useApi<GameDto[]>('/api/games');
  const arcade = useArcadeConfig();
  const popular = useApi<{ plays: Record<string, number> }>('/api/arcade/popular');
  return (
    <div className="space-y-10">
      <section>
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <Gamepad2 className="size-6 text-brand-500" /> Free games
            </span>
          }
          subtitle={arcade.data ? `Play for free and earn bonus PMT for your scores — up to ${arcade.data.dailyCapTokens.toLocaleString()} PMT a day.` : 'Play for free and earn bonus PMT for your scores.'}
        />
        {arcade.error ? (
          <ErrorState error={arcade.error} onRetry={arcade.reload} />
        ) : arcade.data ? (
          <FreeGamesGrid games={arcade.data.games} plays={popular.data?.plays} linkFor={(g) => ({ to: `/arcade/${g.id}` })} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/3]" />
            ))}
          </div>
        )}
      </section>

      <section>
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              <Swords className="size-6 text-brand-500" /> Play for PMT
            </span>
          }
          subtitle={`Challenge other players. The winner takes the pot minus a ${percentFromBps(config?.matchFeeBps ?? 100)} platform fee; draws and cancelled matches are fully refunded.`}
        />
        {config && !config.gamesEnabled && (
          <div className="mb-4">
            <Notice tone="warning">Games for stakes are temporarily switched off.</Notice>
          </div>
        )}
        {games.error ? (
          <ErrorState error={games.error} onRetry={games.reload} />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {games.data ? games.data.filter((g) => g.playable || g.enabled).map((g) => <GameCard key={g.id} game={g} paused={config?.gamesEnabled === false} />) : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-64" />)}
          </div>
        )}
      </section>
    </div>
  );
}
