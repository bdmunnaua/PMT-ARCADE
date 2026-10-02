import { formatBdt, formatMinor, formatTokens } from '@arena/shared';

export { formatBdt, formatTokens };

export const tokens = (units: number | null | undefined, opts: { signed?: boolean } = {}) => (units == null ? '—' : formatTokens(units, opts));
export const tokensPlain = (units: number) => formatMinor(units);
export const bdt = (poisha: number | null | undefined) => (poisha == null ? '—' : formatBdt(poisha));

export function dateTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}

export function date(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(ms));
}

export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : date(ms);
}

export const percentFromBps = (bps: number) => `${formatMinor(bps)}%`;

export const human = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export const playerTag = (n: number | null | undefined) => (n ? `#${n}` : '—');
