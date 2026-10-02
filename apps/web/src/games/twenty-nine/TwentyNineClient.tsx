import { useState } from 'react';
import { label as cardLabel, SUIT_NAME, SUIT_SYMBOL } from '@arena/games/cards';
import type { TwentyNineView } from '@arena/games/views';
import { Button } from '../../components/ui';
import { CardTable } from '../shared/CardTable';
import { GameMessage, seatPlayers, TurnClock } from '../shared/GameUi';
import type { GameClientProps } from '../types';

const TEAM_TONE = ['#38bdf8', '#f97316'];

export function TwentyNineClient({ match, room }: GameClientProps) {
  const v = room.view as TwentyNineView | null;
  const [bid, setBid] = useState(16);
  const players = seatPlayers(match);
  if (!v) return <GameMessage>Waiting for all four players to sit down…</GameMessage>;
  const myTurn = v.turn === v.you;
  const name = (i: number) => (i === v.you ? 'You' : (players[i]?.username ?? `Seat ${i + 1}`));
  const myTeam = v.yourTeam ?? 0;
  const minBid = v.bid === null ? 16 : v.bid + 1;
  const send = (data: unknown) => room.send({ t: 'move', data });
  const choosingTrump = myTurn && v.phase === 'TRUMP';

  let message: string;
  if (v.phase === 'OVER') message = v.draw ? 'Match drawn — stakes refunded' : v.winnerTeam === myTeam ? 'Your team won! 🎉' : 'The other team won';
  else if (v.phase === 'HAND_END') message = 'Hand finished — next deal coming';
  else if (v.phase === 'BIDDING') message = myTurn ? (v.mustBid ? 'Everyone passed — you must bid' : 'Your bid') : `${name(v.turn)} is bidding…`;
  else if (v.phase === 'TRUMP') message = myTurn ? 'You won the bid — tap a card to set it face down as the trump' : `${name(v.turn)} is setting the trump card…`;
  else message = myTurn ? 'Your turn' : `${name(v.turn)} is playing…`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold">
          Hand {v.handNumber} · bid {v.bid ?? '–'}
          {v.bidder !== null ? ` by ${name(v.bidder)}` : ''} · target {v.target}
        </span>
        <span>
          Trump: {v.trump ? `${SUIT_SYMBOL[v.trump]} ${SUIT_NAME[v.trump]}${v.trumpRevealed ? '' : ` — your face-down card ${v.trumpCard ? cardLabel(v.trumpCard) : ''} (only you know it)`}` : v.trumpChosen ? 'face down 🂠' : '—'}
        </span>
        <TurnClock deadline={v.deadline} serverOffset={room.serverOffset} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-center text-sm">
        {[0, 1].map((t) => (
          <div key={t} className="rounded-xl border-2 px-3 py-2" style={{ borderColor: TEAM_TONE[t] }}>
            <p className="font-semibold">{t === myTeam ? 'Your team' : 'Opponents'}</p>
            <p>
              Game {v.gameScore[t] > 0 ? '+' : ''}
              {v.gameScore[t]} / 6 · points this hand {v.teamPoints[t]}
            </p>
          </div>
        ))}
      </div>
      <GameMessage tone={v.phase === 'OVER' ? (v.winnerTeam === myTeam ? 'success' : v.draw ? 'info' : 'danger') : 'info'}>{message}</GameMessage>
      <CardTable
        match={match}
        you={v.you}
        turn={v.phase === 'HAND_END' || v.phase === 'OVER' ? null : v.turn}
        handCounts={v.handCounts}
        trick={v.trick}
        lastTrick={v.lastTrick}
        hand={v.hand}
        legal={choosingTrump ? v.hand : v.legal}
        teamTone={(s) => TEAM_TONE[s % 2]}
        onPlay={choosingTrump ? (card) => send({ action: 'trump', card }) : myTurn && v.phase === 'PLAYING' ? (card) => send({ action: 'play', card }) : undefined}
        seatExtra={(s) => (v.phase === 'BIDDING' ? (v.passed[s] ? 'pass' : v.bidder === s ? `bid ${v.bid}` : '') : v.bidder === s ? `bidder ${v.bid}${v.trumpFaceDown ? ' · 🂠 trump' : ''}` : '')}
        centre={v.lastTrick ? <span className="rounded-full bg-black/30 px-3 py-1 text-xs font-semibold text-white">Last trick → {name(v.lastTrick.winner)} (+{v.lastTrick.points})</span> : null}
      />
      <div className="flex flex-wrap items-center justify-center gap-2">
        {myTurn && v.phase === 'BIDDING' && (
          <>
            <Button variant="outline" size="sm" onClick={() => setBid((b) => Math.max(minBid, b - 1))} aria-label="Lower bid">
              −
            </Button>
            <span className="w-10 text-center text-2xl font-bold">{Math.max(bid, minBid)}</span>
            <Button variant="outline" size="sm" onClick={() => setBid((b) => Math.min(28, Math.max(b, minBid) + 1))} aria-label="Raise bid">
              +
            </Button>
            <Button onClick={() => send({ action: 'bid', bid: Math.max(bid, minBid) })}>Bid {Math.max(bid, minBid)}</Button>
            {!v.mustBid && (
              <Button variant="secondary" onClick={() => send({ action: 'bid', bid: null })}>
                Pass
              </Button>
            )}
          </>
        )}
        {v.canReveal && (
          <Button variant="secondary" onClick={() => send({ action: 'reveal' })}>
            Call trump (reveal)
          </Button>
        )}
        {v.canShowPair && <Button onClick={() => send({ action: 'pair' })}>Show pair (K+Q of trump)</Button>}
      </div>
      {room.lastError && <p className="text-center text-sm text-rose-600">{room.lastError}</p>}
      <p className="text-xs text-ink-500">Card points: J 3 · 9 2 · A 1 · 10 1 (28 per hand). The bidder sets one card face down as trump; it stays out of their hand until someone calls it. Follow suit; if you can’t, you may call the trump open — then you must play a trump if you have one. Pair (K+Q of trump) moves the target by 4 once your team wins a trick after the reveal. The bidding team needs the target to gain +1; otherwise −1. First team to +6 wins.</p>
    </div>
  );
}
