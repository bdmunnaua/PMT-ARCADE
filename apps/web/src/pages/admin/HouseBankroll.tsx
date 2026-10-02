import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Plane, Scale, TrendingUp } from 'lucide-react';
import { hasPermission, parseTokenAmount, type HouseBankrollDto, type SystemWalletEntryDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { Amount } from '../../components/Common';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, Input, Notice, PageHeader, Pagination, StatCard, useToast } from '../../components/ui';
import { post, qs } from '../../lib/api';
import { dateTime, human, tokens } from '../../lib/format';
import { useApi, useDocumentTitle, useIdempotencyKey } from '../../lib/hooks';

type Page = HouseBankrollDto & { entries: SystemWalletEntryDto[]; hasMore: boolean };

export default function HouseBankroll() {
  useDocumentTitle('House bankroll');
  const me = useMe();
  const toast = useToast();
  const idem = useIdempotencyKey();
  const [page, setPage] = useState(1);
  const d = useApi<Page>(`/api/admin/house-bankroll${qs({ page, pageSize: 25 })}`);
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'TO_BANKROLL' | 'FROM_BANKROLL' | null>(null);
  const units = parseTokenAmount(amount);
  const canMove = hasPermission(me.admin?.permissions, 'finance.treasury');
  const x = d.data;
  return (
    <div className="space-y-6">
      <PageHeader title="House bankroll" subtitle="Backs Aviator: pays winning cash-outs, receives losing bets. Funded only from the admin treasury." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Bankroll" value={x ? tokens(x.balanceUnits) : '…'} icon={<Plane className="size-5" />} />
        <StatCard label="Open exposure" value={x ? tokens(x.openExposureUnits) : '…'} hint="Max profit open bets could still win" icon={<Scale className="size-5" />} tone="amber" />
        <StatCard label="Bets (24h)" value={x ? x.stats24h.bets : '…'} hint={x ? `staked ${tokens(x.stats24h.stakedUnits)}` : undefined} icon={<TrendingUp className="size-5" />} tone="sky" />
        <StatCard label="House result (24h)" value={x ? tokens(x.stats24h.houseResultUnits) : '…'} hint="stakes − payouts" icon={<TrendingUp className="size-5" />} tone={x && x.stats24h.houseResultUnits < 0 ? 'rose' : 'emerald'} />
      </div>
      {x && x.balanceUnits === 0 && <Notice tone="warning">The bankroll is empty, so Aviator refuses every bet. Transfer tokens from the admin treasury to open the game.</Notice>}
      {canMove && (
        <Card>
          <CardHeader title="Transfer" subtitle="Ledger transaction + audit log. Withdrawals cannot go below the open exposure." />
          <CardBody className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Input label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" suffix="PMT" />
            </div>
            <Button disabled={!units} icon={<ArrowDownToLine className="size-4" />} onClick={() => setDirection('TO_BANKROLL')}>
              Treasury → bankroll
            </Button>
            <Button variant="outline" disabled={!units} icon={<ArrowUpFromLine className="size-4" />} onClick={() => setDirection('FROM_BANKROLL')}>
              Bankroll → treasury
            </Button>
          </CardBody>
        </Card>
      )}
      <Card>
        <DataTable
          rows={x?.entries}
          loading={d.loading}
          error={d.error}
          onRetry={d.reload}
          rowKey={(e) => e.id}
          empty={{ title: 'No movements yet' }}
          columns={[
            { header: 'Date', cell: (e) => dateTime(e.createdAt) },
            { header: 'Type', cell: (e) => human(e.transactionType) },
            { header: 'Amount', cell: (e) => <Amount units={e.amountUnits} signed />, className: 'text-right' },
            { header: 'Balance after', cell: (e) => tokens(e.balanceAfterUnits), className: 'text-right', hideOnMobile: true },
          ]}
        />
        <Pagination page={page} hasMore={!!x?.hasMore} onPage={setPage} />
      </Card>
      <ConfirmDialog
        open={!!direction}
        onClose={() => setDirection(null)}
        title={direction === 'TO_BANKROLL' ? 'Fund the house bankroll' : 'Withdraw from the bankroll'}
        confirmLabel={`Move ${tokens(units ?? 0)}`}
        reasonLabel="Reason (audit log)"
        message={direction === 'TO_BANKROLL' ? `Move ${tokens(units ?? 0)} from ADMIN_TREASURY to HOUSE_BANKROLL?` : `Move ${tokens(units ?? 0)} from HOUSE_BANKROLL back to ADMIN_TREASURY?`}
        onConfirm={async (reason) => {
          await post('/api/admin/house-bankroll/transfer', { direction, amountUnits: units, reason }, idem.key());
          idem.rotate();
          setAmount('');
          toast.success('Transfer recorded.');
          d.reload();
        }}
      />
    </div>
  );
}
