import { Activity, AlertTriangle, ArrowLeftRight, Bitcoin, Gamepad2, Gavel, Landmark, PiggyBank, Plane, Scale, ShieldCheck, ShoppingCart, TrendingUp, Users } from 'lucide-react';
import { Link } from 'react-router';
import type { AdminDashboardDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { ErrorState, PageHeader, PageLoader, StatCard } from '../../components/ui';
import { bdt, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

export default function AdminDashboard() {
  useDocumentTitle('Admin dashboard');
  const me = useMe();
  const d = useApi<AdminDashboardDto>('/api/admin/dashboard');
  if (d.loading && !d.data) return <PageLoader />;
  if (d.error || !d.data) return <ErrorState error={d.error} onRetry={d.reload} />;
  const x = d.data;
  const tile = (to: string, el: React.ReactNode) => (
    <Link to={to} className="block transition hover:-translate-y-0.5">
      {el}
    </Link>
  );
  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" subtitle={`Signed in as ${me.admin?.role.replace('_', ' ').toLowerCase()} · #${me.playerNumber}`} />
      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-500 uppercase">Needs attention</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tile('/admin/finance/buy-requests', <StatCard label="Pending buy requests" value={x.finance.pendingBuy} icon={<ShoppingCart className="size-5" />} tone="sky" />)}
          {tile('/admin/finance/sell-requests', <StatCard label="Pending sell requests" value={x.finance.pendingSell} icon={<ArrowLeftRight className="size-5" />} tone="amber" />)}
          {tile('/admin/games/disputes', <StatCard label="Open disputes" value={x.games.openDisputes} icon={<Gavel className="size-5" />} tone="rose" />)}
          {tile('/admin/security/fraud-flags', <StatCard label="Open risk flags" value={x.risk.openFlags} hint={`${x.risk.highFlags} high severity`} icon={<AlertTriangle className="size-5" />} tone="rose" />)}
          {tile('/admin/finance/crypto', <StatCard label="Crypto withdrawals waiting" value={x.crypto.pendingWithdrawals} icon={<Bitcoin className="size-5" />} tone="amber" />)}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-500 uppercase">PMT money</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tile('/admin/finance/reserve', <StatCard label="Taka reserve" value={bdt(x.reserve.reservePoisha)} hint={x.reserve.stagePriceBdt ? `1 PMT = ৳${x.reserve.stagePriceBdt}` : 'custom rates'} icon={<Scale className="size-5" />} />)}
          {tile('/admin/finance/reserve', <StatCard label="Reserve coverage" value={x.reserve.coverageBps === null ? '—' : `${(x.reserve.coverageBps / 100).toFixed(1)}%`} hint="of what players could sell back" icon={<ShieldCheck className="size-5" />} tone={x.reserve.coverageBps === null || x.reserve.coverageBps >= 10_000 ? 'emerald' : 'amber'} />)}
          {tile('/admin/finance/reserve', <StatCard label="Income you can take out" value={bdt(x.reserve.safeToWithdrawPoisha)} icon={<TrendingUp className="size-5" />} tone="emerald" />)}
          {tile('/admin/finance/rewards-pool', <StatCard label="Free games (24h)" value={x.freeGames.plays24h.toLocaleString()} hint={`${x.freeGames.players24h} players · paid ${tokens(x.freeGames.rewards24hUnits)} · pool ${tokens(x.freeGames.poolUnits)}`} icon={<Gamepad2 className="size-5" />} tone="sky" />)}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-500 uppercase">Finance</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tile('/admin/finance/treasury', <StatCard label="Admin treasury" value={tokens(x.finance.treasuryUnits)} hint={`Issued total ${tokens(x.finance.issuedUnits)}`} icon={<Landmark className="size-5" />} />)}
          {tile('/admin/finance/platform-fees', <StatCard label="Platform fee wallet" value={tokens(x.finance.platformFeesUnits)} hint={`Last 24h ${tokens(x.games.fees24hUnits)}`} icon={<PiggyBank className="size-5" />} tone="emerald" />)}
          {tile('/admin/finance/house-bankroll', <StatCard label="House bankroll (Aviator)" value={tokens(x.finance.houseBankrollUnits)} icon={<Plane className="size-5" />} tone="amber" />)}
          <StatCard label="Purchases (24h)" value={bdt(x.finance.buyVolume24hPoisha)} icon={<ShoppingCart className="size-5" />} tone="sky" />
          <StatCard label="Redemptions paid (24h)" value={bdt(x.finance.sellVolume24hPoisha)} icon={<ArrowLeftRight className="size-5" />} tone="amber" />
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-500 uppercase">Players & games</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tile('/admin/players', <StatCard label="Players" value={x.players.total} hint={`${x.players.newToday} new in 24h`} icon={<Users className="size-5" />} />)}
          <StatCard label="Restricted / suspended / banned" value={`${x.players.restricted} / ${x.players.suspended} / ${x.players.banned}`} icon={<Users className="size-5" />} tone="rose" />
          {tile('/admin/games/live', <StatCard label="Live matches" value={x.games.liveMatches} hint={`${x.games.waitingMatches} rooms waiting`} icon={<Activity className="size-5" />} tone="emerald" />)}
          <StatCard label="Settled (24h)" value={x.games.settled24h} icon={<Activity className="size-5" />} tone="sky" />
        </div>
      </section>
    </div>
  );
}
