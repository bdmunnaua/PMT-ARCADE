/**
 * Session states shown instead of the app: the public landing page with sign-in (signed out),
 * blocked accounts, connection errors and missing configuration.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { Coins, Gamepad2, Megaphone, ShieldBan, Trophy, UserRound, Wrench } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { devAuthEnabled, devSignIn } from '../../auth/identity';
import { SignInCard } from '../../auth/SignInCard';
import { FreeGamesGrid, useArcadeConfig } from '../../components/Arcade';
import { ThemeToggle } from '../../components/Common';
import { Button, ErrorState, Input, Notice } from '../../components/ui';
import { firebaseConfigured } from '../../lib/firebase';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import { Logo } from '../../layouts/Logo';
import { LangToggle, t } from '../../lib/i18n';

export function AuthShell({ children }: { children: ReactNode }) {
  const { config } = useAuth();
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex items-center justify-between p-4">
        <Logo name={config?.platformName} compact />
        <div className="flex items-center gap-1">
          <LangToggle />
          <ThemeToggle />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}

function StateIcon({ children, tone }: { children: ReactNode; tone: 'brand' | 'rose' | 'amber' }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10',
    rose: 'bg-rose-50 text-rose-500 dark:bg-rose-500/10',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10',
  };
  return <div className={`mx-auto mb-4 grid size-14 place-items-center rounded-2xl ${tones[tone]}`}>{children}</div>;
}

/** The public landing page: sign in, or play the free games for fun right away. */
export function SignedOutPage() {
  useDocumentTitle(t("Play free games, earn PMT"));
  const { config } = useAuth();
  const arcade = useArcadeConfig();
  const popular = useApi<{ plays: Record<string, number> }>('/api/arcade/popular');
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-4 py-3 sm:px-8">
        <Logo name={config?.platformName} compact />
        <div className="flex items-center gap-1">
          <LangToggle />
          <ThemeToggle />
        </div>
      </header>
      <section className="hero-gradient mx-4 grid gap-8 overflow-hidden rounded-3xl p-6 text-white sm:mx-8 sm:p-10 lg:grid-cols-[1fr_380px] lg:items-center">
        <div>
          <h1 className="text-3xl leading-tight font-black sm:text-5xl">{t("Play free games. Earn PMT.")}</h1>
          <p className="mt-4 max-w-xl text-white/75">{t("16 free browser games — no download, no purchase needed. Climb the leaderboards, collect daily rewards and earn PMT for your scores.")}</p>
          <ul className="mt-6 grid gap-3 text-sm text-white/85 sm:grid-cols-3">
            <li className="flex items-center gap-2">
              <Gamepad2 className="size-5 text-amber-300" /> {t("Free games, daily check-in")}
            </li>
            <li className="flex items-center gap-2">
              <Trophy className="size-5 text-amber-300" /> {t("Leaderboards & weekly tournament")}
            </li>
            <li className="flex items-center gap-2">
              <Megaphone className="size-5 text-amber-300" /> {t("Creator rewards")}
            </li>
          </ul>
        </div>
        <div className="text-ink-900 dark:text-ink-100">
          {firebaseConfigured && <SignInCard />}
          {devAuthEnabled && <DevIdentityPanel />}
        </div>
      </section>
      <section className="px-4 pt-6 sm:px-8">
        <a href="/creator-rewards" className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-amber-300/60 bg-amber-50 p-5 text-amber-950 transition hover:shadow-md dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <span>
            <span className="block text-lg font-black">{t("🎁 Creator reward: 100,000 PMT")}</span>
            <span className="text-sm">{t("Make an original video or post about PMT Arcade and get rewarded after approval.")}</span>
          </span>
          <span className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white">{t("How it works")}</span>
        </a>
      </section>
      <section className="px-4 py-8 sm:px-8">
        <h2 className="mb-1 flex items-center gap-2 text-xl font-bold">
          <Coins className="size-5 text-amber-500" /> {t("Free games")}
        </h2>
        <p className="mb-4 text-sm text-ink-500">{t("Play right now for fun — sign in to earn PMT for your scores.")}</p>
        {arcade.data && <FreeGamesGrid games={arcade.data.games} plays={popular.data?.plays} linkFor={(g) => ({ href: `/games/${g.id}/index.html` })} />}
      </section>
      <footer className="px-4 pb-8 text-center text-xs text-ink-400 sm:px-8">
        <nav className="mb-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
          <a href="/token/" className="hover:text-brand-600">{t("PMT token")}</a>
          <a href="/transparency/" className="hover:text-brand-600">{t("Transparency")}</a>
          <a href="/whitepaper/" className="hover:text-brand-600">{t("Whitepaper")}</a>
          <a href="https://www.facebook.com/groups/pmtarcade" target="_blank" rel="noreferrer" className="hover:text-brand-600">Facebook</a>
          <a href="/terms/" className="hover:text-brand-600">{t("Terms")}</a>
          <a href="/privacy/" className="hover:text-brand-600">{t("Privacy")}</a>
          <a href="mailto:team@pmtarcade.com" className="hover:text-brand-600">team@pmtarcade.com</a>
        </nav>
        {t("Free to play. No purchase required. PMT does not have an established DEX market price yet.")}
      </footer>
    </div>
  );
}

