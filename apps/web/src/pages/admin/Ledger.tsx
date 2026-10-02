import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { LEDGER_TX_TYPES, type LedgerTransactionDto } from '@arena/shared';
import { Amount } from '../../components/Common';
import { Card, CardHeader, DataTable, FilterBar, Input, PageHeader, Pagination, Select } from '../../components/ui';
import { dateTime, human, tokens } from '../../lib/format';
import { useDocumentTitle, usePaged } from '../../lib/hooks';

export default function AdminLedger() {
  useDocumentTitle('Ledger');
  const [params] = useSearchParams();
  const [type, setType] = useState('');
  const [txInput, setTxInput] = useState(params.get('txId') ?? '');
  const [playerInput, setPlayerInput] = useState('');
  const [filters, setFilters] = useState({ txId: params.get('txId') ?? '', playerNumber: '' });
  const list = usePaged<LedgerTransactionDto>('/api/admin/ledger', { type: type || undefined, txId: filters.txId || undefined, playerNumber: filters.playerNumber || undefined });
  return (
    <div>
      <PageHeader title="Ledger" subtitle="Immutable double-entry transactions. Every transaction’s entries sum to zero." />
      <Card>
        <FilterBar>
          <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {LEDGER_TX_TYPES.map((t) => (
              <option key={t} value={t}>
                {human(t)}
              </option>
            ))}
          </Select>
          <form
            className="flex flex-1 items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setFilters({ txId: txInput.trim(), playerNumber: playerInput.replace(/\D/g, '') });
            }}
          >
            <Input label="Transaction ID / key" value={txInput} onChange={(e) => setTxInput(e.target.value)} />
            <Input label="Player #" value={playerInput} onChange={(e) => setPlayerInput(e.target.value)} inputMode="numeric" />
            <button type="submit" className="mb-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white" aria-label="Apply filters">
              <Search className="size-4" />
            </button>
          </form>
        </FilterBar>
        {list.error || !list.data ? (
          <DataTable rows={null} loading={list.loading} error={list.error} onRetry={list.reload} rowKey={() => ''} columns={[]} />
        ) : list.data.items.length === 0 ? (
          <DataTable rows={[]} rowKey={() => ''} columns={[]} empty={{ title: 'No ledger transactions' }} />
        ) : (
          <div className="divide-y divide-ink-100 dark:divide-ink-800">
            {list.data.items.map((t) => (
              <div key={t.id}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {human(t.type)} <span className="font-mono text-xs text-ink-500">{t.id}</span>
                    </span>
                  }
                  subtitle={`${dateTime(t.createdAt)} · ${human(t.createdByType)} · ${t.referenceType ? `${human(t.referenceType)} ${t.referenceId ?? ''}` : 'no reference'} · key ${t.idempotencyKey}`}
                  actions={<span className="text-sm font-semibold">{tokens(t.totalUnits)}</span>}
                />
                <div className="overflow-x-auto px-5 pb-4">
                  <table className="min-w-full text-sm">
                    <tbody>
                      {t.entries.map((e) => (
                        <tr key={e.id} className="border-b border-ink-50 last:border-0 dark:border-ink-850">
                          <td className="py-1.5 pr-4">{e.accountLabel}</td>
                          <td className="py-1.5 pr-4 text-ink-500">{human(e.postingType)}</td>
                          <td className="py-1.5 pr-4 text-right">
                            <Amount units={e.amountUnits} signed />
                          </td>
                          <td className="py-1.5 text-right text-ink-500">→ {tokens(e.balanceAfterUnits)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
        <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
      </Card>
    </div>
  );
}
