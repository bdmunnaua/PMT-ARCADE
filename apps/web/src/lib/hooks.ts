import { useCallback, useEffect, useRef, useState } from 'react';
import type { Paginated } from '@arena/shared';
import { ApiError, get, newKey, qs } from './api';

export interface Loadable<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
  setData: (d: T) => void;
}

/** GET a resource; re-fetches when `path` changes. Pass null to skip. */
export function useApi<T>(path: string | null): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    get<T>(path, ctrl.signal)
      .then((d) => setData(d))
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError('INTERNAL_ERROR', String(e), 0));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload, setData };
}

/** Paginated list with filters kept in state. */
export function usePaged<T>(basePath: string, filters: Record<string, string | number | undefined>, pageSize = 20) {
  const [page, setPage] = useState(1);
  const key = JSON.stringify(filters);
  useEffect(() => setPage(1), [key]);
  const res = useApi<Paginated<T>>(`${basePath}${qs({ ...filters, page, pageSize })}`);
  return { ...res, page, setPage };
}

/**
 * One idempotency key per user action: kept across retries of the same submission,
 * rotated after success so the next action is a new operation.
 */
export function useIdempotencyKey() {
  const ref = useRef(newKey());
  return { key: () => ref.current, rotate: () => (ref.current = newKey()) };
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · PMT Arcade` : 'PMT Arcade';
  }, [title]);
}
