/** Free arcade games: cards, daily check-in and invites (the original pmtarcade.com features). */
import { useState } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';
import { CalendarCheck, Copy, Flame, Gift } from 'lucide-react';
import type { ArcadeConfigDto, ArcadeGameDto, ArcadeMeDto } from '@arena/shared';
import { ApiError, post } from '../lib/api';
import { tokens } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useWallet } from './Wallet';
import { Badge, Button, Card, CardBody, CardHeader, Input, useToast } from './ui';
import { isPlayEdition } from '../lib/edition';
import { t, tn } from '../lib/i18n';

export const useArcadeConfig = () => useApi<ArcadeConfigDto>('/api/arcade/config');

/** A free game as a glossy tilted tile. `to` is an app route; `href` a plain link (signed-out play). */
export function FreeGameCard({ game, to, href, plays }: { game: ArcadeGameDto; to?: string; href?: string; plays?: number }) {
  const body = (
    <>
      <div className="stage-3d relative grid aspect-[4/3] place-items-center overflow-hidden rounded-2xl" style={{ background: `linear-gradient(135deg, ${game.colors[0]}, ${game.colors[1]})` }}>
        <span className="text-5xl drop-shadow-[0_8px_10px_rgb(0_0_0/0.35)] transition-transform duration-300 [transform:rotateX(18deg)_translateZ(0)] group-hover:scale-110 group-hover:[transform:rotateX(0deg)]">{game.emoji}</span>
        <span className="absolute inset-0 bg-[radial-gradient(90%_60%_at_25%_0%,rgb(255_255_255/0.35),transparent_60%)]" />
        {game.isNew && <span className="absolute top-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-black text-ink-900">{t("NEW")}</span>}
        {!!plays && <span className="absolute right-2 bottom-2 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-semibold text-white">{tn(plays, '{n} play', '{n} plays')}</span>}
      </div>
      <div className="px-1 pt-2">
        <p className="truncate text-sm font-bold">{game.name}</p>
        <p className="truncate text-xs text-ink-500">
          {isPlayEdition ? t(game.tag) : <>{t(game.tag)} · {t("up to {n} PMT", { n: game.maxPerRunTokens })}</>}
        </p>
      </div>
    </>
  );
  const cls = 'group block rounded-2xl p-1.5 transition hover:-translate-y-1 hover:bg-white hover:shadow-lg dark:hover:bg-ink-900';
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <a href={href} className={cls}>
      {body}
    </a>
  );
}

export function FreeGamesGrid({ games, linkFor, plays }: { games: ArcadeGameDto[]; linkFor: (g: ArcadeGameDto) => { to?: string; href?: string }; plays?: Record<string, number> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {games.map((g) => (
        <FreeGameCard key={g.id} game={g} plays={plays?.[g.id]} {...linkFor(g)} />
      ))}
    </div>
  );
}

/** Daily check-in streak (10 → 60 PMT bonus) and today's free-game earnings. */
export function CheckinCard() {
  const toast = useToast();
  const wallet = useWallet();
  const me = useApi<ArcadeMeDto>('/api/arcade/me');
  const [busy, setBusy] = useState(false);
  const m = me.data;
  const checkin = async () => {
    setBusy(true);
    try {
      const r = await post<{ amountUnits: number; streak: number }>('/api/arcade/checkin');
      toast.success(`+${tokens(r.amountUnits)} — day ${r.streak} streak 🔥`);
      me.reload();
      wallet.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("Check-in failed."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title={t("Daily check-in")} subtitle={t("Come back every day — the reward grows with your streak.")} icon={<CalendarCheck className="size-4" />} />
      <CardBody className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={clsx('grid size-12 place-items-center rounded-2xl text-white shadow-lg', m?.streak ? 'bg-gradient-to-br from-orange-400 to-rose-500' : 'bg-ink-300 dark:bg-ink-700')}>
            <Flame className="size-6" />
          </span>
          <div>
            <p className="text-lg font-black">{m ? tn(m.streak, '{n} day', '{n} days') : '…'}</p>
            <p className="text-xs text-ink-500">{m ? t('Free games today: {a} of {b}', { a: tokens(m.earnedTodayUnits), b: tokens(m.dailyCapUnits) }) : ''}</p>
          </div>
        </div>
        <Button loading={busy} disabled={!m || m.checkedInToday} onClick={checkin}>
          {m?.checkedInToday ? t("Checked in ✓") : t('Check in · +{n} PMT', { n: m?.nextCheckinTokens ?? '' })}
        </Button>
      </CardBody>
    </Card>
  );
}

/** Invite friends: both get a bonus once the friend has earned enough from free games. */
export function InviteCard() {
  const toast = useToast();
  const me = useApi<ArcadeMeDto>('/api/arcade/me');
  const config = useArcadeConfig();
  const [code, setCode] = useState('');
  const m = me.data;
  const c = config.data;
  const link = m ? `${window.location.origin}/?ref=${m.refCode}` : '';
  const use = async () => {
    try {
      await post('/api/arcade/referral', { code: code.trim() });
      toast.success(t("Invite code saved."));
      me.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("Could not use that code."));
    }
  };
  return (
    <Card>
      <CardHeader
        title={t("Invite friends")}
        icon={<Gift className="size-4" />}
        subtitle={c ? t('You get {a} PMT and your friend {b} PMT once they earn {c} PMT from free games.', { a: c.referralBonusTokens, b: c.referralWelcomeTokens, c: c.referralUnlockTokens }) : undefined}
        actions={m ? <Badge tone="brand">{t('{n} invited', { n: m.refCount })}</Badge> : null}
      />
      <CardBody className="space-y-3">
        <div className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 dark:bg-ink-850">
          <span className="flex-1 truncate font-mono text-sm">{link || '…'}</span>
          <Button
            size="sm"
            variant="outline"
            icon={<Copy className="size-4" />}
            onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success(t("Invite link copied.")), () => toast.error(t("Could not copy.")))}
          >
            {t("Copy")}
          </Button>
        </div>
        {m && !m.referred && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input label={t("Got an invite code?")} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC2345" maxLength={12} />
            </div>
            <Button variant="outline" disabled={code.trim().length < 4} onClick={use}>
              {t("Use code")}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
