import { Crown } from 'lucide-react';
import type { LeaderboardEntryDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { Badge, Card, DataTable, PageHeader, Pagination } from '../../components/ui';
import { percentFromBps } from '../../lib/format';
import { useDocumentTitle, usePaged } from '../../lib/hooks';

export default function LeaderboardPage() {
  useDocumentTitle('Leaderboard');
  const me = useMe();
  const list = usePaged<LeaderboardEntryDto>('/api/leaderboard', {}, 50);
  return (
    <div>
      <PageHeader title="Leaderboard" subtitle="Ranked by wins across all games. Only usernames and player numbers are public." />
      <Card>
        <DataTable
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(r) => String(r.playerNumber)}
          empty={{ title: 'No ranked players yet', description: 'Finish a match to appear here.' }}
          columns={[
            { header: '#', cell: (r) => (r.rank <= 3 ? <span className="flex items-center gap-1 font-bold text-amber-500"><Crown className="size-4" />{r.rank}</span> : <span className="font-semibold text-ink-500">{r.rank}</span>) },
            {
              header: 'Player',
              cell: (r) => (
                <span>
                  <span className="font-semibold">{r.displayName}</span> <span className="text-ink-500">@{r.username} · #{r.playerNumber}</span>{' '}
                  {r.playerNumber === me.playerNumber && <Badge tone="brand">You</Badge>}
                </span>
              ),
            },
            { header: 'Wins', cell: (r) => <span className="font-semibold">{r.wins}</span> },
            { header: 'Played', cell: (r) => r.gamesPlayed, hideOnMobile: true },
            { header: 'Losses', cell: (r) => r.losses, hideOnMobile: true },
            { header: 'Win rate', cell: (r) => percentFromBps(r.winRateBps) },
          ]}
        />
        <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
      </Card>
    </div>
  );
}
