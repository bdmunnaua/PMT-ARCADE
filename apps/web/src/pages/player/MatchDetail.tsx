import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Flag, LogOut, Radio, RotateCcw } from 'lucide-react';
import { BOT_MODULE_KEYS, DISPUTE_CATEGORIES, DISPUTE_CATEGORY_LABELS, isTerminal, QUICK_MATCH_BOT_AFTER_MS, type DisputeCategory, type GameDto, type MatchDto } from '@arena/shared';
import { BackLink, CopyText } from '../../components/Common';
import { InviteShare } from '../../components/InviteShare';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, KeyValue, Modal, Notice, PageHeader, PageLoader, Select, StatusBadge, Textarea, useToast } from '../../components/ui';
import { GAME_CLIENTS } from '../../games/registry';
import { useGameRoom } from '../../games/useGameRoom';
import { SoundToggle } from '../../games/shared/GameUi';
import { useSoundOnChange } from '../../games/shared/sound';
import { VoiceChat } from '../../games/shared/VoiceChat';
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
      {m.status === 'WAITING_FOR_OPPONENT' && m.isCreator && m.playerCount < m.maxPlayers && <HostStart match={m} botsAllowed={(BOT_MODULE_KEYS as readonly string[]).includes(game.data?.moduleKey ?? '')} onChanged={match.reload} />}
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
      {isTerminal(m.status) && m.status !== 'DISPUTED' && m.isParticipant && <PlayAgain match={m} />}

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
      {/* stays mounted while the game connection reconnects, so a short drop does not end the call */}
      {match.visibility === 'PRIVATE' && (
        <div className="border-b border-ink-100 p-3 dark:border-ink-800">
          <VoiceChat room={room} players={match.players} />
        </div>
      )}
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

/** "Play another one": opens the next room for the same players, or joins the one a friend opened. */
function PlayAgain({ match }: { match: MatchDto }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const friendOpened = !!match.rematchMatchId;
  const go = async () => {
    setBusy(true);
    try {
      const next = await post<MatchDto>(`/api/matches/${match.id}/rematch`);
      navigate(`/matches/${next.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? t(e.message) : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <p className="font-semibold">{friendOpened ? t('Your friends are ready for another game!') : t('Play another one?')}</p>
          <p className="text-sm text-ink-500">{t('Same game, same stake ({amount}), same players.', { amount: tokens(match.stakeUnits) })}</p>
        </div>
        <Button size="lg" icon={<RotateCcw className="size-5" />} loading={busy} onClick={() => void go()} className="w-full sm:w-auto">
          {friendOpened ? t('Join the next game') : t('Play another one')}
        </Button>
      </CardBody>
    </Card>
  );
}

/** The host starts now: with the people who joined (no bots), or with 🤖 bots in the empty seats. */
function HostStart({ match, botsAllowed, onChanged }: { match: MatchDto; botsAllowed: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // quick match: if nobody joins within a short wait, a 🤖 bot sits down so the player can play
  const autoBot = botsAllowed && match.mode === 'QUICK';
  const [left, setLeft] = useState(() => Math.max(0, match.createdAt + QUICK_MATCH_BOT_AFTER_MS - Date.now()));
  const fired = useRef(false);
  useEffect(() => {
    if (!autoBot) return;
    const iv = setInterval(() => setLeft(Math.max(0, match.createdAt + QUICK_MATCH_BOT_AFTER_MS - Date.now())), 1000);
    return () => clearInterval(iv);
  }, [autoBot, match.createdAt]);
  useEffect(() => {
    if (!autoBot || left > 0 || fired.current) return;
    fired.current = true;
    post(`/api/matches/${match.id}/bots`)
      .then(() => {
        toast.success(t('No opponent yet — a 🤖 bot joined so you can play now.'));
        onChanged();
      })
      .catch(() => undefined); // someone joined meanwhile, or bots are resting
  }, [autoBot, left, match.id, toast, onChanged]);
  const empty = match.maxPlayers - match.playerCount;
  const canStartNow = match.playerCount >= match.minPlayers;
  const run = async (path: 'start' | 'bots', done: string) => {
    setBusy(true);
    try {
      await post(`/api/matches/${match.id}/${path}`);
      toast.success(done);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? t(e.message) : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };
  if (!canStartNow && !botsAllowed) return null;
  return (
    <Card>
      <CardBody className="space-y-3">
        {autoBot && left > 0 && <p className="text-sm font-medium text-brand-600">{t('Looking for an opponent… if nobody joins in {n}s, a 🤖 bot will play you.', { n: Math.ceil(left / 1000) })}</p>}
        <p className="text-sm">
          {canStartNow
            ? t('{n} player(s) are here. Start now with them, or wait for more friends.', { n: match.playerCount })
            : t('Waiting for friends. You can also fill the {n} empty seat(s) with 🤖 bots and start now.', { n: empty })}
        </p>
        <div className="flex flex-wrap gap-2">
          {canStartNow && (
            <Button disabled={busy} onClick={() => run('start', t('The game is starting!'))}>
              ▶ {t('Start now with {n} players', { n: match.playerCount })}
            </Button>
          )}
          {botsAllowed && (
            <Button variant="outline" disabled={busy} onClick={() => run('bots', t('Bots joined — the game is starting!'))}>
              🤖 {t('Fill {n} seat(s) with bots', { n: empty })}
            </Button>
          )}
        </div>
        {botsAllowed && <p className="text-xs text-ink-500">{t('Bots are always shown as bots.')}</p>}
      </CardBody>
    </Card>
  );
}
