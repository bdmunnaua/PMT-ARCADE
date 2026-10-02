import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ShieldCheck, Smartphone } from 'lucide-react';
import { parseBdtAmount, tokenUnitsForBdt, type BuyRequestDto, type PaymentMethod } from '@arena/shared';
import { useConfig, useMe } from '../../auth/AuthProvider';
import { BackLink, CopyText } from '../../components/Common';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, Input, Notice, PageHeader, PageLoader, Select, Textarea } from '../../components/ui';
import { ApiError, post } from '../../lib/api';
import { bdt, tokens } from '../../lib/format';
import { useDocumentTitle, useIdempotencyKey } from '../../lib/hooks';
import { t } from '../../lib/i18n';

export default function BuyTokensPage() {
  useDocumentTitle(t("Buy tokens"));
  const config = useConfig();
  const me = useMe();
  const navigate = useNavigate();
  const idem = useIdempotencyKey();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('BKASH_MANUAL');
  const [sender, setSender] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (!config) return <PageLoader />;
  const poisha = parseBdtAmount(amount);
  const rate = config.buyTokensPerBdt;
  const tokenUnits = poisha && poisha > 0 ? tokenUnitsForBdt(poisha, rate) : 0;
  const min = config.minimumBuyBdt * 100;
  const max = config.maximumBuyBdt * 100;
  const amountError = amount && (poisha === null || poisha < min || poisha > max) ? t('Enter between {min} and {max}.', { min: bdt(min), max: bdt(max) }) : null;
  const provider = config.paymentMethods.find((p) => p.id === method) ?? config.paymentMethods[0];
  const disabled = !config.buyRequestsEnabled || config.paymentMethods.length === 0 || me.accountStatus !== 'ACTIVE';

  const validate = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!poisha || amountError) errs.amount = amountError ?? t('Enter an amount.');
    if (sender.trim().length < 4) errs.sender = `Enter your ${provider?.accountLabel ?? 'account number'}.`;
    if (reference.trim().length < 6) errs.reference = `Enter the ${provider?.referenceLabel ?? 'transaction reference'}.`;
    setFieldErrors(errs);
    if (Object.keys(errs).length === 0) setConfirming(true);
  };

  const submit = async () => {
    try {
      const res = await post<{ request: BuyRequestDto }>('/api/wallet/buy-requests', { amountPoisha: poisha, paymentMethod: method, senderNumber: sender, paymentReference: reference, note: note || undefined }, idem.key());
      idem.rotate();
      navigate(`/wallet/buy/${res.request.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        const errs: Record<string, string> = {};
        if (e.fieldError('senderNumber')) errs.sender = e.fieldError('senderNumber')!;
        if (e.fieldError('paymentReference') || e.code === 'DUPLICATE_PAYMENT_REFERENCE') errs.reference = e.fieldError('paymentReference') ?? e.message;
        setFieldErrors(errs);
      }
      throw e;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader back={<BackLink to="/wallet">{t("Wallet")}</BackLink>} title={t("Buy tokens")} subtitle={t("Pay manually, then submit your payment details for verification.")} />
      {!config.buyRequestsEnabled && <Notice tone="warning">{t("Token purchases are currently disabled.")}</Notice>}
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={t("Payment details")} subtitle={<>{t("Current rate:")} <strong>৳1 = {rate} {t("PMT")}</strong></>} />
          <CardBody>
            <form onSubmit={validate} className="space-y-4" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label={t("Amount paid (BDT)")} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} suffix="BDT" error={fieldErrors.amount ?? amountError} required />
                <div>
                  <span className="label">{t("You will receive")}</span>
                  <div className="flex h-[42px] items-center rounded-xl bg-brand-50 px-3.5 text-sm font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-200">{tokenUnits ? tokens(tokenUnits) : '—'}</div>
                </div>
              </div>
              <Select label={t("Payment method")} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {config.paymentMethods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
              <Input label={`Your ${provider?.accountLabel ?? 'number'} (sender)`} inputMode="tel" value={sender} onChange={(e) => setSender(e.target.value)} error={fieldErrors.sender} placeholder="01XXXXXXXXX" autoComplete="tel" required />
              <Input label={provider?.referenceLabel ?? 'Transaction reference'} value={reference} onChange={(e) => setReference(e.target.value)} error={fieldErrors.reference} placeholder="e.g. 9AB8CD7EF0" className="font-mono uppercase" required />
              <Textarea label={t("Note (optional)")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />
              <Button type="submit" size="lg" className="w-full" disabled={disabled}>
                {t("Submit buy request")}
              </Button>
              <p className="text-center text-xs text-ink-500">{t("Tokens are credited only after an administrator verifies your payment.")}</p>
            </form>
          </CardBody>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={t("How to pay")} icon={<Smartphone className="size-4" />} />
            <CardBody className="space-y-3 text-sm">
              {method === 'BKASH_MANUAL' && config.bkashReceivingNumber ? (
                <p>
                  {t("Send money to bKash:")} <CopyText value={config.bkashReceivingNumber} label={t("bKash number")} />
                </p>
              ) : method === 'BKASH_MANUAL' ? (
                <Notice tone="warning">{t("The receiving bKash number has not been published yet. Contact support before paying.")}</Notice>
              ) : null}
              <ol className="list-decimal space-y-1.5 pl-5 text-ink-600 dark:text-ink-300">
                <li>{t("Send the exact amount from your own account.")}</li>
                <li>{t("Copy the transaction ID from the confirmation.")}</li>
                <li>{t("Submit this form. We verify and credit your tokens.")}</li>
              </ol>
              {config.paymentNotice && <p className="text-ink-500">{config.paymentNotice}</p>}
            </CardBody>
          </Card>
          <Notice tone="danger" title={t("Never share your PIN or OTP")}>
            {t("We will never ask for your bKash PIN, OTP or password — not here, not in chat, not by phone.")}
          </Notice>
          <div className="flex items-start gap-2 text-xs text-ink-500">
            <ShieldCheck className="size-4 shrink-0" /> {t("A transaction ID can only be used once. Reused IDs are rejected and reviewed.")}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("Submit buy request?")}
        confirmLabel={t("Submit request")}
        onConfirm={submit}
        message={
          <>
            {t('You paid {paid} via {method} from {sender} (ref {ref}). After verification you will receive {amount} at ৳1 = {rate} PMT.', { paid: bdt(poisha ?? 0), method: provider?.label ?? '', sender, ref: reference.toUpperCase(), amount: tokens(tokenUnits), rate })}
          </>
        }
      />
    </div>
  );
}
