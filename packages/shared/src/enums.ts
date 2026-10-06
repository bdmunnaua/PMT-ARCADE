export const ACCOUNT_STATUSES = ['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Per-player balance buckets. */
export const PLAYER_BUCKETS = ['AVAILABLE', 'LOCKED_GAME', 'LOCKED_SELL', 'BONUS'] as const;
export type PlayerBucket = (typeof PLAYER_BUCKETS)[number];

/**
 * System wallets. ISSUANCE is the only account allowed to go negative: its balance is
 * minus the total number of tokens ever issued into ADMIN_TREASURY.
 * HOUSE_BANKROLL backs house-banked games (Aviator): it pays winning bets and receives losing
 * ones; it is funded only by audited transfers from ADMIN_TREASURY.
 */
/** REWARDS_POOL pays free-game rewards, check-ins and referral bonuses (always as BONUS). */
/** ONCHAIN_BRIDGE holds PMT that crossed to/from BNB Chain (withdrawals in, deposits out; may go negative). */
export const SYSTEM_ACCOUNTS = ['ADMIN_TREASURY', 'PLATFORM_FEES', 'ISSUANCE', 'HOUSE_BANKROLL', 'REWARDS_POOL', 'ONCHAIN_BRIDGE'] as const;
export type SystemAccount = (typeof SYSTEM_ACCOUNTS)[number];

export const SYSTEM_ACCOUNT_IDS: Record<SystemAccount, string> = {
  ADMIN_TREASURY: 'sys_admin_treasury',
  PLATFORM_FEES: 'sys_platform_fees',
  ISSUANCE: 'sys_issuance',
  HOUSE_BANKROLL: 'sys_house_bankroll',
  REWARDS_POOL: 'sys_rewards_pool',
  ONCHAIN_BRIDGE: 'sys_onchain_bridge',
};

export function playerAccountId(userId: string, bucket: PlayerBucket): string {
  return `wa_${userId}_${bucket}`;
}

/** Ledger transaction types (one per business operation). */
export const LEDGER_TX_TYPES = [
  'TREASURY_ISSUANCE',
  'ADMIN_GRANT',
  'TOKEN_PURCHASE',
  'TOKEN_SELL_LOCK',
  'TOKEN_SELL_COMPLETE',
  'TOKEN_SELL_REFUND',
  'GAME_STAKE_LOCK',
  'GAME_STAKE_REFUND',
  'GAME_WIN_PAYOUT',
  'ADJUSTMENT',
  'HOUSE_BET_WIN',
  'HOUSE_BET_LOSS',
  'HOUSE_BET_REFUND',
  'HOUSE_BANKROLL_TRANSFER',
  'PLAYER_TRANSFER',
  'ARCADE_REWARD',
  'REWARDS_POOL_TRANSFER',
  'ONCHAIN_WITHDRAW',
  'ONCHAIN_WITHDRAW_PAID',
  'ONCHAIN_WITHDRAW_REFUND',
  'ONCHAIN_DEPOSIT',
] as const;
export type LedgerTxType = (typeof LEDGER_TX_TYPES)[number];

/** Posting types (one per individual movement inside a transaction). */
export const POSTING_TYPES = [...LEDGER_TX_TYPES, 'PLATFORM_MATCH_FEE', 'TRANSFER_FEE', 'WITHDRAW_FEE'] as const;
export type PostingType = (typeof POSTING_TYPES)[number];

export const GRANT_TYPES = ['PROMOTION', 'COMPENSATION', 'MANUAL_GRANT', 'BONUS'] as const;
export type GrantType = (typeof GRANT_TYPES)[number];

/** Player-facing transaction categories. */
export const PLAYER_TX_CATEGORIES = [
  'BUY',
  'SELL',
  'GAME_STAKE',
  'GAME_WIN',
  'GAME_LOSS',
  'GAME_REFUND',
  'ADMIN_GRANT',
  'BONUS',
  'FREE_GAME',
  'TRANSFER',
  'CRYPTO',
  'ADJUSTMENT',
] as const;
export type PlayerTxCategory = (typeof PLAYER_TX_CATEGORIES)[number];

export const PAYMENT_METHODS = ['BKASH_MANUAL', 'OTHER_MANUAL'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const BUY_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'TOKEN_CREDITED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const;
export type BuyStatus = (typeof BUY_STATUSES)[number];
export const BUY_OPEN_STATUSES: readonly BuyStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

export const SELL_STATUSES = [
  'SUBMITTED',
  'TOKENS_LOCKED',
  'UNDER_REVIEW',
  'APPROVED',
  'PAYMENT_PROCESSING',
  'PAYMENT_SENT',
  'COMPLETED',
  'REJECTED',
  'TOKENS_UNLOCKED',
  'CANCELLED',
] as const;
export type SellStatus = (typeof SELL_STATUSES)[number];
export const SELL_OPEN_STATUSES: readonly SellStatus[] = ['TOKENS_LOCKED', 'UNDER_REVIEW', 'PAYMENT_PROCESSING'];

export const FINANCE_REQUEST_KINDS = ['BUY', 'SELL'] as const;
export type FinanceRequestKind = (typeof FINANCE_REQUEST_KINDS)[number];

export const SENDER_TYPES = ['PLAYER', 'ADMIN', 'SYSTEM'] as const;
export type SenderType = (typeof SENDER_TYPES)[number];

export const MATCH_VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const;
export type MatchVisibility = (typeof MATCH_VISIBILITIES)[number];

export const MATCH_MODES = ['QUICK', 'ROOM'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const MATCH_PLAYER_RESULTS = ['WIN', 'LOSS', 'DRAW', 'REFUNDED'] as const;
export type MatchPlayerResult = (typeof MATCH_PLAYER_RESULTS)[number];

export const DISPUTE_CATEGORIES = [
  'CONNECTION_PROBLEM',
  'INCORRECT_RESULT',
  'SUSPECTED_CHEATING',
  'SETTLEMENT_PROBLEM',
  'OTHER',
] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

export const DISPUTE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/**
 * Resolution options. Anything that moves tokens goes through the settlement or ledger
 * service — a resolution never edits a balance directly.
 */
export const DISPUTE_RESOLUTIONS = [
  'UPHOLD_RESULT', // keep the result, no token movement
  'SETTLE_WINNER', // unsettled disputed match: settle for the chosen winner (normal fee)
  'SETTLE_DRAW', // unsettled disputed match: refund stakes as a draw
  'VOID_REFUND', // unsettled disputed match: void and refund all stakes
  'COMPENSATE', // settled match: compensating grant from ADMIN_TREASURY
  'REJECT', // complaint rejected
] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];

export const FRAUD_FLAG_TYPES = [
  'DUPLICATE_PAYMENT_REFERENCE',
  'SHARED_SENDER_NUMBER',
  'SHARED_RECEIVING_NUMBER',
  'HIGH_PURCHASE_VELOCITY',
  'LARGE_TRANSACTION',
  'NEW_ACCOUNT_LARGE_SELL',
  'SAME_IP_OPPONENTS',
  'MANUAL',
] as const;
export type FraudFlagType = (typeof FRAUD_FLAG_TYPES)[number];

export const FRAUD_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type FraudSeverity = (typeof FRAUD_SEVERITIES)[number];

export const FRAUD_FLAG_STATUSES = ['OPEN', 'REVIEWED', 'DISMISSED', 'CONFIRMED'] as const;
export type FraudFlagStatus = (typeof FRAUD_FLAG_STATUSES)[number];

export const LOGIN_EVENT_TYPES = ['REGISTER', 'LOGIN', 'AUTH_FAILED', 'ADMIN_ACCESS_DENIED', 'BLOCKED_STATUS'] as const;
export type LoginEventType = (typeof LOGIN_EVENT_TYPES)[number];

export const NOTIFICATION_TYPES = [
  // player
  'BUY_REQUEST_RECEIVED',
  'BUY_APPROVED',
  'BUY_REJECTED',
  'TOKENS_CREDITED',
  'SELL_SUBMITTED',
  'SELL_APPROVED',
  'SELL_REJECTED',
  'PAYMENT_PROCESSING',
  'PAYMENT_SENT',
  'SELL_COMPLETED',
  'MATCH_OPPONENT_FOUND',
  'MATCH_RESULT',
  'MATCH_REMATCH',
  'REFUND',
  'ADMIN_MESSAGE',
  'ACCOUNT_STATUS',
  'TOKENS_GRANTED',
  'DISPUTE_UPDATE',
  'TRANSFER_RECEIVED',
  'CRYPTO_WITHDRAWAL',
  'CRYPTO_DEPOSIT',
  'TOURNAMENT_PRIZE',
  'CREATOR_REWARD',
  'ADMIN_CRYPTO_WITHDRAWAL',
  // admin
  'ADMIN_NEW_BUY_REQUEST',
  'ADMIN_NEW_SELL_REQUEST',
  'ADMIN_LARGE_TRANSACTION',
  'ADMIN_FINANCE_CHAT',
  'ADMIN_NEW_DISPUTE',
  'ADMIN_FRAUD_FLAG',
  'ADMIN_STUCK_MATCH',
  'ADMIN_PLAYER_MESSAGE',
  'ADMIN_CREATOR_SUBMISSION',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const GAME_KINDS = ['ROOM', 'CRASH'] as const;
/** ROOM = player-vs-player match in a GameRoom; CRASH = house-banked crash game (Aviator). */
export type GameKind = (typeof GAME_KINDS)[number];

export const CRASH_BET_STATUSES = ['ACTIVE', 'CASHED_OUT', 'LOST', 'REFUNDED'] as const;
export type CrashBetStatus = (typeof CRASH_BET_STATUSES)[number];
