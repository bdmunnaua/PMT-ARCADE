import { Gift, Lock, Timer, Wallet as WalletIcon } from 'lucide-react';
import type { WalletDto } from '@arena/shared';
import { useMe } from '../auth/AuthProvider';
import { useApi } from '../lib/hooks';
import { tokens } from '../lib/format';
import { useRealtime } from '../lib/realtime';
import { StatCard } from './ui';
import { t } from '../lib/i18n';

/** Live wallet: re-fetches when the server announces a wallet change. */
export function useWallet() {
  const me = useMe();
  const w = useApi<WalletDto>('/api/me/wallet');
  useRealtime(`user:${me.id}`, (m) => {
    if (m.type === 'wallet.updated') w.reload();
  });
  return w;
}

export function WalletCards({ wallet }: { wallet: WalletDto | null }) {
  const v = (n: number | undefined) => (wallet ? tokens(n ?? 0) : '…');
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label={t("Available")} value={v(wallet?.availableUnits)} hint={t("Ready to play or sell")} icon={<WalletIcon className="size-5" />} tone="emerald" />
      <StatCard label={t("Locked in games")} value={v(wallet?.lockedGameUnits)} hint={t("Held in match escrow")} icon={<Lock className="size-5" />} tone="sky" />
      <StatCard label={t("Pending sell")} value={v(wallet?.lockedSellUnits)} hint={t("Locked for redemption")} icon={<Timer className="size-5" />} tone="amber" />
      <StatCard label={t("Bonus")} value={v(wallet?.bonusUnits)} hint={t("Usable for stakes, not sellable")} icon={<Gift className="size-5" />} tone="brand" />
    </div>
  );
}
