import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { BUY_STATUSES, BUY_STATUS_LABELS, PLAYER_TX_CATEGORIES, SELL_STATUSES, SELL_STATUS_LABELS, TX_CATEGORY_LABELS, type BuyRequestDto, type GameDto, type PlayerTransactionDto, type SellRequestDto } from '@arena/shared';
import { BackLink } from '../../components/Common';
import { Amount } from '../../components/Common';
import { Badge, Card, DataTable, FilterBar, Input, PageHeader, Pagination, Select, StatusBadge, Tabs } from '../../components/ui';
import { bdt, dateTime, tokens } from '../../lib/format';
import { useApi, useDocumentTitle, usePaged } from '../../lib/hooks';
import { t, t as tr } from '../../lib/i18n';

type Tab = 'ledger' | 'buy' | 'sell';

const toMs = (d: string, end = false) => (d ? new Date(`${d}T${end ? '23:59:59' : '00:00:00'}`).getTime() : undefined);

export default function TransactionsPage() {
  useDocumentTitle(t("Transaction history"));
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'ledger';
  return (
    <div className="space-y-4">
      <PageHeader back={<BackLink to="/wallet">{t("Wallet")}</BackLink>} title={t("Transaction history")} subtitle={t("Every token movement on your account, from the immutable ledger.")} />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        items={[
          { key: 'ledger', label: t("Token movements") },
          { key: 'buy', label: t("Buy requests") },
          { key: 'sell', label: t("Sell requests") },
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
        <Select label={t("Type")} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t("All types")}</option>
          {PLAYER_TX_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(TX_CATEGORY_LABELS[c])}
            </option>
          ))}
        </Select>
        <Input label={t("From")} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label={t("To")} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select label={t("Game")} value={gameId} onChange={(e) => setGameId(e.target.value)}>
          <option value="">{t("All games")}</option>
          {games.data?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <Input label={t("Transaction ID")} value={txId} onChange={(e) => setTxId(e.target.value)} placeholder="01J…" />
      </FilterBar>
      <DataTable
        rows={list.data?.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        rowKey={(t) => t.id}
        onRowClick={(t) => navigate(`/wallet/transactions/${t.id}`)}
        empty={{ title: t("No transactions match"), description: t("Try clearing the filters.") }}
        columns={[
          { header: t("Date"), cell: (t) => <span className="text-ink-500">{dateTime(t.createdAt)}</span> },
          { header: t("Type"), cell: (t) => <Badge tone="neutral">{tr(TX_CATEGORY_LABELS[t.category])}</Badge> },
          { header: t("Description"), cell: (t) => <span className="text-ink-600 dark:text-ink-300">{t.description}</span>, hideOnMobile: true },
          { header: t("Available"), cell: (t) => (t.effects.AVAILABLE ? <Amount units={t.effects.AVAILABLE} signed /> : '—'), className: 'text-right' },
          { header: t("Locked / bonus"), cell: (t) => <LockedEffects t={t} />, className: 'text-right', hideOnMobile: true },
          { header: t("Status"), cell: () => <StatusBadge status="COMPLETED" />, hideOnMobile: true },
        ]}
      />
      <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
    </Card>
  );
}

function LockedEffects({ t }: { t: PlayerTransactionDto }) {
  const parts = [
    t.effects.LOCKED_GAME ? `${tr('game')} ${tokens(t.effects.LOCKED_GAME, { signed: true })}` : null,
    t.effects.LOCKED_SELL ? `${tr('sell')} ${tokens(t.effects.LOCKED_SELL, { signed: true })}` : null,
    t.effects.BONUS ? `${tr('bonus')} ${tokens(t.effects.BONUS, { signed: true })}` : null,
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
        <Select label={t("Status")} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("All statuses")}</option>
          {BUY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(BUY_STATUS_LABELS[s])}
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
        empty={{ title: t("No buy requests") }}
        columns={[
          { header: t("Request"), cell: (r) => <span className="font-semibold">#{r.requestNumber}</span> },
          { header: t("Date"), cell: (r) => dateTime(r.createdAt), hideOnMobile: true },
          { header: t("Paid"), cell: (r) => bdt(r.amountPoisha) },
          { header: t("Tokens"), cell: (r) => tokens(r.tokenUnits) },
          { header: t("Rate"), cell: (r) => `৳1 = ${r.rateTokensPerBdt}`, hideOnMobile: true },
          { header: t("Status"), cell: (r) => <StatusBadge status={r.status} /> },
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
        <Select label={t("Status")} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("All statuses")}</option>
          {SELL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(SELL_STATUS_LABELS[s])}
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
        empty={{ title: t("No sell requests") }}
        columns={[
          { header: t("Request"), cell: (r) => <span className="font-semibold">#{r.requestNumber}</span> },
          { header: t("Date"), cell: (r) => dateTime(r.createdAt), hideOnMobile: true },
          { header: t("Tokens"), cell: (r) => tokens(r.amountUnits) },
          { header: t("Payout"), cell: (r) => bdt(r.bdtPoisha) },
          { header: t("Rate"), cell: (r) => `${r.rateTokensPerBdt} = ৳1`, hideOnMobile: true },
          { header: t("Status"), cell: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
      <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
    </Card>
  );
}
