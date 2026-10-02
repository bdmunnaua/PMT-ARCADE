import { lazy, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import type { Permission } from '@arena/shared';
import { useAuth } from './auth/AuthProvider';
import { ErrorState, PageLoader } from './components/ui';
import { AdminLayout } from './layouts/AdminLayout';
import { PlayerLayout } from './layouts/PlayerLayout';
import { BlockedPage, SessionErrorPage, SetupRequiredPage, SignedOutPage } from './pages/auth/AuthStates';
import { DashboardPage } from './pages/player/Dashboard';
import { NotFoundPage } from './pages/NotFound';

// Player pages
const PlayPage = lazy(() => import('./pages/player/Play'));
const FreeGamePage = lazy(() => import('./pages/player/FreeGame'));
const GameDetailPage = lazy(() => import('./pages/player/GameDetail'));
const MatchesPage = lazy(() => import('./pages/player/Matches'));
const MatchDetailPage = lazy(() => import('./pages/player/MatchDetail'));
const WalletPage = lazy(() => import('./pages/player/Wallet'));
const BuyTokensPage = lazy(() => import('./pages/player/BuyTokens'));
const SellTokensPage = lazy(() => import('./pages/player/SellTokens'));
const SendTokensPage = lazy(() => import('./pages/player/SendTokens'));
const CryptoWalletPage = lazy(() => import('./pages/player/CryptoWallet'));
const TransactionsPage = lazy(() => import('./pages/player/Transactions'));
const TransactionDetailPage = lazy(() => import('./pages/player/TransactionDetail'));
const BuyRequestDetailPage = lazy(() => import('./pages/player/BuyRequestDetail'));
const SellRequestDetailPage = lazy(() => import('./pages/player/SellRequestDetail'));
const LeaderboardPage = lazy(() => import('./pages/player/Leaderboard'));
const NotificationsPage = lazy(() => import('./pages/player/Notifications'));
const SupportPage = lazy(() => import('./pages/player/Support'));
const DisputeDetailPage = lazy(() => import('./pages/player/DisputeDetail'));
const ProfilePage = lazy(() => import('./pages/player/Profile'));

// Admin pages (separate chunks; every action is re-authorised by the API)
const A = {
  Dashboard: lazy(() => import('./pages/admin/Dashboard')),
  Players: lazy(() => import('./pages/admin/Players')),
  PlayerDetail: lazy(() => import('./pages/admin/PlayerDetail')),
  GameRegistry: lazy(() => import('./pages/admin/GameRegistry')),
  Matches: lazy(() => import('./pages/admin/Matches')),
  MatchDetail: lazy(() => import('./pages/admin/MatchDetail')),
  Disputes: lazy(() => import('./pages/admin/Disputes')),
  DisputeDetail: lazy(() => import('./pages/admin/DisputeDetail')),
  FinanceOverview: lazy(() => import('./pages/admin/FinanceOverview')),
  BuyRequests: lazy(() => import('./pages/admin/BuyRequests')),
  BuyRequestDetail: lazy(() => import('./pages/admin/BuyRequestDetail')),
  SellRequests: lazy(() => import('./pages/admin/SellRequests')),
  SellRequestDetail: lazy(() => import('./pages/admin/SellRequestDetail')),
  Ledger: lazy(() => import('./pages/admin/Ledger')),
  LedgerIntegrity: lazy(() => import('./pages/admin/LedgerIntegrity')),
  SystemWallet: lazy(() => import('./pages/admin/SystemWallet')),
  HouseBankroll: lazy(() => import('./pages/admin/HouseBankroll')),
  Reserve: lazy(() => import('./pages/admin/Reserve')),
  RewardsPool: lazy(() => import('./pages/admin/RewardsPool')),
  CryptoWithdrawals: lazy(() => import('./pages/admin/CryptoWithdrawals')),
  Liquidity: lazy(() => import('./pages/admin/Liquidity')),
  Distribute: lazy(() => import('./pages/admin/Distribute')),
  FraudFlags: lazy(() => import('./pages/admin/FraudFlags')),
  LoginActivity: lazy(() => import('./pages/admin/LoginActivity')),
  AuditLogs: lazy(() => import('./pages/admin/AuditLogs')),
  Notifications: lazy(() => import('./pages/admin/Notifications')),
  Administrators: lazy(() => import('./pages/admin/Administrators')),
  Settings: lazy(() => import('./pages/admin/Settings')),
  DevSimulator: lazy(() => import('./pages/admin/DevSimulator')),
};

/** Sign-in happens in the host project; this only reflects its session (auth/identity.ts). */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status, error } = useAuth();
  if (status === 'unconfigured') return <SetupRequiredPage />;
  if (status === 'loading') return <PageLoader label="Signing you in…" />;
  if (status === 'signed_out') return <SignedOutPage />;
  if (status === 'blocked') return <BlockedPage message={error} />;
  if (status === 'error') return <SessionErrorPage message={error} />;
  return <>{children}</>;
}