/** Local development only (tree-shaken from production builds): pick a test player for this tab. */
function DevIdentityPanel() {
  const [name, setName] = useState('');
  const valid = /^[a-z0-9_]{3,20}$/.test(name);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) devSignIn(name);
  };
  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-2xl border border-dashed border-amber-400 bg-white p-4 dark:bg-ink-900">
      <Notice tone="warning">{t("Development identity — not a login. Each browser tab can act as a different test player.")}</Notice>
      <Input label={t("Test player name")} value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="alice" error={name && !valid ? t("3–20 characters: a–z, 0–9, _") : undefined} />
      <Button type="submit" variant="outline" className="w-full" disabled={!valid} icon={<UserRound className="size-4" />}>
        {t("Continue as test player")}
      </Button>
    </form>
  );
}

export function BlockedPage({ message }: { message: string | null }) {
  const { signOut } = useAuth();
  return (
    <AuthShell>
      <div className="text-center">
        <StateIcon tone="rose">
          <ShieldBan className="size-6" />
        </StateIcon>
        <h1 className="text-xl font-bold">{t("Account unavailable")}</h1>
        <p className="mt-2 text-sm text-ink-500">{message ?? 'This account cannot be used.'}</p>
        <Button variant="outline" className="mt-6" onClick={() => void signOut()}>
          {t("Sign out")}
        </Button>
      </div>
    </AuthShell>
  );
}

export function SessionErrorPage({ message }: { message: string | null }) {
  const { retry } = useAuth();
  return (
    <AuthShell>
      <ErrorState error={message ?? t('Could not reach the server.')} onRetry={retry} />
    </AuthShell>
  );
}

export function SetupRequiredPage() {
  return (
    <AuthShell>
      <StateIcon tone="amber">
        <Wrench className="size-6" />
      </StateIcon>
      <h1 className="text-center text-xl font-bold">{t("External setup required")}</h1>
      <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
        {t("No sign-in source is configured. Add")} <code className="font-mono">{t("FIREBASE_API_KEY")}</code>, <code className="font-mono">{t("FIREBASE_AUTH_DOMAIN")}</code> and{' '}
        <code className="font-mono">{t("FIREBASE_PROJECT_ID")}</code> {t("(the host project's Firebase project) to the")} <code className="font-mono">.env</code> {t("file in the repository root, or set")}{' '}
        <code className="font-mono">{t("VITE_DEV_AUTH=true")}</code> {t("for local development, then restart the dev server.")}
      </p>
      <p className="mt-3 text-sm text-ink-500 dark:text-ink-400">{t("See docs/INTEGRATION.md.")}</p>
    </AuthShell>
  );
}
