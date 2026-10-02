import { useState } from 'react';
import { useParams } from 'react-router';
import { Ban } from 'lucide-react';
import { hasPermission, isTerminal, type LedgerTransactionDto, type MatchDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { Amount, BackLink } from '../../components/Common';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, ErrorState, KeyValue, PageHeader, PageLoader, StatusBadge, useToast } from '../../components/ui';
import { post } from '../../lib/api';
import { dateTime, human, percentFromBps, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

interface AdminMatch {
  match: MatchDto;
  resultSource: string | null;
  resultProof: string | null;
  voidReason: string | null;
  events: { type: string; actorType: string; payload: unknown; createdAt: number }[];
  settlement: LedgerTransactionDto | null;
}

export default function AdminMatchDetail() {
  const { id = '' } = useParams();
  const me = useMe();
  const toast = useToast();
  const d = useApi<AdminMatch>(`/api/admin/matches/${id}`);
  const [voiding, setVoiding] = useState(false);
  useDocumentTitle(d.data ? `Match #${d.data.match.matchNumber}` : 'Match');
  if (d.loading && !d.data) return <PageLoader />;
  if (d.error || !d.data) return <ErrorState error={d.error} onRetry={d.reload} />;
  const { match: m, events, settlement } = d.data;
  const canVoid = hasPermission(me.admin?.permissions, 'matches.manage') && !isTerminal(m.status);
  return (
    <div className="space-y-6">
      <PageHeader
        back={<BackLink to="/admin/games/live">Matches</BackLink>}
        title={<span className="flex items-center gap-3">Match #{m.matchNumber} <StatusBadge status={m.status} /></span>}
        subtitle={m.gameName}
        actions={canVoid && <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setVoiding(true)}>Void & refund</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Escrow & settlement" />
          <CardBody>
            <KeyValue
              columns={3}
              items={[
                ['Stake', tokens(m.stakeUnits)],
                ['Pot', tokens(m.potUnits)],
                ['Fee (snapshot)', `${percentFromBps(m.feeBps)} · ${tokens(m.feeUnits)}`],
                ['Payout', tokens(m.payoutUnits)],
                ['Winner', m.winnerPlayerNumber ? `#${m.winnerPlayerNumber}` : '—'],
                ['Result source', d.data.resultSource ? human(d.data.resultSource) : '—'],
                ['Void reason', d.data.voidReason ?? '—'],
                ['Created', dateTime(m.createdAt)],
                ['Ended', dateTime(m.endedAt)],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Players" />
          <DataTable
            rows={m.players}
            rowKey={(p) => String(p.playerNumber)}
            columns={[
              { header: 'Player', cell: (p) => `#${p.playerNumber} @${p.username}` },
              { header: 'Result', cell: (p) => (p.result ? <StatusBadge status={p.result} /> : '—') },
              { header: 'Payout', cell: (p) => tokens(p.payoutUnits) },
            ]}
          />
        </Card>
      </div>
      {settlement && (
        <Card>
          <CardHeader title={`Settlement transaction · ${human(settlement.type)}`} subtitle={settlement.id} />
          <DataTable
            rows={settlement.entries}
            rowKey={(e) => e.id}
            columns={[
              { header: 'Account', cell: (e) => e.accountLabel },
              { header: 'Posting', cell: (e) => human(e.postingType) },
              { header: 'Amount', cell: (e) => <Amount units={e.amountUnits} signed /> },
              { header: 'Balance after', cell: (e) => tokens(e.balanceAfterUnits) },
            ]}
          />
        </Card>
      )}
      <Card>
        <CardHeader title="Authoritative events" subtitle="Only important events are stored — never individual frames" />
        <DataTable
          rows={events}
          rowKey={(e) => `${e.createdAt}-${e.type}-${JSON.stringify(e.payload).length}`}
          empty={{ title: 'No events' }}
          columns={[
            { header: 'Time', cell: (e) => dateTime(e.createdAt) },
            { header: 'Event', cell: (e) => <span className="font-semibold">{human(e.type)}</span> },
            { header: 'Actor', cell: (e) => human(e.actorType) },
            { header: 'Details', cell: (e) => <code className="block max-w-md truncate text-xs text-ink-500">{JSON.stringify(e.payload)}</code>, hideOnMobile: true },
          ]}
        />
      </Card>
      <ConfirmDialog
        open={voiding}
        onClose={() => setVoiding(false)}
        tone="danger"
        title={`Void Match #${m.matchNumber}?`}
        confirmLabel="Void & refund all stakes"
        reasonLabel="Reason (audit log)"
        message="Every player gets their full stake back and no fee is charged. This cannot be undone."
        onConfirm={async (reason) => {
          await post(`/api/admin/matches/${m.id}/void`, { reason });
          toast.success('Match voided; stakes refunded.');
          d.reload();
        }}
      />
    </div>
  );
}
