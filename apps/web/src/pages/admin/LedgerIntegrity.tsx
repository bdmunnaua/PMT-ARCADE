import { useState } from 'react';
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import type { IntegrityReportDto } from '@arena/shared';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, KeyValue, Notice, PageHeader } from '../../components/ui';
import { ApiError, post } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { useDocumentTitle } from '../../lib/hooks';

export default function LedgerIntegrity() {
  useDocumentTitle('Ledger integrity');
  const [report, setReport] = useState<IntegrityReportDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await post<IntegrityReportDto>('/api/admin/ledger/integrity'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Check failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Ledger integrity" subtitle="Reconciles every cached balance against the immutable ledger. Read-only — it never modifies balances." actions={<Button onClick={run} loading={busy} icon={<ShieldCheck className="size-4" />}>Run integrity check</Button>} />
      {error && <Notice tone="danger">{error}</Notice>}
      {!report ? (
        <Card>
          <EmptyState icon={<ShieldCheck className="size-6" />} title="No check run yet" description="The check scans the full ledger, so it runs only when you ask." />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title={<span className="flex items-center gap-3">Result {report.status === 'PASS' ? <Badge tone="success">PASS</Badge> : <Badge tone="danger">FAIL</Badge>}</span>} subtitle={`${dateTime(report.checkedAt)} · ${report.durationMs} ms`} />
            <CardBody>
              <KeyValue columns={3} items={[['Transactions', report.stats.transactions], ['Entries', report.stats.entries], ['Accounts', report.stats.accounts], ['Active holds', report.stats.activeHolds], ['Issues', report.issues.length]]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Checks" />
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {report.checks.map((c) => (
                <li key={c.name} className="flex items-center gap-3 px-5 py-3 text-sm">
                  {c.passed ? <CheckCircle2 className="size-5 text-emerald-500" /> : <XCircle className="size-5 text-rose-500" />} {c.name}
                </li>
              ))}
            </ul>
          </Card>
          {report.issues.length > 0 && (
            <Card>
              <CardHeader title="Reconciliation errors" subtitle="Investigate and correct with compensating transactions (Finance → Adjustments) — never by editing balances." />
              <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                {report.issues.map((i, n) => (
                  <li key={n} className="px-5 py-3 text-sm">
                    <span className="font-mono text-xs text-rose-600">{i.check}</span> — {i.message}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
