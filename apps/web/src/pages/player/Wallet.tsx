import { useNavigate } from 'react-router';
import { ArrowDownToLine, ArrowUpFromLine, History, Send, Wallet as WalletIcon } from 'lucide-react';
import type { BuyRequestDto, Paginated, SellRequestDto } from '@arena/shared';
import { useWallet, WalletCards } from '../../components/Wallet';
import { Badge, ButtonLink, Card, CardHeader, DataTable, ErrorState, PageHeader, StatusBadge } from '../../components/ui';
import { bdt, dateTime, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

export default function WalletPage() {
  useDocumentTitle('Wallet');
  const navigate = useNavigate();
  const wallet = useWallet();
  const buys = useApi<Paginated<BuyRequestDto>>('/api/wallet/buy-requests?pageSize=5');
  const sells = useApi<Paginated<SellRequestDto>>('/api/wallet/sell-requests?pageSize=5');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Wallet"
        subtitle={wallet.data ? `Total ${tokens(wallet.data.totalUnits)}` : 'Your internal token balances'}
        actions={
          <>
            <ButtonLink to="/wallet/buy" icon={<ArrowDownToLine className="size-4" />}>
              Buy PMT
            </ButtonLink>
            <ButtonLink to="/wallet/sell" variant="outline" icon={<ArrowUpFromLine className="size-4" />}>
              Sell PMT
            </ButtonLink>
            <ButtonLink to="/wallet/send" variant="outline" icon={<Send className="size-4" />}>
              Send PMT
            </ButtonLink>
            <ButtonLink to="/wallet/crypto" variant="outline" icon={<WalletIcon className="size-4" />}>
              Crypto wallet
            </ButtonLink>
            <ButtonLink to="/wallet/transactions" variant="ghost" icon={<History className="size-4" />}>
              Transaction history
            </ButtonLink>
          </>
        }
      />
      {wallet.error ? <ErrorState error={wallet.error} onRetry={wallet.reload} /> : <WalletCards wallet={wallet.data} />}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Buy requests" actions={<ButtonLink to="/wallet/transactions?tab=buy" variant="ghost" size="sm">All</ButtonLink>} />
          <DataTable
            rows={buys.data?.items}
            loading={buys.loading}
            error={buys.error}
            onRetry={buys.reload}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/wallet/buy/${r.id}`)}
            empty={{ title: 'No purchases yet' }}
            columns={[
              { header: 'Request', cell: (r) => <span className="font-semibold">#{r.requestNumber}</span> },
              { header: 'Paid', cell: (r) => bdt(r.amountPoisha) },
              { header: 'Tokens', cell: (r) => tokens(r.tokenUnits), hideOnMobile: true },
              { header: 'Status', cell: (r) => <span className="flex items-center gap-1.5"><StatusBadge status={r.status} />{r.unreadMessages > 0 && <Badge tone="danger">{r.unreadMessages} new</Badge>}</span> },
              { header: 'Date', cell: (r) => <span className="text-ink-500">{dateTime(r.createdAt)}</span>, hideOnMobile: true },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Sell requests" actions={<ButtonLink to="/wallet/transactions?tab=sell" variant="ghost" size="sm">All</ButtonLink>} />
          <DataTable
            rows={sells.data?.items}
            loading={sells.loading}
            error={sells.error}
            onRetry={sells.reload}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/wallet/sell/${r.id}`)}
            empty={{ title: 'No sales yet' }}
            columns={[
              { header: 'Request', cell: (r) => <span className="font-semibold">#{r.requestNumber}</span> },
              { header: 'Tokens', cell: (r) => tokens(r.amountUnits) },
              { header: 'Payout', cell: (r) => bdt(r.bdtPoisha), hideOnMobile: true },
              { header: 'Status', cell: (r) => <span className="flex items-center gap-1.5"><StatusBadge status={r.status} />{r.unreadMessages > 0 && <Badge tone="danger">{r.unreadMessages} new</Badge>}</span> },
              { header: 'Date', cell: (r) => <span className="text-ink-500">{dateTime(r.createdAt)}</span>, hideOnMobile: true },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
