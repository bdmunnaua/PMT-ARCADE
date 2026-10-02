import { useNavigate } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
import clsx from 'clsx';
import type { NotificationDto } from '@arena/shared';
import { useMe } from '../auth/AuthProvider';
import { post } from '../lib/api';
import { timeAgo } from '../lib/format';
import { usePaged } from '../lib/hooks';
import { useRealtime } from '../lib/realtime';
import { Button, Card, CardHeader, EmptyState, ErrorState, Pagination, SkeletonRows } from './ui';

/** Shared by the player and admin notification pages (they read different audiences). */
export function NotificationList({ audience }: { audience: 'player' | 'admin' }) {
  const me = useMe();
  const navigate = useNavigate();
  const base = audience === 'player' ? '/api/notifications' : '/api/admin/notifications';
  const list = usePaged<NotificationDto>(base, {});
  useRealtime(`user:${me.id}`, (m) => m.type === 'notification' && list.reload());
  const open = async (n: NotificationDto) => {
    if (!n.readAt) await post(`${base}/read`, { ids: [n.id] }).catch(() => undefined);
    if (n.link) navigate(n.link);
    else list.reload();
  };
  return (
    <Card>
      <CardHeader
        title="Notifications"
        icon={<Bell className="size-4" />}
        actions={
          <Button variant="ghost" size="sm" icon={<CheckCheck className="size-4" />} onClick={() => post(`${base}/read`, { all: true }).then(list.reload)}>
            Mark all read
          </Button>
        }
      />
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <SkeletonRows />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="You’re all caught up" description="Updates about your requests and matches appear here." />
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {list.data.items.map((n) => (
            <li key={n.id}>
              <button onClick={() => void open(n)} className={clsx('flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-ink-50 dark:hover:bg-ink-850', !n.readAt && 'bg-brand-50/40 dark:bg-brand-500/5')}>
                <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-500')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{n.title}</span>
                  <span className="block text-sm text-ink-600 dark:text-ink-300">{n.body}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-500">{timeAgo(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
    </Card>
  );
}
