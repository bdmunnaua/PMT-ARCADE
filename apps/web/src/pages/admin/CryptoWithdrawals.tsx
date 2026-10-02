import { useState } from 'react';
import { ExternalLink, Fuel, Send, Wallet as WalletIcon } from 'lucide-react';
import { hasPermission, type CryptoWithdrawalDto, type HotWalletDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { CopyText } from '../../components/Common';
import { Badge, Button, Card, ConfirmDialog, DataTable, Notice, PageHeader, Select, StatCard, useToast } from '../../components/ui';
import { post, qs } from '../../lib/api';
import { dateTime, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

const tone = (s: string) => (s === 'PAID' ? 'success' : s === 'REJECTED' ? 'danger' : s === 'FAILED' ? 'warning' : 'info') as 'success' | 'danger' | 'warning' | 'info';

/** PMT withdrawals to players' crypto wallets: Pay sends real PMT from the payout hot wallet. */
export default function CryptoWithdrawalsPage() {
  useDocumentTitle('Crypto withdrawals');
  const me = useMe();
  const toast = useToast();
  const [status, setStatus] = useState('PENDING');
  const list = useApi<CryptoWithdrawalDto[]>(`/api/admin/crypto/withdrawals${qs({ status })}`);
  const hot = useApi<HotWalletDto>('/api/admin/crypto/hot-wallet');
  const [paying, setPaying] = useState<CryptoWithdrawalDto | null>(null);
  const [rejecting, setRejecting] = useState<CryptoWithdrawalDto | null>(null);
  const canPay = hasPermission(me.admin?.permissions, 'finance.sell.manage');
  const h = hot.data;
  const reload = () => {
    list.reload();
    hot.reload();
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Crypto withdrawals" subtitle="Players' PMT withdrawals to their BNB Chain wallets. Pay sends PMT from the separate payout wallet — never keep the main supply there." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Payout wallet PMT" value={h?.tokenBalance ? Number(h.tokenBalance).toLocaleString() : '—'} hint={h?.address ?? 'not set up'} icon={<WalletIcon className="size-5" />} />
        <StatCard label="Gas (BNB)" value={h?.gasBnb ?? '—'} hint="one payout costs about 0.0001 BNB" icon={<Fuel className="size-5" />} tone={h?.gasBnb && Number(h.gasBnb) < 0.005 ? 'rose' : 'emerald'} />
        <StatCard label="Waiting to be sent" value={h ? tokens(h.pendingUnits) : '…'} icon={<Send className="size-5" />} tone="amber" />
      </div>
      {h?.blockedAddress ? (
        <Notice tone="danger">
          The saved payout key belongs to {h.blockedAddress}, which is the main supply wallet, so the server refuses to use it. Remove it (npx wrangler secret delete PAYOUT_PRIVATE_KEY --env production) and add the key of a NEW wallet that holds only a small amount of PMT.
        </Notice>
      ) : (
        h && !h.configured && <Notice tone="warning">The payout wallet is not set up: add PAYOUT_PRIVATE_KEY as a Worker secret (see docs/GO_LIVE.md).</Notice>
      )}
      <div className="max-w-xs">
        <Select label="Show" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="PENDING">Waiting</option>
          <option value="FAILED">Failed</option>
          <option value="PROCESSING">Being sent</option>
          <option value="PAID">Paid</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </Select>
      </div>
      <Card>
        <DataTable
          rows={list.data}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(w) => w.id}
          empty={{ title: 'Nothing here' }}
          columns={[
            { header: 'Requested', cell: (w) => dateTime(w.createdAt) },
            { header: 'Player', cell: (w) => `#${w.playerNumber} @${w.username}` },
            { header: 'To', cell: (w) => <CopyText value={w.address} label="Address" /> },
            { header: 'Send', cell: (w) => <strong>{tokens(w.sentUnits)}</strong>, className: 'text-right' },
            {
              header: 'Status',
              cell: (w) => (
                <span className="flex items-center gap-2">
                  <Badge tone={tone(w.status)}>{w.status.toLowerCase()}</Badge>
                  {w.txHash && (
                    <a href={`https://bscscan.com/tx/${w.txHash}`} target="_blank" rel="noreferrer" className="text-brand-600" aria-label="View on BscScan">
                      <ExternalLink className="size-4" />
                    </a>
                  )}
                </span>
              ),
            },
            {
              header: '',
              cell: (w) =>
                canPay && (w.status === 'PENDING' || w.status === 'FAILED') ? (
                  <span className="flex justify-end gap-2">
                    <Button size="sm" onClick={() => setPaying(w)}>
                      Pay
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setRejecting(w)}>
                      Reject
                    </Button>
                  </span>
                ) : null,
            },
          ]}
        />
      </Card>
      <ConfirmDialog
        open={!!paying}
        onClose={() => setPaying(null)}
        title="Send PMT now?"
        confirmLabel={`Send ${tokens(paying?.sentUnits ?? 0)}`}
        message={paying ? `This sends ${tokens(paying.sentUnits)} from the payout wallet to ${paying.address} on BNB Chain. Blockchain payments cannot be undone.${paying.status === 'FAILED' ? ' It failed before — check the payout wallet on BscScan first so you do not pay twice.' : ''}` : ''}
        onConfirm={async () => {
          await post(`/api/admin/crypto/withdrawals/${paying!.id}/pay`);
          toast.success('Sent.');
          reload();
        }}
      />
      <ConfirmDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject this withdrawal?"
        confirmLabel="Reject and return the PMT"
        tone="danger"
        reasonLabel="Reason (shown to the player)"
        message="The PMT goes back to the player's balance."
        onConfirm={async (reason) => {
          await post(`/api/admin/crypto/withdrawals/${rejecting!.id}/reject`, { reason });
          toast.success('Rejected — PMT returned.');
          reload();
        }}
      />
    </div>
  );
}
