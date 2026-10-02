import { useEffect, useState } from 'react';
import { checkSettings, hasPermission, PAYMENT_METHODS, PAYMENT_PROVIDERS, type AdminSettingsDto, type PlatformSettings, type SettingKey } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, ErrorState, Input, Notice, PageHeader, PageLoader, Select, Textarea, useToast } from '../../components/ui';
import { patch } from '../../lib/api';
import { percentFromBps } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

const NUMBER_FIELDS: { key: SettingKey; label: string; hint: string }[] = [
  { key: 'MATCH_FEE_BPS', label: 'Match fee (basis points)', hint: '100 = 1%. Snapshotted into each new match.' },
  { key: 'BUY_TOKENS_PER_BDT', label: 'Buy rate (PMT per ৳1)', hint: 'Snapshotted into each buy request.' },
  { key: 'SELL_TOKENS_PER_BDT', label: 'Sell rate (PMT per ৳1)', hint: 'Must be greater than the buy rate in production.' },
  { key: 'minimum_buy_bdt', label: 'Minimum buy (৳)', hint: 'Whole taka' },
  { key: 'maximum_buy_bdt', label: 'Maximum buy (৳)', hint: 'Whole taka' },
  { key: 'minimum_sell_tokens', label: 'Minimum sell (PMT)', hint: 'Whole tokens' },
  { key: 'maximum_sell_tokens', label: 'Maximum sell (PMT)', hint: 'Whole tokens' },
  { key: 'minimum_match_stake', label: 'Minimum match stake (PMT)', hint: 'Platform-wide floor' },
  { key: 'maximum_match_stake', label: 'Maximum match stake (PMT)', hint: 'Platform-wide ceiling' },
  { key: 'large_transaction_tokens', label: 'Large transaction alert (PMT)', hint: 'Admins are notified at or above this' },
  { key: 'transfer_fee_bps', label: 'Transfer fee (basis points)', hint: '100 = 1%, kept by the platform on player-to-player transfers' },
  { key: 'minimum_transfer_tokens', label: 'Minimum transfer (PMT)', hint: 'Whole PMT' },
  { key: 'daily_transfer_limit_tokens', label: 'Daily transfer limit (PMT)', hint: 'Most one player can send in 24 hours' },
  { key: 'arcade_daily_cap_tokens', label: 'Free games: daily earning cap (PMT)', hint: 'Per player, Bangladesh day. Keep it within your ad income.' },
  { key: 'arcade_welcome_bonus_tokens', label: 'Free games: welcome bonus (PMT)', hint: 'Paid once to each new player, as bonus' },
  { key: 'arcade_referral_bonus_tokens', label: 'Invite bonus for the inviter (PMT)', hint: 'Paid when the friend has earned the unlock amount' },
  { key: 'arcade_referral_welcome_tokens', label: 'Invite bonus for the friend (PMT)', hint: 'Paid together with the inviter bonus' },
  { key: 'arcade_referral_unlock_tokens', label: 'Invite unlock (PMT earned by the friend)', hint: 'From free games, before invite bonuses are paid' },
  { key: 'onchain_min_withdraw_tokens', label: 'Crypto: minimum withdrawal (PMT)', hint: 'Whole PMT' },
  { key: 'onchain_withdraw_fee_tokens', label: 'Crypto: withdrawal fee (PMT)', hint: 'Covers the BNB network cost; goes to platform fees' },
  { key: 'onchain_min_deposit_tokens', label: 'Crypto: minimum deposit (PMT)', hint: 'Whole PMT' },
  { key: 'onchain_confirmations', label: 'Crypto: deposit confirmations', hint: 'Blocks before a deposit is credited (BNB Chain: ~3 s per block)' },
  { key: 'bot_daily_loss_limit_tokens', label: 'Bots: most the house may lose per day (PMT)', hint: 'Bonus PMT from the house bankroll; when reached, bots pause until tomorrow' },
];

