import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { Gamepad2 } from 'lucide-react';
import { isTerminal, type MatchDto, type Paginated } from '@arena/shared';
import { useMe } from '../auth/AuthProvider';
import { useApi } from '../lib/hooks';
import { t } from '../lib/i18n';
import { useRealtime } from '../lib/realtime';

/** "Game in progress — return": a bar on every page while the player has an unfinished match. */
export function ActiveMatchBar() {
  const me = useMe();
  const { pathname } = useLocation();
  const list = useApi<Paginated<MatchDto>>('/api/me/matches?pageSize=10');
  const { reload } = list;
  // refresh when moving between pages and when the server says a match changed
  useEffect(() => reload(), [pathname, reload]);
  useRealtime(`user:${me.id}`, () => reload());
  const active = (list.data?.items ?? []).filter((m) => !isTerminal(m.status));
  const elsewhere = active.filter((m) => !pathname.startsWith(`/matches/${m.id}`));
  if (!elsewhere.length) return null;
  return (
    <div className="mb-4 space-y-2">
      {elsewhere.slice(0, 3).map((m) => {
        const waiting = m.status === 'WAITING_FOR_OPPONENT';
        return (
          <Link
            key={m.id}
            to={`/matches/${m.id}`}
            className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-white shadow-lg transition hover:brightness-110"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Gamepad2 className="size-5 shrink-0 animate-pulse" />
              <span className="min-w-0 truncate text-sm">
                <strong>{t(m.gameName)}</strong> · {waiting ? t('Waiting for players ({n}/{max})', { n: m.playerCount, max: m.maxPlayers }) : t('Game in progress')}
              </span>
            </span>
            <span className="shrink-0 rounded-xl bg-white/20 px-3 py-1 text-sm font-bold">{waiting ? t('Open room') : t('Return to game')}</span>
          </Link>
        );
      })}
    </div>
  );
}
