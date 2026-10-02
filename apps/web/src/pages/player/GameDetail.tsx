import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { DoorOpen, KeyRound, Lock, Users, Zap } from 'lucide-react';
import { computeMatchFee, formatMinor, parseTokenAmount, type GameDto, type MatchDto } from '@arena/shared';
import { useConfig } from '../../auth/AuthProvider';
import { BackLink, GameArt } from '../../components/Common';
import { AviatorGame } from '../../games/aviator/AviatorGame';
import { useWallet } from '../../components/Wallet';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, ErrorState, Input, PageLoader, Tabs, useToast } from '../../components/ui';
import { ApiError, post } from '../../lib/api';
import { tokens } from '../../lib/format';
import { useApi, useDocumentTitle, useIdempotencyKey } from '../../lib/hooks';

type Mode = 'quick' | 'room' | 'code';

export default function GameDetailPage() {
  const { slug = '' } = useParams();
  const game = useApi<GameDto>(`/api/games/${slug}`);
  useDocumentTitle(game.data?.name ?? 'Game');
  if (game.loading && !game.data) return <PageLoader />;
  if (game.error || !game.data) return <ErrorState error={game.error} onRetry={game.reload} />;
  if (game.data.kind === 'CRASH')
    return (
      <div className="space-y-4">
        <BackLink to="/play">All games</BackLink>
        <h1 className="text-2xl font-bold">{game.data.name}</h1>
        <AviatorGame game={game.data} />
      </div>
    );
  return <GameLobby game={game.data} />;
}

