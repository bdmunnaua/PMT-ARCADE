import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ACCOUNT_STATUSES, hasPermission, TX_CATEGORY_LABELS, type AccountStatus, type AdminPlayerDetailDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { Amount, BackLink } from '../../components/Common';
import { WalletCards } from '../../components/Wallet';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, ErrorState, KeyValue, PageHeader, PageLoader, StatusBadge, Textarea, useToast } from '../../components/ui';
import { post } from '../../lib/api';
import { bdt, dateTime, human, percentFromBps, timeAgo, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

export default function AdminPlayerDetail() {
  const { id = '' } = useParams();
  const me = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const p = useApi<AdminPlayerDetailDto>(`/api/admin/players/${id}`);
  const [target, setTarget] = useState<AccountStatus | null>(null);
  const [note, setNote] = useState('');
  useDocumentTitle(p.data ? `Player #${p.data.playerNumber}` : 'Player');
  if (p.loading && !p.data) return <PageLoader />;
  if (p.error || !p.data) return <ErrorState error={p.error} onRetry={p.reload} />;
  const x = p.data;
  const perms = me.admin?.permissions ?? [];
  const canManage = hasPermission(perms, 'players.manage');
  const canNote = hasPermission(perms, 'support.notes') || canManage;
  const actions: { status: AccountStatus; label: string; tone: 'danger' | 'success' | 'primary' }[] = [
    { status: 'ACTIVE', label: x.accountStatus === 'SUSPENDED' ? 'Unsuspend' : 'Reactivate', tone: 'success' },
    { status: 'RESTRICTED', label: 'Restrict', tone: 'primary' },
    { status: 'SUSPENDED', label: 'Suspend', tone: 'danger' },
    { status: 'BANNED', label: 'Ban', tone: 'danger' },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        back={<BackLink to="/admin/players">Players</BackLink>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Player #{x.playerNumber} <StatusBadge status={x.accountStatus} /> {x.adminRole && <Badge tone="brand">{human(x.adminRole)}</Badge>}
          </span>
        }
        subtitle={`@${x.username} · ${x.displayName}`}
        actions={
          canManage &&
          actions
            .filter((a) => a.status !== x.accountStatus && ACCOUNT_STATUSES.includes(a.status))
            .map((a) => (
              <Button key={a.status} variant={a.tone === 'primary' ? 'outline' : a.tone} size="sm" onClick={() => setTarget(a.status)}>
                {a.label}
              </Button>
            ))
        }
      />
      <WalletCards wallet={x.wallet} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Account" />
          <CardBody>
            <KeyValue
              columns={3}
              items={[
                ['Email', <span>{x.email ?? '—'} {x.emailVerified ? <Badge tone="success">verified</Badge> : <Badge tone="warning">unverified</Badge>}</span>],
                ['Created', `${dateTime(x.createdAt)} (${x.accountAgeDays}d)`],
                ['Last login', dateTime(x.lastLoginAt)],
                ['Games played', x.stats.gamesPlayed],
                ['Wins / losses / draws', `${x.stats.wins} / ${x.stats.losses} / ${x.stats.draws}`],
                ['Win rate', percentFromBps(x.stats.winRateBps)],
                ['Total staked', tokens(x.stats.totalStakedUnits)],
                ['Total won', tokens(x.stats.totalWonUnits)],
                ['Open flags', x.openFlags],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Support notes" />
          <CardBody className="space-y-3">
            {canNote && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  await post(`/api/admin/players/${x.playerNumber}/notes`, { note }).then(
                    () => {
                      setNote('');
                      p.reload();
                    },
                    () => toast.error('Could not save note.'),
                  );
                }}
                className="space-y-2"
              >
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add an internal note (append-only)" aria-label="New note" />
                <Button type="submit" size="sm" disabled={!note.trim()}>
                  Add note
                </Button>
              </form>
            )}
            <ul className="max-h-64 space-y-3 overflow-y-auto">
              {x.notes.length === 0 && <li className="text-sm text-ink-500">No notes yet.</li>}
              {x.notes.map((n) => (
                <li key={n.id} className="rounded-xl bg-ink-50 p-3 text-sm dark:bg-ink-850">
                  <p className="whitespace-pre-wrap">{n.note}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    {n.adminLabel} · {timeAgo(n.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      {x.flags.length > 0 && (
        <Card>
          <CardHeader title="Risk flags" />
          <DataTable
            rows={x.flags}
            rowKey={(f) => f.id}
            columns={[
              { header: 'Type', cell: (f) => human(f.type) },
              { header: 'Severity', cell: (f) => <StatusBadge status={f.severity} /> },
              { header: 'Status', cell: (f) => <StatusBadge status={f.status} /> },
              { header: 'Raised', cell: (f) => dateTime(f.createdAt) },
            ]}
          />
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent transactions" />
          <DataTable
            rows={x.recentTransactions}
            rowKey={(t) => t.id}
            empty={{ title: 'No transactions' }}
            onRowClick={(t) => navigate(`/admin/finance/ledger?txId=${t.id}`)}
            columns={[
              { header: 'Date', cell: (t) => dateTime(t.createdAt) },
              { header: 'Type', cell: (t) => TX_CATEGORY_LABELS[t.category] },
              { header: 'Net', cell: (t) => <Amount units={t.netUnits} signed /> },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Recent matches" />
          <DataTable
            rows={x.recentMatches}
            rowKey={(m) => m.id}
            empty={{ title: 'No matches' }}
            onRowClick={(m) => navigate(`/admin/games/matches/${m.id}`)}
            columns={[
              { header: 'Match', cell: (m) => `#${m.matchNumber}` },
              { header: 'Game', cell: (m) => m.gameName },
              { header: 'Stake', cell: (m) => tokens(m.stakeUnits) },
              { header: 'Status', cell: (m) => <StatusBadge status={m.status} /> },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Buy requests" />
          <DataTable
            rows={x.recentBuyRequests}
            rowKey={(r) => r.id}
            empty={{ title: 'No buy requests' }}
            onRowClick={(r) => navigate(`/admin/finance/buy-requests/${r.id}`)}
            columns={[
              { header: '#', cell: (r) => r.requestNumber },
              { header: 'BDT', cell: (r) => bdt(r.amountPoisha) },
              { header: 'Tokens', cell: (r) => tokens(r.tokenUnits) },
              { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Sell requests" />
          <DataTable
            rows={x.recentSellRequests}
            rowKey={(r) => r.id}
            empty={{ title: 'No sell requests' }}
            onRowClick={(r) => navigate(`/admin/finance/sell-requests/${r.id}`)}
            columns={[
              { header: '#', cell: (r) => r.requestNumber },
              { header: 'Tokens', cell: (r) => tokens(r.amountUnits) },
              { header: 'BDT', cell: (r) => bdt(r.bdtPoisha) },
              { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        </Card>
      </div>

      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={`Change Player #${x.playerNumber} to ${target ?? ''}?`}
        confirmLabel="Change status"
        tone={target === 'ACTIVE' ? 'success' : 'danger'}
        reasonLabel="Reason (recorded in the audit log and shown to the player)"
        message={target === 'ACTIVE' ? 'The player will be able to play, buy and sell again.' : 'The player will not be able to play, buy or sell. Their balances are not changed.'}
        onConfirm={async (reason) => {
          await post(`/api/admin/players/${x.playerNumber}/status`, { status: target, reason });
          toast.success('Status updated.');
          p.reload();
        }}
      />
    </div>
  );
}
