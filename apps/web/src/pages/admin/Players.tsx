import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { ACCOUNT_STATUSES, type AdminPlayerRowDto } from '@arena/shared';
import { Badge, Card, DataTable, FilterBar, Input, PageHeader, Pagination, Select, StatusBadge } from '../../components/ui';
import { dateTime, tokens } from '../../lib/format';
import { useDocumentTitle, usePaged } from '../../lib/hooks';

export default function AdminPlayers() {
  useDocumentTitle('Players');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const flagged = params.get('flagged') ?? '';
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const list = usePaged<AdminPlayerRowDto>('/api/admin/players', { status: status || undefined, flagged: flagged || undefined, q: search || undefined });
  const title = flagged ? 'Flagged players' : status ? `${status.charAt(0)}${status.slice(1).toLowerCase()} players` : 'All players';
  return (
    <div>
      <PageHeader title={title} subtitle="Search by player number, username or email." />
      <Card>
        <FilterBar>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
            }}
            className="flex min-w-64 flex-1 items-end gap-2"
          >
            <Input label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="#100001, username, email" />
            <button type="submit" className="mb-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white" aria-label="Search">
              <Search className="size-4" />
            </button>
          </form>
          <Select
            label="Status"
            value={status}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('status', e.target.value);
              else next.delete('status');
              setParams(next);
            }}
          >
            <option value="">Any</option>
            {ACCOUNT_STATUSES.map((s) => (
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
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/admin/players/${p.playerNumber}`)}
          empty={{ title: 'No players found' }}
          columns={[
            { header: 'Player', cell: (p) => <span><span className="font-semibold">#{p.playerNumber}</span> <span className="text-ink-500">@{p.username}</span></span> },
            { header: 'Email', cell: (p) => <span className="text-ink-500">{p.email ?? '—'}</span>, hideOnMobile: true },
            { header: 'Status', cell: (p) => <span className="flex gap-1.5"><StatusBadge status={p.accountStatus} />{p.openFlags > 0 && <Badge tone="danger">{p.openFlags} flags</Badge>}</span> },
            { header: 'Available', cell: (p) => tokens(p.wallet.availableUnits), hideOnMobile: true },
            { header: 'Total', cell: (p) => tokens(p.wallet.totalUnits) },
            { header: 'Joined', cell: (p) => dateTime(p.createdAt), hideOnMobile: true },
            { header: 'Last login', cell: (p) => dateTime(p.lastLoginAt), hideOnMobile: true },
          ]}
        />
        <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
      </Card>
    </div>
  );
}
