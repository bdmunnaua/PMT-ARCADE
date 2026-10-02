import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { DISPUTE_CATEGORY_LABELS, DISPUTE_RESOLUTION_LABELS, DISPUTE_RESOLUTIONS, hasPermission, parseTokenAmount, type AdminDisputeDto, type DisputeResolution } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { BackLink } from '../../components/Common';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, ErrorState, Input, KeyValue, Notice, PageHeader, PageLoader, Select, StatusBadge, useToast } from '../../components/ui';
import { post } from '../../lib/api';
import { dateTime, human, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

export default function AdminDisputeDetail() {
  const { id = '' } = useParams();
  const me = useMe();
  const toast = useToast();
  const d = useApi<AdminDisputeDto>(`/api/admin/disputes/${id}`);
  const [resolution, setResolution] = useState<DisputeResolution>('UPHOLD_RESULT');
  const [winner, setWinner] = useState('');
  const [compPlayer, setCompPlayer] = useState('');
  const [compAmount, setCompAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  useDocumentTitle(d.data ? `Dispute #${d.data.disputeNumber}` : 'Dispute');
  if (d.loading && !d.data) return <PageLoader />;
  if (d.error || !d.data) return <ErrorState error={d.error} onRetry={d.reload} />;
  const x = d.data;
  const perms = me.admin?.permissions ?? [];
  const canManage = hasPermission(perms, 'disputes.manage');
  const open = x.status === 'OPEN' || x.status === 'UNDER_REVIEW';
  const frozen = x.match.status === 'DISPUTED';
  const allowed = DISPUTE_RESOLUTIONS.filter((r) => (frozen ? ['SETTLE_WINNER', 'SETTLE_DRAW', 'VOID_REFUND'].includes(r) : ['UPHOLD_RESULT', 'COMPENSATE', 'REJECT'].includes(r)) && (r !== 'COMPENSATE' || hasPermission(perms, 'finance.distribute')));
  const current = allowed.includes(resolution) ? resolution : allowed[0]!;
  const compUnits = parseTokenAmount(compAmount);
  const winnerPlayer = x.match.players.find((p) => String(p.playerNumber) === winner);
  const compTarget = x.match.players.find((p) => String(p.playerNumber) === compPlayer);

  const describe = () => {
    switch (current) {
      case 'SETTLE_WINNER':
        return `Settle Match #${x.match.matchNumber} for Player #${winner}. The normal ${tokens(x.match.potUnits)} pot minus fee is paid through the settlement service.`;
      case 'SETTLE_DRAW':
        return 'Settle as a draw: every stake is returned, no fee.';
      case 'VOID_REFUND':
        return 'Void the match: every stake is returned, no fee.';
      case 'COMPENSATE':
        return `Grant ${tokens(compUnits ?? 0)} from the admin treasury to Player #${compPlayer} as compensation (ledger transaction).`;
      case 'REJECT':
        return 'Reject the complaint. No tokens move.';
      default:
        return 'Keep the recorded result. No tokens move.';
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        back={<BackLink to="/admin/games/disputes">Disputes</BackLink>}
        title={<span className="flex items-center gap-3">Dispute #{x.disputeNumber} <StatusBadge status={x.status} /></span>}
        subtitle={<Link className="font-semibold text-brand-600" to={`/admin/games/matches/${x.matchId}`}>Match #{x.matchNumber} · {x.gameName}</Link>}
        actions={canManage && x.status === 'OPEN' && <Button variant="outline" onClick={() => post(`/api/admin/disputes/${x.id}/review`).then(d.reload)}>Start review</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Complaint" />
          <CardBody className="space-y-4">
            <KeyValue
              columns={3}
              items={[
                ['Player', <Link className="text-brand-600" to={`/admin/players/${x.player.playerNumber}`}>#{x.player.playerNumber} @{x.player.username}</Link>],
                ['Category', DISPUTE_CATEGORY_LABELS[x.category]],
                ['Opened', dateTime(x.createdAt)],
                ['Match status', <StatusBadge status={x.match.status} />],
                ['Stake', tokens(x.match.stakeUnits)],
                ['Settlement tx', x.settlementTxId ?? '—'],
              ]}
            />
            <p className="rounded-xl bg-ink-50 p-4 text-sm whitespace-pre-wrap dark:bg-ink-850">{x.description}</p>
            {x.resolution && (
              <Notice tone="success" title={DISPUTE_RESOLUTION_LABELS[x.resolution]}>
                {x.resolutionNote}
              </Notice>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Players" />
          <DataTable
            rows={x.match.players}
            rowKey={(p) => String(p.playerNumber)}
            columns={[
              { header: 'Player', cell: (p) => `#${p.playerNumber} @${p.username}` },
              { header: 'Result', cell: (p) => (p.result ? <StatusBadge status={p.result} /> : '—') },
            ]}
          />
        </Card>
      </div>

      {canManage && open && (
        <Card>
          <CardHeader title="Resolve" subtitle={frozen ? 'This match is frozen — choose how its escrow is settled.' : 'The match is already resolved — you can uphold, compensate or reject.'} />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Select label="Resolution" value={current} onChange={(e) => setResolution(e.target.value as DisputeResolution)}>
              {allowed.map((r) => (
                <option key={r} value={r}>
                  {DISPUTE_RESOLUTION_LABELS[r]}
                </option>
              ))}
            </Select>
            {current === 'SETTLE_WINNER' && (
              <Select label="Winner" value={winner} onChange={(e) => setWinner(e.target.value)}>
                <option value="">Choose…</option>
                {x.match.players.map((p) => (
                  <option key={p.playerNumber} value={p.playerNumber}>
                    #{p.playerNumber} @{p.username}
                  </option>
                ))}
              </Select>
            )}
            {current === 'COMPENSATE' && (
              <>
                <Select label="Player" value={compPlayer} onChange={(e) => setCompPlayer(e.target.value)}>
                  <option value="">Choose…</option>
                  {x.match.players.map((p) => (
                    <option key={p.playerNumber} value={p.playerNumber}>
                      #{p.playerNumber} @{p.username}
                    </option>
                  ))}
                </Select>
                <Input label="Amount (PMT)" value={compAmount} onChange={(e) => setCompAmount(e.target.value)} inputMode="decimal" />
              </>
            )}
            <div className="flex items-end sm:col-span-3">
              <Button
                onClick={() => setConfirming(true)}
                disabled={(current === 'SETTLE_WINNER' && !winnerPlayer) || (current === 'COMPENSATE' && (!compTarget || !compUnits))}
                variant={current === 'REJECT' ? 'outline' : 'primary'}
              >
                Resolve dispute…
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Match events" />
        <DataTable
          rows={x.events}
          rowKey={(e) => `${e.createdAt}-${e.type}`}
          empty={{ title: 'No events' }}
          columns={[
            { header: 'Time', cell: (e) => dateTime(e.createdAt) },
            { header: 'Event', cell: (e) => human(e.type) },
            { header: 'Details', cell: (e) => <code className="block max-w-lg truncate text-xs text-ink-500">{JSON.stringify(e.payload)}</code> },
          ]}
        />
      </Card>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={DISPUTE_RESOLUTION_LABELS[current]}
        confirmLabel="Confirm resolution"
        tone={current === 'REJECT' ? 'danger' : 'primary'}
        reasonLabel="Resolution note (shown to the player and audited)"
        message={describe()}
        onConfirm={async (note) => {
          await post(`/api/admin/disputes/${x.id}/resolve`, {
            resolution: current,
            note,
            ...(current === 'SETTLE_WINNER' ? { winnerPlayerNumber: Number(winner) } : {}),
            ...(current === 'COMPENSATE' ? { compensationPlayerNumber: Number(compPlayer), compensationUnits: compUnits } : {}),
          });
          toast.success('Dispute resolved.');
          d.reload();
        }}
      />
    </div>
  );
}
