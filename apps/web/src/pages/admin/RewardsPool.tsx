import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Flag, Gamepad2, Gift, Users } from 'lucide-react';
import { hasPermission, parseTokenAmount, type RewardsPoolDto, type SystemWalletEntryDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { Amount } from '../../components/Common';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, Input, Notice, PageHeader, Pagination, StatCard, useToast } from '../../components/ui';
import { post, qs } from '../../lib/api';
import { dateTime, human, tokens } from '../../lib/format';
import { useApi, useDocumentTitle, useIdempotencyKey } from '../../lib/hooks';

type Page = RewardsPoolDto & { items: SystemWalletEntryDto[]; hasMore: boolean };

/** The PMT budget for free games, daily check-ins and invite bonuses (all paid as BONUS). */
export default function RewardsPoolPage() {
  useDocumentTitle('Rewards pool');
  const me = useMe();
  const toast = useToast();
  const idem = useIdempotencyKey();
  const [page, setPage] = useState(1);
  const d = useApi<Page>(`/api/admin/rewards-pool${qs({ page, pageSize: 25 })}`);
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'TO_POOL' | 'FROM_POOL' | null>(null);
  const units = parseTokenAmount(amount);
  const canMove = hasPermission(me.admin?.permissions, 'finance.treasury');
  const x = d.data;
  const daysLeft = x && x.paid7dUnits > 0 ? Math.floor(x.balanceUnits / (x.paid7dUnits / 7)) : null;
  return (
    <div className="space-y-6">
      <PageHeader title="Rewards pool" subtitle="Pays free-game rewards, daily check-ins and invite bonuses — always as bonus PMT, which can be played and withdrawn but not sold for taka. Funded only from the admin treasury." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pool balance" value={x ? tokens(x.balanceUnits) : '…'} hint={daysLeft !== null ? `≈ ${daysLeft.toLocaleString()} days at this week's pace` : undefined} icon={<Gift className="size-5" />} />
        <StatCard label="Paid today" value={x ? tokens(x.paidTodayUnits) : '…'} hint={x ? `${tokens(x.paid7dUnits)} in 7 days` : undefined} icon={<Gamepad2 className="size-5" />} tone="amber" />
        <StatCard label="Plays (7 days)" value={x ? x.plays7d.toLocaleString() : '…'} hint={x ? `${x.players7d} players` : undefined} icon={<Users className="size-5" />} tone="sky" />
        <StatCard label="Impossible scores (7 days)" value={x ? x.flagged7d : '…'} hint="earned nothing; hidden from leaderboards" icon={<Flag className="size-5" />} tone={x && x.flagged7d > 0 ? 'rose' : 'emerald'} />
      </div>
      {x && x.balanceUnits === 0 && <Notice tone="warning">The pool is empty: free games still work, but pay nothing until you add PMT here.</Notice>}
      {canMove && (
        <Card>
          <CardHeader title="Fund or reduce the pool" subtitle="Ledger transaction + audit log. Plan: 10% of the PMT supply, released slowly." />
          <CardBody className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Input label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" suffix="PMT" />
            </div>
            <Button disabled={!units} icon={<ArrowDownToLine className="size-4" />} onClick={() => setDirection('TO_POOL')}>
              Treasury → pool
            </Button>
            <Button variant="outline" disabled={!units} icon={<ArrowUpFromLine className="size-4" />} onClick={() => setDirection('FROM_POOL')}>
              Pool → treasury
            </Button>
          </CardBody>
        </Card>
      )}
      <Card>
        <DataTable
          rows={x?.items}
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
        title={direction === 'TO_POOL' ? 'Fund the rewards pool' : 'Take PMT out of the pool'}
        confirmLabel={`Move ${tokens(units ?? 0)}`}
        reasonLabel="Reason (audit log)"
        message={direction === 'TO_POOL' ? `Move ${tokens(units ?? 0)} from the admin treasury to the rewards pool?` : `Move ${tokens(units ?? 0)} from the rewards pool back to the admin treasury?`}
        onConfirm={async (reason) => {
          await post('/api/admin/rewards-pool/transfer', { direction, amountUnits: units, reason }, idem.key());
          idem.rotate();
          setAmount('');
          toast.success('Transfer recorded.');
          d.reload();
        }}
      />
    </div>
  );
}
