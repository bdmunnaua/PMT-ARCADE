/**
 * Game integration contracts.
 *
 * A GameModule is pure, deterministic-as-possible game logic. It never touches the database,
 * wallets or the ledger. The platform's GameRoom Durable Object hosts the module, relays
 * player messages to it, persists only the events the module marks as important, and hands the
 * module's final outcome to the single settlement service. See docs/ADDING_A_GAME.md.
 */
import type { MatchOutcome } from './match-state';

export interface GamePlayerInfo {
  userId: string;
  playerNumber: number;
  username: string;
  displayName: string;
  seat: number;
  /** a 🤖 bot seat played by the server (always shown as a bot to everyone) */
  isBot?: boolean;
}

export interface DisconnectPolicy {
  /** How long a disconnected player may take to come back before `onTimeout` applies. */
  reconnectWindowMs: number;
  /**
   * After the window expires during PLAYING:
   *  FORFEIT → module.handleForfeit(player) decides the winner (normal fee applies)
   *  VOID    → match is voided and every stake refunded (no fee)
   *  MODULE  → module.handleDisconnect is called again with `expired: true` and decides
   */
  onTimeout: 'FORFEIT' | 'VOID' | 'MODULE';
}

export interface RoomContext {
  matchId: string;
  gameId: string;
  stakeUnits: number;
  players: GamePlayerInfo[];
  /** server clock (ms) */
  now: number;
  /** cryptographically secure random float in [0, 1), generated server-side */
  random: () => number;
}

export interface PersistableEvent {
  /** short machine type, e.g. "ROUND_RESULT" — stored in match_events */
  type: string;
  payload: unknown;
}

export interface ModuleResult<TState> {
  state: TState;
  /** messages to every connected player */
  broadcast?: unknown[];
  /** messages to one player */
  send?: { userId: string; message: unknown }[];
  /** important authoritative events to persist for recovery/audit/disputes (NOT every frame) */
  persist?: PersistableEvent[];
  /** set once the module has an authoritative final outcome */
  outcome?: MatchOutcome;
  /**
   * Module turn timer (absolute server ms). `undefined` keeps the current timer, `null` clears it.
   * When it fires, the room calls `handleTimeout` (e.g. auto-play for an idle player, chess flag).
   */
  timerAt?: number | null;
}

export type ResultValidation = { valid: true; proof: string } | { valid: false; reason: string };

export interface GameModule<TState = unknown> {
  /** Must equal the `module_key` of the game registry row that uses it. */
  readonly moduleKey: string;
  readonly version: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly disconnectPolicy: DisconnectPolicy;

  createRoom(ctx: RoomContext): TState;
  joinRoom(state: TState, player: GamePlayerInfo, ctx: RoomContext): ModuleResult<TState>;
  startMatch(state: TState, ctx: RoomContext): ModuleResult<TState>;
  handleMessage(state: TState, userId: string, message: unknown, ctx: RoomContext): ModuleResult<TState>;
  /** Re-checks a proposed outcome against the authoritative state before money moves. */
  validateResult(state: TState, outcome: MatchOutcome, ctx: RoomContext): ResultValidation;
  handleDisconnect(state: TState, userId: string, ctx: RoomContext & { expired: boolean }): ModuleResult<TState>;
  handleReconnect(state: TState, userId: string, ctx: RoomContext): ModuleResult<TState>;
  handleDraw(state: TState, ctx: RoomContext): ModuleResult<TState>;
  handleForfeit(state: TState, userId: string, ctx: RoomContext): ModuleResult<TState>;
  /** Called when the module's own timer (`ModuleResult.timerAt`) expires. */
  handleTimeout?(state: TState, ctx: RoomContext): ModuleResult<TState>;
  /** What a given player is allowed to see (hide opponents' secret information). */
  viewFor(state: TState, userId: string): unknown;
}

// ---- WebSocket protocol between the browser and the GameRoom Durable Object ----

export type ClientToRoomMessage =
  | { t: 'move'; data: unknown }
  | { t: 'forfeit' }
  | { t: 'ping' }
  /** voice chat signalling, relayed only to players at the same table (`to` = player number, or everyone) */
  | { t: 'rtc'; to?: number; data: unknown };

export type RoomToClientMessage =
  | { t: 'welcome'; matchId: string; you: number; players: { playerNumber: number; connected: boolean }[] }
  | { t: 'presence'; players: { playerNumber: number; connected: boolean }[]; reconnectDeadline?: number | null }
  | { t: 'state'; view: unknown; now?: number }
  | { t: 'event'; data: unknown }
  | { t: 'result'; outcome: { type: MatchOutcome['type']; winnerPlayerNumber?: number | null } }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' }
  | { t: 'rtc'; from: number; data: unknown };
