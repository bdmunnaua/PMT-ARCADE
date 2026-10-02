import { Suspense } from 'react';
import { NavLink, Outlet, Link } from 'react-router';
import { Bell, Gamepad2, LayoutDashboard, LifeBuoy, LogOut, ShieldCheck, Swords, Trophy, User, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { useAuth, useMe } from '../auth/AuthProvider';
import { NotificationBell, ThemeToggle } from '../components/Common';
import { Notice, PageLoader } from '../components/ui';
import { Logo } from './Logo';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/play', label: 'Play', icon: Gamepad2 },
  { to: '/matches', label: 'Matches', icon: Swords },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/support', label: 'Support', icon: LifeBuoy },
  { to: '/profile', label: 'Profile', icon: User },
];
const MOBILE = ['/', '/play', '/matches', '/wallet', '/profile'];

export function PlayerLayout() {
  const me = useMe();
  const { signOut, config } = useAuth();
  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-ink-200/70 bg-white lg:flex dark:border-ink-800 dark:bg-ink-900">
        <div className="flex h-16 items-center px-5">
          <Logo name={config?.platformName} />
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Main">
          {NAV.map((n) => (
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
              <n.icon className="size-5" aria-hidden /> {n.label}
            </NavLink>
          ))}
          {me.admin && (
            <NavLink to="/admin" className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-brand-300 px-3 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 dark:border-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-500/10">
              <ShieldCheck className="size-5" /> Admin panel
            </NavLink>
          )}
        </nav>
        <div className="border-t border-ink-100 p-4 dark:border-ink-800">
          <p className="truncate text-sm font-semibold">{me.displayName}</p>
          <p className="text-xs text-ink-500">Player #{me.playerNumber}</p>
          <button onClick={() => void signOut()} className="mt-3 flex items-center gap-2 text-sm font-medium text-ink-500 hover:text-rose-600">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-ink-200/70 bg-white/80 px-4 backdrop-blur sm:px-6 dark:border-ink-800 dark:bg-ink-950/80">
        <div className="lg:hidden">
          <Logo name={config?.platformName} compact />
        </div>
        <div className="hidden text-sm text-ink-500 lg:block">
          Signed in as <span className="font-semibold text-ink-900 dark:text-white">{me.username}</span> · #{me.playerNumber}
        </div>
        <div className="flex items-center gap-1">
          {me.admin && (
            <Link to="/admin" className="rounded-xl p-2 text-brand-600 hover:bg-brand-50 lg:hidden dark:text-brand-300" aria-label="Admin panel">
              <ShieldCheck className="size-5" />
            </Link>
          )}
          <NotificationBell userId={me.id} to="/notifications" audience="player" />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-6 lg:pb-12">
        {config?.maintenanceMode && (
          <div className="mb-4">
            <Notice tone="warning" title="Maintenance">
              The platform is under maintenance. Matches, purchases and sales are paused.
            </Notice>
          </div>
        )}
        {me.accountStatus !== 'ACTIVE' && (
          <div className="mb-4">
            <Notice tone="danger" title={`Account ${me.accountStatus.toLowerCase()}`}>
              You can view your account, but playing, buying and selling are disabled. Contact support if you think this is a mistake.
            </Notice>
          </div>
        )}
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-ink-800 dark:bg-ink-900/95" aria-label="Main">
        {NAV.filter((n) => MOBILE.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium', isActive ? 'text-brand-600 dark:text-brand-300' : 'text-ink-500')}>
            <n.icon className="size-5" aria-hidden />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
