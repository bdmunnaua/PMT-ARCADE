import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MATCH_STATUSES, MATCH_STATUS_LABELS, type GameDto, type MatchDto } from '@arena/shared';
import { Card, DataTable, FilterBar, PageHeader, Pagination, Select, StatusBadge } from '../../components/ui';
import { dateTime, tokens } from '../../lib/format';
import { useApi, useDocumentTitle, usePaged } from '../../lib/hooks';

export default function AdminMatches({ live }: { live: boolean }) {
  useDocumentTitle(live ? 'Live matches' : 'Match history');
  const navigate = useNavigate();
  const games = useApi<GameDto[]>('/api/games');
  const [status, setStatus] = useState('');
  const [gameId, setGameId] = useState('');
  const list = usePaged<MatchDto>('/api/admin/matches', { live: live && !status ? '1' : undefined, status: status || undefined, gameId: gameId || undefined });
  return (
    <div>
      <PageHeader title={live ? 'Live matches' : 'Match history'} subtitle={live ? 'Rooms waiting, ready, in play, pending results or disputed.' : 'Every match, newest first.'} />
      <Card>
        <FilterBar>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{live ? 'All live' : 'All'}</option>
            {MATCH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {MATCH_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select label="Game" value={gameId} onChange={(e) => setGameId(e.target.value)}>
            <option value="">All games</option>
            {games.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </FilterBar>
        <DataTable
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(m) => m.id}
          onRowClick={(m) => navigate(`/admin/games/matches/${m.id}`)}
          empty={{ title: 'No matches' }}
          columns={[
            { header: 'Match', cell: (m) => <span className="font-semibold">#{m.matchNumber}</span> },
            { header: 'Game', cell: (m) => m.gameName },
            { header: 'Players', cell: (m) => m.players.map((p) => `#${p.playerNumber}`).join(' vs '), hideOnMobile: true },
            { header: 'Stake', cell: (m) => tokens(m.stakeUnits) },
            { header: 'Pot', cell: (m) => tokens(m.potUnits), hideOnMobile: true },
            { header: 'Fee', cell: (m) => (m.feeUnits != null ? tokens(m.feeUnits) : '—'), hideOnMobile: true },
            { header: 'Status', cell: (m) => <StatusBadge status={m.status} /> },
            { header: 'Created', cell: (m) => dateTime(m.createdAt), hideOnMobile: true },
          ]}
        />
        <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
      </Card>
    </div>
  );
}
