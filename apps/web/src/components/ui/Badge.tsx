import type { ReactNode } from 'react';
import clsx from 'clsx';
import { BUY_STATUS_LABELS, MATCH_STATUS_LABELS, SELL_STATUS_LABELS } from '@arena/shared';
import { t } from '../../lib/i18n';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200 dark:bg-ink-800 dark:text-ink-200 dark:ring-ink-700',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30',
  info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset', tones[tone], className)}>{children}</span>;
}

const STATUS_TONES: Record<string, Tone> = {
  ACTIVE: 'success',
  RESTRICTED: 'warning',
  SUSPENDED: 'danger',
  BANNED: 'danger',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  APPROVED: 'brand',
  TOKEN_CREDITED: 'success',
  TOKENS_LOCKED: 'info',
  PAYMENT_PROCESSING: 'brand',
  PAYMENT_SENT: 'success',
  COMPLETED: 'success',
  REJECTED: 'danger',
  TOKENS_UNLOCKED: 'neutral',
  CANCELLED: 'neutral',
  CREATED: 'neutral',
  WAITING_FOR_OPPONENT: 'info',
  STAKE_LOCKING: 'info',
  READY: 'brand',
  PLAYING: 'warning',
  RESULT_PENDING: 'warning',
  SETTLING: 'warning',
  SETTLED: 'success',
  DRAW: 'neutral',
  VOID: 'neutral',
  REFUNDED: 'neutral',
  DISPUTED: 'danger',
  OPEN: 'warning',
  RESOLVED: 'success',
  REVIEWED: 'neutral',
  DISMISSED: 'neutral',
  CONFIRMED: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'info',
  WIN: 'success',
  LOSS: 'danger',
};

const LABELS: Record<string, string> = { ...MATCH_STATUS_LABELS, ...SELL_STATUS_LABELS, ...BUY_STATUS_LABELS };

export function StatusBadge({ status }: { status: string }) {
  const label = LABELS[status] ?? status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{t(label)}</Badge>;
}
