import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, Wallet as WalletIcon } from 'lucide-react';
import { parseTokenAmount, type CryptoStatusDto } from '@arena/shared';
import { BackLink, CopyText } from '../../components/Common';
import { useWallet } from '../../components/Wallet';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Input, KeyValue, Notice, PageHeader, PageLoader, useToast } from '../../components/ui';
import { ApiError, post } from '../../lib/api';
import { dateTime, tokens } from '../../lib/format';
import { useApi, useDocumentTitle, useIdempotencyKey } from '../../lib/hooks';

const tone = (s: string) => (s === 'PAID' ? 'success' : s === 'REJECTED' ? 'danger' : s === 'FAILED' ? 'warning' : 'info') as 'success' | 'danger' | 'warning' | 'info';

/** PMT on BNB Chain: link a wallet, withdraw PMT to it, deposit PMT from it. */
export default function CryptoWalletPage() {
  useDocumentTitle('Crypto wallet');
  const toast = useToast();
  const wallet = useWallet();
  const idem = useIdempotencyKey();
  const d = useApi<CryptoStatusDto>('/api/wallet/crypto');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (d.loading && !d.data) return <PageLoader />;
  if (d.error || !d.data) return <ErrorState error={d.error} onRetry={d.reload} />;
  const x = d.data;
  const units = parseTokenAmount(amount);
  const fee = x.withdrawFeeTokens * 100;
  const total = (wallet.data?.availableUnits ?? 0) + (wallet.data?.bonusUnits ?? 0);
  const amountError = amount && (units === null || units < x.minWithdrawTokens * 100) ? `Withdraw at least ${tokens(x.minWithdrawTokens * 100)}.` : units && units > total ? 'More than your balance.' : null;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      d.reload();
      wallet.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <BackLink to="/wallet">Wallet</BackLink>
      <PageHeader title="Crypto wallet" subtitle={`Move PMT between your balance here and your own wallet on ${x.chainName}.`} />
      {!x.configured && <Notice tone="info">Crypto withdrawals and deposits open when PMT launches on the blockchain. Keep playing!</Notice>}
      <p className="text-sm text-ink-500">
        PMT contract on {x.chainName}: see the <a href="/token/" className="text-brand-600 underline">PMT token page</a> to check the address and add PMT to MetaMask in one tap. Only trust that address.
      </p>

      <Card>
        <CardHeader title="Your wallet address" subtitle="A BNB Chain (BEP-20) address you control, for example from Trust Wallet or MetaMask." icon={<WalletIcon className="size-4" />} />
        <CardBody className="space-y-3">
          {x.myAddress && (
            <p className="text-sm">
              Linked: <CopyText value={x.myAddress} label="Address" />
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1">
              <Input label={x.myAddress ? 'Change address' : 'Address'} value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="0x…" />
            </div>
            <Button variant="outline" disabled={!/^0x[0-9a-fA-F]{40}$/.test(address) || busy} onClick={() => run(() => post('/api/wallet/crypto/address', { address }), 'Wallet address saved.')}>
              Save
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Withdraw PMT" subtitle={`Network fee: ${tokens(fee)} per withdrawal. Bonus PMT is sent first.`} icon={<ArrowUpFromLine className="size-4" />} />
          <CardBody className="space-y-3">
            {!x.withdrawalsEnabled && <Notice tone="warning">Withdrawals are not open yet.</Notice>}
            <Input label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" suffix="PMT" error={amountError ?? undefined} hint={`Minimum ${tokens(x.minWithdrawTokens * 100)} · you can withdraw ${tokens(total)}`} />
            <Button className="w-full" disabled={!x.withdrawalsEnabled || !x.myAddress || !units || !!amountError} onClick={() => setConfirming(true)}>
              Withdraw {units ? tokens(units) : ''}
            </Button>
            <p className="text-xs text-ink-500">Withdrawals are checked and sent within 48 hours. PMT you bring back later counts as bonus PMT.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Deposit PMT" subtitle="Send PMT from your linked wallet, then paste the transaction ID." icon={<ArrowDownToLine className="size-4" />} />
          <CardBody className="space-y-3">
            {!x.depositsEnabled ? (
              <Notice tone="warning">Deposits are not open yet.</Notice>
            ) : (
              <KeyValue
                items={[
                  ['Send PMT to', x.depositAddress ? <CopyText value={x.depositAddress} label="Deposit address" /> : '—'],
                  ['Network', `${x.chainName} (BEP-20)`],
                  ['Minimum', tokens(x.minDepositTokens * 100)],
                  ['Credited after', `${x.confirmations} block confirmations, as bonus PMT`],
                ]}
              />
            )}
            <Input label="Transaction ID" value={txHash} onChange={(e) => setTxHash(e.target.value.trim())} placeholder="0x… (66 characters)" />
            <Button variant="outline" className="w-full" disabled={!x.depositsEnabled || !x.myAddress || !/^0x[0-9a-fA-F]{64}$/.test(txHash) || busy} onClick={() => run(() => post('/api/wallet/crypto/deposits', { txHash }), 'Deposit credited.').then(() => setTxHash(''))}>
              Check and credit
            </Button>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="History" />
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {x.withdrawals.length + x.deposits.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No withdrawals or deposits yet.</li>}
          {x.withdrawals.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <span>
                Withdrawal of <strong>{tokens(w.sentUnits)}</strong> to {w.address.slice(0, 8)}…{w.address.slice(-4)} <span className="text-ink-500">· {dateTime(w.createdAt)}</span>
                {w.note && <span className="block text-xs text-ink-500">{w.note}</span>}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={tone(w.status)}>{w.status.toLowerCase()}</Badge>
                {w.txHash && (
                  <a href={`${x.explorerTx}${w.txHash}`} target="_blank" rel="noreferrer" className="text-brand-600" aria-label="View on the block explorer">
                    <ExternalLink className="size-4" />
                  </a>
                )}
              </span>
            </li>
          ))}
          {x.deposits.map((dp) => (
            <li key={dp.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <span>
                Deposit of <strong>{tokens(dp.amountUnits)}</strong> <span className="text-ink-500">· {dateTime(dp.createdAt)}</span>
              </span>
              <a href={`${x.explorerTx}${dp.txHash}`} target="_blank" rel="noreferrer" className="text-brand-600" aria-label="View on the block explorer">
                <ExternalLink className="size-4" />
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Withdraw PMT?"
        confirmLabel={`Withdraw ${tokens(units ?? 0)}`}
        message={
          <KeyValue
            items={[
              ['To', x.myAddress ?? '—'],
              ['From your balance', tokens(units ?? 0)],
              ['Network fee', tokens(fee)],
              ['Arrives in your wallet', tokens(Math.max(0, (units ?? 0) - fee))],
            ]}
          />
        }
        onConfirm={async () => {
          await post('/api/wallet/crypto/withdrawals', { amountUnits: units }, idem.key());
          idem.rotate();
          setAmount('');
          toast.success('Withdrawal requested.');
          d.reload();
          wallet.reload();
        }}
      />
    </div>
  );
}
