import { Link, useParams } from 'react-router';
import { TX_CATEGORY_LABELS, type PlayerTransactionDetailDto } from '@arena/shared';
import { Amount, BackLink, CopyText } from '../../components/Common';
import { Card, CardBody, CardHeader, DataTable, ErrorState, KeyValue, PageHeader, PageLoader, StatusBadge } from '../../components/ui';
import { bdt, dateTime, human, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

export default function TransactionDetailPage() {
  const { id = '' } = useParams();
  useDocumentTitle('Transaction');
  const tx = useApi<PlayerTransactionDetailDto>(`/api/me/transactions/${id}`);
  if (tx.loading && !tx.data) return <PageLoader />;
  if (tx.error || !tx.data) return <ErrorState error={tx.error} onRetry={tx.reload} />;
  const t = tx.data;
  return (
    <div className="space-y-6">
      <PageHeader back={<BackLink to="/wallet/transactions">History</BackLink>} title={TX_CATEGORY_LABELS[t.category]} subtitle={t.description} />
      <Card>
        <CardHeader title="Summary" actions={<StatusBadge status="COMPLETED" />} />
        <CardBody>
          <KeyValue
            columns={3}
            items={[
              ['Reference number', <CopyText value={t.id} label="Transaction ID" />],
              ['Date', dateTime(t.createdAt)],
              ['Net effect on your total', <Amount units={t.netUnits} signed />],
              ...Object.entries(t.effects).map(([bucket, v]) => [`${human(bucket)} balance`, <Amount units={v} signed />] as [string, React.ReactNode]),
              ...(t.referenceLabel ? ([['Related to', t.referenceLabel]] as [string, string][]) : []),
            ]}
          />
        </CardBody>
      </Card>
      {t.match && (
        <Card>
          <CardHeader title="Related match" />
          <CardBody>
            <Link to={`/matches/${t.match.id}`} className="flex items-center justify-between rounded-xl border border-ink-200 p-4 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-850">
              <span className="font-semibold">
                Match #{t.match.matchNumber} · {t.match.gameName}
              </span>
              <StatusBadge status={t.match.status} />
            </Link>
          </CardBody>
        </Card>
      )}
      {t.buyRequest && (
        <Card>
          <CardHeader title={`Buy request #${t.buyRequest.requestNumber}`} actions={<Link className="text-sm font-semibold text-brand-600" to={`/wallet/buy/${t.buyRequest.id}`}>Open request & chat</Link>} />
          <CardBody>
            <KeyValue items={[['Paid', bdt(t.buyRequest.amountPoisha)], ['Rate', `৳1 = ${t.buyRequest.rateTokensPerBdt} PMT`], ['Payment reference', t.buyRequest.paymentReference], ['Sender', t.buyRequest.senderNumber]]} />
          </CardBody>
        </Card>
      )}
      {t.sellRequest && (
        <Card>
          <CardHeader title={`Sell request #${t.sellRequest.requestNumber}`} actions={<Link className="text-sm font-semibold text-brand-600" to={`/wallet/sell/${t.sellRequest.id}`}>Open request & chat</Link>} />
          <CardBody>
            <KeyValue
              items={[
                ['Payout', bdt(t.sellRequest.bdtPoisha)],
                ['Rate', `${t.sellRequest.rateTokensPerBdt} PMT = ৳1`],
                ['Receiving number', t.sellRequest.receivingNumber],
                ['Payment reference', t.sellRequest.payment?.outgoingReference ?? '—'],
              ]}
            />
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Ledger entries on your account" subtitle="Immutable double-entry records" />
        <DataTable
          rows={t.entries}
          rowKey={(e) => `${e.bucket}-${e.postingType}-${e.amountUnits}-${e.balanceAfterUnits}`}
          columns={[
            { header: 'Balance', cell: (e) => human(e.bucket) },
            { header: 'Posting', cell: (e) => human(e.postingType), hideOnMobile: true },
            { header: 'Amount', cell: (e) => <Amount units={e.amountUnits} signed /> },
            { header: 'Balance after', cell: (e) => tokens(e.balanceAfterUnits) },
          ]}
        />
      </Card>
    </div>
  );
}
