/**
 * /creator-rewards — the campaign page. Signed out: what it is, the rules, and sign in.
 * Signed in: eligibility (one finished game), the submission form, and the review status.
 * Rewards are for ORIGINAL content only — never for likes, follows or shares.
 */
import { useState } from 'react';
import { CheckCircle2, Clapperboard, Gamepad2, Link as LinkIcon, ShieldCheck } from 'lucide-react';
import type { CreatorInfoDto, CreatorMeDto } from '@arena/shared';
import { SignInCard } from '../auth/SignInCard';
import { ThemeToggle } from '../components/Common';
import { Badge, Button, ButtonLink, Card, CardBody, CardHeader, Input, Notice, PageLoader, Select, useToast } from '../components/ui';
import { Logo } from '../layouts/Logo';
import { ApiError, post } from '../lib/api';
import { dateTime, tokens } from '../lib/format';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { LangToggle, t } from '../lib/i18n';

function Hero({ info }: { info: CreatorInfoDto | null }) {
  const reward = (info?.rewardTokens ?? 100_000).toLocaleString('en-US');
  return (
    <section className="hero-gradient overflow-hidden rounded-3xl p-6 text-white sm:p-10">
      <p className="text-sm font-semibold tracking-wide text-amber-300 uppercase">{t('Creator rewards')}</p>
      <h1 className="mt-2 text-3xl leading-tight font-black sm:text-5xl">{t('🎮 Create. Play. Earn {n} PMT.', { n: reward })}</h1>
      <p className="mt-4 max-w-2xl text-white/80">{t('Make an original video or post about your PMT Arcade experience and receive {n} PMT after it is approved.', { n: reward })}</p>
      {info && (
        <p className="mt-4 inline-flex rounded-full bg-white/15 px-3 py-1 text-sm">
          {t('{left} of {max} creator places left', { left: info.remaining.toLocaleString('en-US'), max: info.maxCreators.toLocaleString('en-US') })}
        </p>
      )}
    </section>
  );
}

