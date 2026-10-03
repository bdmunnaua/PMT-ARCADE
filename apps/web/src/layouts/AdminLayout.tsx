import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import {
  Activity,
  ArrowLeftRight,
  Bell,
  Coins,
  FlaskConical,
  Gamepad2,
  Gavel,
  History,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Menu,
  PiggyBank,
  Plane,
  Scale,
  Gift,
  Bitcoin,
  Droplets,
  ScrollText,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Swords,
  UserCog,
  Users,
  Wallet,
  X,
  type LucideIcon,
  MessageSquare,
  Megaphone,
} from 'lucide-react';
import clsx from 'clsx';
import type { Permission } from '@arena/shared';
import { useAuth, useMe } from '../auth/AuthProvider';
import { NotificationBell, ThemeToggle } from '../components/Common';
import { PageLoader } from '../components/ui';
import { Logo } from './Logo';

interface Item {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: Permission[];
  end?: boolean;
  devOnly?: boolean;
}
interface Group {
  title: string;
  items: Item[];
}

const GROUPS: Group[] = [
  { title: '', items: [{ to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    title: 'Players',
    items: [
      { to: '/admin/players', label: 'All players', icon: Users, perm: ['players.view'], end: true },
      { to: '/admin/players?status=ACTIVE', label: 'Active', icon: Users, perm: ['players.view'] },
      { to: '/admin/players?status=RESTRICTED', label: 'Restricted', icon: Users, perm: ['players.view'] },
      { to: '/admin/players?status=SUSPENDED', label: 'Suspended', icon: Users, perm: ['players.view'] },
      { to: '/admin/players?flagged=1', label: 'Flagged', icon: ShieldAlert, perm: ['players.view'] },
    ],
  },
  {
    title: 'Games',
    items: [
      { to: '/admin/games/registry', label: 'Game registry', icon: Gamepad2, perm: ['games.view', 'games.manage'] },
      { to: '/admin/games/live', label: 'Live matches', icon: Activity, perm: ['matches.view'] },
      { to: '/admin/games/history', label: 'Match history', icon: Swords, perm: ['matches.view'] },
      { to: '/admin/games/disputes', label: 'Disputes', icon: Gavel, perm: ['disputes.view'] },
    ],
  },
  {
    title: 'Community',
    items: [
      { to: '/admin/messages', label: 'Messages', icon: MessageSquare, perm: ['support.view'] },
      { to: '/admin/creators', label: 'Creator rewards', icon: Megaphone, perm: ['support.view'] },
    ],
  },
  {
    title: 'Finance',
    items: [
      { to: '/admin/finance', label: 'Overview', icon: Coins, perm: ['finance.view'], end: true },
      { to: '/admin/finance/buy-requests', label: 'Buy requests', icon: ShoppingCart, perm: ['finance.view', 'finance.buy.manage'] },
      { to: '/admin/finance/sell-requests', label: 'Sell requests', icon: ArrowLeftRight, perm: ['finance.view', 'finance.sell.manage'] },
      { to: '/admin/finance/ledger', label: 'Ledger', icon: ScrollText, perm: ['finance.ledger.view'] },
      { to: '/admin/finance/integrity', label: 'Ledger integrity', icon: ListChecks, perm: ['finance.integrity'] },
      { to: '/admin/finance/treasury', label: 'Admin treasury', icon: Landmark, perm: ['finance.view'] },
      { to: '/admin/finance/platform-fees', label: 'Platform fee wallet', icon: PiggyBank, perm: ['finance.view'] },
      { to: '/admin/finance/reserve', label: 'Reserve & price', icon: Scale, perm: ['finance.view'] },
      { to: '/admin/finance/rewards-pool', label: 'Rewards pool', icon: Gift, perm: ['finance.view'] },
      { to: '/admin/finance/crypto', label: 'Crypto withdrawals', icon: Bitcoin, perm: ['finance.view', 'finance.sell.manage'] },
      { to: '/admin/finance/liquidity', label: 'Liquidity & wallets', icon: Droplets, perm: ['finance.view'] },
      { to: '/admin/finance/house-bankroll', label: 'House bankroll', icon: Plane, perm: ['finance.view'] },
      { to: '/admin/finance/distribute', label: 'Token distribution', icon: Send, perm: ['finance.distribute'] },
    ],
  },
  {
    title: 'Security',
    items: [
      { to: '/admin/security/fraud-flags', label: 'Fraud flags', icon: ShieldAlert, perm: ['risk.view'] },
      { to: '/admin/security/login-activity', label: 'Login activity', icon: History, perm: ['security.login_activity'] },
      { to: '/admin/security/audit', label: 'Audit logs', icon: ScrollText, perm: ['audit.view'] },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/admin/notifications', label: 'Notifications', icon: Bell },
      { to: '/admin/administrators', label: 'Administrators', icon: UserCog, perm: ['admins.manage'] },
      { to: '/admin/settings', label: 'Settings', icon: Settings, perm: ['settings.view', 'settings.manage'] },
      { to: '/admin/dev', label: 'Dev simulator', icon: FlaskConical, perm: ['dev.simulator'], devOnly: true },
    ],
  },
];

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe();
  const { config } = useAuth();
  const location = useLocation();
  const perms = me.admin?.permissions ?? [];
  const isActive = (to: string, end?: boolean) => {
    const [path, query] = to.split('?');
    if (query) return location.pathname === path && location.search === `?${query}`;
    return end ? location.pathname === path && !location.search : location.pathname.startsWith(path ?? '');
  };
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3" aria-label="Admin">
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => (!i.perm || i.perm.some((p) => perms.includes(p))) && (!i.devOnly || config?.devToolsEnabled));
        if (items.length === 0) return null;
        return (
          <div key={g.title || 'root'}>
            {g.title && <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">{g.title}</p>}
            <div className="space-y-0.5">
              {items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  onClick={onNavigate}
                  className={clsx(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                    isActive(i.to, i.end) ? 'bg-white/10 text-white' : 'text-ink-300 hover:bg-white/5 hover:text-white',
                  )}
                >
                  <i.icon className="size-4" aria-hidden /> {i.label}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function AdminLayout() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const panel = (
    <>
      <div className="flex h-16 items-center justify-between px-5 text-white">
        <Logo name="Admin" to="/admin" />
        <span className="rounded-md bg-brand-500/20 px-2 py-0.5 text-[10px] font-bold tracking-wide text-brand-200 uppercase">{me.admin?.role.replace('_', ' ')}</span>
      </div>
      <SideNav onNavigate={() => setOpen(false)} />
      <div className="border-t border-white/10 p-4">
        <NavLink to="/" className="flex items-center gap-2 text-sm font-medium text-ink-300 hover:text-white">
          <Wallet className="size-4" /> Back to player app
        </NavLink>
      </div>
    </>
  );
  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-ink-950 lg:flex">{panel}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/60" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-ink-950">
            <button className="absolute top-4 right-3 rounded-lg p-1.5 text-ink-300" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            {panel}
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-ink-200/70 bg-white/80 px-4 backdrop-blur sm:px-6 dark:border-ink-800 dark:bg-ink-950/80">
        <div className="flex items-center gap-2">
          <button className="rounded-xl p-2 text-ink-600 hover:bg-ink-100 lg:hidden dark:text-ink-300 dark:hover:bg-ink-800" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-brand-600" /> Administration
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-2 hidden text-sm text-ink-500 sm:inline">
            #{me.playerNumber} · {me.username}
          </span>
          <NotificationBell userId={me.id} to="/admin/notifications" audience="admin" />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
