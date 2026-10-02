import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { BUY_STATUSES, BUY_STATUS_LABELS, PLAYER_TX_CATEGORIES, SELL_STATUSES, SELL_STATUS_LABELS, TX_CATEGORY_LABELS, type BuyRequestDto, type GameDto, type PlayerTransactionDto, type SellRequestDto } from '@arena/shared';
import { BackLink } from '../../components/Common';
import { Amount } from '../../components/Common';
import { Badge, Card, DataTable, FilterBar, Input, PageHeader, Pagination, Select, StatusBadge, Tabs } from '../../components/ui';
import { bdt, dateTime, tokens } from '../../lib/format';
import { useApi, useDocumentTitle, usePaged } from '../../lib/hooks';

type Tab = 'ledger' | 'buy' | 'sell';

const toMs = (d: string, end = false) => (d ? new Date(`${d}T${end ? '23:59:59' : '00:00:00'}`).getTime() : undefined);

export default function TransactionsPage() {
  useDocumentTitle('Transaction history');
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'ledger';
  return (
    <div className="space-y-4">
      <PageHeader back={<BackLink to="/wallet">Wallet</BackLink>} title="Transaction history" subtitle="Every token movement on your account, from the immutable ledger." />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        items={[
          { key: 'ledger', label: 'Token movements' },
          { key: 'buy', label: 'Buy requests' },
          { key: 'sell', label: 'Sell requests' },
        ]}
      />
      {tab === 'ledger' ? <LedgerTab /> : tab === 'buy' ? <BuyTab /> : <SellTab />}
    </div>
  );
}

function LedgerTab() {
  const navigate = useNavigate();
  const games = useApi<GameDto[]>('/api/games');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [gameId, setGameId] = useState('');
  const [txId, setTxId] = useState('');
  const list = usePaged<PlayerTransactionDto>('/api/me/transactions', { category: category || undefined, from: toMs(from), to: toMs(to, true), gameId: gameId || undefined, txId: txId.trim() || undefined });
  return (
    <Card>
      <FilterBar>
        <Select label="Type" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All types</option>
          {PLAYER_TX_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {TX_CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select label="Game" value={gameId} onChange={(e) => setGameId(e.target.value)}>
          <option value="">All games</option>
          {games.data?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <Input label="Transaction ID" value={txId} onChange={(e) => setTxId(e.target.value)} placeholder="01J…" />
      </FilterBar>
      <DataTable
        rows={list.data?.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        rowKey={(t) => t.id}
        onRowClick={(t) => navigate(`/wallet/transactions/${t.id}`)}
        empty={{ title: 'No transactions match', description: 'Try clearing the filters.' }}
        columns={[
          { header: 'Date', cell: (t) => <span className="text-ink-500">{dateTime(t.createdAt)}</span> },
          { header: 'Type', cell: (t) => <Badge tone="neutral">{TX_CATEGORY_LABELS[t.category]}</Badge> },
          { header: 'Description', cell: (t) => <span className="text-ink-600 dark:text-ink-300">{t.description}</span>, hideOnMobile: true },
          { header: 'Available', cell: (t) => (t.effects.AVAILABLE ? <Amount units={t.effects.AVAILABLE} signed /> : '—'), className: 'text-right' },
          { header: 'Locked / bonus', cell: (t) => <LockedEffects t={t} />, className: 'text-right', hideOnMobile: true },
          { header: 'Status', cell: () => <StatusBadge status="COMPLETED" />, hideOnMobile: true },
        ]}
      />
      <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
    </Card>
  );
}

function LockedEffects({ t }: { t: PlayerTransactionDto }) {
  const parts = [
    t.effects.LOCKED_GAME ? `game ${tokens(t.effects.LOCKED_GAME, { signed: true })}` : null,
    t.effects.LOCKED_SELL ? `sell ${tokens(t.effects.LOCKED_SELL, { signed: true })}` : null,
    t.effects.BONUS ? `bonus ${tokens(t.effects.BONUS, { signed: true })}` : null,
  ].filter(Boolean);
  return <span className="text-xs text-ink-500">{parts.length ? parts.join(' · ') : '—'}</span>;
}

function BuyTab() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const list = usePaged<BuyRequestDto>('/api/wallet/buy-requests', { status: status || undefined });
  return (
    <Card>
      <FilterBar>
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
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
        onRowClick={(r) => navigate(`/wallet/buy/${r.id}`)}
        empty={{ title: 'No buy requests' }}
        columns={[
          { header: 'Request', cell: (r) => <span className="font-semibold">#{r.requestNumber}</span> },
          { header: 'Date', cell: (r) => dateTime(r.createdAt), hideOnMobile: true },
          { header: 'Paid', cell: (r) => bdt(r.amountPoisha) },
          { header: 'Tokens', cell: (r) => tokens(r.tokenUnits) },
          { header: 'Rate', cell: (r) => `৳1 = ${r.rateTokensPerBdt}`, hideOnMobile: true },
          { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
      <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
    </Card>
  );
}

function SellTab() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const list = usePaged<SellRequestDto>('/api/wallet/sell-requests', { status: status || undefined });
  return (
    <Card>
      <FilterBar>
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
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
        onRowClick={(r) => navigate(`/wallet/sell/${r.id}`)}
        empty={{ title: 'No sell requests' }}
        columns={[
          { header: 'Request', cell: (r) => <span className="font-semibold">#{r.requestNumber}</span> },
          { header: 'Date', cell: (r) => dateTime(r.createdAt), hideOnMobile: true },
          { header: 'Tokens', cell: (r) => tokens(r.amountUnits) },
          { header: 'Payout', cell: (r) => bdt(r.bdtPoisha) },
          { header: 'Rate', cell: (r) => `${r.rateTokensPerBdt} = ৳1`, hideOnMobile: true },
          { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
      <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
    </Card>
  );
}
