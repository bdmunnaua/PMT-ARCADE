import { useState } from 'react';
import { Landmark, PiggyBank, Plus } from 'lucide-react';
import { hasPermission, parseTokenAmount, type SystemWalletEntryDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { Amount } from '../../components/Common';
import { Button, Card, ConfirmDialog, DataTable, Input, PageHeader, Pagination, StatCard, useToast } from '../../components/ui';
import { post } from '../../lib/api';
import { dateTime, human, tokens } from '../../lib/format';
import { useApi, useDocumentTitle, useIdempotencyKey } from '../../lib/hooks';
import { qs } from '../../lib/api';

interface SystemWalletPage {
  account: string;
  balanceUnits: number;
  issuedUnits?: number;
  entries: SystemWalletEntryDto[];
  hasMore: boolean;
}

export default function SystemWallet({ account }: { account: 'ADMIN_TREASURY' | 'PLATFORM_FEES' }) {
  const treasury = account === 'ADMIN_TREASURY';
  useDocumentTitle(treasury ? 'Admin treasury' : 'Platform fee wallet');
  const me = useMe();
  const toast = useToast();
  const idem = useIdempotencyKey();
  const [page, setPage] = useState(1);
  const w = useApi<SystemWalletPage>(`/api/admin/${treasury ? 'treasury' : 'platform-fees'}${qs({ page, pageSize: 25 })}`);
  const [amount, setAmount] = useState('');
  const [issuing, setIssuing] = useState(false);
  const units = parseTokenAmount(amount);
  const canIssue = treasury && hasPermission(me.admin?.permissions, 'finance.treasury');
  return (
    <div className="space-y-6">
      <PageHeader
        title={treasury ? 'Admin treasury' : 'Platform fee wallet'}
        subtitle={treasury ? 'Tokens sold to players and distributed by admins come from here; redeemed tokens return here.' : 'Receives only the platform fee from settled matches.'}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Balance" value={w.data ? tokens(w.data.balanceUnits) : '…'} icon={treasury ? <Landmark className="size-5" /> : <PiggyBank className="size-5" />} tone={treasury ? 'brand' : 'emerald'} />
        {treasury && <StatCard label="Total issued (all time)" value={w.data ? tokens(w.data.issuedUnits ?? 0) : '…'} hint="Only through explicit, audited issuance" icon={<Plus className="size-5" />} tone="sky" />}
      </div>
      {canIssue && (
        <Card className="p-5">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (units) setIssuing(true);
            }}
          >
            <div className="min-w-48 flex-1">
              <Input label="Issue new tokens into the treasury" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" suffix="PMT" hint="Super Admin only. Creates supply via the ISSUANCE account and an audit record." />
            </div>
            <Button type="submit" disabled={!units} icon={<Plus className="size-4" />}>
              Issue…
            </Button>
          </form>
        </Card>
      )}
      <Card>
        <DataTable
          rows={w.data?.entries}
          loading={w.loading}
          error={w.error}
          onRetry={w.reload}
          rowKey={(e) => e.id}
          empty={{ title: 'No movements yet' }}
          columns={[
            { header: 'Date', cell: (e) => dateTime(e.createdAt) },
            { header: 'Transaction', cell: (e) => <span>{human(e.transactionType)} <span className="block font-mono text-[11px] text-ink-500">{e.transactionId}</span></span> },
            { header: 'Posting', cell: (e) => human(e.postingType), hideOnMobile: true },
            { header: 'Reference', cell: (e) => (e.referenceType ? `${human(e.referenceType)}` : '—'), hideOnMobile: true },
            { header: 'Amount', cell: (e) => <Amount units={e.amountUnits} signed />, className: 'text-right' },
            { header: 'Balance after', cell: (e) => tokens(e.balanceAfterUnits), className: 'text-right', hideOnMobile: true },
          ]}
        />
        <Pagination page={page} hasMore={!!w.data?.hasMore} onPage={setPage} />
      </Card>
      <ConfirmDialog
        open={issuing}
        onClose={() => setIssuing(false)}
        title="Issue treasury tokens"
        confirmLabel={`Issue ${tokens(units ?? 0)}`}
        reasonLabel="Reason (audit log)"
        message={`This creates ${tokens(units ?? 0)} of new supply in ADMIN_TREASURY. Issuance is permanent and fully audited.`}
        onConfirm={async (reason) => {
          await post('/api/admin/treasury/issue', { amountUnits: units, reason }, idem.key());
          idem.rotate();
          setAmount('');
          toast.success('Treasury issuance recorded.');
          w.reload();
        }}
      />
    </div>
  );
}
