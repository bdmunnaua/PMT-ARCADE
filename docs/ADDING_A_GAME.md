# Adding a game (e.g. Game #1)

You replace a registry slot's name/description/thumbnail and plug in a module. **No wallet, ledger or settlement code changes.**

## 0. Pick a slot and a module key

Slots `game-01` … `game-06` hold the installed games (see [GAMES.md](GAMES.md)); `game-07` … `game-10` are free. Choose a module key, e.g. `chess-blitz`. Six complete examples live in `packages/games/src/` — copy the closest one.

## 1. Server: implement `GameModule`

Create a folder `packages/games/src/chess-blitz/` with `rules.ts` (pure rules, easy to unit-test) and `module.ts`:

```ts
import type { GameModule } from '@arena/shared';

interface State { /* your authoritative state */ }

export const chessBlitz: GameModule<State> = {
  moduleKey: 'chess-blitz',
  version: '1.0.0',
  minPlayers: 2,
  maxPlayers: 2,
  // your rule: 60 s to reconnect, then the absent player forfeits (normal 1% fee)
  disconnectPolicy: { reconnectWindowMs: 60_000, onTimeout: 'FORFEIT' },

  createRoom: (ctx) => ({ /* initial state from ctx.players, ctx.random() for server-side randomness */ }),
  joinRoom: (state) => ({ state }),
  startMatch: (state) => ({ state, broadcast: [{ kind: 'started' }] }),
  handleMessage(state, userId, message, ctx) {
    // validate the move server-side; return the new state
    // when the game ends: return { state, outcome: { type: 'WIN', winnerUserId } } or { type: 'DRAW' }
    // persist only important events: persist: [{ type: 'GAME_OVER', payload: {...} }]
    return { state };
  },
  validateResult(state, outcome) {
    // recompute the result from the authoritative state; return a proof (e.g. move list hash)
    return { valid: true, proof: '…' };
  },
  handleDisconnect: (state) => ({ state }),
  handleReconnect: (state) => ({ state }),
  handleDraw: (state) => ({ state, outcome: { type: 'DRAW' } }),
  handleForfeit: (state, userId, ctx) => ({ state, outcome: { type: 'WIN', winnerUserId: ctx.players.find((p) => p.userId !== userId)!.userId, reason: 'FORFEIT' } }),
  viewFor: (state, userId) => ({ /* only what this player may see */ }),
};
```

Rules:
* Never trust the browser — validate every move in `handleMessage`.
* Use `ctx.random()` (server-side crypto RNG) for dice/shuffles.
* Outcomes use **user ids** (`ctx.players[i].userId`); the UI shows player numbers.
* Keep `persist` small: results and dispute-relevant events only, never frames.

Register it in `packages/games/src/server.ts` (`ROOM_GAME_MODULES`):

```ts
import { chessBlitz } from './chess-blitz/module';
export const ROOM_GAME_MODULES = { ..., [chessBlitz.moduleKey]: chessBlitz };
```

Add its view type to `packages/games/src/views.ts`. Optional turn timer: return `timerAt` from any handler and implement `handleTimeout` (auto-play / flag fall). Team games return `{ type: 'WIN', winnerUserId, teammateUserIds }`.

Add tests to `tests/unit/games.test.ts`: rules tests plus a bot playthrough with `playOut(...)`, which drives the module to completion through the real RoomEngine.

## 2. Browser: a game client

Create `apps/web/src/games/chess-blitz/ChessBlitzClient.tsx` (shared pieces: `games/shared/GameUi.tsx`, `games/shared/CardTable.tsx`):

```tsx
import type { GameClientProps } from '../types';

export function ChessBlitzClient({ match, room }: GameClientProps) {
  // room.view   → what the server's viewFor() returned for you
  // room.send({ t: 'move', data: {...} }) → a move (validated server-side)
  // room.send({ t: 'forfeit' })
  // room.presence / room.reconnectDeadline / room.result
  return <div>…render the board from room.view…</div>;
}
```

Register it in `apps/web/src/games/registry.ts`:

```ts
import { ChessBlitzClient } from './chess-blitz/ChessBlitzClient';
export const GAME_CLIENTS = { ..., 'chess-blitz': ChessBlitzClient };
```

The match page (`/matches/:id`) automatically opens the GameRoom WebSocket and renders your client when the match is READY/PLAYING.

## 3. Configure the registry slot

Deploy (or run locally), then **Admin → Games → Game registry → Edit `game-01`**:

* Name, description, thumbnail URL
* Module key: `chess-blitz`
* Stake limits, players (min/max), version
* **Enabled** ✓ (production refuses this until the module is installed)
* Reason (audit log)

## How each concern is connected

| Concern | Provided by the platform |
|---|---|
| Authentication | Firebase ID token → Worker; the room ticket identifies the player (`userId`, `playerNumber`) |
| Player information | `ctx.players` (user id, player number, username, display name, seat) — no emails |
| Stake locking | `POST /api/matches` / join / quick match lock stakes before READY; the room never starts until every stake is locked |
| Matchmaking | quick match (same game + stake), public rooms, private rooms with codes |
| Match state | `matches.status`, transition table, GameRoom presence/timers |
| Result verification | `module.validateResult` re-checks the outcome before settlement; proof stored in `matches.result_proof` |
| Token settlement | `SettlementService` — 1% fee to PLATFORM_FEES, payouts, refunds, exactly once |
| Match history | `match_players`, `match_events`, ledger entries, player stats, leaderboard |
| Disputes | players report from the match page; matches in play are frozen for admin decision |

## Checklist before enabling in production

- [ ] module unit tests (win, draw, forfeit, disconnect policy, invalid moves)
- [ ] `validateResult` recomputes from state (doesn't just echo)
- [ ] `viewFor` hides secret information
- [ ] client never decides outcomes
- [ ] stake limits and players configured in the registry
- [ ] tried end-to-end in development with two accounts
