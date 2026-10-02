/** Weekly tournament pieces shared by the tournament page, the dashboard, the lobby and game pages. */
import { Link } from 'react-router';
import clsx from 'clsx';
import { Trophy } from 'lucide-react';
import type { TournamentDto, TournamentRowDto } from '@arena/shared';
import { useArcadeConfig } from './Arcade';
import { Badge } from './ui';
import { t } from '../lib/i18n';
import { tokens } from '../lib/format';
import { useApi } from '../lib/hooks';

export const bdDate = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));

export function timeLeft(ms: number): string {
  const m = Math.max(0, Math.floor((ms - Date.now()) / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return t('{d}d {h}h left', { d, h });
  if (h > 0) return t('{h}h {m}m left', { h, m: m % 60 });
  return t('{m}m left', { m });
}

export const useTournament = () => useApi<TournamentDto>('/api/arcade/tournament/me');

export const medal = (rank: number) => (rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : String(rank));

export function Ranking({ rows, empty }: { rows: TournamentRowDto[]; empty: string }) {
  if (!rows.length) return <p className="px-5 py-6 text-sm text-ink-500">{empty}</p>;
  return (
    <ol className="divide-y divide-ink-100 dark:divide-ink-800">
      {rows.map((r) => (
        <li key={r.rank} className={clsx('flex items-center justify-between gap-3 px-5 py-2.5 text-sm', r.isYou && 'bg-brand-50/70 dark:bg-brand-500/10')}>
          <span className="flex min-w-0 items-center gap-3">
            <span className="w-7 shrink-0 text-center font-black text-ink-400">{medal(r.rank)}</span>
            <span className="truncate font-semibold">{r.name}</span>
            <span className="hidden text-xs text-ink-500 xl:inline">#{r.playerNumber}</span>
            {r.isYou && <Badge tone="brand">{t('You')}</Badge>}
          </span>
          <span className="flex shrink-0 items-center gap-3">
            {r.prizeUnits > 0 && <span className="hidden text-xs font-semibold text-emerald-600 sm:inline dark:text-emerald-400">+{tokens(r.prizeUnits)}</span>}
            <span className="w-16 text-right font-mono font-bold sm:w-20">{r.score.toLocaleString('en-US')}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Compact banner for the dashboard and the lobby. */
export function TournamentBanner() {
  const tour = useTournament();
  const config = useArcadeConfig();
  const d = tour.data;
  const game = config.data?.games.find((g) => g.id === d?.current.gameId);
  if (!d || !d.enabled || !game) return null;
  const top = d.current.prizesUnits[0] ?? 0;
  return (
    <Link to="/tournament" className="group flex flex-wrap items-center gap-4 rounded-3xl p-5 text-white shadow-lg transition hover:-translate-y-0.5" style={{ background: `linear-gradient(120deg, ${game.colors[0]}, ${game.colors[1]})` }}>
      <span className="grid size-14 place-items-center rounded-2xl bg-white/20 text-3xl">{game.emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-white/80 uppercase">
          <Trophy className="size-4" /> {t('Weekly tournament')} · {timeLeft(d.current.endsAt)}
        </p>
        <p className="text-lg font-black">{t('{game}: 1st place wins {prize}', { game: game.name, prize: tokens(top) })}</p>
        <p className="text-sm text-white/80">{d.current.you ? t('You are #{rank} with {score}', { rank: d.current.you.rank, score: d.current.you.score }) : t('Free to enter — just play. Your best score counts.')}</p>
      </div>
      <span className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-ink-900 group-hover:bg-white/90">{t('See ranking')}</span>
    </Link>
  );
}
