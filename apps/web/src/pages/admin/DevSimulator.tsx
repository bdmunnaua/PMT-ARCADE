import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { parseTokenAmount, type GameDto, type MatchDto } from '@arena/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Card, CardBody, CardHeader, ErrorState, Input, KeyValue, Notice, PageHeader, Select, StatusBadge, useToast } from '../../components/ui';
import { ApiError, post } from '../../lib/api';
import { tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

type Outcome = 'WIN' | 'DRAW' | 'CANCEL' | 'VOID' | 'FORFEIT';

/**
 * DEVELOPMENT ONLY. The API returns 404 for /api/dev/* when ENVIRONMENT=production; this page
 * is also hidden from the menu there. Money still moves only through the settlement service.
 */
export default function DevSimulator() {
  useDocumentTitle('Dev simulator');
  const { config } = useAuth();
  const toast = useToast();
  const games = useApi<GameDto[]>('/api/games');
  const [gameId, setGameId] = useState('game-01');
  const [stake, setStake] = useState('100');
  const [players, setPlayers] = useState('100002, 100003');
  const [match, setMatch] = useState<MatchDto | null>(null);
  const [outcome, setOutcome] = useState<Outcome>('WIN');
  const [winner, setWinner] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (config && !config.devToolsEnabled) return <ErrorState error="The development simulator is not available in production." />;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    act(async () => {
      const playerNumbers = players.split(/[,\s]+/).filter(Boolean).map(Number);
      const m = await post<MatchDto>('/api/dev/matches', { gameId, stakeUnits: parseTokenAmount(stake), playerNumbers });
      setMatch(m);
      setWinner(String(m.players[0]?.playerNumber ?? ''));
      toast.success(`Match #${m.matchNumber} is READY; stakes locked.`);
    });

  const simulate = () =>
    act(async () => {
      if (!match) return;
      const body =
        outcome === 'WIN' ? { outcome, winnerPlayerNumber: Number(winner) } : outcome === 'FORFEIT' ? { outcome, forfeitPlayerNumber: Number(winner) } : { outcome };
      const res = await post<{ match: MatchDto }>(`/api/dev/matches/${match.id}/simulate`, body);
      setMatch(res.match);
      toast.success(`Match resolved: ${res.match.status}`);
    });

  return (
    <div className="space-y-6">
      <PageHeader title="Development settlement simulator" subtitle="Test win / loss / draw / refund flows before any game exists." />
      <Notice tone="warning" title="Development only">This tool is disabled in production. It uses the real match, escrow and settlement services, so balances, fees, ledger entries and notifications behave exactly as they will with real games.</Notice>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="1. Create a READY match" icon={<FlaskConical className="size-4" />} />
          <CardBody className="space-y-4">
            <Select label="Game" value={gameId} onChange={(e) => setGameId(e.target.value)}>
              {games.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.id})
                </option>
              ))}
            </Select>
            <Input label="Stake per player" value={stake} onChange={(e) => setStake(e.target.value)} suffix="PMT" inputMode="decimal" />
            <Input label="Player numbers" value={players} onChange={(e) => setPlayers(e.target.value)} hint="Comma-separated. Players need enough available/bonus balance." />
            <Button onClick={create} loading={busy}>
              Create match & lock stakes
            </Button>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="2. Simulate a result" />
          <CardBody className="space-y-4">
            {!match ? (
              <p className="text-sm text-ink-500">Create a match first.</p>
            ) : (
              <>
                <KeyValue items={[['Match', `#${match.matchNumber}`], ['Status', <StatusBadge status={match.status} />], ['Pot', tokens(match.potUnits)], ['Payout', tokens(match.payoutUnits)]]} />
                <Select label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
                  <option value="WIN">Win (1% fee)</option>
                  <option value="FORFEIT">Forfeit (opponent wins, 1% fee)</option>
                  <option value="DRAW">Draw (refund, no fee)</option>
                  <option value="VOID">Server failure / void (refund)</option>
                  <option value="CANCEL">Cancel before start (refund)</option>
                </Select>
                {(outcome === 'WIN' || outcome === 'FORFEIT') && (
                  <Select label={outcome === 'WIN' ? 'Winner' : 'Player who forfeits'} value={winner} onChange={(e) => setWinner(e.target.value)}>
                    {match.players.map((p) => (
                      <option key={p.playerNumber} value={p.playerNumber}>
                        #{p.playerNumber} @{p.username}
                      </option>
                    ))}
                  </Select>
                )}
                <Button onClick={simulate} loading={busy}>
                  Settle via settlement service
                </Button>
              </>
            )}
          </CardBody>
        </Card>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}
