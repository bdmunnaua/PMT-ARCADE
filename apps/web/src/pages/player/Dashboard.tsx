import { useNavigate } from 'react-router';
import { ArrowDownToLine, ArrowUpFromLine, Gamepad2, Percent, Swords, Trophy, XCircle } from 'lucide-react';
import type { MatchDto, Paginated, PlayerTransactionDto } from '@arena/shared';
import { TX_CATEGORY_LABELS } from '@arena/shared';
import { useAuth, useMe } from '../../auth/AuthProvider';
import { Amount } from '../../components/Common';
import { CheckinCard, InviteCard } from '../../components/Arcade';
import { useWallet } from '../../components/Wallet';
import { TournamentBanner } from '../../components/Tournament';
import { ButtonLink, Card, CardHeader, DataTable, StatCard, StatusBadge } from '../../components/ui';
import { percentFromBps, timeAgo, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import { t, t as tr } from '../../lib/i18n';

export function DashboardPage() {
  useDocumentTitle(t("Dashboard"));
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
        <p className="text-sm font-medium text-white/70">{t('Player #{n}', { n: String(me.playerNumber) })}</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{t('Welcome back, {name}', { name: me.displayName })}</h1>
        <p className="mt-6 text-sm text-white/70">{t("Total balance")}</p>
        <p className="text-4xl font-bold tracking-tight tabular-nums">{wallet.data ? tokens(wallet.data.totalUnits) : '…'}</p>
        <p className="mt-1 text-sm text-white/70">
          {t("Available")} {wallet.data ? tokens(wallet.data.availableUnits) : '…'} {t("· Bonus")} {wallet.data ? tokens(wallet.data.bonusUnits) : '…'}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <ButtonLink to="/play" icon={<Gamepad2 className="size-4" />} className="bg-white !text-ink-900 hover:bg-white/90">
            {t("Play now")}
          </ButtonLink>
          {config?.buyRequestsEnabled && (
            <ButtonLink to="/wallet/buy" variant="outline" className="border-white/30 !bg-white/10 !text-white hover:!bg-white/20" icon={<ArrowDownToLine className="size-4" />}>
              {t("Buy PMT")}
            </ButtonLink>
          )}
          {config?.sellRequestsEnabled && (
            <ButtonLink to="/wallet/sell" variant="outline" className="border-white/30 !bg-white/10 !text-white hover:!bg-white/20" icon={<ArrowUpFromLine className="size-4" />}>
              {t("Sell PMT")}
            </ButtonLink>
          )}
        </div>
      </div>

      <TournamentBanner />

      <div className="grid gap-6 lg:grid-cols-2">
        <CheckinCard />
        <InviteCard />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("Games played")} value={s.gamesPlayed} icon={<Swords className="size-5" />} />
        <StatCard label={t("Wins")} value={s.wins} icon={<Trophy className="size-5" />} tone="emerald" />
        <StatCard label={t("Losses")} value={s.losses} icon={<XCircle className="size-5" />} tone="rose" />
        <StatCard label={t("Win rate")} value={percentFromBps(s.winRateBps)} hint={t('{n} draws', { n: s.draws })} icon={<Percent className="size-5" />} tone="sky" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("Recent matches")} actions={<ButtonLink to="/matches" variant="ghost" size="sm">{t("View all")}</ButtonLink>} />
          <DataTable
            rows={matches.data?.items}
            loading={matches.loading}
            error={matches.error}
            onRetry={matches.reload}
            rowKey={(m) => m.id}
            onRowClick={(m) => navigate(`/matches/${m.id}`)}
            empty={{ title: t("No matches yet"), description: t("Pick a game and challenge another player."), action: <ButtonLink to="/play" size="sm">{t("Browse games")}</ButtonLink> }}
            columns={[
              { header: t("Match"), cell: (m) => <span className="font-semibold">#{m.matchNumber}</span> },
              { header: t("Game"), cell: (m) => m.gameName, hideOnMobile: true },
              { header: t("Stake"), cell: (m) => tokens(m.stakeUnits) },
              { header: t("Status"), cell: (m) => <StatusBadge status={m.myResult ?? m.status} /> },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title={t("Recent transactions")} actions={<ButtonLink to="/wallet/transactions" variant="ghost" size="sm">{t("History")}</ButtonLink>} />
          <DataTable
            rows={txs.data?.items}
            loading={txs.loading}
            error={txs.error}
            onRetry={txs.reload}
            rowKey={(t) => t.id}
            onRowClick={(t) => navigate(`/wallet/transactions/${t.id}`)}
            empty={{ title: t("No transactions yet"), description: t(config?.buyRequestsEnabled ? 'Play free games or buy PMT to get started.' : 'Play free games and check in daily to earn PMT.') }}
            columns={[
              { header: t("Type"), cell: (t) => <span className="font-medium">{tr(TX_CATEGORY_LABELS[t.category])}</span> },
              { header: t("When"), cell: (t) => <span className="text-ink-500">{timeAgo(t.createdAt)}</span>, hideOnMobile: true },
              { header: t("Amount"), cell: (t) => <Amount units={t.effects.AVAILABLE ?? t.netUnits} signed />, className: 'text-right' },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
