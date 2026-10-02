import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { MatchDto } from '@arena/shared';
import { ButtonLink, Card, DataTable, PageHeader, Pagination, StatusBadge, Tabs } from '../../components/ui';
import { dateTime, tokens } from '../../lib/format';
import { useDocumentTitle, usePaged } from '../../lib/hooks';
import { t } from '../../lib/i18n';

type Filter = 'all' | 'WAITING_FOR_OPPONENT' | 'READY' | 'PLAYING' | 'SETTLED' | 'DISPUTED';

export default function MatchesPage() {
  useDocumentTitle(t("Matches"));
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const list = usePaged<MatchDto>('/api/me/matches', { status: filter === 'all' ? undefined : filter });
  return (
    <div>
      <PageHeader title={t("Matches")} subtitle={t("Your rooms, live matches and results.")} actions={<ButtonLink to="/play">{t("New match")}</ButtonLink>} />
      <div className="mb-4">
        <Tabs<Filter>
          value={filter}
          onChange={setFilter}
          items={[
            { key: 'all', label: t("All") },
            { key: 'WAITING_FOR_OPPONENT', label: t("Waiting") },
            { key: 'READY', label: t("Ready") },
            { key: 'PLAYING', label: t("Playing") },
            { key: 'SETTLED', label: t("Settled") },
            { key: 'DISPUTED', label: t("Disputed") },
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
          empty={{ title: t("No matches here"), description: t("Matches you create or join appear here.") }}
          columns={[
            { header: t("Match"), cell: (m) => <span className="font-semibold">#{m.matchNumber}</span> },
            { header: t("Game"), cell: (m) => m.gameName },
            { header: t("Stake"), cell: (m) => tokens(m.stakeUnits) },
            { header: t("Players"), cell: (m) => `${m.playerCount}/${m.maxPlayers}`, hideOnMobile: true },
            { header: t("Status"), cell: (m) => <StatusBadge status={m.status} /> },
            { header: t("Result"), cell: (m) => (m.myResult ? <StatusBadge status={m.myResult} /> : '—'), hideOnMobile: true },
            { header: t("Created"), cell: (m) => <span className="text-ink-500">{dateTime(m.createdAt)}</span>, hideOnMobile: true },
          ]}
        />
        <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
      </Card>
    </div>
  );
}
