import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Bot, DoorOpen, KeyRound, Lock, Users, Zap } from 'lucide-react';
import { computeMatchFee, formatMinor, parseTokenAmount, type GameDto, type MatchDto } from '@arena/shared';
import { useConfig } from '../../auth/AuthProvider';
import { BackLink, GameArt } from '../../components/Common';
import { AviatorGame } from '../../games/aviator/AviatorGame';
import { useWallet } from '../../components/Wallet';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, ErrorState, Input, Notice, PageLoader, Tabs, useToast } from '../../components/ui';
import { ApiError, post } from '../../lib/api';
import { tokens } from '../../lib/format';
import { useApi, useDocumentTitle, useIdempotencyKey } from '../../lib/hooks';
import { t } from '../../lib/i18n';

type Mode = 'quick' | 'room' | 'code';

const BOT_GAMES = ['ludo', 'call-bridge', 'twenty-nine'];

export default function GameDetailPage() {
  const { slug = '' } = useParams();
  const game = useApi<GameDto>(`/api/games/${slug}`);
  useDocumentTitle(game.data?.name ?? 'Game');
  if (game.loading && !game.data) return <PageLoader />;
  if (game.error || !game.data) return <ErrorState error={game.error} onRetry={game.reload} />;
  if (game.data.kind === 'CRASH')
    return (
      <div className="space-y-4">
        <BackLink to="/play">{t("All games")}</BackLink>
        <h1 className="text-2xl font-bold">{game.data.name}</h1>
        {game.data.playable ? <AviatorGame game={game.data} /> : <Notice tone="info">{t('This game is switched off right now. Try the free games or play Ludo with friends.')}</Notice>}
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
  const [seats, setSeats] = useState(game.maximumPlayers);
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState<null | { kind: 'quick' } | { kind: 'room' } | { kind: 'bot' } | { kind: 'join'; match: MatchDto }>(null);
  const open = useApi<MatchDto[]>(`/api/matches/open?gameId=${game.id}`);

  const stakeUnits = parseTokenAmount(stake);
  const min = Math.max(game.minimumStakeUnits, (config?.minimumMatchStake ?? 0) * 100);
  const max = Math.min(game.maximumStakeUnits, (config?.maximumMatchStake ?? Infinity) * 100);
  const stakeError = stakeUnits === null ? t('Enter a token amount (up to 2 decimals).') : stakeUnits < min || stakeUnits > max ? t('Stake between {min} and {max}.', { min: tokens(min), max: tokens(max) }) : null;
  const spendable = (wallet.data?.availableUnits ?? 0) + (wallet.data?.bonusUnits ?? 0);

  const feeLine = (s: number) => {
    const pot = s * game.minimumPlayers;
    const fee = computeMatchFee(pot, config?.matchFeeBps ?? 100);
    return t('Pot {pot} · fee {fee} · winner receives {win}', { pot: tokens(pot), fee: tokens(fee), win: tokens(pot - fee) });
  };

  const go = (m: MatchDto) => navigate(`/matches/${m.id}`);

  const run = async () => {
    if (!confirm) return;
    try {
      if (confirm.kind === 'quick') {
        const r = await post<{ match: MatchDto; joined: boolean }>('/api/matches/quick', { gameId: game.id, stakeUnits }, idem.key());
        idem.rotate();
        toast.success(r.joined ? t("Opponent found — your match is ready!") : t("Waiting for an opponent. Your stake is locked."));
        go(r.match);
      } else if (confirm.kind === 'bot') {
        // a private 1-vs-1 room, then a 🤖 bot takes the other seat and the game starts
        const r = await post<{ match: MatchDto }>('/api/matches', { gameId: game.id, stakeUnits, visibility: 'PRIVATE', maxPlayers: 2 }, idem.key());
        idem.rotate();
        try {
          go(await post<MatchDto>(`/api/matches/${r.match.id}/bots`));
        } catch (e) {
          go(r.match); // the room stays open: invite a friend instead, or leave to get the stake back
          throw e;
        }
      } else if (confirm.kind === 'room') {
        const r = await post<{ match: MatchDto }>('/api/matches', { gameId: game.id, stakeUnits, visibility: isPrivate ? 'PRIVATE' : 'PUBLIC', maxPlayers: seats }, idem.key());
        idem.rotate();
        toast.success(t("Room created. Your stake is locked until the match ends or you leave."));
        go(r.match);
      } else {
        const m = await post<MatchDto>(`/api/matches/${confirm.match.id}/join`);
        toast.success(t("Joined! Stake locked."));
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
      toast.success(t("Joined the private room."));
      go(m);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("Could not join."));
    }
  };

  const confirmStake = confirm?.kind === 'join' ? confirm.match.stakeUnits : (stakeUnits ?? 0);

  return (
    <div className="space-y-6">
      <BackLink to="/play">{t("All games")}</BackLink>
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
              {t("Stakes")} {tokens(game.minimumStakeUnits)} – {tokens(game.maximumStakeUnits)}
            </span>
            <span>{t("Version")} {game.gameVersion}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title={t("Start a match")} subtitle={`Spendable: ${wallet.data ? tokens(spendable) : '…'}`} />
          <CardBody className="space-y-4">
            <Tabs<Mode>
              value={mode}
              onChange={setMode}
              items={[
                { key: 'quick', label: t("Quick match") },
                { key: 'room', label: t("Create room") },
                { key: 'code', label: t("Join code") },
              ]}
            />
            {mode !== 'code' ? (
              <>
                <Input label={t("Stake")} inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} suffix="PMT" error={stake ? stakeError : null} hint={stakeUnits && !stakeError ? feeLine(stakeUnits) : undefined} />
                {mode === 'room' && game.minimumPlayers < game.maximumPlayers && (
                  <div>
                    <p className="mb-1.5 text-sm font-medium">{t('Players')}</p>
                    <div className="flex gap-2">
                      {Array.from({ length: game.maximumPlayers - game.minimumPlayers + 1 }, (_, i) => game.minimumPlayers + i).map((n) => (
                        <Button key={n} size="sm" variant={seats === n ? 'primary' : 'secondary'} className="flex-1" onClick={() => setSeats(n)}>
                          {n === 2 ? t('Duo (2)') : `${n}`}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                {mode === 'room' && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} className="size-4 accent-brand-600" />
                    <Lock className="size-4" /> {t("Private room (share a join code)")}
                  </label>
                )}
                <Button className="w-full" disabled={!!stakeError || !stakeUnits} icon={mode === 'quick' ? <Zap className="size-4" /> : <DoorOpen className="size-4" />} onClick={() => setConfirm(mode === 'quick' ? { kind: 'quick' } : { kind: 'room' })}>
                  {mode === 'quick' ? t("Find an opponent") : t("Create room")}
                </Button>
                {BOT_GAMES.includes(game.moduleKey ?? '') && (
                  <Button className="w-full" variant="outline" disabled={!!stakeError || !stakeUnits} icon={<Bot className="size-4" />} onClick={() => setConfirm({ kind: 'bot' })}>
                    {game.maximumPlayers > 2 && game.minimumPlayers > 2 ? t('Play with 🤖 bots') : t('Play against a 🤖 bot')}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Input label={t("Room code")} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" className="font-mono tracking-widest uppercase" />
                <Button className="w-full" disabled={!/^[A-Z0-9]{6}$/.test(code)} icon={<KeyRound className="size-4" />} onClick={() => void joinByCode()}>
                  {t("Join private room")}
                </Button>
              </>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title={t("Open rooms")} subtitle={t("Public rooms waiting for players")} actions={<Button variant="ghost" size="sm" onClick={open.reload}>{t("Refresh")}</Button>} />
          <DataTable
            rows={open.data}
            loading={open.loading}
            error={open.error}
            onRetry={open.reload}
            rowKey={(m) => m.id}
            empty={{ title: t("No open rooms"), description: t("Create one or use quick match.") }}
            columns={[
              { header: t("Room"), cell: (m) => <span className="font-semibold">#{m.matchNumber}</span> },
              { header: t("Host"), cell: (m) => `#${m.players[0]?.playerNumber ?? ''} ${m.players[0]?.username ?? ''}`, hideOnMobile: true },
              { header: t("Stake"), cell: (m) => tokens(m.stakeUnits) },
              { header: t("Players"), cell: (m) => `${m.playerCount}/${m.maxPlayers}` },
              {
                header: '',
                className: 'text-right',
                cell: (m) => (m.isParticipant ? <Button size="sm" variant="outline" onClick={() => go(m)}>{t("Open")}</Button> : <Button size="sm" onClick={() => setConfirm({ kind: 'join', match: m })}>{t("Join")}</Button>),
              },
            ]}
          />
        </Card>
      </div>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={t("Lock your stake?")}
        confirmLabel={`Lock ${tokens(confirmStake)}`}
        onConfirm={run}
        message={
          <>
            <p>
              <strong>{tokens(confirmStake)}</strong> {t("will move from your available balance into match escrow. It is returned if the match is cancelled, drawn or voided.")}
            </p>
            <p className="mt-2 text-ink-500">{feeLine(confirmStake)}</p>
          </>
        }
      />
    </div>
  );
}
