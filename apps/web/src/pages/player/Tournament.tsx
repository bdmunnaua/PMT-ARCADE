/**
 * The weekly free-game tournament: this week's featured game, the live ranking with the prize per
 * place, and last week's winners. Every finished game of the featured game counts on its own.
 */
import { CalendarClock, Gamepad2, Trophy } from 'lucide-react';
import type { ArcadeGameDto } from '@arena/shared';
import { useArcadeConfig } from '../../components/Arcade';
import { bdDate, medal, Ranking, timeLeft, useTournament } from '../../components/Tournament';
import { Badge, ButtonLink, Card, CardHeader, ErrorState, Notice, PageHeader, PageLoader } from '../../components/ui';
import { t } from '../../lib/i18n';
import { tokens } from '../../lib/format';
import { useDocumentTitle } from '../../lib/hooks';

function GameTile({ game }: { game: ArcadeGameDto }) {
  return (
    <span className="grid size-16 shrink-0 place-items-center rounded-2xl text-4xl shadow-lg" style={{ background: `linear-gradient(135deg, ${game.colors[0]}, ${game.colors[1]})` }}>
      {game.emoji}
    </span>
  );
}

export default function TournamentPage() {
  useDocumentTitle(t('Weekly tournament'));
  const tour = useTournament();
  const config = useArcadeConfig();
  if ((tour.loading && !tour.data) || (config.loading && !config.data)) return <PageLoader />;
  if (tour.error || !tour.data) return <ErrorState error={tour.error} onRetry={tour.reload} />;
  const d = tour.data;
  const games = config.data?.games ?? [];
  const find = (id: string) => games.find((g) => g.id === id);
  const game = find(d.current.gameId);
  const next = find(d.next.gameId);
  const lastGame = d.last ? find(d.last.gameId) : undefined;
  const total = d.current.prizesUnits.reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t('Weekly tournament')} subtitle={t('One free game each week. Play it as often as you like — your best score counts. Prizes are bonus PMT from the rewards pool.')} />
      {!d.enabled && <Notice tone="warning">{t('Tournaments are paused right now. Scores still count for the normal free-game rewards.')}</Notice>}

      <Card>
        <div className="flex flex-wrap items-center gap-4 p-5">
          {game && <GameTile game={game} />}
          <div className="min-w-48 flex-1">
            <p className="text-xs font-bold tracking-wide text-ink-500 uppercase">{t('This week')}</p>
            <p className="text-2xl font-black">{game?.name ?? d.current.gameId}</p>
            <p className="flex items-center gap-1.5 text-sm text-ink-500">
              <CalendarClock className="size-4" /> {t('Ends {date} (Bangladesh time)', { date: bdDate(d.current.endsAt) })} · {timeLeft(d.current.endsAt)}
            </p>
          </div>
          <ButtonLink to={`/arcade/${d.current.gameId}`} icon={<Gamepad2 className="size-4" />}>
            {t('Play now')}
          </ButtonLink>
        </div>
        <div className="grid grid-cols-3 border-t border-ink-100 text-center dark:border-ink-800">
          <div className="p-3">
            <p className="text-xs text-ink-500">{t('Prizes')}</p>
            <p className="font-bold">{tokens(total)}</p>
          </div>
          <div className="border-x border-ink-100 p-3 dark:border-ink-800">
            <p className="text-xs text-ink-500">{t('Players')}</p>
            <p className="font-bold">{d.current.players.toLocaleString('en-US')}</p>
          </div>
          <div className="p-3">
            <p className="text-xs text-ink-500">{t('Your place')}</p>
            <p className="font-bold">{d.current.you ? `#${d.current.you.rank}` : '—'}</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title={t('Live ranking')} subtitle={t('Prizes shown are what each place wins if the week ended now.')} icon={<Trophy className="size-4" />} />
          <Ranking rows={d.current.rows} empty={t('No scores yet this week — be the first!')} />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('Prizes')} />
            <ol className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
              {d.current.prizesUnits.map((p, i) => (
                <li key={i} className="flex justify-between px-5 py-2">
                  <span className="font-semibold">{medal(i + 1)}</span>
                  <span>{tokens(p)}</span>
                </li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardHeader title={t('Rules')} />
            <ul className="list-disc space-y-1.5 px-9 py-4 text-sm text-ink-600 dark:text-ink-300">
              <li>{t('Monday 00:00 to Sunday 23:59, Bangladesh time.')}</li>
              <li>{t('No entry fee. Every finished game of the featured game counts; your best score ranks.')}</li>
              <li>{t('Equal scores: whoever reached it first ranks higher.')}</li>
              <li>{t('Impossible scores are rejected, and banned or suspended accounts win nothing.')}</li>
              <li>{t('Prizes are paid automatically as bonus PMT a few hours after the week ends.')}</li>
            </ul>
          </Card>
          {next && (
            <Card>
              <div className="flex items-center gap-3 p-5">
                <GameTile game={next} />
                <div>
                  <p className="text-xs font-bold tracking-wide text-ink-500 uppercase">{t('Next week')}</p>
                  <p className="font-bold">{next.name}</p>
                  <p className="text-xs text-ink-500">{t('Starts {date}', { date: bdDate(d.next.startsAt) })}</p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {d.last && (
        <Card>
          <CardHeader
            title={t('Last week: {game}', { game: lastGame?.name ?? d.last.gameId })}
            actions={
              <Badge tone={d.last.status === 'PAID' ? 'success' : 'neutral'}>
                {d.last.status === 'PAID' ? t('Prizes paid') : d.last.status === 'PENDING' ? t('Paying soon') : d.last.status === 'OFF' ? t('Paused') : t('No entries')}
              </Badge>
            }
          />
          <Ranking rows={d.last.rows} empty={t('Nobody played last week’s tournament.')} />
        </Card>
      )}
    </div>
  );
}