export default function SettingsPage() {
  useDocumentTitle('Settings');
  const me = useMe();
  const toast = useToast();
  const s = useApi<AdminSettingsDto>('/api/admin/settings');
  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [prizesText, setPrizesText] = useState('');
  useEffect(() => {
    if (s.data) {
      setDraft(s.data.settings);
      setPrizesText(s.data.settings.tournament_prizes_tokens.join(', '));
    }
  }, [s.data]);
  if (s.loading && !s.data) return <PageLoader />;
  if (s.error || !s.data || !draft) return <ErrorState error={s.error} onRetry={s.reload} />;
  const canEdit = hasPermission(me.admin?.permissions, 'settings.manage');
  const original = s.data.settings;
  const changes = (Object.keys(draft) as SettingKey[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(original[k]));
  const check = checkSettings(draft, s.data.isProduction);
  const set = <K extends SettingKey>(k: K, v: PlatformSettings[K]) => setDraft({ ...draft, [k]: v });
  const num = (k: SettingKey) => (e: { target: { value: string } }) => {
    const n = Number(e.target.value);
    if (Number.isSafeInteger(n)) set(k, n as never);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform settings"
        subtitle={s.data.isProduction ? 'Production — unsafe configurations are refused by the server.' : 'Development — unsafe exchange rates are allowed with a warning.'}
        actions={canEdit && <Button disabled={changes.length === 0 || check.errors.length > 0} onClick={() => setConfirming(true)}>Save {changes.length || ''} change{changes.length === 1 ? '' : 's'}…</Button>}
      />
      {check.errors.map((e) => <Notice key={e} tone="danger">{e}</Notice>)}
      {check.warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="General" />
          <CardBody className="space-y-4">
            <Input label="Platform name" value={draft.platform_name} onChange={(e) => set('platform_name', e.target.value)} disabled={!canEdit} />
            <Checkbox label="Maintenance mode" hint="Pauses matches, purchases and sales for players" checked={draft.maintenance_mode} onChange={(v) => canEdit && set('maintenance_mode', v)} />
            <Checkbox label="Games enabled" checked={draft.games_enabled} onChange={(v) => canEdit && set('games_enabled', v)} />
            <Checkbox label="Buy requests enabled" checked={draft.buy_requests_enabled} onChange={(v) => canEdit && set('buy_requests_enabled', v)} />
            <Checkbox label="Sell requests enabled" checked={draft.sell_requests_enabled} onChange={(v) => canEdit && set('sell_requests_enabled', v)} />
            <Checkbox label="Free-game rewards enabled" hint="Free games keep working when off, but pay nothing" checked={draft.arcade_enabled} onChange={(v) => canEdit && set('arcade_enabled', v)} />
            <Checkbox label="🤖 Bots can fill empty seats (Ludo)" hint="Bots stake bonus PMT from the house bankroll and are always shown as bots" checked={draft.bots_enabled} onChange={(v) => canEdit && set('bots_enabled', v)} />
            <Checkbox label="Crypto withdrawals open" hint="Needs the payout hot wallet (PAYOUT_PRIVATE_KEY)" checked={draft.onchain_withdrawals_enabled} onChange={(v) => canEdit && set('onchain_withdrawals_enabled', v)} />
            <Checkbox label="Crypto deposits open" hint="Credited as bonus PMT before the public launch" checked={draft.onchain_deposits_enabled} onChange={(v) => canEdit && set('onchain_deposits_enabled', v)} />
            <Checkbox label="Weekly free-game tournament" hint="Prizes are bonus PMT from the rewards pool, paid automatically after each week" checked={draft.tournament_enabled} onChange={(v) => canEdit && set('tournament_enabled', v)} />
            <Input
              label="Tournament prizes (PMT, 1st, 2nd, …)"
              hint={`Up to 20 places · ${draft.tournament_prizes_tokens.reduce((a, b) => a + b, 0).toLocaleString()} PMT per week`}
              value={prizesText}
              onChange={(e) => {
                setPrizesText(e.target.value);
                const list = e.target.value.split(/[,\s]+/).filter(Boolean).map(Number);
                if (list.length <= 20 && list.every((n) => Number.isSafeInteger(n) && n >= 0)) set('tournament_prizes_tokens', list);
              }}
              disabled={!canEdit}
            />
            <Checkbox label="Player-to-player transfers enabled" checked={draft.transfers_enabled} onChange={(v) => canEdit && set('transfers_enabled', v)} />
            <Checkbox
              label="Reserve guard (recommended: on)"
              hint="Sell-backs must fit in the taka paid in by buyers, so you never pay sellers out of pocket"
              checked={draft.reserve_guard_enabled}
              onChange={(v) => canEdit && set('reserve_guard_enabled', v)}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Payments" subtitle="Feature flags per provider (jurisdiction / provider requirements)" />
          <CardBody className="space-y-4">
            {PAYMENT_METHODS.map((m) => (
              <Checkbox
                key={m}
                label={PAYMENT_PROVIDERS[m].label}
                checked={draft.enabled_payment_methods.includes(m)}
                onChange={(v) => canEdit && set('enabled_payment_methods', v ? [...draft.enabled_payment_methods, m] : draft.enabled_payment_methods.filter((x) => x !== m))}
              />
            ))}
            <Input label="bKash receiving number (shown to buyers)" hint="Change it any time — buyers always see the current number" value={draft.bkash_receiving_number} onChange={(e) => set('bkash_receiving_number', e.target.value)} disabled={!canEdit} />
            <Select label="bKash account type" hint="Tells buyers which bKash option to use" value={draft.bkash_account_type} onChange={(e) => set('bkash_account_type', e.target.value as PlatformSettings['bkash_account_type'])} disabled={!canEdit}>
              <option value="AGENT">Agent number — buyers use Cash Out</option>
              <option value="PERSONAL">Personal number — buyers use Send Money</option>
              <option value="MERCHANT">Merchant number — buyers use Payment</option>
            </Select>
            <Textarea label="Payment provider notice" value={draft.payment_provider_notice} onChange={(e) => set('payment_provider_notice', e.target.value)} rows={3} disabled={!canEdit} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Economy" subtitle={`Current fee ${percentFromBps(draft.MATCH_FEE_BPS)} · buy ৳1 = ${draft.BUY_TOKENS_PER_BDT} · sell ${draft.SELL_TOKENS_PER_BDT} = ৳1`} />
          <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NUMBER_FIELDS.map((f) => (
              <Input key={f.key} label={f.label} hint={f.hint} type="number" min={0} step={1} value={String(draft[f.key])} onChange={num(f.key)} disabled={!canEdit} />
            ))}
          </CardBody>
        </Card>
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Save settings"
        confirmLabel="Save settings"
        tone={changes.some((k) => ['BUY_TOKENS_PER_BDT', 'SELL_TOKENS_PER_BDT', 'MATCH_FEE_BPS'].includes(k)) ? 'danger' : 'primary'}
        reasonLabel="Reason (audit log)"
        message={
          <ul className="list-disc space-y-1 pl-5">
            {changes.map((k) => (
              <li key={k}>
                <span className="font-mono text-xs">{k}</span>: {JSON.stringify(original[k])} → <strong>{JSON.stringify(draft[k])}</strong>
              </li>
            ))}
          </ul>
        }
        onConfirm={async (reason) => {
          const changesObj = Object.fromEntries(changes.map((k) => [k, draft[k]]));
          await patch('/api/admin/settings', { changes: changesObj, reason });
          toast.success('Settings saved.');
          s.reload();
        }}
      />
    </div>
  );
}
