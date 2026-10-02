import { Link, useParams } from 'react-router';
import { DISPUTE_CATEGORY_LABELS, DISPUTE_RESOLUTION_LABELS, type DisputeDto } from '@arena/shared';
import { BackLink } from '../../components/Common';
import { Card, CardBody, CardHeader, ErrorState, KeyValue, PageHeader, PageLoader, StatusBadge } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import { t } from '../../lib/i18n';

export default function DisputeDetailPage() {
  const { id = '' } = useParams();
  const d = useApi<DisputeDto>(`/api/disputes/${id}`);
  useDocumentTitle(t("Dispute"));
  if (d.loading && !d.data) return <PageLoader />;
  if (d.error || !d.data) return <ErrorState error={d.error} onRetry={d.reload} />;
  const x = d.data;
  return (
    <div className="space-y-6">
      <PageHeader back={<BackLink to="/support">{t("Support")}</BackLink>} title={`Dispute #${x.disputeNumber}`} subtitle={<Link className="font-semibold text-brand-600" to={`/matches/${x.matchId}`}>{t("Match #")}{x.matchNumber} · {x.gameName}</Link>} />
      <Card>
        <CardHeader title={t("Details")} actions={<StatusBadge status={x.status} />} />
        <CardBody className="space-y-5">
          <KeyValue
            items={[
              ['Category', DISPUTE_CATEGORY_LABELS[x.category]],
              ['Opened', dateTime(x.createdAt)],
              ['Resolution', x.resolution ? DISPUTE_RESOLUTION_LABELS[x.resolution] : 'Pending'],
              ['Resolved', dateTime(x.resolvedAt)],
            ]}
          />
          <div>
            <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">{t("Your report")}</p>
            <p className="mt-1 text-sm whitespace-pre-wrap">{x.description}</p>
          </div>
          {x.resolutionNote && (
            <div>
              <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">{t("Administrator’s note")}</p>
              <p className="mt-1 text-sm whitespace-pre-wrap">{x.resolutionNote}</p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
