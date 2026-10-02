import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { bdtPoishaForTokenUnits, formatMinor, parseTokenAmount, type PaymentMethod, type SellRequestDto } from '@arena/shared';
import { useConfig, useMe } from '../../auth/AuthProvider';
import { BackLink } from '../../components/Common';
import { useWallet } from '../../components/Wallet';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, Input, KeyValue, Notice, PageHeader, PageLoader, Select, Textarea } from '../../components/ui';
import { ApiError, post } from '../../lib/api';
import { bdt, tokens } from '../../lib/format';
import { useDocumentTitle, useIdempotencyKey } from '../../lib/hooks';

export default function SellTokensPage() {
  useDocumentTitle('Sell tokens');
  const config = useConfig();
  const me = useMe();
  const wallet = useWallet();
  const navigate = useNavigate();
  const idem = useIdempotencyKey();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('BKASH_MANUAL');
  const [receiving, setReceiving] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!config) return <PageLoader />;
  const units = parseTokenAmount(amount);
  const rate = config.sellTokensPerBdt;
  const poisha = units && units > 0 ? bdtPoishaForTokenUnits(units, rate) : 0;
  const available = wallet.data?.availableUnits ?? 0;
  const min = config.minimumSellTokens * 100;
  const max = config.maximumSellTokens * 100;
  const amountError =
    amount && (units === null || units < min || units > max) ? `Sell between ${tokens(min)} and ${tokens(max)}.` : units && units > available ? 'More than your available balance.' : null;
  const provider = config.paymentMethods.find((p) => p.id === method) ?? config.paymentMethods[0];
  const disabled = !config.sellRequestsEnabled || config.paymentMethods.length === 0 || me.accountStatus !== 'ACTIVE';

  const validate = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!units || amountError) errs.amount = amountError ?? 'Enter an amount.';
    if (receiving.trim().length < 4) errs.receiving = `Enter your ${provider?.accountLabel ?? 'account number'}.`;
    setErrors(errs);
    if (Object.keys(errs).length === 0) setConfirming(true);
  };

  const submit = async () => {
    try {
      const res = await post<{ request: SellRequestDto }>('/api/wallet/sell-requests', { amountUnits: units, paymentMethod: method, receivingNumber: receiving, note: note || undefined }, idem.key());
      idem.rotate();
      navigate(`/wallet/sell/${res.request.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.fieldError('receivingNumber')) setErrors({ receiving: e.fieldError('receivingNumber')! });
      throw e;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader back={<BackLink to="/wallet">Wallet</BackLink>} title="Sell tokens" subtitle="Redeem tokens for a manual BDT payout to your own account." />
      {!config.sellRequestsEnabled && <Notice tone="warning">Token sales are currently disabled.</Notice>}
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Redemption" subtitle={<>Current rate: <strong>{rate} PMT = ৳1</strong></>} />
          <CardBody>
            <form onSubmit={validate} className="space-y-4" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Tokens to sell"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  suffix="PMT"
                  error={errors.amount ?? amountError}
                  hint={
                    <button type="button" className="font-semibold text-brand-600" onClick={() => setAmount(formatMinor(Math.min(available, max)).replace(/,/g, ''))}>
                      Available: {tokens(available)} — use max
                    </button>
                  }
                  required
                />
                <div>
                  <span className="label">You will receive</span>
                  <div className="flex h-[42px] items-center rounded-xl bg-emerald-50 px-3.5 text-sm font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">{poisha ? bdt(poisha) : '—'}</div>
                </div>
              </div>
              <Select label="Payout method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {config.paymentMethods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
              <Input label={`Your receiving ${provider?.accountLabel ?? 'number'}`} inputMode="tel" value={receiving} onChange={(e) => setReceiving(e.target.value)} error={errors.receiving} placeholder="01XXXXXXXXX" required />
              <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />
              <Button type="submit" size="lg" className="w-full" disabled={disabled}>
                Submit sell request
              </Button>
            </form>
          </CardBody>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="What happens next" />
            <CardBody className="text-sm">
              <ol className="list-decimal space-y-2 pl-5 text-ink-600 dark:text-ink-300">
                <li>The tokens move from Available to Pending sell immediately — they can’t be played or sold again.</li>
                <li>An administrator reviews and approves the request.</li>
                <li>We send the BDT to your number and record the payment reference.</li>
                <li>If rejected, every locked token returns to your available balance.</li>
              </ol>
            </CardBody>
          </Card>
          <Notice tone="danger" title="Never share your PIN or OTP">
            We only need your receiving number. We will never ask for a PIN, OTP or password.
          </Notice>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Lock tokens for sale?"
        confirmLabel={`Lock ${tokens(units ?? 0)}`}
        onConfirm={submit}
        message={
          <KeyValue
            columns={1}
            items={[
              ['Tokens locked now', tokens(units ?? 0)],
              ['Payout', `${bdt(poisha)} at ${rate} PMT = ৳1`],
              ['Paid to', `${provider?.label ?? ''} ${receiving}`],
            ]}
          />
        }
      />
    </div>
  );
}
