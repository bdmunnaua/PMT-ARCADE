/**
 * Sign-in for pmtarcade.com (the same Firebase project the old arcade used, so every existing
 * account keeps working): Google, or email + password with "create account" and password reset.
 * The platform profile and wallet are created automatically by the server after sign-in.
 */
import { useState, type FormEvent } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';
import { ExternalLink, Eye, EyeOff } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { firebaseAuth } from '../lib/firebase';
import { getLang, t } from '../lib/i18n';
import { inAppBrowser, openInChromeHref } from '../lib/invite';

function authError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account uses this email. Create one instead.',
    'auth/email-already-in-use': 'This email already has an account. Sign in instead.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/popup-closed-by-user': 'The Google window was closed.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return t(map[code] ?? 'Sign-in failed. Please try again.');
}

export function SignInCard() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const google = async () => {
    setError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(firebaseAuth(), provider);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      // phones and in-app browsers often block pop-ups: fall back to a full-page redirect
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') await signInWithRedirect(firebaseAuth(), provider).catch((err: unknown) => setError(authError(err)));
      else setError(authError(e));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'in') await signInWithEmailAndPassword(firebaseAuth(), email.trim(), password);
      else {
        const cred = await createUserWithEmailAndPassword(firebaseAuth(), email.trim(), password);
        await sendEmailVerification(cred.user).catch(() => undefined);
      }
    } catch (err) {
      setError(authError(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError(null);
    if (!email.trim()) return setError(t("Type your email first, then press \"Forgot password\"."));
    try {
      await sendPasswordResetEmail(firebaseAuth(), email.trim());
      setInfo(t("Password reset email sent — check your inbox."));
    } catch (err) {
      setError(authError(err));
    }
  };

  // Google refuses to sign people in inside Facebook / Messenger / imo browsers (ad and invite clicks land there)
  const inApp = inAppBrowser();
  const chrome = inApp ? openInChromeHref() : null;

  return (
    <div className="card space-y-4 p-6">
      {inApp && (
        <div className="space-y-2 rounded-2xl bg-amber-50 p-3 text-center text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="text-sm font-semibold">{t('Google sign-in does not work inside {app}.', { app: inApp })}</p>
          {chrome ? (
            <a href={chrome} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 font-bold text-white">
              <ExternalLink className="size-5" /> {t('Open in Chrome to continue')}
            </a>
          ) : (
            <p className="text-xs">{t('Tap ••• (or the share icon) at the top or bottom of the screen and choose “Open in Safari” / “Open in browser”.')}</p>
          )}
          <p className="text-xs">{t('Or sign in with email below.')}</p>
        </div>
      )}
      <div className="grid grid-cols-2 rounded-xl bg-ink-100 p-1 text-sm font-semibold dark:bg-ink-800">
        {(['in', 'up'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={mode === m ? 'rounded-lg bg-white py-2 shadow dark:bg-ink-700' : 'py-2 text-ink-500'}>
            {m === 'in' ? t("Sign in") : t("Create account")}
          </button>
        ))}
      </div>
      <Button variant="outline" className="w-full" onClick={() => void google()}>
        <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {t("Continue with Google")}
      </Button>
      <div className="flex items-center gap-3 text-xs text-ink-400">
        <span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" /> {t("or with email")} <span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
      </div>
      <form onSubmit={submit} className="space-y-3">
        <Input label={t("Email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        <div className="relative">
          <Input label={t("Password")} type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={6} required className="pr-11" />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2.5 bottom-2 rounded-lg p-1 text-ink-400 hover:text-ink-700" aria-label={show ? t("Hide password") : t("Show password")}>
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {info && <p className="text-sm text-emerald-600">{info}</p>}
        <Button type="submit" className="w-full" loading={busy}>
          {mode === 'in' ? t("Sign in") : t("Create account")}
        </Button>
        <p className="text-center text-xs text-ink-500">
          {t('By continuing you agree to the')} <a href="/terms/" className="underline">{t('Terms')}</a> {t('and')} <a href="/privacy/" className="underline">{t('Privacy Policy')}</a>{getLang() === 'bn' ? '-তে রাজি হচ্ছেন।' : '.'} {t('18+ only.')}
        </p>
        {mode === 'in' && (
          <button type="button" onClick={() => void reset()} className="w-full text-center text-sm text-brand-600 hover:underline">
            {t("Forgot password?")}
          </button>
        )}
      </form>
    </div>
  );
}
