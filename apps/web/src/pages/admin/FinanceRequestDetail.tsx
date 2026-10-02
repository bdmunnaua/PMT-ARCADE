import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { CheckCircle2, Eye, Send, XCircle } from 'lucide-react';
import { formatMinor, hasPermission, parseBdtAmount, type AdminBuyRequestDto, type AdminFinanceContextDto, type AdminSellRequestDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { ChatPanel } from '../../components/ChatPanel';
import { BackLink, CopyText, Timeline } from '../../components/Common';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Input, KeyValue, Notice, PageHeader, PageLoader, StatusBadge, Textarea, useToast } from '../../components/ui';
import { post } from '../../lib/api';
import { bdt, dateTime, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import { useRealtime } from '../../lib/realtime';
import { FinanceContext, PlayerSummaryCard } from './finance-shared';

function NotesCard({ initial, onSave, canEdit }: { initial: string | null; onSave: (notes: string) => Promise<void>; canEdit: boolean }) {
  const [notes, setNotes] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Admin notes" subtitle="Internal — never shown to the player" />
      <CardBody className="space-y-2">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} disabled={!canEdit} aria-label="Admin notes" />
        {canEdit && (
          <Button size="sm" variant="outline" loading={busy} onClick={() => { setBusy(true); void onSave(notes).finally(() => setBusy(false)); }}>
            Save notes
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

export function AdminBuyRequestDetail() {
  const { id = '' } = useParams();
  const me = useMe();
  const toast = useToast();
  const d = useApi<{ request: AdminBuyRequestDto; context: AdminFinanceContextDto }>(`/api/admin/buy-requests/${id}`);
  const [action, setAction] = useState<null | 'review' | 'approve' | 'reject'>(null);
  useDocumentTitle(d.data ? `Buy #${d.data.request.requestNumber}` : 'Buy request');
  useRealtime(`finance:BUY:${id}`, (m) => m.type === 'request.updated' && d.reload());
  if (d.loading && !d.data) return <PageLoader />;
  if (d.error || !d.data) return <ErrorState error={d.error} onRetry={d.reload} />;
  const { request: r, context } = d.data;
  const perms = me.admin?.permissions ?? [];
  const canManage = hasPermission(perms, 'finance.buy.manage');
  const open = r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW';
  const run = (path: string, body?: unknown) => post(`/api/admin/buy-requests/${r.id}/${path}`, body).then(() => d.reload());

  return (
    <div className="space-y-6">
      <PageHeader
        back={<BackLink to="/admin/finance/buy-requests">Buy requests</BackLink>}
        title={<span className="flex items-center gap-3">Buy request #{r.requestNumber} <StatusBadge status={r.status} /></span>}
        subtitle={`Submitted ${dateTime(r.createdAt)}${r.reviewedBy ? ` · reviewer ${r.reviewedBy}` : ''}`}
        actions={
          canManage &&
          open && (
            <>
              {r.status === 'SUBMITTED' && <Button variant="outline" icon={<Eye className="size-4" />} onClick={() => setAction('review')}>Start review</Button>}
              <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => setAction('reject')}>Reject</Button>
              <Button variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => setAction('approve')}>Approve & credit</Button>
            </>
          )
        }
      />
      {r.status === 'COMPLETED' && r.ledgerTxId && (
        <Notice tone="success" title="Credited">
          Ledger transaction <Link className="font-mono underline" to={`/admin/finance/ledger?txId=${r.ledgerTxId}`}>{r.ledgerTxId}</Link>. This action cannot be repeated.
        </Notice>
      )}
      {r.status === 'REJECTED' && <Notice tone="danger" title="Rejected">{r.rejectionReason}</Notice>}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Payment to verify" />
            <CardBody>
              <KeyValue
                columns={3}
                items={[
                  ['Request ID', <CopyText value={r.id} label="Request ID" />],
                  ['Requested BDT', <span className="text-lg font-bold">{bdt(r.amountPoisha)}</span>],
                  ['Tokens to credit', <span className="text-lg font-bold">{tokens(r.tokenUnits)}</span>],
                  ['Rate snapshot', `৳1 = ${r.rateTokensPerBdt} PMT`],
                  ['Payment method', r.paymentMethod],
                  ['Sender number', <span className="font-mono">{r.senderNumber}</span>],
                  ['Transaction / reference ID', <CopyText value={r.paymentReference} label="Reference" />],
                  ['Submitted', dateTime(r.createdAt)],
                  ['Player note', r.note ?? '—'],
                ]}
              />
            </CardBody>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChatPanel kind="BUY" requestId={r.id} side="ADMIN" canSend={hasPermission(perms, 'finance.chat')} />
            <div className="space-y-6">
              <Card>
                <CardHeader title="Timeline" />
                <CardBody>
                  <Timeline events={r.events} />
                </CardBody>
              </Card>
              <NotesCard initial={r.adminNotes} canEdit={canManage} onSave={(notes) => run('notes', { notes }).then(() => toast.success('Notes saved.'))} />
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <PlayerSummaryCard player={r.player} />
          <FinanceContext ctx={context} />
        </div>
      </div>

      <ConfirmDialog open={action === 'review'} onClose={() => setAction(null)} title="Start review?" confirmLabel="Start review" message="The player sees that the request is under review and can no longer cancel it." onConfirm={() => run('review')} />
      <ConfirmDialog
        open={action === 'approve'}
        onClose={() => setAction(null)}
        tone="success"
        title="Approve & credit"
        confirmLabel={`Credit ${tokens(r.tokenUnits)}`}
        message={
          <>
            Credit <strong>{tokens(r.tokenUnits)}</strong> to <strong>Player #{r.player.playerNumber}</strong>? Only continue if you confirmed <strong>{bdt(r.amountPoisha)}</strong> arrived with reference <span className="font-mono">{r.paymentReference}</span>. Tokens come from the admin treasury and this cannot be repeated.
          </>
        }
        onConfirm={async () => {
          await run('approve');
          toast.success('Tokens credited.');
        }}
      />
      <ConfirmDialog
        open={action === 'reject'}
        onClose={() => setAction(null)}
        tone="danger"
        title={`Reject buy request #${r.requestNumber}?`}
        confirmLabel="Reject request"
        reasonLabel="Rejection reason (shown to the player)"
        message="No tokens are credited. The payment reference becomes available again."
        onConfirm={async (reason) => {
          await run('reject', { reason });
          toast.success('Request rejected.');
        }}
      />
    </div>
  );
}

export function AdminSellRequestDetail() {
  const { id = '' } = useParams();
  const me = useMe();
  const toast = useToast();
  const d = useApi<{ request: AdminSellRequestDto; context: AdminFinanceContextDto }>(`/api/admin/sell-requests/${id}`);
  const [action, setAction] = useState<null | 'review' | 'approve' | 'reject' | 'paid'>(null);
  const [sent, setSent] = useState('');
  const [ref, setRef] = useState('');
  const [payNote, setPayNote] = useState('');
  useDocumentTitle(d.data ? `Sell #${d.data.request.requestNumber}` : 'Sell request');
  useRealtime(`finance:SELL:${id}`, (m) => m.type === 'request.updated' && d.reload());
  if (d.loading && !d.data) return <PageLoader />;
  if (d.error || !d.data) return <ErrorState error={d.error} onRetry={d.reload} />;
  const { request: r, context } = d.data;
  const perms = me.admin?.permissions ?? [];
  const canManage = hasPermission(perms, 'finance.sell.manage');
  const run = (path: string, body?: unknown) => post(`/api/admin/sell-requests/${r.id}/${path}`, body).then(() => d.reload());
  const sentPoisha = parseBdtAmount(sent);
  const reviewable = r.status === 'TOKENS_LOCKED' || r.status === 'UNDER_REVIEW';

  return (
    <div className="space-y-6">
      <PageHeader
        back={<BackLink to="/admin/finance/sell-requests">Sell requests</BackLink>}
        title={<span className="flex items-center gap-3">Sell request #{r.requestNumber} <StatusBadge status={r.status} /></span>}
        subtitle={`Submitted ${dateTime(r.createdAt)}${r.reviewedBy ? ` · reviewer ${r.reviewedBy}` : ''}`}
        actions={
          canManage && (
            <>
              {r.status === 'TOKENS_LOCKED' && <Button variant="outline" icon={<Eye className="size-4" />} onClick={() => setAction('review')}>Start review</Button>}
              {(reviewable || r.status === 'PAYMENT_PROCESSING') && <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => setAction('reject')}>Reject</Button>}
              {reviewable && <Button variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => setAction('approve')}>Approve</Button>}
            </>
          )
        }
      />
      {r.status === 'PAYMENT_PROCESSING' && canManage && (
        <Card className="border-brand-300 dark:border-brand-500/40">
          <CardHeader title="Record the payment" subtitle={`Send ${bdt(r.bdtPoisha)} to ${r.receivingNumber}, then confirm it here.`} icon={<Send className="size-4" />} />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Input label="Amount sent (BDT)" value={sent} onChange={(e) => setSent(e.target.value)} inputMode="decimal" placeholder={formatMinor(r.bdtPoisha)} hint={`Must equal ${bdt(r.bdtPoisha)}`} />
            <Input label="Outgoing transaction ID" value={ref} onChange={(e) => setRef(e.target.value)} className="font-mono uppercase" />
            <Input label="Payment note (optional)" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            <div className="sm:col-span-3">
              <Button variant="success" disabled={!sentPoisha || ref.trim().length < 4} onClick={() => setAction('paid')}>
                Confirm payment sent…
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
      {r.payment && (
        <Notice tone="success" title="Payment recorded">
          {bdt(r.payment.amountSentPoisha)} sent · reference <span className="font-mono">{r.payment.outgoingReference}</span> · {dateTime(r.payment.sentAt)}
        </Notice>
      )}
      {r.status === 'TOKENS_UNLOCKED' && <Notice tone="danger" title="Rejected — tokens returned to the player">{r.rejectionReason}</Notice>}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Redemption" />
            <CardBody>
              <KeyValue
                columns={3}
                items={[
                  ['Request ID', <CopyText value={r.id} label="Request ID" />],
                  ['Tokens (locked)', <span className="text-lg font-bold">{tokens(r.amountUnits)}</span>],
                  ['BDT to pay', <span className="text-lg font-bold">{bdt(r.bdtPoisha)}</span>],
                  ['Rate snapshot', `${r.rateTokensPerBdt} PMT = ৳1`],
                  ['Method', r.paymentMethod],
                  ['Receiving number', <span className="font-mono">{r.receivingNumber}</span>],
                  ['Player note', r.note ?? '—'],
                  ['Ledger', r.ledgerTxId ? <Link className="font-mono text-xs text-brand-600" to={`/admin/finance/ledger?txId=${r.ledgerTxId}`}>{r.ledgerTxId}</Link> : '—'],
                ]}
              />
            </CardBody>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChatPanel kind="SELL" requestId={r.id} side="ADMIN" canSend={hasPermission(perms, 'finance.chat')} />
            <div className="space-y-6">
              <Card>
                <CardHeader title="Timeline" />
                <CardBody>
                  <Timeline events={r.events} />
                </CardBody>
              </Card>
              <NotesCard initial={r.adminNotes} canEdit={canManage} onSave={(notes) => run('notes', { notes }).then(() => toast.success('Notes saved.'))} />
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <PlayerSummaryCard player={r.player} />
          <FinanceContext ctx={context} />
        </div>
      </div>

      <ConfirmDialog open={action === 'review'} onClose={() => setAction(null)} title="Start review?" confirmLabel="Start review" message="The player can no longer cancel this request." onConfirm={() => run('review')} />
      <ConfirmDialog
        open={action === 'approve'}
        onClose={() => setAction(null)}
        tone="success"
        title="Approve redemption"
        confirmLabel="Approve"
        message={
          <>
            Approve redemption of <strong>{tokens(r.amountUnits)}</strong> for <strong>{bdt(r.bdtPoisha)}</strong>? The request moves to <em>Payment processing</em>. Nothing is completed until you confirm the payment.
          </>
        }
        onConfirm={async () => {
          await run('approve');
          toast.success('Approved — now send the payment.');
        }}
      />
      <ConfirmDialog
        open={action === 'reject'}
        onClose={() => setAction(null)}
        tone="danger"
        title={`Reject sell request #${r.requestNumber}?`}
        confirmLabel="Reject & unlock tokens"
        reasonLabel="Rejection reason (shown to the player)"
        message={`${tokens(r.amountUnits)} return to the player’s available balance.`}
        onConfirm={async (reason) => {
          await run('reject', { reason });
          toast.success('Rejected; tokens unlocked.');
        }}
      />
      <ConfirmDialog
        open={action === 'paid'}
        onClose={() => setAction(null)}
        tone="success"
        title="Confirm payment sent"
        confirmLabel="Confirm payment sent"
        message={
          <>
            Confirm that <strong>{bdt(sentPoisha ?? 0)}</strong> was sent to the player’s registered payment destination <span className="font-mono">{r.receivingNumber}</span> with reference <span className="font-mono">{ref.toUpperCase()}</span>? {tokens(r.amountUnits)} will move from the player’s locked balance to the admin treasury. This cannot be undone or repeated.
          </>
        }
        onConfirm={async () => {
          await run('payment-sent', { amountSentPoisha: sentPoisha, outgoingReference: ref, note: payNote || undefined });
          toast.success('Payment recorded — request completed.');
        }}
      />
    </div>
  );
}