function RequireAdmin({ perm, children }: { perm?: Permission[]; children: ReactNode }) {
  const { me } = useAuth();
  if (!me?.admin) return <NotFoundPage />;
  if (perm && !perm.some((p) => me.admin!.permissions.includes(p))) {
    return <ErrorState error="Your administrator role does not include this section." />;
  }
  return <>{children}</>;
}

const guard = (el: ReactNode, perm?: Permission[]) => <RequireAdmin perm={perm}>{el}</RequireAdmin>;

const router = createBrowserRouter([
  {
    element: (
      <RequireAuth>
        <PlayerLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'play', element: <PlayPage /> },
      { path: 'arcade/:id', element: <FreeGamePage /> },
      { path: 'play/:slug', element: <GameDetailPage /> },
      { path: 'matches', element: <MatchesPage /> },
      { path: 'matches/:id', element: <MatchDetailPage /> },
      { path: 'wallet', element: <WalletPage /> },
      { path: 'wallet/buy', element: <BuyTokensPage /> },
      { path: 'wallet/sell', element: <SellTokensPage /> },
      { path: 'wallet/send', element: <SendTokensPage /> },
      { path: 'wallet/crypto', element: <CryptoWalletPage /> },
      { path: 'wallet/transactions', element: <TransactionsPage /> },
      { path: 'wallet/transactions/:id', element: <TransactionDetailPage /> },
      { path: 'wallet/buy/:id', element: <BuyRequestDetailPage /> },
      { path: 'wallet/sell/:id', element: <SellRequestDetailPage /> },
      { path: 'leaderboard', element: <LeaderboardPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'support', element: <SupportPage /> },
      { path: 'support/disputes/:id', element: <DisputeDetailPage /> },
      { path: 'profile', element: <ProfilePage /> },
    ],
  },
  {
    path: '/admin',
    element: (
      <RequireAuth>
        <RequireAdmin>
          <AdminLayout />
        </RequireAdmin>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <A.Dashboard /> },
      { path: 'players', element: guard(<A.Players />, ['players.view']) },
      { path: 'players/:id', element: guard(<A.PlayerDetail />, ['players.view']) },
      { path: 'games/registry', element: guard(<A.GameRegistry />, ['games.view', 'games.manage']) },
      { path: 'games/live', element: guard(<A.Matches live />, ['matches.view']) },
      { path: 'games/history', element: guard(<A.Matches live={false} />, ['matches.view']) },
      { path: 'games/matches/:id', element: guard(<A.MatchDetail />, ['matches.view']) },
      { path: 'games/disputes', element: guard(<A.Disputes />, ['disputes.view']) },
      { path: 'games/disputes/:id', element: guard(<A.DisputeDetail />, ['disputes.view']) },
      { path: 'finance', element: guard(<A.FinanceOverview />, ['finance.view']) },
      { path: 'finance/buy-requests', element: guard(<A.BuyRequests />, ['finance.view', 'finance.buy.manage']) },
      { path: 'finance/buy-requests/:id', element: guard(<A.BuyRequestDetail />, ['finance.view', 'finance.buy.manage']) },
      { path: 'finance/sell-requests', element: guard(<A.SellRequests />, ['finance.view', 'finance.sell.manage']) },
      { path: 'finance/sell-requests/:id', element: guard(<A.SellRequestDetail />, ['finance.view', 'finance.sell.manage']) },
      { path: 'finance/ledger', element: guard(<A.Ledger />, ['finance.ledger.view']) },
      { path: 'finance/integrity', element: guard(<A.LedgerIntegrity />, ['finance.integrity']) },
      { path: 'finance/treasury', element: guard(<A.SystemWallet account="ADMIN_TREASURY" />, ['finance.view']) },
      { path: 'finance/platform-fees', element: guard(<A.SystemWallet account="PLATFORM_FEES" />, ['finance.view']) },
      { path: 'finance/distribute', element: guard(<A.Distribute />, ['finance.distribute']) },
      { path: 'finance/house-bankroll', element: guard(<A.HouseBankroll />, ['finance.view']) },
      { path: 'finance/reserve', element: guard(<A.Reserve />, ['finance.view']) },
      { path: 'finance/rewards-pool', element: guard(<A.RewardsPool />, ['finance.view']) },
      { path: 'finance/crypto', element: guard(<A.CryptoWithdrawals />, ['finance.view', 'finance.sell.manage']) },
      { path: 'finance/liquidity', element: guard(<A.Liquidity />, ['finance.view']) },
      { path: 'security/fraud-flags', element: guard(<A.FraudFlags />, ['risk.view']) },
      { path: 'security/login-activity', element: guard(<A.LoginActivity />, ['security.login_activity']) },
      { path: 'security/audit', element: guard(<A.AuditLogs />, ['audit.view']) },
      { path: 'notifications', element: <A.Notifications /> },
      { path: 'administrators', element: guard(<A.Administrators />, ['admins.manage']) },
      { path: 'settings', element: guard(<A.Settings />, ['settings.view', 'settings.manage']) },
      { path: 'dev', element: guard(<A.DevSimulator />, ['dev.simulator']) },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}

