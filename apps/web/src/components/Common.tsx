import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Bell, Copy, Gamepad2, Moon, Sun } from 'lucide-react';
import clsx from 'clsx';
import type { GameDto, RequestEventDto } from '@arena/shared';
import { get } from '../lib/api';
import { dateTime, human, tokens } from '../lib/format';
import { useRealtime } from '../lib/realtime';
import { Badge, useToast } from './ui';
import { t } from '../lib/i18n';

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-900 dark:hover:text-white">
      <ArrowLeft className="size-4" /> {children}
    </Link>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <button onClick={toggle} className={clsx('rounded-xl p-2 text-ink-500 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800', className)} aria-label={dark ? t("Switch to light theme") : t("Switch to dark theme")}>
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}

/** Bell with unread count; live-updated from the user's realtime channel. */
export function NotificationBell({ userId, to, audience }: { userId: string; to: string; audience: 'player' | 'admin' }) {
  const [count, setCount] = useState(0);
  const refresh = () =>
    get<{ player: number; admin: number }>('/api/notifications/unread-count')
      .then((c) => setCount(audience === 'player' ? c.player : c.admin))
      .catch(() => undefined);
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience]);
  useRealtime(`user:${userId}`, (m) => {
    if (m.type === 'notification') void refresh();
  });
  return (
    <Link to={to} className="relative rounded-xl p-2 text-ink-500 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800" aria-label={`Notifications${count ? ` (${count} unread)` : ''}`}>
      <Bell className="size-5" />
      {count > 0 && <span className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{count > 99 ? '99+' : count}</span>}
    </Link>
  );
}

export function CopyText({ value, label }: { value: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 font-mono text-xs break-all text-ink-600 hover:text-brand-600 dark:text-ink-300"
      onClick={() => navigator.clipboard?.writeText(value).then(() => toast.success(`${label ?? 'Value'} copied`))}
      title={t("Copy")}
    >
      {value} <Copy className="size-3 shrink-0" />
    </button>
  );
}

export function Timeline({ events }: { events: RequestEventDto[] }) {
  if (events.length === 0) return null;
  return (
    <ol className="relative space-y-4 border-l border-ink-200 pl-5 dark:border-ink-700">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span className={clsx('absolute top-1 -left-[25px] size-2.5 rounded-full ring-4 ring-white dark:ring-ink-900', i === events.length - 1 ? 'bg-brand-500' : 'bg-ink-300 dark:bg-ink-600')} />
          <p className="text-sm font-semibold">{human(e.status)}</p>
          <p className="text-xs text-ink-500">
            {dateTime(e.createdAt)} · {e.actorType === 'ADMIN' ? t("Support team") : e.actorType === 'PLAYER' ? 'You' : 'System'}
          </p>
          {e.note && <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

const GRADIENTS = [
  'from-violet-600 to-fuchsia-500',
  'from-sky-600 to-cyan-400',
  'from-emerald-600 to-lime-400',
  'from-amber-500 to-orange-500',
  'from-rose-600 to-pink-400',
  'from-indigo-600 to-blue-400',
  'from-teal-600 to-emerald-400',
  'from-fuchsia-600 to-purple-500',
  'from-orange-600 to-amber-400',
  'from-cyan-600 to-sky-400',
];

export function GameArt({ game, className, flat }: { game: GameDto; className?: string; flat?: boolean }) {
  if (game.thumbnailUrl && flat) return <img src={game.thumbnailUrl} alt="" className={clsx('object-cover', className)} loading="lazy" />;
  if (game.thumbnailUrl)
    return (
      // the artwork sits on a tilted 3D card that straightens up on hover
      <div className={clsx('stage-3d relative overflow-hidden bg-[radial-gradient(120%_90%_at_50%_0%,#4c1d95,#120a2a_70%)]', className)}>
        <img
          src={game.thumbnailUrl}
          alt=""
          loading="lazy"
          className="absolute inset-[9%] h-[82%] w-[82%] rounded-xl object-cover shadow-[0_18px_30px_-8px_rgb(0_0_0/0.7)] ring-1 ring-white/15 transition-transform duration-500 ease-out [transform:rotateX(26deg)_rotateZ(-6deg)] group-hover:[transform:rotateX(8deg)_rotateZ(-2deg)_scale(1.05)]"
        />
      </div>
    );
  return (
    <div className={clsx('grid place-items-center bg-gradient-to-br text-white', GRADIENTS[(game.sortOrder - 1 + GRADIENTS.length) % GRADIENTS.length], className)}>
      <Gamepad2 className="size-10 opacity-90" aria-hidden />
    </div>
  );
}

export function GameCard({ game, paused = false }: { game: GameDto; paused?: boolean }) {
  const content = (
    <>
      <div className="relative">
        <GameArt game={game} className="aspect-[16/10] w-full" />
        <div className="absolute top-3 left-3">
          {paused ? <Badge tone="warning">{t("Paused")}</Badge> : game.playable ? <Badge tone="success">{t("Live")}</Badge> : game.maintenanceMode ? <Badge tone="warning">{t("Maintenance")}</Badge> : <Badge tone="neutral">{t("Coming soon")}</Badge>}
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-semibold">{game.name}</h3>
        <p className="mt-0.5 line-clamp-2 min-h-10 text-sm text-ink-500 dark:text-ink-400">{game.description}</p>
        <p className="mt-3 text-xs text-ink-500">
          {t("Stakes")} {tokens(game.minimumStakeUnits)} – {tokens(game.maximumStakeUnits)} · {game.minimumPlayers === game.maximumPlayers ? game.minimumPlayers : `${game.minimumPlayers}–${game.maximumPlayers}`} players
        </p>
      </div>
    </>
  );
  return game.playable ? (
    <Link to={`/play/${game.slug}`} className="card group overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
      {content}
    </Link>
  ) : (
    <div className="card overflow-hidden opacity-80" aria-disabled>
      {content}
    </div>
  );
}

export function Amount({ units, signed, className }: { units: number; signed?: boolean; className?: string }) {
  return <span className={clsx('font-semibold tabular-nums', signed && units > 0 && 'text-emerald-600 dark:text-emerald-400', signed && units < 0 && 'text-rose-600 dark:text-rose-400', className)}>{tokens(units, { signed })}</span>;
}
