import { Link, useParams } from 'react-router';
import { TX_CATEGORY_LABELS, type PlayerTransactionDetailDto } from '@arena/shared';
import { Amount, BackLink, CopyText } from '../../components/Common';
import { Card, CardBody, CardHeader, DataTable, ErrorState, KeyValue, PageHeader, PageLoader, StatusBadge } from '../../components/ui';
import { bdt, dateTime, human, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import { t } from '../../lib/i18n';

export default function TransactionDetailPage() {
  const { id = '' } = useParams();
  useDocumentTitle(t("Transaction"));
  const tx = useApi<PlayerTransactionDetailDto>(`/api/me/transactions/${id}`);
  if (tx.loading && !tx.data) return <PageLoader />;
  if (tx.error || !tx.data) return <ErrorState error={tx.error} onRetry={tx.reload} />;
  const d = tx.data;
  return (
    <div className="space-y-6">
      <PageHeader back={<BackLink to="/wallet/transactions">{t("History")}</BackLink>} title={t(TX_CATEGORY_LABELS[d.category])} subtitle={d.description} />
      <Card>
        <CardHeader title={t("Summary")} actions={<StatusBadge status="COMPLETED" />} />
        <CardBody>
          <KeyValue
            columns={3}
            items={[
              ['Reference number', <CopyText value={d.id} label={t("Transaction ID")} />],
              ['Date', dateTime(d.createdAt)],
              ['Net effect on your total', <Amount units={d.netUnits} signed />],
              ...Object.entries(d.effects).map(([bucket, v]) => [`${human(bucket)} balance`, <Amount units={v} signed />] as [string, React.ReactNode]),
              ...(d.referenceLabel ? ([['Related to', d.referenceLabel]] as [string, string][]) : []),
            ]}
          />
        </CardBody>
      </Card>
      {d.match && (
        <Card>
          <CardHeader title={t("Related match")} />
          <CardBody>
            <Link to={`/matches/${d.match.id}`} className="flex items-center justify-between rounded-xl border border-ink-200 p-4 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-850">
              <span className="font-semibold">
                {t('Match #{n}', { n: String(d.match.matchNumber) })} · {d.match.gameName}
              </span>
              <StatusBadge status={d.match.status} />
            </Link>
          </CardBody>
        </Card>
      )}
      {d.buyRequest && (
        <Card>
          <CardHeader title={t('Buy request #{n}', { n: String(d.buyRequest.requestNumber) })} actions={<Link className="text-sm font-semibold text-brand-600" to={`/wallet/buy/${d.buyRequest.id}`}>{t("Open request & chat")}</Link>} />
          <CardBody>
            <KeyValue items={[['Paid', bdt(d.buyRequest.amountPoisha)], ['Rate', `৳1 = ${d.buyRequest.rateTokensPerBdt} PMT`], ['Payment reference', d.buyRequest.paymentReference], ['Sender', d.buyRequest.senderNumber]]} />
          </CardBody>
        </Card>
      )}
      {d.sellRequest && (
        <Card>
          <CardHeader title={t('Sell request #{n}', { n: String(d.sellRequest.requestNumber) })} actions={<Link className="text-sm font-semibold text-brand-600" to={`/wallet/sell/${d.sellRequest.id}`}>{t("Open request & chat")}</Link>} />
          <CardBody>
            <KeyValue
              items={[
                ['Payout', bdt(d.sellRequest.bdtPoisha)],
                ['Rate', `${d.sellRequest.rateTokensPerBdt} PMT = ৳1`],
                ['Receiving number', d.sellRequest.receivingNumber],
                ['Payment reference', d.sellRequest.payment?.outgoingReference ?? '—'],
              ]}
            />
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title={t("Ledger entries on your account")} subtitle={t("Immutable double-entry records")} />
        <DataTable
          rows={d.entries}
          rowKey={(e) => `${e.bucket}-${e.postingType}-${e.amountUnits}-${e.balanceAfterUnits}`}
          columns={[
            { header: t("Balance"), cell: (e) => human(e.bucket) },
            { header: t("Posting"), cell: (e) => human(e.postingType), hideOnMobile: true },
            { header: t("Amount"), cell: (e) => <Amount units={e.amountUnits} signed /> },
            { header: t("Balance after"), cell: (e) => tokens(e.balanceAfterUnits) },
          ]}
        />
      </Card>
    </div>
  );
}
