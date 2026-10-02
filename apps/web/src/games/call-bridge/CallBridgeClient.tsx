import { useState } from 'react';
import type { CallBridgeView } from '@arena/games/views';
import { Button } from '../../components/ui';
import { CardTable } from '../shared/CardTable';
import { GameMessage, seatPlayers, TurnClock } from '../shared/GameUi';
import type { GameClientProps } from '../types';

const score = (tenths: number) => (tenths / 10).toFixed(1);

export function CallBridgeClient({ match, room }: GameClientProps) {
  const v = room.view as CallBridgeView | null;
  const [call, setCall] = useState(2);
  const players = seatPlayers(match);
  if (!v) return <GameMessage>Waiting for all four players to sit down…</GameMessage>;
  const myTurn = v.turn === v.you;
  const name = (i: number) => (i === v.you ? 'You' : (players[i]?.username ?? `Seat ${i + 1}`));

  let message: string;
  if (v.phase === 'OVER') message = v.draw ? 'Game over — draw, stakes refunded' : v.winner === v.you ? 'You won the game! 🎉' : `${name(v.winner!)} won the game`;
  else if (v.phase === 'ROUND_END') message = `Round ${v.round} finished — next deal coming`;
  else if (v.phase === 'BIDDING') message = myTurn ? 'Your call: how many tricks will you win?' : `${name(v.turn)} is calling…`;
  else message = myTurn ? 'Your turn — play a highlighted card' : `${name(v.turn)} is playing…`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          Round {Math.max(v.round, 1)} of {v.rounds} · ♠ spades are trump
        </span>
        <TurnClock deadline={v.deadline} serverOffset={room.serverOffset} />
      </div>
      <GameMessage tone={v.phase === 'OVER' ? (v.winner === v.you ? 'success' : v.draw ? 'info' : 'danger') : 'info'}>{message}</GameMessage>
      <CardTable
        match={match}
        you={v.you}
        turn={v.phase === 'BIDDING' || v.phase === 'PLAYING' ? v.turn : null}
        handCounts={v.handCounts}
        trick={v.trick}
        lastTrick={v.lastTrick}
        hand={v.hand}
        legal={v.legal}
        onPlay={myTurn && v.phase === 'PLAYING' ? (card) => room.send({ t: 'move', data: { action: 'play', card } }) : undefined}
        seatExtra={(s) => `${v.bids[s] === null ? '–' : `call ${v.bids[s]}`} · won ${v.tricksWon[s]} · ${score(v.scores[s]!)}`}
        centre={
          v.lastTrick ? (
            <span className="rounded-full bg-black/30 px-3 py-1 text-xs font-semibold text-white">Last trick → {name(v.lastTrick.winner)}</span>
          ) : null
        }
      />
      {myTurn && v.phase === 'BIDDING' && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCall((c) => Math.max(1, c - 1))} aria-label="Lower call">
            −
          </Button>
          <span className="w-10 text-center text-2xl font-bold">{call}</span>
          <Button variant="outline" size="sm" onClick={() => setCall((c) => Math.min(13, c + 1))} aria-label="Raise call">
            +
          </Button>
          <Button onClick={() => room.send({ t: 'move', data: { action: 'bid', call } })}>Call {call}</Button>
        </div>
      )}
      {room.lastError && <p className="text-center text-sm text-rose-600">{room.lastError}</p>}
      {v.history.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-center text-sm">
            <thead>
              <tr className="text-xs text-ink-500">
                <th className="px-2 py-1 text-left">Round</th>
                {[0, 1, 2, 3].map((i) => (
                  <th key={i} className="px-2 py-1">
                    {name(i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.history.map((h, r) => (
                <tr key={r} className="border-t border-ink-100 dark:border-ink-800">
                  <td className="px-2 py-1 text-left">{r + 1}</td>
                  {h.delta.map((d, i) => (
                    <td key={i} className={d >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                      {h.tricks[i]}/{h.bids[i]} ({d >= 0 ? '+' : ''}
                      {score(d)})
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t-2 border-ink-200 font-bold dark:border-ink-700">
                <td className="px-2 py-1 text-left">Total</td>
                {v.scores.map((s, i) => (
                  <td key={i}>{score(s)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-500">Follow suit and beat the winning card when you can; if you can’t follow, you must play a spade. Make your call: +call (+0.1 per extra trick); miss it: −call. Highest total after 5 rounds wins.</p>
    </div>
  );
}
