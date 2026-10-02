import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Send, UserRound } from 'lucide-react';
import { parseTokenAmount, type TransferDto, type TransferRecipientDto } from '@arena/shared';
import { useConfig, useMe } from '../../auth/AuthProvider';
import { BackLink } from '../../components/Common';
import { useWallet } from '../../components/Wallet';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, Input, KeyValue, Notice, PageHeader, PageLoader, useToast } from '../../components/ui';
import { ApiError, get, post } from '../../lib/api';
import { tokens } from '../../lib/format';
import { useDocumentTitle, useIdempotencyKey } from '../../lib/hooks';

/** Send PMT to another player by player number (bought or won PMT only; bonus cannot be sent). */
export default function SendTokensPage() {
  useDocumentTitle('Send PMT');
  const config = useConfig();
  const me = useMe();
  const wallet = useWallet();
  const toast = useToast();
  const navigate = useNavigate();
  const idem = useIdempotencyKey();
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [recipient, setRecipient] = useState<TransferRecipientDto | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // look the player number up as it is typed, so the sender sees who will receive it
  const n = Number(number);
  useEffect(() => {
    setRecipient(null);
    setLookupError(null);
    if (!Number.isInteger(n) || n < 100_000) return;
    const t = setTimeout(() => {
      get<TransferRecipientDto>(`/api/wallet/transfers/recipient/${n}`)
        .then(setRecipient)
        .catch((e: unknown) => setLookupError(e instanceof ApiError && e.code === 'NOT_FOUND' ? 'No player has that number.' : 'Could not look that player up.'));
    }, 350);
    return () => clearTimeout(t);
  }, [n]);

  if (!config) return <PageLoader />;
  const units = parseTokenAmount(amount);
  const available = wallet.data?.availableUnits ?? 0;
  const min = config.minimumTransferTokens * 100;
  const fee = units ? Math.floor((units * config.transferFeeBps) / 10_000) : 0;
  const amountError = amount && (units === null || units < min) ? `Send at least ${tokens(min)}.` : units && units > available ? 'More than your available PMT (bonus PMT cannot be sent).' : null;
  const self = recipient?.playerNumber === me.playerNumber;
  const ready = !!recipient && !self && !!units && !amountError && config.transfersEnabled && me.accountStatus === 'ACTIVE';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) setConfirming(true);
  };

  return (
    <div className="space-y-6">
      <BackLink to="/wallet">Wallet</BackLink>
      <PageHeader title="Send PMT" subtitle="Send PMT to another player using their player number." />
      {!config.transfersEnabled && <Notice tone="warning">Sending PMT is switched off right now.</Notice>}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="Transfer" subtitle={`Available to send: ${tokens(available)}`} />
          <CardBody>
            <form onSubmit={submit} className="space-y-4">
              <Input label="Player number" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="100002" error={lookupError ?? (self ? 'That is you.' : undefined)} required />
              {recipient && !self && (
                <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-500/10">
                  <UserRound className="size-4 text-emerald-600" />
                  <span>
                    <strong>{recipient.displayName}</strong> <span className="text-ink-500">@{recipient.username} · #{recipient.playerNumber}</span>
                  </span>
                </div>
              )}
              <Input label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" suffix="PMT" error={amountError ?? undefined} required />
              <Input label="Message (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="For the match" />
              <Button type="submit" size="lg" className="w-full" disabled={!ready} icon={<Send className="size-4" />}>
                Send {units ? tokens(units) : ''}
              </Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Good to know" />
          <CardBody className="space-y-2 text-sm text-ink-600 dark:text-ink-300">
            <p>• Fee: {config.transferFeeBps / 100}% — the player receives the amount minus the fee.</p>
            <p>• Minimum {tokens(min)}; up to {tokens(config.dailyTransferLimitTokens * 100)} per 24 hours.</p>
            <p>• Only PMT you bought or won can be sent. Bonus PMT from free games stays with you.</p>
            <p>• Transfers cannot be undone — check the player number and name.</p>
          </CardBody>
        </Card>
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Send PMT?"
        confirmLabel={`Send ${tokens(units ?? 0)}`}
        message={
          <KeyValue
            items={[
              ['To', recipient ? `${recipient.displayName} (@${recipient.username}, #${recipient.playerNumber})` : '—'],
              ['You send', tokens(units ?? 0)],
              ['Fee', tokens(fee)],
              ['They receive', tokens((units ?? 0) - fee)],
            ]}
          />
        }
        onConfirm={async () => {
          const res = await post<{ transfer: TransferDto }>('/api/wallet/transfers', { toPlayerNumber: n, amountUnits: units, note: note || undefined }, idem.key());
          idem.rotate();
          wallet.reload();
          toast.success(`Sent ${tokens(res.transfer.receivedUnits)} to @${res.transfer.toUsername}.`);
          navigate('/wallet/transactions');
        }}
      />
    </div>
  );
}
