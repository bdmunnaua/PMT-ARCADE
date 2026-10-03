/**
 * One Aviator bet panel. The page shows two (as in Spribe's Aviator), each an independent bet with
 * its own optional auto cash-out and "auto bet" that re-places the same bet every round.
 */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { formatX } from '@arena/games/aviator';
import { parseTokenAmount, type CrashBetDto, type CrashRoundDto } from '@arena/shared';
import { Button, Input, useToast } from '../../components/ui';
import { ApiError, newKey, post } from '../../lib/api';
import { tokens } from '../../lib/format';
import { playSound } from '../shared/sound';
import { t } from '../../lib/i18n';

export function BetPanel({ gameId, panel, round, bet, x100, onChanged }: { gameId: string; panel: 1 | 2; round: CrashRoundDto | null; bet: CrashBetDto | undefined; x100: number; onChanged: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(panel === 1 ? '10' : '20');
  const [auto, setAuto] = useState('');
  const [autoBet, setAutoBet] = useState(false);
  const [busy, setBusy] = useState(false);
  const autoPlacedFor = useRef(0);
  const units = parseTokenAmount(amount);
  const autoX = auto ? Math.round(Number(auto) * 100) : undefined;
  const betting = round?.phase === 'BETTING';

  const placeBet = async () => {
    if (!units || !round) return;
    setBusy(true);
    try {
      await post(`/api/crash/${gameId}/bets`, { panel, amountUnits: units, autoCashoutX100: autoX && autoX >= 101 ? autoX : undefined }, newKey());
      onChanged();
    } catch (e) {
      setAutoBet(false); // stop auto-betting after a refusal (balance, limits, bankroll)
      toast.error(e instanceof ApiError ? e.message : t('Bet failed.'));
    } finally {
      setBusy(false);
    }
  };

  const cashOut = async () => {
    setBusy(true);
    try {
      const r = await post<{ x100: number; payoutUnits: number }>(`/api/crash/${gameId}/cashout`, { panel });
      playSound('cashout');
      toast.success(t('Cashed out at {x} — {amount}', { x: formatX(r.x100), amount: tokens(r.payoutUnits) }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('Cash-out failed.'));
    } finally {
      onChanged();
      setBusy(false);
    }
  };

  const cancelBet = async () => {
    setBusy(true);
    try {
      await post(`/api/crash/${gameId}/cancel`, { panel });
      setAutoBet(false);
      toast.success(t('Bet cancelled — your stake is back.'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('Could not cancel.'));
    } finally {
      onChanged();
      setBusy(false);
    }
  };

  // auto bet: once per round, as soon as betting opens
  useEffect(() => {
    if (!autoBet || !round || !betting || bet || busy || autoPlacedFor.current === round.roundNumber) return;
    autoPlacedFor.current = round.roundNumber;
    void placeBet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBet, round?.roundNumber, betting, bet]);

  const active = bet?.status === 'ACTIVE';
  const potential = active ? Math.floor((bet.stakeUnits * x100) / 100) : 0;

  return (
    <div className={clsx('rounded-2xl border p-4 transition', active ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-500/5' : 'border-ink-200 dark:border-ink-700')}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold tracking-wide text-ink-500 uppercase">{t('Bet')} {panel}</span>
        <label className="flex items-center gap-1.5 text-xs font-medium">
          <input type="checkbox" checked={autoBet} onChange={(e) => setAutoBet(e.target.checked)} className="accent-brand-600" />
          {t('Auto bet')}
        </label>
      </div>
      {bet ? (
        <div className="space-y-3">
          <p className="text-sm">
            {t('Stake')} <strong>{tokens(bet.stakeUnits)}</strong>
            {bet.autoCashoutX100 ? ` · auto ${formatX(bet.autoCashoutX100)}` : ''}
          </p>
          {active && round?.phase === 'FLYING' && (
            <Button size="lg" variant="success" className="!h-14 w-full text-lg" loading={busy} onClick={cashOut}>
              {t('Cash out')} {tokens(potential)}
            </Button>
          )}
          {active && betting && (
            <div className="space-y-2">
              <p className="rounded-xl bg-ink-100 px-3 py-2 text-sm dark:bg-ink-800">{t('Waiting for take-off…')}</p>
              <Button size="lg" variant="danger" className="w-full" loading={busy} onClick={cancelBet}>
                {t('Cancel bet')}
              </Button>
            </div>
          )}
          {bet.status === 'CASHED_OUT' && <p className="rounded-xl bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">{t('Cashed out at {x} — {amount}', { x: formatX(bet.cashoutX100!), amount: tokens(bet.payoutUnits!) })}</p>}
          {bet.status === 'LOST' && <p className="rounded-xl bg-rose-100 px-3 py-2 text-sm font-semibold text-rose-800 dark:bg-rose-500/15 dark:text-rose-200">{t('Flew away — stake lost.')}</p>}
          {bet.status === 'REFUNDED' && <p className="rounded-xl bg-ink-100 px-3 py-2 text-sm dark:bg-ink-800">{t('Bet cancelled — stake returned.')}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input label={t('Amount')} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" suffix="PMT" />
            <Input label={t('Auto cash-out')} value={auto} onChange={(e) => setAuto(e.target.value)} inputMode="decimal" placeholder="2.00" suffix="×" />
          </div>
          <div className="flex gap-1.5">
            {[10, 50, 100, 500].map((n) => (
              <Button key={n} size="sm" variant="secondary" className="flex-1" onClick={() => setAmount(String(n))}>
                {n}
              </Button>
            ))}
          </div>
          <Button size="lg" className="w-full" loading={busy} disabled={!betting || !units} onClick={placeBet}>
            {betting ? `${t('Bet')} ${units ? tokens(units) : ''}` : t('Wait for the next round')}
          </Button>
        </div>
      )}
    </div>
  );
}
