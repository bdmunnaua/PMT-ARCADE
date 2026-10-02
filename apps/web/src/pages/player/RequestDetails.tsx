import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { BuyRequestDto, SellRequestDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { ChatPanel } from '../../components/ChatPanel';
import { BackLink, CopyText, Timeline } from '../../components/Common';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, KeyValue, Notice, PageHeader, PageLoader, StatusBadge, useToast } from '../../components/ui';
import { post } from '../../lib/api';
import { bdt, dateTime, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import { useRealtime } from '../../lib/realtime';

export function BuyRequestDetail() {
  const { id = '' } = useParams();
  const me = useMe();
  const toast = useToast();
  const r = useApi<BuyRequestDto>(`/api/wallet/buy-requests/${id}`);
  const [cancelling, setCancelling] = useState(false);
  useDocumentTitle(r.data ? `Buy request #${r.data.requestNumber}` : 'Buy request');
  useRealtime(`finance:BUY:${id}`, (m) => m.type === 'request.updated' && r.reload());
  useRealtime(`user:${me.id}`, (m) => m.type === 'notification' && r.reload());
  if (r.loading && !r.data) return <PageLoader />;
  if (r.error || !r.data) return <ErrorState error={r.error} onRetry={r.reload} />;
  const b = r.data;
  return (
    <div className="space-y-6">
      <PageHeader
        back={<BackLink to="/wallet/transactions?tab=buy">Buy requests</BackLink>}
        title={`Buy request #${b.requestNumber}`}
        subtitle={`Submitted ${dateTime(b.createdAt)}`}
        actions={
          b.status === 'SUBMITTED' && (
            <Button variant="outline" onClick={() => setCancelling(true)}>
              Cancel request
            </Button>
          )
        }
      />
      {b.status === 'REJECTED' && b.rejectionReason && <Notice tone="danger" title="Rejected">{b.rejectionReason}</Notice>}
      {b.status === 'COMPLETED' && b.ledgerTxId && (
        <Notice tone="success" title="Tokens credited">
          {tokens(b.tokenUnits)} were added to your available balance. <Link className="font-semibold underline" to={`/wallet/transactions/${b.ledgerTxId}`}>View transaction</Link>
        </Notice>
      )}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title="Request" actions={<StatusBadge status={b.status} />} />
            <CardBody>
              <KeyValue
                items={[
                  ['Request ID', <CopyText value={b.id} label="Request ID" />],
                  ['Amount paid', bdt(b.amountPoisha)],
                  ['Tokens', tokens(b.tokenUnits)],
                  ['Rate (locked at submission)', `৳1 = ${b.rateTokensPerBdt} PMT`],
                  ['Payment method', b.paymentMethod === 'BKASH_MANUAL' ? 'bKash (manual)' : 'Other (manual)'],
                  ['Sender number', b.senderNumber],
                  ['Transaction ID', <span className="font-mono">{b.paymentReference}</span>],
                  ['Note', b.note ?? '—'],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Status timeline" />
            <CardBody>
              <Timeline events={b.events} />
            </CardBody>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <ChatPanel kind="BUY" requestId={b.id} side="PLAYER" />
        </div>
      </div>
      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="Cancel this buy request?"
        confirmLabel="Cancel request"
        tone="danger"
        message="Only cancel if you did not send the payment. If you already paid, keep the request and message support instead."
        onConfirm={async () => {
          await post(`/api/wallet/buy-requests/${b.id}/cancel`);
          toast.success('Request cancelled.');
          r.reload();
        }}
      />
    </div>
  );
}

export function SellRequestDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const r = useApi<SellRequestDto>(`/api/wallet/sell-requests/${id}`);
  const [cancelling, setCancelling] = useState(false);
  useDocumentTitle(r.data ? `Sell request #${r.data.requestNumber}` : 'Sell request');
  useRealtime(`finance:SELL:${id}`, (m) => m.type === 'request.updated' && r.reload());
  if (r.loading && !r.data) return <PageLoader />;
  if (r.error || !r.data) return <ErrorState error={r.error} onRetry={r.reload} />;
  const s = r.data;
  return (
    <div className="space-y-6">
      <PageHeader
        back={<BackLink to="/wallet/transactions?tab=sell">Sell requests</BackLink>}
        title={`Sell request #${s.requestNumber}`}
        subtitle={`Submitted ${dateTime(s.createdAt)}`}
        actions={
          s.status === 'TOKENS_LOCKED' && (
            <Button variant="outline" onClick={() => setCancelling(true)}>
              Cancel & unlock tokens
            </Button>
          )
        }
      />
      {s.status === 'TOKENS_UNLOCKED' && <Notice tone="danger" title="Rejected — tokens returned">{s.rejectionReason}</Notice>}
      {s.payment && (
        <Notice tone="success" title={`${bdt(s.payment.amountSentPoisha)} sent`}>
          Payment reference <span className="font-mono">{s.payment.outgoingReference}</span> on {dateTime(s.payment.sentAt)}.
        </Notice>
      )}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title="Request" actions={<StatusBadge status={s.status} />} />
            <CardBody>
              <KeyValue
                items={[
                  ['Request ID', <CopyText value={s.id} label="Request ID" />],
                  ['Tokens', tokens(s.amountUnits)],
                  ['Payout', bdt(s.bdtPoisha)],
                  ['Rate (locked at submission)', `${s.rateTokensPerBdt} PMT = ৳1`],
                  ['Receiving number', s.receivingNumber],
                  ['Note', s.note ?? '—'],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Status timeline" />
            <CardBody>
              <Timeline events={s.events} />
            </CardBody>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <ChatPanel kind="SELL" requestId={s.id} side="PLAYER" />
        </div>
      </div>
      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="Cancel this sell request?"
        confirmLabel="Cancel & unlock"
        tone="danger"
        message={`${tokens(s.amountUnits)} will return to your available balance.`}
        onConfirm={async () => {
          await post(`/api/wallet/sell-requests/${s.id}/cancel`);
          toast.success('Tokens unlocked.');
          r.reload();
        }}
      />
    </div>
  );
}
