import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Landmark, Scale, ShieldCheck, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import { hasPermission, LADDER_RULES, PRICE_LADDER, type ReserveDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Input, KeyValue, Notice, PageHeader, PageLoader, StatCard, useToast } from '../../components/ui';
import { post } from '../../lib/api';
import { bdt, dateTime, tokens } from '../../lib/format';
import { useApi, useDocumentTitle, useIdempotencyKey } from '../../lib/hooks';

const pct = (bps: number | null) => (bps === null ? '—' : `${(bps / 100).toFixed(1)}%`);
const takaToPoisha = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

/** Taka reserve behind PMT sell-backs, owner income, and the PMT price ladder. */
export default function ReservePage() {
  useDocumentTitle('Reserve & price');
  const me = useMe();
  const toast = useToast();
  const idem = useIdempotencyKey();
  const r = useApi<ReserveDto>('/api/admin/reserve');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'WITHDRAW' | 'DEPOSIT' | null>(null);
  if (r.loading && !r.data) return <PageLoader />;
  if (r.error || !r.data) return <ErrorState error={r.error} onRetry={r.reload} />;
  const x = r.data;
  const canMove = hasPermission(me.admin?.permissions, 'finance.treasury');
  const poisha = takaToPoisha(amount);
  const covered = x.coverageBps === null || x.coverageBps >= 10_000;

  return (
    <div className="space-y-6">
      <PageHeader title="Reserve & price" subtitle="Taka paid in by PMT buyers backs every sell-back, so you never pay sellers from your own pocket." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Taka reserve" value={bdt(x.reservePoisha)} hint={`${bdt(x.pendingSellPoisha)} promised to pending sells`} icon={<Landmark className="size-5" />} />
        <StatCard label="Owed if everyone sold" value={bdt(x.liabilityPoisha)} hint={`${tokens(x.sellableUnits)} sellable at ${x.rates.sell} PMT = ৳1`} icon={<Scale className="size-5" />} tone="amber" />
        <StatCard label="Coverage" value={pct(x.coverageBps)} hint="free reserve ÷ owed" icon={<ShieldCheck className="size-5" />} tone={covered ? 'emerald' : 'rose'} />
        <StatCard label="Safe to take out" value={bdt(x.safeToWithdrawPoisha)} hint="your income above 100% coverage" icon={<TrendingUp className="size-5" />} tone="emerald" />
      </div>
      {!covered && <Notice tone="warning">The reserve covers less than everything players could sell back. Sell-backs are still safe — each one must fit in the reserve — but large sales may have to wait until more PMT is bought.</Notice>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="PMT price ladder" subtitle={`The price moves up one step at a time, only when the reserve can back it (at least ${LADDER_RULES.minCoverageBps / 100}% covered at the new price, more buying than selling in 30 days, and ${LADDER_RULES.minDaysBetweenSteps} days since the last step). Change the rates in Settings.`} />
          <CardBody className="space-y-4">
            <ol className="space-y-1.5">
              {PRICE_LADDER.map((st, i) => (
                <li key={st.buy} className={clsx('flex items-center justify-between rounded-xl px-3 py-2 text-sm', i === x.stage.index ? 'bg-brand-600 font-semibold text-white' : i < x.stage.index ? 'text-ink-400 line-through' : 'bg-ink-50 dark:bg-ink-850')}>
                  <span>
                    Stage {i + 1}: 1 PMT = ৳{st.priceBdt}
                  </span>
                  <span>
                    buy {st.buy.toLocaleString()} PMT = ৳1 · sell-back {st.sell.toLocaleString()} PMT = ৳1
                  </span>
                </li>
              ))}
            </ol>
            {x.stage.index < 0 && <Notice tone="info">Today&apos;s rates ({x.rates.buy} / {x.rates.sell} PMT per ৳1) are custom, not a ladder stage.</Notice>}
            {x.next ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold">
                  Next step: 1 PMT = ৳{x.next.priceBdt} {x.next.ready ? <Badge tone="success">ready</Badge> : <Badge tone="warning">not yet</Badge>}
                </p>
                <KeyValue
                  items={[
                    ['Coverage at the new price', <span className={x.next.coverageOk ? 'text-emerald-600' : 'text-rose-600'}>{pct(x.next.coverageBps)} (needs {LADDER_RULES.minCoverageBps / 100}%)</span>],
                    ['Bought − sold, last 30 days', <span className={x.next.demandOk ? 'text-emerald-600' : 'text-rose-600'}>{bdt(x.next.netBuy30dPoisha)}</span>],
                    ['Days since last price change', <span className={x.next.timeOk ? 'text-emerald-600' : 'text-rose-600'}>{x.next.daysSinceChange ?? 'never changed'}</span>],
                  ]}
                />
                <p className="text-xs text-ink-500">Never announce future prices or dates to players — show the rules, not promises.</p>
              </div>
            ) : (
              <p className="text-sm text-ink-500">This is the last configured stage.</p>
            )}
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Where the reserve comes from" />
            <CardBody>
              <KeyValue
                items={[
                  ['Taka received from buyers', bdt(x.receivedPoisha)],
                  ['Taka paid to sellers', bdt(x.paidOutPoisha)],
                  ['Owner taken out (net)', bdt(x.ownerNetWithdrawnPoisha)],
                  ['Bought, last 30 days', bdt(x.last30d.boughtPoisha)],
                  ['Sold back, last 30 days', bdt(x.last30d.soldPoisha)],
                ]}
              />
            </CardBody>
          </Card>
          {canMove && (
            <Card>
              <CardHeader title="Take income out / add money" subtitle="Taking out is limited to the safe amount. Adding money (for example ad income) makes sell-backs safer and lets the price rise sooner." />
              <CardBody className="flex flex-wrap items-end gap-3">
                <div className="min-w-40 flex-1">
                  <Input label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" suffix="৳" />
                </div>
                <Button disabled={!poisha || poisha > x.safeToWithdrawPoisha} icon={<ArrowUpFromLine className="size-4" />} onClick={() => setDirection('WITHDRAW')}>
                  Take out
                </Button>
                <Button variant="outline" disabled={!poisha} icon={<ArrowDownToLine className="size-4" />} onClick={() => setDirection('DEPOSIT')}>
                  Add to reserve
                </Button>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader title="Owner movements" />
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {x.movements.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">Nothing taken out or added yet.</li>}
          {x.movements.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <span>
                {m.kind === 'OWNER_WITHDRAWAL' ? 'Taken out' : 'Added'} · <span className="text-ink-500">{m.reason}</span>
              </span>
              <span className="flex items-center gap-4">
                <span className={m.kind === 'OWNER_WITHDRAWAL' ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-600'}>
                  {m.kind === 'OWNER_WITHDRAWAL' ? '−' : '+'}
                  {bdt(m.amountPoisha)}
                </span>
                <span className="text-ink-500">{dateTime(m.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog
        open={!!direction}
        onClose={() => setDirection(null)}
        title={direction === 'WITHDRAW' ? 'Take income out of the reserve' : 'Add money to the reserve'}
        confirmLabel={direction === 'WITHDRAW' ? `Take out ${bdt(poisha ?? 0)}` : `Add ${bdt(poisha ?? 0)}`}
        reasonLabel="Note (audit log)"
        message={direction === 'WITHDRAW' ? 'Record that you took this much taka out of the reserve as income.' : 'Record that you added this much taka to the reserve.'}
        onConfirm={async (reason) => {
          await post('/api/admin/reserve/move', { direction, amountPoisha: poisha, reason }, idem.key());
          idem.rotate();
          setAmount('');
          toast.success('Recorded.');
          r.reload();
        }}
      />
    </div>
  );
}
