import { useState } from 'react';
import { useNavigate } from 'react-router';
import { DISPUTE_CATEGORY_LABELS, DISPUTE_STATUSES, type DisputeDto } from '@arena/shared';
import { Card, DataTable, FilterBar, PageHeader, Pagination, Select, StatusBadge } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { useDocumentTitle, usePaged } from '../../lib/hooks';

export default function AdminDisputes() {
  useDocumentTitle('Disputes');
  const navigate = useNavigate();
  const [status, setStatus] = useState('OPEN');
  const list = usePaged<DisputeDto>('/api/admin/disputes', { status: status || undefined });
  return (
    <div>
      <PageHeader title="Disputes" subtitle="Player complaints about matches. Resolutions that move tokens always go through the ledger." />
      <Card>
        <FilterBar>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {DISPUTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </FilterBar>
        <DataTable
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(d) => d.id}
          onRowClick={(d) => navigate(`/admin/games/disputes/${d.id}`)}
          empty={{ title: 'No disputes' }}
          columns={[
            { header: 'Dispute', cell: (d) => <span className="font-semibold">#{d.disputeNumber}</span> },
            { header: 'Match', cell: (d) => `#${d.matchNumber} · ${d.gameName}` },
            { header: 'Category', cell: (d) => DISPUTE_CATEGORY_LABELS[d.category] },
            { header: 'Status', cell: (d) => <StatusBadge status={d.status} /> },
            { header: 'Opened', cell: (d) => dateTime(d.createdAt), hideOnMobile: true },
          ]}
        />
        <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
      </Card>
    </div>
  );
}
