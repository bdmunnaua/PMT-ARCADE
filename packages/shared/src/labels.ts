import type { BuyStatus, DisputeCategory, DisputeResolution, PlayerTxCategory, SellStatus } from './enums';
import type { MatchStatus } from './match-state';

export const BUY_STATUS_LABELS: Record<BuyStatus, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  TOKEN_CREDITED: 'Tokens credited',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const SELL_STATUS_LABELS: Record<SellStatus, string> = {
  SUBMITTED: 'Submitted',
  TOKENS_LOCKED: 'Tokens locked',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  PAYMENT_PROCESSING: 'Payment processing',
  PAYMENT_SENT: 'Payment sent',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  TOKENS_UNLOCKED: 'Rejected — tokens returned',
  CANCELLED: 'Cancelled — tokens returned',
};

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  CREATED: 'Created',
  WAITING_FOR_OPPONENT: 'Waiting for opponent',
  STAKE_LOCKING: 'Locking stakes',
  READY: 'Ready',
  PLAYING: 'Playing',
  RESULT_PENDING: 'Result pending',
  SETTLING: 'Settling',
  SETTLED: 'Settled',
  DRAW: 'Draw — refunded',
  CANCELLED: 'Cancelled — refunded',
  VOID: 'Void — refunded',
  REFUNDED: 'Refunded',
  DISPUTED: 'Disputed',
};

export const TX_CATEGORY_LABELS: Record<PlayerTxCategory, string> = {
  BUY: 'Token purchase',
  SELL: 'Token sale',
  GAME_STAKE: 'Game stake',
  GAME_WIN: 'Game win',
  GAME_LOSS: 'Game loss',
  GAME_REFUND: 'Game refund',
  ADMIN_GRANT: 'Admin grant',
  BONUS: 'Bonus',
  FREE_GAME: 'Free game reward',
  TRANSFER: 'Transfer',
  CRYPTO: 'Crypto wallet',
  ADJUSTMENT: 'Adjustment',
};

export const DISPUTE_CATEGORY_LABELS: Record<DisputeCategory, string> = {
  CONNECTION_PROBLEM: 'Connection problem',
  INCORRECT_RESULT: 'Incorrect result',
  SUSPECTED_CHEATING: 'Suspected cheating',
  SETTLEMENT_PROBLEM: 'Settlement problem',
  OTHER: 'Other',
};

export const DISPUTE_RESOLUTION_LABELS: Record<DisputeResolution, string> = {
  UPHOLD_RESULT: 'Result upheld',
  SETTLE_WINNER: 'Settled for a winner',
  SETTLE_DRAW: 'Settled as a draw',
  VOID_REFUND: 'Voided and refunded',
  COMPENSATE: 'Compensation granted',
  REJECT: 'Complaint rejected',
};