function GameLobby({ game }: { game: GameDto }) {
  const navigate = useNavigate();
  const toast = useToast();
  const config = useConfig();
  const wallet = useWallet();
  const idem = useIdempotencyKey();
  const [mode, setMode] = useState<Mode>('quick');
  const [stake, setStake] = useState(formatMinor(Math.max(game.minimumStakeUnits, (config?.minimumMatchStake ?? 10) * 100)).replace(/,/g, ''));
  const [isPrivate, setPrivate] = useState(false);
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState<null | { kind: 'quick' } | { kind: 'room' } | { kind: 'join'; match: MatchDto }>(null);
  const open = useApi<MatchDto[]>(`/api/matches/open?gameId=${game.id}`);

  const stakeUnits = parseTokenAmount(stake);
  const min = Math.max(game.minimumStakeUnits, (config?.minimumMatchStake ?? 0) * 100);
  const max = Math.min(game.maximumStakeUnits, (config?.maximumMatchStake ?? Infinity) * 100);
  const stakeError = stakeUnits === null ? 'Enter a token amount (up to 2 decimals).' : stakeUnits < min || stakeUnits > max ? `Stake between ${tokens(min)} and ${tokens(max)}.` : null;
  const spendable = (wallet.data?.availableUnits ?? 0) + (wallet.data?.bonusUnits ?? 0);

  const feeLine = (s: number) => {
    const pot = s * game.minimumPlayers;
    const fee = computeMatchFee(pot, config?.matchFeeBps ?? 100);
    return `Pot ${tokens(pot)} · fee ${tokens(fee)} · winner receives ${tokens(pot - fee)}`;
  };

  const go = (m: MatchDto) => navigate(`/matches/${m.id}`);

  const run = async () => {
    if (!confirm) return;
    try {
      if (confirm.kind === 'quick') {
        const r = await post<{ match: MatchDto; joined: boolean }>('/api/matches/quick', { gameId: game.id, stakeUnits }, idem.key());
        idem.rotate();
        toast.success(r.joined ? 'Opponent found — your match is ready!' : 'Waiting for an opponent. Your stake is locked.');
        go(r.match);
      } else if (confirm.kind === 'room') {
        const r = await post<{ match: MatchDto }>('/api/matches', { gameId: game.id, stakeUnits, visibility: isPrivate ? 'PRIVATE' : 'PUBLIC' }, idem.key());
        idem.rotate();
        toast.success('Room created. Your stake is locked until the match ends or you leave.');
        go(r.match);
      } else {
        const m = await post<MatchDto>(`/api/matches/${confirm.match.id}/join`);
        toast.success('Joined! Stake locked.');
        go(m);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MATCH_FULL') open.reload();
      throw e;
    }
  };

  const joinByCode = async () => {
    try {
      const m = await post<MatchDto>('/api/matches/join-by-code', { code: code.trim().toUpperCase() });
      toast.success('Joined the private room.');
      go(m);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not join.');
    }
  };

  const confirmStake = confirm?.kind === 'join' ? confirm.match.stakeUnits : (stakeUnits ?? 0);

  return (
    <div className="space-y-6">
      <BackLink to="/play">All games</BackLink>
      <div className="card overflow-hidden md:flex">
        <GameArt game={game} className="aspect-[16/9] w-full md:aspect-auto md:w-72" />
        <div className="p-6">
          <h1 className="text-2xl font-bold">{game.name}</h1>
          <p className="mt-1 text-ink-500 dark:text-ink-400">{game.description}</p>
          <div className="mt-4 flex flex-wrap gap-4 text-sm text-ink-600 dark:text-ink-300">
            <span className="flex items-center gap-1.5">
              <Users className="size-4" /> {game.minimumPlayers}–{game.maximumPlayers} players
            </span>
            <span>
              Stakes {tokens(game.minimumStakeUnits)} – {tokens(game.maximumStakeUnits)}
            </span>
            <span>Version {game.gameVersion}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Start a match" subtitle={`Spendable: ${wallet.data ? tokens(spendable) : '…'}`} />
          <CardBody className="space-y-4">
            <Tabs<Mode>
              value={mode}
              onChange={setMode}
              items={[
                { key: 'quick', label: 'Quick match' },
                { key: 'room', label: 'Create room' },
                { key: 'code', label: 'Join code' },
              ]}
            />
            {mode !== 'code' ? (
              <>
                <Input label="Stake" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} suffix="PMT" error={stake ? stakeError : null} hint={stakeUnits && !stakeError ? feeLine(stakeUnits) : undefined} />
                {mode === 'room' && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} className="size-4 accent-brand-600" />
                    <Lock className="size-4" /> Private room (share a join code)
                  </label>
                )}
                <Button className="w-full" disabled={!!stakeError || !stakeUnits} icon={mode === 'quick' ? <Zap className="size-4" /> : <DoorOpen className="size-4" />} onClick={() => setConfirm(mode === 'quick' ? { kind: 'quick' } : { kind: 'room' })}>
                  {mode === 'quick' ? 'Find an opponent' : 'Create room'}
                </Button>
              </>
            ) : (
              <>
                <Input label="Room code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" className="font-mono tracking-widest uppercase" />
                <Button className="w-full" disabled={!/^[A-Z0-9]{6}$/.test(code)} icon={<KeyRound className="size-4" />} onClick={() => void joinByCode()}>
                  Join private room
                </Button>
              </>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Open rooms" subtitle="Public rooms waiting for players" actions={<Button variant="ghost" size="sm" onClick={open.reload}>Refresh</Button>} />
          <DataTable
            rows={open.data}
            loading={open.loading}
            error={open.error}
            onRetry={open.reload}
            rowKey={(m) => m.id}
            empty={{ title: 'No open rooms', description: 'Create one or use quick match.' }}
            columns={[
              { header: 'Room', cell: (m) => <span className="font-semibold">#{m.matchNumber}</span> },
              { header: 'Host', cell: (m) => `#${m.players[0]?.playerNumber ?? ''} ${m.players[0]?.username ?? ''}`, hideOnMobile: true },
              { header: 'Stake', cell: (m) => tokens(m.stakeUnits) },
              { header: 'Players', cell: (m) => `${m.playerCount}/${m.maxPlayers}` },
              {
                header: '',
                className: 'text-right',
                cell: (m) => (m.isParticipant ? <Button size="sm" variant="outline" onClick={() => go(m)}>Open</Button> : <Button size="sm" onClick={() => setConfirm({ kind: 'join', match: m })}>Join</Button>),
              },
            ]}
          />
        </Card>
      </div>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Lock your stake?"
        confirmLabel={`Lock ${tokens(confirmStake)}`}
        onConfirm={run}
        message={
          <>
            <p>
              <strong>{tokens(confirmStake)}</strong> will move from your available balance into match escrow. It is returned if the match is cancelled, drawn or voided.
            </p>
            <p className="mt-2 text-ink-500">{feeLine(confirmStake)}</p>
          </>
        }
      />
    </div>
  );
}
