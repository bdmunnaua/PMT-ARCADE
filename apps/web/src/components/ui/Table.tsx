import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import type { ApiError } from '../../lib/api';
import { Button } from './Button';
import { EmptyState, ErrorState, SkeletonRows } from './States';
import { t } from '../../lib/i18n';

export interface Column<T> {
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** hide on small screens */
  hideOnMobile?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  error,
  onRetry,
  empty,
}: {
  columns: Column<T>[];
  rows: T[] | undefined | null;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  error?: ApiError | null;
  onRetry?: () => void;
  empty?: { title: string; description?: ReactNode; action?: ReactNode };
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading && !rows) return <SkeletonRows />;
  if (!rows || rows.length === 0) return <EmptyState title={empty?.title ?? t('Nothing here yet')} description={empty?.description} action={empty?.action} />;
  return (
    <div className={clsx('overflow-x-auto', loading && 'opacity-60 transition-opacity')}>
      <table className="min-w-full divide-y divide-ink-100 dark:divide-ink-800">
        <thead className="bg-ink-50/60 dark:bg-ink-850/60">
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col" className={clsx('table-head', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={clsx(onRowClick && 'cursor-pointer hover:bg-ink-50 focus:bg-ink-50 dark:hover:bg-ink-850 dark:focus:bg-ink-850')}
            >
              {columns.map((c, i) => (
                <td key={i} className={clsx('table-cell', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, hasMore, onPage }: { page: number; hasMore: boolean; onPage: (p: number) => void }) {
  if (page === 1 && !hasMore) return null;
  return (
    <nav className="flex items-center justify-between border-t border-ink-100 px-5 py-3 dark:border-ink-800" aria-label={t("Pagination")}>
      <span className="text-sm text-ink-500">{t("Page")} {page}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} icon={<ChevronLeft className="size-3.5" />}>
          {t("Previous")}
        </Button>
        <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => onPage(page + 1)}>
          {t("Next")} <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </nav>
  );
}

export function Tabs<K extends string>({ value, onChange, items }: { value: K; onChange: (k: K) => void; items: { key: K; label: ReactNode; count?: number }[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-ink-100 p-1 dark:bg-ink-850" role="tablist">
      {items.map((it) => (
        <button
          key={it.key}
          role="tab"
          aria-selected={value === it.key}
          onClick={() => onChange(it.key)}
          className={clsx(
            'flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition',
            value === it.key ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-white' : 'text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100',
          )}
        >
          {it.label}
          {it.count ? <span className="rounded-full bg-brand-600 px-1.5 text-[10px] text-white">{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3 border-b border-ink-100 px-5 py-4 dark:border-ink-800 [&>*]:min-w-36 [&>*]:flex-1 sm:[&>*]:flex-none">{children}</div>;
}
