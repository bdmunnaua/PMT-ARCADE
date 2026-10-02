import { useNavigate } from 'react-router';
import { ArrowDownToLine, ArrowUpFromLine, Gamepad2, Percent, Swords, Trophy, XCircle } from 'lucide-react';
import type { MatchDto, Paginated, PlayerTransactionDto } from '@arena/shared';
import { TX_CATEGORY_LABELS } from '@arena/shared';
import { useAuth, useMe } from '../../auth/AuthProvider';
import { Amount } from '../../components/Common';
import { CheckinCard, InviteCard } from '../../components/Arcade';
import { useWallet } from '../../components/Wallet';
import { ButtonLink, Card, CardHeader, DataTable, StatCard, StatusBadge } from '../../components/ui';
import { percentFromBps, timeAgo, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const me = useMe();
  const { config } = useAuth();
  const navigate = useNavigate();
  const wallet = useWallet();
  const matches = useApi<Paginated<MatchDto>>('/api/me/matches?pageSize=5');
  const txs = useApi<Paginated<PlayerTransactionDto>>('/api/me/transactions?pageSize=5');
  const s = me.stats;
  return (
    <div className="space-y-6">
      <div className="hero-gradient relative overflow-hidden rounded-3xl p-6 text-white sm:p-8">
        <p className="text-sm font-medium text-white/70">Player #{me.playerNumber}</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Welcome back, {me.displayName}</h1>
        <p className="mt-6 text-sm text-white/70">Total balance</p>
        <p className="text-4xl font-bold tracking-tight tabular-nums">{wallet.data ? tokens(wallet.data.totalUnits) : '…'}</p>
        <p className="mt-1 text-sm text-white/70">
          Available {wallet.data ? tokens(wallet.data.availableUnits) : '…'} · Bonus {wallet.data ? tokens(wallet.data.bonusUnits) : '…'}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <ButtonLink to="/play" icon={<Gamepad2 className="size-4" />} className="bg-white !text-ink-900 hover:bg-white/90">
            Play now
          </ButtonLink>
          {config?.buyRequestsEnabled && (
            <ButtonLink to="/wallet/buy" variant="outline" className="border-white/30 !bg-white/10 !text-white hover:!bg-white/20" icon={<ArrowDownToLine className="size-4" />}>
              Buy PMT
            </ButtonLink>
          )}
          {config?.sellRequestsEnabled && (
            <ButtonLink to="/wallet/sell" variant="outline" className="border-white/30 !bg-white/10 !text-white hover:!bg-white/20" icon={<ArrowUpFromLine className="size-4" />}>
              Sell PMT
            </ButtonLink>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CheckinCard />
        <InviteCard />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Games played" value={s.gamesPlayed} icon={<Swords className="size-5" />} />
        <StatCard label="Wins" value={s.wins} icon={<Trophy className="size-5" />} tone="emerald" />
        <StatCard label="Losses" value={s.losses} icon={<XCircle className="size-5" />} tone="rose" />
        <StatCard label="Win rate" value={percentFromBps(s.winRateBps)} hint={`${s.draws} draws`} icon={<Percent className="size-5" />} tone="sky" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent matches" actions={<ButtonLink to="/matches" variant="ghost" size="sm">View all</ButtonLink>} />
          <DataTable
            rows={matches.data?.items}
            loading={matches.loading}
            error={matches.error}
            onRetry={matches.reload}
            rowKey={(m) => m.id}
            onRowClick={(m) => navigate(`/matches/${m.id}`)}
            empty={{ title: 'No matches yet', description: 'Pick a game and challenge another player.', action: <ButtonLink to="/play" size="sm">Browse games</ButtonLink> }}
            columns={[
              { header: 'Match', cell: (m) => <span className="font-semibold">#{m.matchNumber}</span> },
              { header: 'Game', cell: (m) => m.gameName, hideOnMobile: true },
              { header: 'Stake', cell: (m) => tokens(m.stakeUnits) },
              { header: 'Status', cell: (m) => <StatusBadge status={m.myResult ?? m.status} /> },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Recent transactions" actions={<ButtonLink to="/wallet/transactions" variant="ghost" size="sm">History</ButtonLink>} />
          <DataTable
            rows={txs.data?.items}
            loading={txs.loading}
            error={txs.error}
            onRetry={txs.reload}
            rowKey={(t) => t.id}
            onRowClick={(t) => navigate(`/wallet/transactions/${t.id}`)}
            empty={{ title: 'No transactions yet', description: config?.buyRequestsEnabled ? 'Play free games or buy PMT to get started.' : 'Play free games and check in daily to earn PMT.' }}
            columns={[
              { header: 'Type', cell: (t) => <span className="font-medium">{TX_CATEGORY_LABELS[t.category]}</span> },
              { header: 'When', cell: (t) => <span className="text-ink-500">{timeAgo(t.createdAt)}</span>, hideOnMobile: true },
              { header: 'Amount', cell: (t) => <Amount units={t.effects.AVAILABLE ?? t.netUnits} signed />, className: 'text-right' },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
