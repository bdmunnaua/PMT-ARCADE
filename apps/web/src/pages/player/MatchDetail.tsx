import { useState } from 'react';
import { useParams } from 'react-router';
import { Flag, LogOut, Radio } from 'lucide-react';
import { DISPUTE_CATEGORIES, DISPUTE_CATEGORY_LABELS, isTerminal, type DisputeCategory, type GameDto, type MatchDto } from '@arena/shared';
import { BackLink, CopyText } from '../../components/Common';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, KeyValue, Modal, Notice, PageHeader, PageLoader, Select, StatusBadge, Textarea, useToast } from '../../components/ui';
import { GAME_CLIENTS } from '../../games/registry';
import { useGameRoom } from '../../games/useGameRoom';
import { SoundToggle } from '../../games/shared/GameUi';
import { useSoundOnChange } from '../../games/shared/sound';
import { ApiError, post } from '../../lib/api';
import { dateTime, percentFromBps, tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';
import { useRealtime } from '../../lib/realtime';

export default function MatchDetailPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const match = useApi<MatchDto>(`/api/matches/${id}`);
  const game = useApi<GameDto>(match.data ? `/api/games/${match.data.gameId}` : null);
  const [leaving, setLeaving] = useState(false);
  const [disputing, setDisputing] = useState(false);
  useDocumentTitle(match.data ? `Match #${match.data.matchNumber}` : 'Match');
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
        back={<BackLink to="/matches">Matches</BackLink>}
        title={`Match #${m.matchNumber}`}
        subtitle={m.gameName}
        actions={
          <>
            {canLeave && (
              <Button variant="outline" icon={<LogOut className="size-4" />} onClick={() => setLeaving(true)}>
                {m.isCreator ? 'Cancel room' : 'Leave room'}
              </Button>
            )}
            {canDispute && (
              <Button variant="outline" icon={<Flag className="size-4" />} onClick={() => setDisputing(true)}>
                Report a problem
              </Button>
            )}
          </>
        }
      />

      {m.status === 'WAITING_FOR_OPPONENT' && (
        <Notice tone="info" title="Waiting for opponent">
          Your stake is locked in escrow. {m.visibility === 'PRIVATE' && m.joinCode ? <>Share this room code: <CopyText value={m.joinCode} label="Room code" /></> : 'Other players can join from the game lobby.'} Rooms that wait longer than 30 minutes are cancelled and refunded automatically.
        </Notice>
      )}
      {m.status === 'DISPUTED' && <Notice tone="warning" title="Under review">This match is frozen while an administrator reviews a dispute. Stakes stay in escrow until it is resolved.</Notice>}

      {/* the table comes first so players never scroll past the details to play */}
      {live && game.data && <GameRoomPanel match={m} game={game.data} />}
      {isTerminal(m.status) && m.myResult && (
        <Notice tone={m.myResult === 'WIN' ? 'success' : m.myResult === 'LOSS' ? 'danger' : 'info'} title={m.myResult === 'WIN' ? 'You won!' : m.myResult === 'LOSS' ? 'You lost this match' : 'Stake returned'}>
          {m.myResult === 'WIN' ? `${tokens(m.payoutUnits)} was added to your available balance.` : m.myResult === 'LOSS' ? 'Your stake went to the winner (minus the platform fee).' : 'Your full stake is back in your wallet.'}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Match details" actions={<StatusBadge status={m.status} />} />
          <CardBody>
            <KeyValue
              columns={3}
              items={[
                ['Stake per player', tokens(m.stakeUnits)],
                ['Pot', tokens(m.potUnits)],
                ['Platform fee', `${percentFromBps(m.feeBps)}${m.feeUnits != null ? ` · ${tokens(m.feeUnits)}` : ''}`],
                ['Winner payout', m.payoutUnits ? tokens(m.payoutUnits) : '—'],
                ['Visibility', m.visibility === 'PRIVATE' ? 'Private' : 'Public'],
                ['Mode', m.mode === 'QUICK' ? 'Quick match' : 'Room'],
                ['Created', dateTime(m.createdAt)],
                ['Started', dateTime(m.startedAt)],
                ['Ended', dateTime(m.endedAt)],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Players" subtitle={`${m.playerCount}/${m.maxPlayers}`} />
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {m.players.map((p) => (
              <li key={p.playerNumber} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="font-semibold">
                    {p.displayName} {p.isYou && <Badge tone="brand">You</Badge>}
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
        title={m.isCreator ? 'Cancel this room?' : 'Leave this room?'}
        confirmLabel={m.isCreator ? 'Cancel room' : 'Leave room'}
        tone="danger"
        message={m.isCreator ? 'Everyone in the room gets their full stake back.' : `Your ${tokens(m.stakeUnits)} stake will be returned to your wallet.`}
        onConfirm={async () => {
          await post(`/api/matches/${m.id}/leave`);
          toast.success('Stake returned to your wallet.');
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
      <Notice tone="info" title="Game client not installed">
        The playable client for {game.name} has not been installed in this build yet, so this match cannot be played here. Stakes stay safely in escrow; rooms that never start are refunded automatically.
      </Notice>
    );
  }
  return (
    <Card>
      <CardHeader
        title="Game room"
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
      toast.success('Dispute submitted. An administrator will review it.');
      onClose();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not submit.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Report a problem with Match #${match.matchNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={description.trim().length < 10}>
            Submit dispute
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select label="What happened?" value={category} onChange={(e) => setCategory(e.target.value as DisputeCategory)}>
          {DISPUTE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {DISPUTE_CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <Textarea label="Details" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={5} hint="At least 10 characters. Include times and what you saw." required />
        {['PLAYING', 'RESULT_PENDING'].includes(match.status) && <Notice tone="warning">Reporting now freezes the match until an administrator resolves it.</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}
