import { useState } from 'react';
import { CheckCircle2, Droplets, ExternalLink, Lock, Plus, Trash2, XCircle } from 'lucide-react';
import { hasPermission, type PublicWalletDto, type ReserveDto, type TransparencyDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { CopyText } from '../../components/Common';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Input, KeyValue, Notice, PageHeader, PageLoader, StatCard, useToast } from '../../components/ui';
import { ApiError, del, post } from '../../lib/api';
import { bdt, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

const PANCAKE_FEE = 0.0025; // PancakeSwap v2 swap fee
const num = (v: string) => {
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const fmt = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });

/** What happens to a PMT/BNB pool (constant product) when `sold` PMT is sold into it. */
function sellInto(poolPmt: number, poolTaka: number, sold: number) {
  const k = poolPmt * poolTaka;
  const x = poolPmt + sold * (1 - PANCAKE_FEE);
  const y = k / x;
  return { takaOut: poolTaka - y, pmtPerTaka: (poolPmt + sold) / y };
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />}
      <span>{children}</span>
    </li>
  );
}

/**
 * Plan a future PancakeSwap listing: how much money the pool needs, what happens if holders sell,
 * and the public wallets that make the allocation checkable on BscScan.
 */
export default function LiquidityPage() {
  useDocumentTitle('Liquidity plan');
  const me = useMe();
  const toast = useToast();
  const reserve = useApi<ReserveDto>('/api/admin/reserve');
  const feed = useApi<TransparencyDto>('/api/transparency');
  const wallets = useApi<PublicWalletDto[]>('/api/admin/public-wallets');
  const canEdit = hasPermission(me.admin?.permissions, 'finance.treasury');

  const [fromReserve, setFromReserve] = useState('');
  const [income, setIncome] = useState('');
  const [bnbTaka, setBnbTaka] = useState('');
  const [rate, setRate] = useState('');
  const [form, setForm] = useState({ label: '', address: '', purpose: '', plannedTokens: '' });
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<PublicWalletDto | null>(null);

  if ((reserve.loading && !reserve.data) || (feed.loading && !feed.data)) return <PageLoader />;
  if (reserve.error || !reserve.data) return <ErrorState error={reserve.error} onRetry={reserve.reload} />;
  if (feed.error || !feed.data) return <ErrorState error={feed.error} onRetry={feed.reload} />;
  const r = reserve.data;
  const t = feed.data;

  const safeTaka = r.safeToWithdrawPoisha / 100;
  const reserveTaka = Math.min(num(fromReserve), safeTaka);
  const poolTaka = reserveTaka + num(income);
  const startRate = num(rate) || r.rates.buy; // PMT per ৳1 when the pool opens
  const poolPmt = poolTaka * startRate;
  const bnb = num(bnbTaka) ? poolTaka / num(bnbTaka) : null;
  // PMT players could move on-chain and sell: everything they hold (bonus too, once withdrawals open)
  const playerPmt = (t.inApp.playersSellableUnits + t.inApp.playersBonusUnits) / 100;
  const scenarios = [0.1, 0.25, 0.5, 1].map((f) => {
    const sold = playerPmt * f;
    const res = poolTaka > 0 ? sellInto(poolPmt, poolTaka, sold) : null;
    return { f, sold, ...res, drop: res ? 1 - startRate / res.pmtPerTaka : null };
  });
  const quarter = scenarios[1]!;
  const playerValueTaka = playerPmt / startRate;
  const covered = r.coverageBps === null || r.coverageBps >= 10_000;

  const add = async () => {
    setBusy(true);
    try {
      await post('/api/admin/public-wallets', {
        label: form.label,
        address: form.address.trim(),
        purpose: form.purpose,
        plannedTokens: form.plannedTokens ? Math.floor(num(form.plannedTokens)) : null,
      });
      toast.success('Wallet published on the transparency page.');
      setForm({ label: '', address: '', purpose: '', plannedTokens: '' });
      wallets.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not add the wallet.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Liquidity plan"
        subtitle="Plan a PancakeSwap pool before you open one: how much money it needs, and what happens to the price if holders sell. Nothing here sends anything — it only calculates."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Safe to use from the reserve" value={bdt(r.safeToWithdrawPoisha)} hint="income above 100% of sell-backs" icon={<Droplets className="size-5" />} tone="emerald" />
        <StatCard label="PMT players hold" value={tokens(t.inApp.playersSellableUnits + t.inApp.playersBonusUnits)} hint={`worth ${bdt(Math.round(playerValueTaka * 100))} at ${fmt(startRate)} PMT = ৳1`} icon={<Droplets className="size-5" />} tone="sky" />
        <StatCard label="Pool money (planned)" value={bdt(Math.round(poolTaka * 100))} hint={bnb ? `≈ ${fmt(bnb, 4)} BNB` : 'enter the BNB price'} icon={<Droplets className="size-5" />} />
        <StatCard label="PMT to pair" value={`${fmt(poolPmt)} PMT`} hint={`start: ${fmt(startRate)} PMT = ৳1`} icon={<Droplets className="size-5" />} tone="amber" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Pool money" subtitle="Only use money that is not owed to players: reserve income above 100% coverage, plus ad and fee income." />
          <CardBody className="space-y-3">
            <Input label="From the reserve (income)" value={fromReserve} onChange={(e) => setFromReserve(e.target.value)} inputMode="decimal" suffix="৳" hint={`At most ${bdt(r.safeToWithdrawPoisha)} — the rest backs sell-backs.`} />
            <Input label="Ad and fee income you add" value={income} onChange={(e) => setIncome(e.target.value)} inputMode="decimal" suffix="৳" hint="New money is what lets holders sell without the last sellers losing." />
            <Input label="1 BNB in taka (today)" value={bnbTaka} onChange={(e) => setBnbTaka(e.target.value)} inputMode="decimal" suffix="৳" hint="Check the price on Binance or bKash-to-USDT rates on the day." />
            <Input label="Starting price (PMT per ৳1)" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder={String(r.rates.buy)} hint={`Today's in-app buy rate is ${fmt(r.rates.buy)} PMT = ৳1. Starting lower than that (more PMT per ৳1) would undercut players who bought in the app.`} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="If holders sell into the pool" subtitle="PancakeSwap pools follow x × y = k: every sale lowers the price for the next seller." />
          <CardBody>
            {poolTaka <= 0 ? (
              <Notice tone="info">Enter the pool money to see what happens.</Notice>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-ink-500 uppercase">
                    <tr>
                      <th className="py-2">Players sell</th>
                      <th className="py-2 text-right">They get</th>
                      <th className="py-2 text-right">Price after</th>
                      <th className="py-2 text-right">Drop</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    {scenarios.map((s) => (
                      <tr key={s.f}>
                        <td className="py-2">
                          {s.f * 100}% · {fmt(s.sold)} PMT
                        </td>
                        <td className="py-2 text-right">{bdt(Math.round((s.takaOut ?? 0) * 100))}</td>
                        <td className="py-2 text-right">{fmt(s.pmtPerTaka ?? 0)} PMT = ৳1</td>
                        <td className={`py-2 text-right font-semibold ${(s.drop ?? 0) > 0.5 ? 'text-rose-600' : (s.drop ?? 0) > 0.25 ? 'text-amber-600' : 'text-emerald-600'}`}>{fmt((s.drop ?? 0) * 100, 1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Ready to list?" subtitle="List only when every line is green. The manual steps protect players and make the pool checkable by anyone." icon={<Lock className="size-4" />} />
        <CardBody className="grid gap-6 md:grid-cols-2">
          <ul className="space-y-2">
            <Check ok={covered}>The taka reserve covers 100% of sell-backs ({r.coverageBps === null ? 'nothing owed' : `${(r.coverageBps / 100).toFixed(1)}%`}).</Check>
            <Check ok={poolTaka > 0 && poolTaka >= playerValueTaka * 0.5}>The pool holds at least half of what players' PMT is worth ({bdt(Math.round(playerValueTaka * 50))} needed).</Check>
            <Check ok={poolTaka > 0 && (quarter.drop ?? 1) <= 0.4}>If a quarter of players sold, the price would fall less than 40%.</Check>
            <Check ok={startRate <= r.rates.buy}>The pool does not start cheaper than the in-app price.</Check>
            <Check ok={(wallets.data?.length ?? 0) >= 4}>The allocation wallets are published below ({wallets.data?.length ?? 0} published).</Check>
          </ul>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-600 dark:text-ink-300">
            <li>A lawyer in Bangladesh has approved selling PMT for taka.</li>
            <li>Lock the pool's LP tokens for at least 12 months (for example with PinkLock) and publish the lock link.</li>
            <li>Lock the team share for 12 months too, or keep it in its published wallet untouched.</li>
            <li>Add the liquidity wallet and the lock to the published wallets.</li>
            <li>Announce the listing with the rules, never with a price target.</li>
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Published wallets"
          subtitle="Shown with live BNB Chain balances on the public transparency page. Publish each allocation share as its own wallet, so anyone can check that the plan in the whitepaper is kept."
          actions={
            <a href="/transparency/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-600">
              Public page <ExternalLink className="size-3.5" />
            </a>
          }
        />
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {wallets.data?.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <span className="min-w-0">
                <strong>{w.label}</strong> {w.purpose && <span className="text-ink-500">· {w.purpose}</span>}
                <span className="block">
                  <CopyText value={w.address} label="Address" />
                </span>
              </span>
              <span className="flex items-center gap-4">
                <KeyValue
                  items={[
                    ['On chain', w.balance === null ? 'unavailable' : `${fmt(Number(w.balance))} PMT`],
                    ['Planned', w.plannedTokens === null ? '—' : `${fmt(w.plannedTokens)} PMT`],
                  ]}
                />
                {canEdit && (
                  <Button size="sm" variant="outline" icon={<Trash2 className="size-4" />} onClick={() => setRemoving(w)}>
                    Remove
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {canEdit && (
          <CardBody className="grid gap-3 border-t border-ink-100 sm:grid-cols-2 lg:grid-cols-4 dark:border-ink-800">
            <Input label="Name" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Player sale" />
            <Input label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="0x…" />
            <Input label="Purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Sold to players in the app" />
            <Input label="Planned PMT" value={form.plannedTokens} onChange={(e) => setForm({ ...form, plannedTokens: e.target.value })} inputMode="numeric" placeholder="2000000000" />
            <div className="sm:col-span-2 lg:col-span-4">
              <Button icon={<Plus className="size-4" />} disabled={busy || form.label.trim().length < 2 || !/^0x[0-9a-fA-F]{40}$/.test(form.address.trim())} onClick={add}>
                Publish wallet
              </Button>
            </div>
          </CardBody>
        )}
      </Card>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove this wallet from the public page?"
        confirmLabel="Remove"
        tone="danger"
        message="It disappears from the transparency page. The removal is recorded in the audit log."
        onConfirm={async () => {
          await del(`/api/admin/public-wallets/${removing!.id}`);
          toast.success('Removed.');
          wallets.reload();
        }}
      />
    </div>
  );
}
