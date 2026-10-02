import { ArrowLeftRight, Coins, Landmark, PiggyBank, ShoppingCart } from 'lucide-react';
import type { AdminDashboardDto } from '@arena/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ButtonLink, Card, CardBody, CardHeader, ErrorState, KeyValue, PageHeader, PageLoader, StatCard } from '../../components/ui';
import { bdt, percentFromBps, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

export default function FinanceOverview() {
  useDocumentTitle('Finance overview');
  const { config } = useAuth();
  const f = useApi<AdminDashboardDto['finance']>('/api/admin/finance/overview');
  if (f.loading && !f.data) return <PageLoader />;
  if (f.error || !f.data) return <ErrorState error={f.error} onRetry={f.reload} />;
  const x = f.data;
  const circulating = x.issuedUnits - x.treasuryUnits - x.platformFeesUnits;
  return (
    <div className="space-y-6">
      <PageHeader title="Finance overview" subtitle="ADMIN_TREASURY and PLATFORM_FEES are separate system wallets; neither can be edited directly." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Admin treasury" value={tokens(x.treasuryUnits)} hint="Source of purchases & grants; receives redeemed tokens" icon={<Landmark className="size-5" />} />
        <StatCard label="Platform fee wallet" value={tokens(x.platformFeesUnits)} hint="Only match fees land here" icon={<PiggyBank className="size-5" />} tone="emerald" />
        <StatCard label="Total issued" value={tokens(x.issuedUnits)} hint="Explicit treasury issuance" icon={<Coins className="size-5" />} tone="sky" />
        <StatCard label="Held by players" value={tokens(circulating)} hint="Issued − treasury − fees" icon={<Coins className="size-5" />} tone="amber" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Queues" />
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2"><ShoppingCart className="size-4 text-sky-500" /> Pending buy requests: <strong>{x.pendingBuy}</strong></span>
              <ButtonLink to="/admin/finance/buy-requests" size="sm" variant="outline">Open</ButtonLink>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2"><ArrowLeftRight className="size-4 text-amber-500" /> Pending sell requests: <strong>{x.pendingSell}</strong></span>
              <ButtonLink to="/admin/finance/sell-requests" size="sm" variant="outline">Open</ButtonLink>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Last 24 hours & rates" />
          <CardBody>
            <KeyValue
              items={[
                ['Purchases credited', bdt(x.buyVolume24hPoisha)],
                ['Redemptions paid', bdt(x.sellVolume24hPoisha)],
                ['Buy rate', config ? `৳1 = ${config.buyTokensPerBdt} PMT` : '…'],
                ['Sell rate', config ? `${config.sellTokensPerBdt} PMT = ৳1` : '…'],
                ['Match fee', config ? percentFromBps(config.matchFeeBps) : '…'],
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
