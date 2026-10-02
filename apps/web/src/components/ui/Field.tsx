import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

export function Field({ label, hint, error, children, htmlFor, required }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">{hint}</p>
      )}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null; suffix?: ReactNode };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, hint, error, suffix, className, id, required, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  const input = (
    <div className="relative">
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={!!error || undefined}
        className={clsx('input', error && 'input-invalid', suffix ? 'pr-20' : undefined, className)}
        {...rest}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-ink-500">{suffix}</span>}
    </div>
  );
  if (!label) return input;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId} required={required}>
      {input}
    </Field>
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, hint, error, className, id, children, required, ...rest }, ref) {
  const auto = useId();
  const sid = id ?? auto;
  const el = (
    <select ref={ref} id={sid} required={required} className={clsx('input appearance-auto pr-8', error && 'input-invalid', className)} {...rest}>
      {children}
    </select>
  );
  if (!label) return el;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={sid} required={required}>
      {el}
    </Field>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, hint, error, className, id, required, ...rest }, ref) {
  const auto = useId();
  const tid = id ?? auto;
  const el = <textarea ref={ref} id={tid} required={required} className={clsx('input min-h-24', error && 'input-invalid', className)} {...rest} />;
  if (!label) return el;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={tid} required={required}>
      {el}
    </Field>
  );
});

export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 rounded border-ink-300 accent-brand-600" />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink-500 dark:text-ink-400">{hint}</span>}
      </label>
    </div>
  );
}
