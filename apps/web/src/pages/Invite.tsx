/**
 * Invite links (pmtarcade.com/r/CODE).
 *   - InviteWelcomePage: signed out — "X invited you to play Ludo", the joining reward, Continue with Google.
 *     Inside Facebook / Messenger / imo (where Google blocks sign-in) it first offers "Open in Chrome".
 *   - JoinInvitePage: signed in — confirm the stake, join the room, go to the table.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ExternalLink, Gift, Users } from 'lucide-react';
import type { InvitePreviewDto, MatchDto } from '@arena/shared';
import { SignInCard } from '../auth/SignInCard';
import { useWallet } from '../components/Wallet';
import { Button, ButtonLink, Card, CardBody, ErrorState, Notice, PageLoader } from '../components/ui';
import { ThemeToggle } from '../components/Common';
import { Logo } from '../layouts/Logo';
import { ApiError, get, post } from '../lib/api';
import { tokens } from '../lib/format';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { LangToggle, t } from '../lib/i18n';
import { inAppBrowser, openInChromeHref } from '../lib/invite';

const codeFromPath = () => (/^\/r\/([A-Za-z0-9]{4,12})/.exec(window.location.pathname)?.[1] ?? '').toUpperCase();

function Seats({ x }: { x: InvitePreviewDto }) {
  return (
    <div className="flex items-center justify-center gap-2" aria-label={t('{n} of {max} seats taken', { n: x.playerCount, max: x.maxPlayers })}>
      {Array.from({ length: x.maxPlayers }, (_, i) => (
        <span key={i} className={`size-4 rounded-full ${i < x.playerCount ? 'bg-emerald-500' : 'bg-ink-200 dark:bg-ink-700'}`} />
      ))}
      <span className="ml-1 text-sm text-ink-500">{t('{n} of {max} seats taken', { n: x.playerCount, max: x.maxPlayers })}</span>
    </div>
  );
}

function InviteHeadline({ x }: { x: InvitePreviewDto }) {
  return (
    <div className="space-y-3 text-center">
      <h1 className="text-2xl font-black sm:text-3xl">{t('Welcome to PMT Arcade! 👋')}</h1>
      <p className="text-lg">
        <strong>{x.hostName}</strong> {t('invited you to play')} <strong>{t(x.gameName)}</strong>
      </p>
      <p className="text-sm text-ink-500">
        {t('Stake')}: <strong>{tokens(x.stakeUnits)}</strong>
      </p>
      <Seats x={x} />
    </div>
  );
}

/** Signed-out visitor who opened an invite link. */
export function InviteWelcomePage() {
  useDocumentTitle('You are invited');
  const code = codeFromPath();
  const preview = useApi<InvitePreviewDto>(code ? `/api/invites/${code}` : null);
  const inApp = inAppBrowser();
  const chrome = openInChromeHref();
  const x = preview.data;
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white pb-10 dark:from-ink-950 dark:to-ink-950">
      <header className="flex items-center justify-between px-4 py-3">
        <Logo compact />
        <div className="flex items-center gap-2">
          <LangToggle />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-md space-y-5 px-4">
        {preview.loading && <PageLoader />}
        {preview.error && <ErrorState error={t('This invite link is not valid. Ask your friend to send it again.')} />}
        {x && (
          <>
            <Card>
              <CardBody className="space-y-4">
                <InviteHeadline x={x} />
                {x.open ? (
                  x.welcomeBonusTokens > 0 && (
                    <div className="flex items-center gap-3 rounded-2xl bg-amber-50 p-3 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                      <Gift className="size-6 shrink-0" />
                      <p className="text-sm">
                        {t('New here? You get {n} PMT free to start playing.', { n: x.welcomeBonusTokens.toLocaleString('en-US') })}
                      </p>
                    </div>
                  )
                ) : (
                  <Notice tone="warning">{t('This room has already started or is full. Sign in and start your own game.')}</Notice>
                )}
              </CardBody>
            </Card>

            {inApp ? (
              <Card>
                <CardBody className="space-y-3 text-center">
                  <p className="font-semibold">{t('Google sign-in does not work inside {app}.', { app: inApp })}</p>
                  {chrome ? (
                    <a href={chrome} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 text-lg font-bold text-white">
                      <ExternalLink className="size-5" /> {t('Open in Chrome to continue')}
                    </a>
                  ) : (
                    <p className="text-sm text-ink-600 dark:text-ink-300">{t('Tap ••• (or the share icon) at the top or bottom of the screen and choose “Open in Safari” / “Open in browser”.')}</p>
                  )}
                  <p className="text-xs text-ink-500">{t('Or sign in with email below.')}</p>
                </CardBody>
              </Card>
            ) : null}

            <SignInCard />
          </>
        )}
      </main>
    </div>
  );
}

/** Signed-in player who opened an invite link: confirm and join. */
export function JoinInvitePage() {
  useDocumentTitle('Join game');
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const wallet = useWallet();
  const preview = useApi<InvitePreviewDto>(`/api/invites/${code.toUpperCase()}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (preview.loading && !preview.data) return <PageLoader />;
  if (preview.error || !preview.data) return <ErrorState error={t('This invite link is not valid. Ask your friend to send it again.')} />;
  const x = preview.data;
  const balance = (wallet.data?.availableUnits ?? 0) + (wallet.data?.bonusUnits ?? 0);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      // first visit: creates the player's arcade profile, which pays the one-time joining reward
      await get('/api/arcade/me').catch(() => undefined);
      const m = await post<MatchDto>('/api/matches/join-by-code', { code: x.code });
      navigate(`/matches/${m.id}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ALREADY_IN_MATCH') navigate(`/matches/${x.matchId}`, { replace: true });
      else setError(e instanceof ApiError ? e.message : t('Could not join. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-5 py-4">
      <Card>
        <CardBody className="space-y-5">
          <InviteHeadline x={x} />
          {x.open ? (
            <>
              <p className="text-center text-sm text-ink-500">
                {t('Your balance')}: <strong>{wallet.data ? tokens(balance) : '…'}</strong>
              </p>
              {error && <Notice tone="danger">{error}</Notice>}
              <Button size="lg" className="w-full" icon={<Users className="size-5" />} disabled={busy} onClick={join}>
                {t('Join the game')} · {tokens(x.stakeUnits)}
              </Button>
              <p className="text-center text-xs text-ink-500">{t('Your stake is held safely until the game ends. The winner takes the pot minus a 1% fee.')}</p>
            </>
          ) : (
            <>
              <Notice tone="warning">{t('This room has already started or is full.')}</Notice>
              <ButtonLink to="/play" className="w-full">
                {t('Start your own game')}
              </ButtonLink>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export { codeFromPath };
