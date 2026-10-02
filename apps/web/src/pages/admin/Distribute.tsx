import { useState, type FormEvent } from 'react';
import { Send } from 'lucide-react';
import { GRANT_TYPES, parseTokenAmount, type AdminPlayerDetailDto, type GrantResultDto, type GrantType } from '@arena/shared';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, Input, Notice, PageHeader, Select, Textarea, useToast } from '../../components/ui';
import { ApiError, get, post } from '../../lib/api';
import { human, tokens } from '../../lib/format';
import { useApi, useDocumentTitle, useIdempotencyKey } from '../../lib/hooks';

export default function Distribute() {
  useDocumentTitle('Token distribution');
  const toast = useToast();
  const idem = useIdempotencyKey();
  const treasury = useApi<{ balanceUnits: number }>('/api/admin/treasury?pageSize=1');
  const [playerNumber, setPlayerNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<GrantType>('PROMOTION');
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState<AdminPlayerDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<GrantResultDto | null>(null);
  const units = parseTokenAmount(amount);

  const review = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const p = await get<AdminPlayerDetailDto>(`/api/admin/players/${Number(playerNumber)}`);
      setTarget(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Player not found.');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Token distribution" subtitle="Grants always come from ADMIN_TREASURY and create a ledger transaction plus an audit record." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="New distribution" icon={<Send className="size-4" />} subtitle={`Treasury balance: ${treasury.data ? tokens(treasury.data.balanceUnits) : '…'}`} />
          <CardBody>
            <form onSubmit={review} className="grid gap-4 sm:grid-cols-2">
              <Input label="Player #" value={playerNumber} onChange={(e) => setPlayerNumber(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="100001" required />
              <Input label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" suffix="PMT" required error={amount && !units ? 'Enter a valid amount.' : null} />
              <Select label="Type" value={type} onChange={(e) => setType(e.target.value as GrantType)} hint={type === 'BONUS' ? 'Goes to the BONUS balance (stakeable, not sellable).' : 'Goes to the AVAILABLE balance.'}>
                {GRANT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {human(t)}
                  </option>
                ))}
              </Select>
              <div className="sm:col-span-2">
                <Textarea label="Reason (audit log, visible to the player)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required minLength={3} />
              </div>
              {error && (
                <div className="sm:col-span-2">
                  <Notice tone="danger">{error}</Notice>
                </div>
              )}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={!playerNumber || !units || reason.trim().length < 3}>
                  Review distribution…
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
        {last && (
          <Notice tone="success" title={last.replayed ? 'Already processed' : 'Distributed'}>
            {tokens(last.amountUnits)} to Player #{last.playerNumber}. Transaction <span className="font-mono">{last.transactionId}</span>
          </Notice>
        )}
      </div>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title="Confirm distribution"
        confirmLabel={`Send ${tokens(units ?? 0)}`}
        message={
          <>
            Send <strong>{tokens(units ?? 0)}</strong> ({human(type)}) from the admin treasury to <strong>Player #{target?.playerNumber}</strong> (@{target?.username}, {target?.accountStatus.toLowerCase()})?
          </>
        }
        onConfirm={async () => {
          const res = await post<GrantResultDto>('/api/admin/tokens/distribute', { playerNumber: Number(playerNumber), amountUnits: units, type, reason }, idem.key());
          idem.rotate();
          setLast(res);
          setAmount('');
          setReason('');
          treasury.reload();
          toast.success(`Sent ${tokens(res.amountUnits)} to Player #${res.playerNumber}.`);
        }}
      />
    </div>
  );
}
