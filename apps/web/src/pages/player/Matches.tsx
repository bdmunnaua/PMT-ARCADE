import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { MatchDto } from '@arena/shared';
import { ButtonLink, Card, DataTable, PageHeader, Pagination, StatusBadge, Tabs } from '../../components/ui';
import { dateTime, tokens } from '../../lib/format';
import { useDocumentTitle, usePaged } from '../../lib/hooks';

type Filter = 'all' | 'WAITING_FOR_OPPONENT' | 'READY' | 'PLAYING' | 'SETTLED' | 'DISPUTED';

export default function MatchesPage() {
  useDocumentTitle('Matches');
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const list = usePaged<MatchDto>('/api/me/matches', { status: filter === 'all' ? undefined : filter });
  return (
    <div>
      <PageHeader title="Matches" subtitle="Your rooms, live matches and results." actions={<ButtonLink to="/play">New match</ButtonLink>} />
      <div className="mb-4">
        <Tabs<Filter>
          value={filter}
          onChange={setFilter}
          items={[
            { key: 'all', label: 'All' },
            { key: 'WAITING_FOR_OPPONENT', label: 'Waiting' },
            { key: 'READY', label: 'Ready' },
            { key: 'PLAYING', label: 'Playing' },
            { key: 'SETTLED', label: 'Settled' },
            { key: 'DISPUTED', label: 'Disputed' },
          ]}
        />
      </div>
      <Card>
        <DataTable
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(m) => m.id}
          onRowClick={(m) => navigate(`/matches/${m.id}`)}
          empty={{ title: 'No matches here', description: 'Matches you create or join appear here.' }}
          columns={[
            { header: 'Match', cell: (m) => <span className="font-semibold">#{m.matchNumber}</span> },
            { header: 'Game', cell: (m) => m.gameName },
            { header: 'Stake', cell: (m) => tokens(m.stakeUnits) },
            { header: 'Players', cell: (m) => `${m.playerCount}/${m.maxPlayers}`, hideOnMobile: true },
            { header: 'Status', cell: (m) => <StatusBadge status={m.status} /> },
            { header: 'Result', cell: (m) => (m.myResult ? <StatusBadge status={m.myResult} /> : '—'), hideOnMobile: true },
            { header: 'Created', cell: (m) => <span className="text-ink-500">{dateTime(m.createdAt)}</span>, hideOnMobile: true },
          ]}
        />
        <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
      </Card>
    </div>
  );
}
