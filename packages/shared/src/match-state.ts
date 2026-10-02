export const MATCH_STATUSES = [
  'CREATED',
  'WAITING_FOR_OPPONENT',
  'STAKE_LOCKING',
  'READY',
  'PLAYING',
  'RESULT_PENDING',
  'SETTLING',
  'SETTLED',
  // exceptional
  'DRAW',
  'CANCELLED',
  'VOID',
  'REFUNDED',
  'DISPUTED',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const TERMINAL_MATCH_STATUSES: readonly MatchStatus[] = ['SETTLED', 'DRAW', 'CANCELLED', 'VOID', 'REFUNDED'];
export const ACTIVE_MATCH_STATUSES: readonly MatchStatus[] = [
  'CREATED',
  'WAITING_FOR_OPPONENT',
  'STAKE_LOCKING',
  'READY',
  'PLAYING',
  'RESULT_PENDING',
  'SETTLING',
  'DISPUTED',
];
export const LIVE_MATCH_STATUSES: readonly MatchStatus[] = ['READY', 'PLAYING', 'RESULT_PENDING', 'SETTLING'];

/** Legal transitions. Anything not listed is refused. */
export const MATCH_TRANSITIONS: Record<MatchStatus, readonly MatchStatus[]> = {
  CREATED: ['WAITING_FOR_OPPONENT', 'STAKE_LOCKING', 'CANCELLED'],
  WAITING_FOR_OPPONENT: ['STAKE_LOCKING', 'CANCELLED'],
  STAKE_LOCKING: ['WAITING_FOR_OPPONENT', 'READY', 'CANCELLED'],
  READY: ['PLAYING', 'SETTLING', 'CANCELLED'],
  PLAYING: ['RESULT_PENDING', 'SETTLING', 'DISPUTED'],
  RESULT_PENDING: ['SETTLING', 'DISPUTED'],
  SETTLING: ['SETTLED', 'DRAW', 'VOID', 'REFUNDED'],
  DISPUTED: ['SETTLING'],
  SETTLED: [],
  DRAW: [],
  CANCELLED: [],
  VOID: [],
  REFUNDED: [],
};

export function canTransition(from: MatchStatus, to: MatchStatus): boolean {
  return MATCH_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: MatchStatus): boolean {
  return TERMINAL_MATCH_STATUSES.includes(status);
}

/** Every status from which the given final status can be reached through SETTLING. */
export function statusesSettleableTo(finalStatus: MatchStatus): MatchStatus[] {
  return MATCH_STATUSES.filter((s) => canTransition(s, 'SETTLING') && canTransition('SETTLING', finalStatus));
}

export type MatchOutcome =
  /** `teammateUserIds` = other winners of a team game (pot minus fee is split equally among all winners). */
  | { type: 'WIN'; winnerUserId: string; teammateUserIds?: string[]; reason?: 'NORMAL' | 'FORFEIT' | 'TIMEOUT' | 'ADMIN_DECISION' }
  | { type: 'DRAW' }
  | { type: 'VOID'; reason: string }
  | { type: 'REFUND'; reason: string };

export const SETTLEMENT_SOURCES = ['GAME_SERVER', 'INTERNAL_API', 'ADMIN', 'DEV_SIMULATOR', 'SYSTEM'] as const;
export type SettlementSource = (typeof SETTLEMENT_SOURCES)[number];
