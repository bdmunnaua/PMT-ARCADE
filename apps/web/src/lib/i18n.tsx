/**
 * English / Bangla. Text is written in English in the code and wrapped in t(); the Bangla
 * dictionary (i18n-bn.ts) is keyed by that English text, so a missing translation simply shows
 * English. `{name}` placeholders are filled from `vars`. Switching the language remounts the app
 * (LangRoot), so plain t() calls everywhere pick up the new language without hooks.
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { BN } from './i18n-bn';

export type Lang = 'en' | 'bn';
const KEY = 'lang';
const listeners = new Set<() => void>();

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'bn') return saved;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('bn') ? 'bn' : 'en';
}

let lang: Lang = initial();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export const getLang = () => lang;

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lang,
  );
}

export function t(en: string, vars?: Record<string, string | number>): string {
  let s = (lang === 'bn' && BN[en]) || en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(typeof v === 'number' ? v.toLocaleString('en-US') : v);
  return s;
}

/** Plural helper: t(n === 1 ? one : many). Bangla has one form, so both keys map to the same text. */
export const tn = (n: number, one: string, many: string, vars?: Record<string, string | number>) => t(n === 1 ? one : many, { n, ...vars });

/** Remounts the app when the language changes. */
export function LangRoot({ children }: { children: ReactNode }) {
  const l = useLang();
  return <div key={l} className="contents">{children}</div>;
}

/** "বাংলা" ⇄ "English" switch for headers. */
export function LangToggle({ className = '' }: { className?: string }) {
  const l = useLang();
  return (
    <button
      type="button"
      onClick={() => setLang(l === 'bn' ? 'en' : 'bn')}
      className={`rounded-xl px-2.5 py-1.5 text-sm font-semibold text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800 ${className}`}
      aria-label={l === 'bn' ? 'Switch to English' : 'বাংলায় দেখুন'}
      lang={l === 'bn' ? 'en' : 'bn'}
    >
      {l === 'bn' ? 'EN' : 'বাংলা'}
    </button>
  );
}
