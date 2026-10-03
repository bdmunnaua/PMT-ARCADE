import { useState } from 'react';
import { useParams } from 'react-router';
import { Flag, LogOut, Radio } from 'lucide-react';
import { DISPUTE_CATEGORIES, DISPUTE_CATEGORY_LABELS, isTerminal, type DisputeCategory, type GameDto, type MatchDto } from '@arena/shared';
import { BackLink, CopyText } from '../../components/Common';
import { InviteShare } from '../../components/InviteShare';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, KeyValue, Modal, Notice, PageHeader, PageLoader, Select, StatusBadge, Textarea, useToast } from '../../components/ui';
import { GAME_CLIENTS } from '../../games/registry';
import { useGameRoom } from '../../games/useGameRoom';
import { SoundToggle } from '../../games/shared/GameUi';
import { useSoundOnChange } from '../../games/shared/sound';
import { ApiError, post } from '../../lib/api';
import { dateTime, percentFromBps, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import { useRealtime } from '../../lib/realtime';
import { t } from '../../lib/i18n';

export default function MatchDetailPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const match = useApi<MatchDto>(`/api/matches/${id}`);
  const game = useApi<GameDto>(match.data ? `/api/games/${match.data.gameId}` : null);
  const [leaving, setLeaving] = useState(false);
  const [disputing, setDisputing] = useState(false);
  useDocumentTitle(match.data ? `Match #${match.data.matchNumber}` : t("Match"));
  useRealtime(match.data?.isParticipant ? `match:${id}` : null, () => match.reload());

  if (match.loading && !match.data) return <PageLoader />;
  if (match.error || !match.data) return <ErrorState error={match.error} onRetry={match.reload} />;
  const m = match.data;
  const canLeave = m.isParticipant && (m.status === 'WAITING_FOR_OPPONENT' || (m.status === 'READY' && m.isCreator));
  const canDispute = m.isParticipant && !['CREATED', 'WAITING_FOR_OPPONENT', 'STAKE_LOCKING'].includes(m.status);
  const live = ['READY', 'PLAYING', 'RESULT_PENDING'].includes(m.status) && m.isParticipant;

  return (
    <div className="space-y-6">
      <PageHeader
        back={<BackLink to="/matches">{t("Matches")}</BackLink>}
        title={`Match #${m.matchNumber}`}
        subtitle={m.gameName}
        actions={
          <>
            {canLeave && (
              <Button variant="outline" icon={<LogOut className="size-4" />} onClick={() => setLeaving(true)}>
                {m.isCreator ? t("Cancel room") : t("Leave room")}
              </Button>
            )}
            {canDispute && (
              <Button variant="outline" icon={<Flag className="size-4" />} onClick={() => setDisputing(true)}>
                {t("Report a problem")}
              </Button>
            )}
          </>
        }
      />

      {m.status === 'WAITING_FOR_OPPONENT' && (
        <Notice tone="info" title={t("Waiting for opponent")}>
          {t("Your stake is locked in escrow.")} {m.visibility === 'PRIVATE' && m.joinCode ? <>{t("Room code:")} <CopyText value={m.joinCode} label={t("Room code")} /></> : t("Other players can join from the game lobby.")} {t("Rooms that wait longer than 30 minutes are cancelled and refunded automatically.")}
        </Notice>
      )}
      {m.status === 'WAITING_FOR_OPPONENT' && m.isCreator && game.data?.moduleKey === 'ludo' && m.playerCount < m.maxPlayers && <BotFill match={m} />}
      {m.status === 'WAITING_FOR_OPPONENT' && m.visibility === 'PRIVATE' && m.joinCode && m.isParticipant && m.playerCount < m.maxPlayers && (
        <Card>
          <CardBody>
            <InviteShare code={m.joinCode} host={m.players.find((p) => p.isYou)?.displayName ?? 'A friend'} gameName={m.gameName} stakeUnits={m.stakeUnits} />
          </CardBody>
        </Card>
      )}
      {m.status === 'DISPUTED' && <Notice tone="warning" title={t("Under review")}>{t("This match is frozen while an administrator reviews a dispute. Stakes stay in escrow until it is resolved.")}</Notice>}

      {/* the table comes first so players never scroll past the details to play */}
      {live && game.data && <GameRoomPanel match={m} game={game.data} />}
      {isTerminal(m.status) && m.myResult && (
        <Notice tone={m.myResult === 'WIN' ? 'success' : m.myResult === 'LOSS' ? 'danger' : 'info'} title={m.myResult === 'WIN' ? t("You won!") : m.myResult === 'LOSS' ? t('You lost this match') : t('Stake returned')}>
          {m.myResult === 'WIN' ? t('{amount} was added to your available balance.', { amount: tokens(m.payoutUnits) }) : t(m.myResult === 'LOSS' ? 'Your stake went to the winner (minus the platform fee).' : 'Your full stake is back in your wallet.')}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("Match details")} actions={<StatusBadge status={m.status} />} />
          <CardBody>
            <KeyValue
              columns={3}
              items={[
                ['Stake per player', tokens(m.stakeUnits)],
                ['Pot', tokens(m.potUnits)],
                ['Platform fee', `${percentFromBps(m.feeBps)}${m.feeUnits != null ? ` · ${tokens(m.feeUnits)}` : ''}`],
                ['Winner payout', m.payoutUnits ? tokens(m.payoutUnits) : '—'],
                ['Visibility', m.visibility === 'PRIVATE' ? 'Private' : 'Public'],
                ['Mode', t(m.mode === 'QUICK' ? 'Quick match' : 'Room')],
                ['Created', dateTime(m.createdAt)],
                ['Started', dateTime(m.startedAt)],
                ['Ended', dateTime(m.endedAt)],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("Players")} subtitle={`${m.playerCount}/${m.maxPlayers}`} />
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {m.players.map((p) => (
              <li key={p.playerNumber} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="font-semibold">
                    {p.displayName} {p.isYou && <Badge tone="brand">{t("You")}</Badge>}
                  </p>
                  <p className="text-xs text-ink-500">
                    #{p.playerNumber} · @{p.username}
                  </p>
                </div>
                <div className="text-right">
                  {p.result && <StatusBadge status={p.result} />}
                  {p.payoutUnits ? <p className="mt-1 text-xs font-semibold text-emerald-600">{tokens(p.payoutUnits)}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title={m.isCreator ? t("Cancel this room?") : t("Leave this room?")}
        confirmLabel={m.isCreator ? t("Cancel room") : t("Leave room")}
        tone="danger"
        message={m.isCreator ? t("Everyone in the room gets their full stake back.") : t('Your {amount} stake will be returned to your wallet.', { amount: tokens(m.stakeUnits) })}
        onConfirm={async () => {
          await post(`/api/matches/${m.id}/leave`);
          toast.success(t("Stake returned to your wallet."));
          match.reload();
        }}
      />
      <DisputeModal open={disputing} onClose={() => setDisputing(false)} match={m} onDone={match.reload} />
    </div>
  );
}

function GameRoomPanel({ match, game }: { match: MatchDto; game: GameDto }) {
  const Client = game.moduleKey ? GAME_CLIENTS[game.moduleKey] : undefined;
  const room = useGameRoom(match.id, !!Client && game.moduleInstalled);
  // a soft ping when it becomes your turn (every game view has `turn` and `you`)
  const view = room.view as { turn?: unknown; you?: unknown; phase?: string } | null;
  const myTurn = !!view && view.turn === view.you && view.phase !== 'OVER';
  useSoundOnChange(myTurn ? 'mine' : 'theirs', () => (myTurn ? 'turn' : null));
  // win / lose fanfare when the server announces the result (29: partners win together)
  useSoundOnChange(room.result ? `${room.result.type}-${room.result.winnerPlayerNumber ?? ''}` : null, () => {
    const r = room.result;
    if (!r || r.type !== 'WIN') return null;
    const order = [...match.players].sort((a, b) => a.seat - b.seat);
    const mine = order.findIndex((p) => p.isYou);
    const winner = order.findIndex((p) => p.playerNumber === r.winnerPlayerNumber);
    const won = mine >= 0 && (winner === mine || (game.moduleKey === 'twenty-nine' && winner >= 0 && winner % 2 === mine % 2));
    return won ? 'win' : 'lose';
  });
  if (!Client || !game.moduleInstalled) {
    return (
      <Notice tone="info" title={t("Game client not installed")}>
        {t('The playable client for {game} has not been installed in this build yet, so this match cannot be played here. Stakes stay safely in escrow; rooms that never start are refunded automatically.', { game: game.name })}
      </Notice>
    );
  }
  return (
    <Card>
      <CardHeader
        title={t("Game room")}
        icon={<Radio className="size-4" />}
        actions={
          <span className="flex items-center gap-2">
            <SoundToggle />
            <Badge tone={room.status === 'open' ? 'success' : 'warning'}>{room.status}</Badge>
          </span>
        }
      />
      <CardBody>
        {room.error && <Notice tone="danger">{room.error}</Notice>}
        <Client match={match} room={room} />
      </CardBody>
    </Card>
  );
}

function DisputeModal({ open, onClose, match, onDone }: { open: boolean; onClose: () => void; match: MatchDto; onDone: () => void }) {
  const toast = useToast();
  const [category, setCategory] = useState<DisputeCategory>('INCORRECT_RESULT');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/matches/${match.id}/disputes`, { category, description });
      toast.success(t("Dispute submitted. An administrator will review it."));
      onClose();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Could not submit."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Report a problem with Match #{n}', { n: String(match.matchNumber) })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={submit} loading={busy} disabled={description.trim().length < 10}>
            {t("Submit dispute")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select label={t("What happened?")} value={category} onChange={(e) => setCategory(e.target.value as DisputeCategory)}>
          {DISPUTE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {DISPUTE_CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <Textarea label={t("Details")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={5} hint={t("At least 10 characters. Include times and what you saw.")} required />
        {['PLAYING', 'RESULT_PENDING'].includes(match.status) && <Notice tone="warning">{t("Reporting now freezes the match until an administrator resolves it.")}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}

/** The host fills the empty seats with 🤖 bots (Ludo); the game then starts. */
function BotFill({ match }: { match: MatchDto }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const empty = match.maxPlayers - match.playerCount;
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {t('Do not want to wait? Fill the {n} empty seat(s) with 🤖 bots and start now. Bots are always shown as bots.', { n: empty })}
        </p>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await post(`/api/matches/${match.id}/bots`);
              toast.success(t('Bots joined — the game is starting!'));
            } catch (e) {
              toast.error(e instanceof ApiError ? t(e.message) : t('Could not add bots.'));
            } finally {
              setBusy(false);
            }
          }}
        >
          🤖 {t('Start with bots')}
        </Button>
      </CardBody>
    </Card>
  );
}