function Steps() {
  const steps = [
    { icon: <Gamepad2 className="size-5" />, title: t('1. Play'), text: t('Sign in and finish at least one game on PMT Arcade.') },
    { icon: <Clapperboard className="size-5" />, title: t('2. Create'), text: t('Make your own Facebook or Instagram Reel, TikTok, YouTube video or post about PMT Arcade. Show pmtarcade.com.') },
    { icon: <LinkIcon className="size-5" />, title: t('3. Submit'), text: t('Paste the link of your post here. Our team checks every post.') },
    { icon: <CheckCircle2 className="size-5" />, title: t('4. Receive'), text: t('Approved creators get the reward as PMT in their PMT Arcade balance.') },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((s) => (
        <Card key={s.title}>
          <CardBody className="space-y-2">
            <span className="text-brand-600">{s.icon}</span>
            <h3 className="font-semibold">{s.title}</h3>
            <p className="text-sm text-ink-500">{s.text}</p>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function Rules() {
  return (
    <Card>
      <CardHeader title={t('Campaign rules')} icon={<ShieldCheck className="size-4" />} />
      <CardBody>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-600 dark:text-ink-300">
          <li>{t('Your content must be original and made by you. Copied or AI-spam posts are rejected.')}</li>
          <li>{t('Mention or show pmtarcade.com in the post.')}</li>
          <li>{t('Clearly say you receive a PMT reward — on Facebook and Instagram use the “Paid partnership” label where it is available.')}</li>
          <li>{t('We reward content, not likes, follows or shares. Do not ask people to like or share for rewards.')}</li>
          <li>{t('One reward per person and per social account. Several accounts by one person are not allowed and are rejected.')}</li>
          <li>{t('Keep the post public for at least 30 days.')}</li>
          <li>{t('The reward is bonus PMT: you can play with it and withdraw it to your own wallet when withdrawals are open. PMT does not have an established DEX market price yet.')}</li>
          <li>{t('Rewards are limited to the places shown above. PMT Arcade may end the campaign or reject posts that break these rules.')}</li>
        </ul>
      </CardBody>
    </Card>
  );
}

/** Signed out: the campaign, the rules, and sign-in. */
export function CreatorRewardsPublicPage() {
  useDocumentTitle('Creator rewards');
  const info = useApi<CreatorInfoDto>('/api/creator/info');
  return (
    <div className="min-h-screen pb-10">
      <header className="flex items-center justify-between px-4 py-3 sm:px-8">
        <Logo compact />
        <div className="flex items-center gap-2">
          <LangToggle />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4">
        <Hero info={info.data} />
        <Steps />
        <div className="grid gap-6 lg:grid-cols-2">
          <Rules />
          <div className="text-ink-900 dark:text-ink-100">
            <SignInCard />
          </div>
        </div>
      </main>
    </div>
  );
}

const PLATFORMS = [
  ['FACEBOOK', 'Facebook'],
  ['INSTAGRAM', 'Instagram'],
  ['TIKTOK', 'TikTok'],
  ['YOUTUBE', 'YouTube'],
  ['OTHER', 'Other'],
] as const;

/** Signed in: eligibility, submission and status. */
export default function CreatorRewardsPage() {
  useDocumentTitle('Creator rewards');
  const toast = useToast();
  const me = useApi<CreatorMeDto>('/api/me/creator');
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number][0]>('FACEBOOK');
  const [postUrl, setPostUrl] = useState('');
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  if (me.loading && !me.data) return <PageLoader />;
  const x = me.data;
  const sub = x?.submission;
  const submit = async () => {
    setBusy(true);
    try {
      await post('/api/me/creator', { platform, postUrl: postUrl.trim(), socialHandle: handle.trim() });
      toast.success(t('Submitted! Our team will check your post.'));
      me.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? t(e.message) : t('Could not submit. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <Hero info={x ?? null} />
      <Steps />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('Submit your post')} />
          <CardBody className="space-y-3">
            {sub ? (
              <div className="space-y-2 text-sm">
                <p className="flex items-center gap-2">
                  {t('Status')}: <Badge tone={sub.status === 'APPROVED' ? 'success' : sub.status === 'REJECTED' ? 'danger' : 'warning'}>{t(sub.status === 'APPROVED' ? 'Approved' : sub.status === 'REJECTED' ? 'Not approved' : 'Waiting for review')}</Badge>
                </p>
                <p className="break-all">
                  <a href={sub.postUrl} target="_blank" rel="noreferrer" className="text-brand-600 underline">
                    {sub.postUrl}
                  </a>
                </p>
                <p className="text-ink-500">
                  @{sub.socialHandle} · {dateTime(sub.createdAt)}
                </p>
                {sub.status === 'APPROVED' && sub.rewardUnits !== null && <Notice tone="success">{t('Thank you! {amount} was added to your balance.', { amount: tokens(sub.rewardUnits) })}</Notice>}
                {sub.status === 'REJECTED' && sub.reviewNote && <Notice tone="warning">{sub.reviewNote}</Notice>}
              </div>
            ) : !x?.enabled || (x?.remaining ?? 0) <= 0 ? (
              <Notice tone="info">{t('The creator campaign is closed right now.')}</Notice>
            ) : !x?.eligible ? (
              <>
                <Notice tone="info">{t('Finish at least one game on PMT Arcade first — then you can submit your post here.')}</Notice>
                <ButtonLink to="/play" className="w-full">
                  {t('Play a game')}
                </ButtonLink>
              </>
            ) : (
              <>
                <Select label={t('Where did you post?')} value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)}>
                  {PLATFORMS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
                <Input label={t('Link to your post')} value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder="https://www.facebook.com/reel/…" inputMode="url" />
                <Input label={t('Your account name on that platform')} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@yourname" />
                <Button className="w-full" disabled={busy || !/^https:\/\/\S+$/.test(postUrl.trim()) || handle.trim().length < 2} onClick={submit}>
                  {t('Submit for review')}
                </Button>
                <p className="text-xs text-ink-500">{t('You can submit one post per campaign. Make sure it follows the rules.')}</p>
              </>
            )}
          </CardBody>
        </Card>
        <Rules />
      </div>
    </div>
  );
}
