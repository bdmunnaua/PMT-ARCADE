import { useNavigate } from 'react-router';
import { Gavel, MessageSquare, ShieldAlert } from 'lucide-react';
import { DISPUTE_CATEGORY_LABELS, type DisputeDto } from '@arena/shared';
import { Card, CardBody, CardHeader, DataTable, PageHeader, Pagination, StatusBadge } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { useDocumentTitle, usePaged } from '../../lib/hooks';

export default function SupportPage() {
  useDocumentTitle('Support');
  const navigate = useNavigate();
  const list = usePaged<DisputeDto>('/api/disputes', {});
  return (
    <div className="space-y-6">
      <PageHeader title="Support" subtitle="Get help with matches, purchases and redemptions." />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardBody className="space-y-2">
            <MessageSquare className="size-5 text-brand-600" />
            <h3 className="font-semibold">Questions about a payment?</h3>
            <p className="text-sm text-ink-500">Open the buy or sell request in your wallet and use its private chat — the finance team sees it directly.</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-2">
            <Gavel className="size-5 text-brand-600" />
            <h3 className="font-semibold">Problem with a match?</h3>
            <p className="text-sm text-ink-500">Open the match and choose “Report a problem”. Matches still in play are frozen until reviewed.</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-2">
            <ShieldAlert className="size-5 text-rose-500" />
            <h3 className="font-semibold">Stay safe</h3>
            <p className="text-sm text-ink-500">Staff will never ask for your password, bKash PIN or OTP. Report anyone who does.</p>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Your disputes" />
        <DataTable
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(d) => d.id}
          onRowClick={(d) => navigate(`/support/disputes/${d.id}`)}
          empty={{ title: 'No disputes', description: 'Disputes you open from a match appear here.' }}
          columns={[
            { header: 'Dispute', cell: (d) => <span className="font-semibold">#{d.disputeNumber}</span> },
            { header: 'Match', cell: (d) => `#${d.matchNumber} · ${d.gameName}` },
            { header: 'Category', cell: (d) => DISPUTE_CATEGORY_LABELS[d.category], hideOnMobile: true },
            { header: 'Status', cell: (d) => <StatusBadge status={d.status} /> },
            { header: 'Opened', cell: (d) => dateTime(d.createdAt), hideOnMobile: true },
          ]}
        />
        <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
      </Card>
    </div>
  );
}
