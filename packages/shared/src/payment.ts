import type { PaymentMethod } from './enums';

/**
 * Manual payment providers. The platform never talks to a payment API and never collects
 * PINs, OTPs or passwords — only the minimum needed for an admin to verify a payment by hand.
 * Add a provider by adding an entry here and to PAYMENT_METHODS in enums.ts.
 */
export interface PaymentProvider {
  id: PaymentMethod;
  label: string;
  kind: 'MANUAL';
  accountLabel: string;
  referenceLabel: string;
  /** Normalised account/phone number, or null if invalid. */
  normalizeAccount(raw: string): string | null;
  /** Normalised transaction reference, or null if invalid. */
  normalizeReference(raw: string): string | null;
}

/** Bangladesh mobile number: accepts +8801XXXXXXXXX, 8801…, 01…, with spaces or dashes. */
export function normalizeBdMobile(raw: string): string | null {
  let digits = raw.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('880')) digits = digits.slice(2);
  return /^01[3-9]\d{8}$/.test(digits) ? digits : null;
}

/** Trim, strip inner whitespace, uppercase. */
export function normalizeReference(raw: string): string | null {
  const v = raw.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9-]{6,40}$/.test(v) ? v : null;
}

export const PAYMENT_PROVIDERS: Record<PaymentMethod, PaymentProvider> = {
  BKASH_MANUAL: {
    id: 'BKASH_MANUAL',
    label: 'bKash (manual)',
    kind: 'MANUAL',
    accountLabel: 'bKash number',
    referenceLabel: 'bKash Transaction ID (TrxID)',
    normalizeAccount: normalizeBdMobile,
    normalizeReference,
  },
  OTHER_MANUAL: {
    id: 'OTHER_MANUAL',
    label: 'Other (manual)',
    kind: 'MANUAL',
    accountLabel: 'Account / phone number',
    referenceLabel: 'Transaction reference',
    normalizeAccount: (raw) => {
      const v = raw.trim().replace(/\s+/g, '');
      return /^[A-Za-z0-9+\-_.@]{4,40}$/.test(v) ? v : null;
    },
    normalizeReference,
  },
};

/** "01712345689" → "01******89" */
export function maskAccount(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 4) return '*'.repeat(value.length);
  return value.slice(0, 2) + '*'.repeat(Math.max(value.length - 4, 2)) + value.slice(-2);
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}
