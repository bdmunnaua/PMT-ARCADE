import { useNavigate } from "react-router";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  Send,
  Wallet as WalletIcon,
} from "lucide-react";
import type { BuyRequestDto, Paginated, SellRequestDto } from "@arena/shared";
import { useConfig } from "../../auth/AuthProvider";
import { useWallet, WalletCards } from "../../components/Wallet";
import {
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  DataTable,
  ErrorState,
  Notice,
  PageHeader,
  StatusBadge,
} from "../../components/ui";
import { bdt, dateTime, tokens } from "../../lib/format";
import { useApi, useDocumentTitle } from "../../lib/hooks";
import { t } from "../../lib/i18n";

export default function WalletPage() {
  useDocumentTitle(t("Wallet"));
  const navigate = useNavigate();
  const wallet = useWallet();
  const buys = useApi<Paginated<BuyRequestDto>>(
    "/api/wallet/buy-requests?pageSize=5",
  );
  const sells = useApi<Paginated<SellRequestDto>>(
    "/api/wallet/sell-requests?pageSize=5",
  );
  const config = useConfig();
  // buying and selling PMT for taka are paused: show them only when an admin opens them, or when the
  // player still has older requests to follow
  const canBuy = !!config?.buyRequestsEnabled;
  const canSell = !!config?.sellRequestsEnabled;
  const hasRequests =
    (buys.data?.items.length ?? 0) + (sells.data?.items.length ?? 0) > 0;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Wallet")}
        subtitle={
          wallet.data
            ? `Total ${tokens(wallet.data.totalUnits)}`
            : t("Your internal token balances")
        }
        actions={
          <>
            {canBuy && (
              <ButtonLink
                to="/wallet/buy"
                icon={<ArrowDownToLine className="size-4" />}
              >
                {t("Buy PMT")}
              </ButtonLink>
            )}
            {canSell && (
              <ButtonLink
                to="/wallet/sell"
                variant="outline"
                icon={<ArrowUpFromLine className="size-4" />}
              >
                {t("Sell PMT")}
              </ButtonLink>
            )}
            <ButtonLink
              to="/wallet/send"
              variant="outline"
              icon={<Send className="size-4" />}
            >
              {t("Send PMT")}
            </ButtonLink>
            <ButtonLink
              to="/wallet/crypto"
              variant="outline"
              icon={<WalletIcon className="size-4" />}
            >
              {t("Crypto wallet")}
            </ButtonLink>
            <ButtonLink
              to="/wallet/transactions"
              variant="ghost"
              icon={<History className="size-4" />}
            >
              {t("Transaction history")}
            </ButtonLink>
          </>
        }
      />
      {wallet.error ? (
        <ErrorState error={wallet.error} onRetry={wallet.reload} />
      ) : (
        <WalletCards wallet={wallet.data} />
      )}
      {!canBuy && !canSell && (
        <Notice tone="info">
          {t(
            "Earn PMT by playing free games, daily check-ins, tournaments and creator rewards. Buying and selling PMT are paused. PMT does not have an established DEX market price yet.",
          )}
        </Notice>
      )}
      {(canBuy || canSell || hasRequests) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title={t("Buy requests")}
              actions={
                <ButtonLink
                  to="/wallet/transactions?tab=buy"
                  variant="ghost"
                  size="sm"
                >
                  {t("All")}
                </ButtonLink>
              }
            />
            <DataTable
              rows={buys.data?.items}
              loading={buys.loading}
              error={buys.error}
              onRetry={buys.reload}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/wallet/buy/${r.id}`)}
              empty={{ title: t("No purchases yet") }}
              columns={[
                {
                  header: t("Request"),
                  cell: (r) => (
                    <span className="font-semibold">#{r.requestNumber}</span>
                  ),
                },
                { header: t("Paid"), cell: (r) => bdt(r.amountPoisha) },
                {
                  header: t("Tokens"),
                  cell: (r) => tokens(r.tokenUnits),
                  hideOnMobile: true,
                },
                {
                  header: t("Status"),
                  cell: (r) => (
                    <span className="flex items-center gap-1.5">
                      <StatusBadge status={r.status} />
                      {r.unreadMessages > 0 && (
                        <Badge tone="danger">{r.unreadMessages} new</Badge>
                      )}
                    </span>
                  ),
                },
                {
                  header: t("Date"),
                  cell: (r) => (
                    <span className="text-ink-500">
                      {dateTime(r.createdAt)}
                    </span>
                  ),
                  hideOnMobile: true,
                },
              ]}
            />
          </Card>
          <Card>
            <CardHeader
              title={t("Sell requests")}
              actions={
                <ButtonLink
                  to="/wallet/transactions?tab=sell"
                  variant="ghost"
                  size="sm"
                >
                  {t("All")}
                </ButtonLink>
              }
            />
            <DataTable
              rows={sells.data?.items}
              loading={sells.loading}
              error={sells.error}
              onRetry={sells.reload}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/wallet/sell/${r.id}`)}
              empty={{ title: t("No sales yet") }}
              columns={[
                {
                  header: t("Request"),
                  cell: (r) => (
                    <span className="font-semibold">#{r.requestNumber}</span>
                  ),
                },
                { header: t("Tokens"), cell: (r) => tokens(r.amountUnits) },
                {
                  header: t("Payout"),
                  cell: (r) => bdt(r.bdtPoisha),
                  hideOnMobile: true,
                },
                {
                  header: t("Status"),
                  cell: (r) => (
                    <span className="flex items-center gap-1.5">
                      <StatusBadge status={r.status} />
                      {r.unreadMessages > 0 && (
                        <Badge tone="danger">{r.unreadMessages} new</Badge>
                      )}
                    </span>
                  ),
                },
                {
                  header: t("Date"),
                  cell: (r) => (
                    <span className="text-ink-500">
                      {dateTime(r.createdAt)}
                    </span>
                  ),
                  hideOnMobile: true,
                },
              ]}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
