import { Suspense } from 'react';
import { NavLink, Outlet, Link, Navigate, useLocation } from 'react-router';
import { Bell, Gamepad2, LayoutDashboard, LifeBuoy, LogOut, Medal, ShieldCheck, Swords, Trophy, User, Wallet, Megaphone } from 'lucide-react';
import clsx from 'clsx';
import { useAuth, useMe } from '../auth/AuthProvider';
import { ActiveMatchBar } from '../components/ActiveMatchBar';
import { NotificationBell, ThemeToggle } from '../components/Common';
import { Notice, PageLoader } from '../components/ui';
import { isPlayEdition, playEditionAllows } from '../lib/edition';
import { LangToggle, t } from '../lib/i18n';
import { Logo } from './Logo';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/play', label: 'Play', icon: Gamepad2 },
  { to: '/tournament', label: 'Tournament', icon: Medal },
  { to: '/matches', label: 'Matches', icon: Swords },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { to: '/creator-rewards', label: 'Creator rewards', icon: Megaphone },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/support', label: 'Support', icon: LifeBuoy },
  { to: '/profile', label: 'Profile', icon: User },
];
const MOBILE = ['/', '/play', '/tournament', '/wallet', '/profile'];
/** Google Play edition (see lib/edition): just the free games, support and the profile */
const PLAY_NAV = [
  { to: '/', label: 'Games', icon: Gamepad2, end: true },
  { to: '/support', label: 'Support', icon: LifeBuoy },
  { to: '/profile', label: 'Profile', icon: User },
];

export function PlayerLayout() {
  const me = useMe();
  const { signOut, config } = useAuth();
  const { pathname } = useLocation();
  if (isPlayEdition && !playEditionAllows(pathname)) return <Navigate to="/" replace />;
  const nav = isPlayEdition ? PLAY_NAV : NAV;
  const mobile = isPlayEdition ? PLAY_NAV : NAV.filter((n) => MOBILE.includes(n.to));
  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-ink-200/70 bg-white lg:flex dark:border-ink-800 dark:bg-ink-900">
        <div className="flex h-16 items-center px-5">
          <Logo name={config?.platformName} />
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Main">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                  isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-200' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800',
                )
              }
            >
              <n.icon className="size-5" aria-hidden /> {t(n.label)}
            </NavLink>
          ))}
          {me.admin && !isPlayEdition && (
            <NavLink to="/admin" className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-brand-300 px-3 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 dark:border-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-500/10">
              <ShieldCheck className="size-5" /> {t('Admin panel')}
            </NavLink>
          )}
        </nav>
        <div className="border-t border-ink-100 p-4 dark:border-ink-800">
          <p className="truncate text-sm font-semibold">{me.displayName}</p>
          <p className="text-xs text-ink-500">{t('Player #{n}', { n: String(me.playerNumber) })}</p>
          <button onClick={() => void signOut()} className="mt-3 flex items-center gap-2 text-sm font-medium text-ink-500 hover:text-rose-600">
            <LogOut className="size-4" /> {t('Sign out')}
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-ink-200/70 bg-white/80 px-4 backdrop-blur sm:px-6 dark:border-ink-800 dark:bg-ink-950/80">
        <div className="lg:hidden">
          <Logo name={config?.platformName} compact />
        </div>
        <div className="hidden text-sm text-ink-500 lg:block">
          {t('Signed in as')} <span className="font-semibold text-ink-900 dark:text-white">{me.username}</span> · #{me.playerNumber}
        </div>
        <div className="flex items-center gap-1">
          {me.admin && !isPlayEdition && (
            <Link to="/admin" className="rounded-xl p-2 text-brand-600 hover:bg-brand-50 lg:hidden dark:text-brand-300" aria-label={t('Admin panel')}>
              <ShieldCheck className="size-5" />
            </Link>
          )}
          {!isPlayEdition && <NotificationBell userId={me.id} to="/notifications" audience="player" />}
          <LangToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-6 lg:pb-12">
        {config?.maintenanceMode && (
          <div className="mb-4">
            <Notice tone="warning" title={t('Maintenance')}>
              {t('The platform is under maintenance. Matches, purchases and sales are paused.')}
            </Notice>
          </div>
        )}
        {me.accountStatus !== 'ACTIVE' && (
          <div className="mb-4">
            <Notice tone="danger" title={t(me.accountStatus === 'BANNED' ? 'Account banned' : me.accountStatus === 'SUSPENDED' ? 'Account suspended' : 'Account restricted')}>
              {t('You can view your account, but playing, buying and selling are disabled. Contact support if you think this is a mistake.')}
            </Notice>
          </div>
        )}
        {!isPlayEdition && <ActiveMatchBar />}
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>

      <nav
        className={clsx(
          'fixed inset-x-0 bottom-0 z-30 grid border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-ink-800 dark:bg-ink-900/95',
          mobile.length === 3 ? 'grid-cols-3' : 'grid-cols-5',
        )}
        aria-label="Main"
      >
        {mobile.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium', isActive ? 'text-brand-600 dark:text-brand-300' : 'text-ink-500')}>
            <n.icon className="size-5" aria-hidden />
            {t(n.label)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
