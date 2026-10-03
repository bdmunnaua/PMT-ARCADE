import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import clsx from 'clsx';
import { ApiError } from '../../lib/api';
import { Button } from './Button';
import { Textarea } from './Field';
import { t } from '../../lib/i18n';

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (f.length === 0) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => panel.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx('card relative max-h-[92vh] w-full overflow-y-auto rounded-b-none sm:rounded-2xl', size === 'sm' ? 'sm:max-w-md' : size === 'md' ? 'sm:max-w-lg' : 'sm:max-w-2xl')}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4 dark:border-ink-800">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800" aria-label={t("Close")}>
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 px-5 py-4 dark:border-ink-800">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmOptions {
  open: boolean;
  onClose: () => void;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger' | 'success';
  /** when set, the user must type a reason (min 3 chars) which is passed to onConfirm */
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<void>;
  children?: ReactNode;
}

/** High-risk action confirmation (never window.confirm). Shows server errors inline. */
export function ConfirmDialog({ open, onClose, title, message, confirmLabel, tone = 'primary', reasonLabel, onConfirm, children }: ConfirmOptions) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);
  const run = async () => {
    if (reasonLabel && reason.trim().length < 3) {
      setError(t("Please give a reason (at least 3 characters)."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? t(e.message) : t("Something went wrong."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button variant={tone} onClick={run} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        {tone === 'danger' && <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-500" aria-hidden />}
        <div className="text-sm leading-relaxed text-ink-700 dark:text-ink-200">{message}</div>
      </div>
      {children && <div className="mt-4">{children}</div>}
      {reasonLabel && (
        <div className="mt-4">
          <Textarea label={reasonLabel} value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} rows={3} />
        </div>
      )}
      {error && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
