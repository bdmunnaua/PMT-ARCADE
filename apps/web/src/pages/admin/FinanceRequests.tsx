import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { BUY_STATUSES, BUY_STATUS_LABELS, SELL_STATUSES, SELL_STATUS_LABELS, type AdminBuyRequestDto, type AdminSellRequestDto } from '@arena/shared';
import { Badge, Card, DataTable, FilterBar, Input, PageHeader, Pagination, Select, StatusBadge } from '../../components/ui';
import { bdt, dateTime, tokens } from '../../lib/format';
import { useDocumentTitle, usePaged } from '../../lib/hooks';

function useFilters() {
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  return { status, setStatus, q, setQ, search, setSearch, params: { status: status === 'open' || !status ? undefined : status, open: status === 'open' ? '1' : undefined, q: search || undefined } };
}

function SearchBox({ f }: { f: ReturnType<typeof useFilters> }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        f.setSearch(f.q.trim());
      }}
      className="flex min-w-64 flex-1 items-end gap-2"
    >
      <Input label="Search" value={f.q} onChange={(e) => f.setQ(e.target.value)} placeholder="Request #, player #, number, reference" />
      <button type="submit" className="mb-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white" aria-label="Search">
        <Search className="size-4" />
      </button>
    </form>
  );
}

export function AdminBuyRequests() {
  useDocumentTitle('Buy requests');
  const navigate = useNavigate();
  const f = useFilters();
  const list = usePaged<AdminBuyRequestDto>('/api/admin/buy-requests', f.params);
  return (
    <div>
      <PageHeader title="Buy requests" subtitle="Verify each payment manually before crediting tokens." />
      <Card>
        <FilterBar>
          <SearchBox f={f} />
          <Select label="Status" value={f.status} onChange={(e) => f.setStatus(e.target.value)}>
            <option value="open">Needs action</option>
            <option value="">All</option>
            {BUY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {BUY_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterBar>
        <DataTable
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/admin/finance/buy-requests/${r.id}`)}
          empty={{ title: 'No buy requests', description: 'New requests appear here.' }}
          columns={[
            { header: 'Request', cell: (r) => <span className="font-semibold">#{r.requestNumber}</span> },
            { header: 'Player', cell: (r) => `#${r.player.playerNumber} @${r.player.username}` },
            { header: 'BDT', cell: (r) => bdt(r.amountPoisha) },
            { header: 'Tokens', cell: (r) => tokens(r.tokenUnits), hideOnMobile: true },
            { header: 'Reference', cell: (r) => <span className="font-mono text-xs">{r.paymentReference}</span>, hideOnMobile: true },
            { header: 'Status', cell: (r) => <span className="flex gap-1.5"><StatusBadge status={r.status} />{r.unreadMessages > 0 && <Badge tone="danger">{r.unreadMessages} msg</Badge>}</span> },
            { header: 'Submitted', cell: (r) => dateTime(r.createdAt), hideOnMobile: true },
          ]}
        />
        <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
      </Card>
    </div>
  );
}

export function AdminSellRequests() {
  useDocumentTitle('Sell requests');
  const navigate = useNavigate();
  const f = useFilters();
  const list = usePaged<AdminSellRequestDto>('/api/admin/sell-requests', f.params);
  return (
    <div>
      <PageHeader title="Sell requests" subtitle="Tokens are already locked. Approve, pay manually, then confirm the payment." />
      <Card>
        <FilterBar>
          <SearchBox f={f} />
          <Select label="Status" value={f.status} onChange={(e) => f.setStatus(e.target.value)}>
            <option value="open">Needs action</option>
            <option value="">All</option>
            {SELL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SELL_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterBar>
        <DataTable
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/admin/finance/sell-requests/${r.id}`)}
          empty={{ title: 'No sell requests' }}
          columns={[
            { header: 'Request', cell: (r) => <span className="font-semibold">#{r.requestNumber}</span> },
            { header: 'Player', cell: (r) => `#${r.player.playerNumber} @${r.player.username}` },
            { header: 'Tokens', cell: (r) => tokens(r.amountUnits) },
            { header: 'BDT', cell: (r) => bdt(r.bdtPoisha) },
            { header: 'Receiving', cell: (r) => <span className="font-mono text-xs">{r.receivingNumber}</span>, hideOnMobile: true },
            { header: 'Status', cell: (r) => <span className="flex gap-1.5"><StatusBadge status={r.status} />{r.unreadMessages > 0 && <Badge tone="danger">{r.unreadMessages} msg</Badge>}</span> },
            { header: 'Submitted', cell: (r) => dateTime(r.createdAt), hideOnMobile: true },
          ]}
        />
        <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
      </Card>
    </div>
  );
}
