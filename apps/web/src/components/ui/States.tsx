import type { ReactNode } from 'react';
import { AlertCircle, Inbox, Loader2, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import type { ApiError } from '../../lib/api';
import { Button } from './Button';
import { t } from '../../lib/i18n';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-brand-500', className)} aria-label={t("Loading")} />;
}

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-ink-500" role="status">
      <Spinner className="size-7" />
      {t(label)}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-ink-100 dark:bg-ink-800', className)} />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, icon, action }: { title: string; description?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-ink-100 text-ink-400 dark:bg-ink-800">{icon ?? <Inbox className="size-6" />}</div>
      <h3 className="font-semibold">{t(title)}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-500 dark:text-ink-400">{typeof description === 'string' ? t(description) : description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | Error | string | null; onRetry?: () => void }) {
  const message = typeof error === 'string' ? error : (error?.message ?? 'Something went wrong.');
  // server messages are English; known ones have a Bangla translation
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center" role="alert">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-rose-50 text-rose-500 dark:bg-rose-500/10">
        <AlertCircle className="size-6" />
      </div>
      <h3 className="font-semibold">{t("Couldn’t load this")}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-500 dark:text-ink-400">{t(message)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-5" icon={<RotateCcw className="size-3.5" />} onClick={onRetry}>
          {t("Try again")}
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: ReactNode; children: ReactNode }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100',
    warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
    danger: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100',
  };
  return (
    <div className={clsx('rounded-xl border px-4 py-3 text-sm', tones[tone])}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}
