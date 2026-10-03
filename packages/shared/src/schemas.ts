import { z } from 'zod';
import {
  ACCOUNT_STATUSES,
  BUY_STATUSES,
  DISPUTE_CATEGORIES,
  DISPUTE_RESOLUTIONS,
  DISPUTE_STATUSES,
  FRAUD_FLAG_STATUSES,
  GRANT_TYPES,
  LEDGER_TX_TYPES,
  MATCH_VISIBILITIES,
  PAYMENT_METHODS,
  PLAYER_TX_CATEGORIES,
  SELL_STATUSES,
} from './enums';
import { ADMIN_ROLES } from './permissions';
import { CHAT_MESSAGE_MAX_LENGTH, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SUPPORTED_PLAYERS_PER_MATCH } from './constants';
import { MATCH_STATUSES } from './match-state';

const units = z.int().positive().max(Number.MAX_SAFE_INTEGER);
const reason = z.string().trim().min(3, 'Please give a reason (at least 3 characters).').max(500);
const note = z.string().trim().max(500).optional();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

const dateParam = z.coerce.number().int().positive().optional();

// ---------- auth / profile ----------
export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    avatarUrl: z.union([z.url({ protocol: /^https$/ }).max(500), z.literal('')]).optional(),
  })
  .strict();

// ---------- matches ----------
export const createMatchSchema = z.object({
  gameId: z.string().min(1).max(64),
  stakeUnits: units,
  visibility: z.enum(MATCH_VISIBILITIES).default('PUBLIC'),
  maxPlayers: z.int().min(2).max(MAX_SUPPORTED_PLAYERS_PER_MATCH).optional(),
});

export const quickMatchSchema = z.object({
  gameId: z.string().min(1).max(64),
  stakeUnits: units,
});

export const joinByCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6}$/, 'Room codes are 6 letters/numbers.'),
});

export const matchListQuerySchema = paginationSchema.extend({
  status: z.enum(MATCH_STATUSES).optional(),
  gameId: z.string().max(64).optional(),
  live: z.enum(['1', '0']).optional(),
});

export const openMatchesQuerySchema = z.object({ gameId: z.string().max(64).optional() });

// ---------- disputes ----------
export const createDisputeSchema = z.object({
  category: z.enum(DISPUTE_CATEGORIES),
  description: z.string().trim().min(10, 'Describe the problem (at least 10 characters).').max(2000),
});

export const resolveDisputeSchema = z.object({
  resolution: z.enum(DISPUTE_RESOLUTIONS),
  note: reason,
  winnerPlayerNumber: z.int().positive().optional(),
  compensationPlayerNumber: z.int().positive().optional(),
  compensationUnits: units.optional(),
});

export const disputeListQuerySchema = paginationSchema.extend({ status: z.enum(DISPUTE_STATUSES).optional() });

// ---------- buy / sell ----------
export const createBuyRequestSchema = z.object({
  amountPoisha: units,
  paymentMethod: z.enum(PAYMENT_METHODS),
  senderNumber: z.string().trim().min(4).max(40),
  paymentReference: z.string().trim().min(4).max(60),
  note,
});

export const createSellRequestSchema = z.object({
  amountUnits: units,
  paymentMethod: z.enum(PAYMENT_METHODS),
  receivingNumber: z.string().trim().min(4).max(40),
  note,
});

export const buyListQuerySchema = paginationSchema.extend({
  status: z.enum(BUY_STATUSES).optional(),
  q: z.string().trim().max(60).optional(),
});
export const sellListQuerySchema = paginationSchema.extend({
  status: z.enum(SELL_STATUSES).optional(),
  q: z.string().trim().max(60).optional(),
});

export const rejectSchema = z.object({ reason });
export const paymentSentSchema = z.object({
  amountSentPoisha: units,
  outgoingReference: z.string().trim().min(4).max(60),
  note,
});

export const chatMessageSchema = z.object({
  message: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_LENGTH),
});

// ---------- history ----------
export const transactionQuerySchema = paginationSchema.extend({
  category: z.enum(PLAYER_TX_CATEGORIES).optional(),
  from: dateParam,
  to: dateParam,
  gameId: z.string().max(64).optional(),
  txId: z.string().max(64).optional(),
});

export const ledgerQuerySchema = paginationSchema.extend({
  type: z.enum(LEDGER_TX_TYPES).optional(),
  txId: z.string().max(64).optional(),
  playerNumber: z.coerce.number().int().positive().optional(),
  from: dateParam,
  to: dateParam,
});

// ---------- admin ----------
export const distributeSchema = z.object({
  playerNumber: z.int().positive(),
  amountUnits: units,
  type: z.enum(GRANT_TYPES),
  reason,
});

export const issuanceSchema = z.object({ amountUnits: units, reason });

export const adjustmentSchema = z.object({
  playerNumber: z.int().positive(),
  direction: z.enum(['CREDIT', 'DEBIT']),
  amountUnits: units,
  reason,
  relatedTransactionId: z.string().max(64).optional(),
});

export const accountStatusChangeSchema = z.object({
  status: z.enum(ACCOUNT_STATUSES),
  reason,
});

export const playerNoteSchema = z.object({ note: z.string().trim().min(1).max(2000) });

export const adminPlayersQuerySchema = paginationSchema.extend({
  status: z.enum(ACCOUNT_STATUSES).optional(),
  flagged: z.enum(['1', '0']).optional(),
  q: z.string().trim().max(80).optional(),
});

export const gameUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    description: z.string().trim().max(500).optional(),
    thumbnailUrl: z.union([z.url().max(500), z.literal('')]).optional(),
    enabled: z.boolean().optional(),
    maintenanceMode: z.boolean().optional(),
    minimumStakeUnits: units.optional(),
    maximumStakeUnits: units.optional(),
    minimumPlayers: z.int().min(1).max(MAX_SUPPORTED_PLAYERS_PER_MATCH).optional(),
    maximumPlayers: z.int().min(1).max(MAX_SUPPORTED_PLAYERS_PER_MATCH).optional(),
    gameVersion: z.string().trim().min(1).max(30).optional(),
    moduleKey: z.string().trim().max(64).optional(),
  })
  .strict();

export const adminRoleAssignSchema = z.object({
  playerNumber: z.int().positive(),
  role: z.enum(ADMIN_ROLES),
  reason,
});

export const adminUpdateSchema = z.object({
  role: z.enum(ADMIN_ROLES).optional(),
  active: z.boolean().optional(),
  reason,
});

export const fraudFlagUpdateSchema = z.object({
  status: z.enum(FRAUD_FLAG_STATUSES),
  note: reason,
});

export const voidMatchSchema = z.object({ reason });

export const auditQuerySchema = paginationSchema.extend({
  action: z.string().max(80).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  adminUserId: z.string().max(64).optional(),
});

export const realtimeTicketSchema = z.object({
  channel: z.string().min(3).max(120),
});

// ---------- aviator (crash)
export const crashBetSchema = z.object({
  /** bet panel: a player may hold two independent bets per round */
  panel: z.union([z.literal(1), z.literal(2)]).default(1),
  amountUnits: units,
  autoCashoutX100: z.int().min(101).max(1_000_000).optional(),
});

export const crashCashoutSchema = z.object({
  panel: z.union([z.literal(1), z.literal(2)]).default(1),
});

// ---------- free arcade games
export const arcadeRunStartSchema = z.object({ game: z.string().trim().min(1).max(40) });
export const arcadeRunFinishSchema = z.object({
  runId: z.string().trim().min(1).max(64),
  score: z.number().finite().min(0).max(1_000_000_000),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export const arcadeReferralSchema = z.object({ code: z.string().trim().min(4).max(12) });
export const rewardsPoolTransferSchema = z.object({
  direction: z.enum(['TO_POOL', 'FROM_POOL']),
  amountUnits: units,
  reason: z.string().trim().min(3).max(500),
});

// ---------- PMT on BNB Chain
export const cryptoAddressSchema = z.object({ address: z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/, 'Enter a BNB Chain address: 0x followed by 40 characters.') });
export const cryptoWithdrawSchema = z.object({ amountUnits: units });
export const cryptoDepositSchema = z.object({ txHash: z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/, 'Paste the transaction ID: 0x followed by 64 characters.') });
export const cryptoRejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });

/** A message from a player to the team (advice, a request, a problem). */
export const PLAYER_MESSAGE_CATEGORIES = ['ADVICE', 'REQUEST', 'PROBLEM', 'OTHER'] as const;
export const playerMessageSchema = z.object({
  category: z.enum(PLAYER_MESSAGE_CATEGORIES),
  body: z.string().trim().min(5, 'Write at least 5 characters.').max(2000),
});
export const messageReplySchema = z.object({ reply: z.string().trim().min(2).max(2000) });
export const messageStatusSchema = z.object({ status: z.enum(['NEW', 'READ', 'REPLIED', 'CLOSED']) });

/** Creator rewards: an original post about PMT Arcade, submitted for review. */
export const CREATOR_PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'OTHER'] as const;
export const creatorSubmissionSchema = z.object({
  platform: z.enum(CREATOR_PLATFORMS),
  postUrl: z.url({ protocol: /^https$/ }).max(500),
  socialHandle: z.string().trim().min(2).max(80),
});
export const creatorReviewSchema = z.object({ note: z.string().trim().max(500).optional() });
export const creatorRejectSchema = z.object({ note: z.string().trim().min(3).max(500) });

/** A wallet published on the transparency page (supply, allocation share, liquidity, payout). */
export const publicWalletSchema = z.object({
  label: z.string().trim().min(2).max(60),
  address: z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/, 'A BNB Chain address (0x + 40 characters).'),
  purpose: z.string().trim().max(200).default(''),
  plannedTokens: z.int().min(0).max(10_000_000_000).nullable().default(null),
  sort: z.int().min(0).max(1000).default(100),
});

export const createTransferSchema = z.object({
  toPlayerNumber: z.int().positive(),
  amountUnits: units,
  note: z.string().trim().max(140).optional(),
});

export const reserveMovementSchema = z.object({
  direction: z.enum(['WITHDRAW', 'DEPOSIT']),
  amountPoisha: z.int().positive().max(1_000_000_000_000),
  reason: z.string().trim().min(3).max(500),
});

export const bankrollTransferSchema = z.object({
  direction: z.enum(['TO_BANKROLL', 'FROM_BANKROLL']),
  amountUnits: units,
  reason,
});

// ---------- dev simulator (never mounted in production) ----------
export const devCreateMatchSchema = z.object({
  gameId: z.string().min(1).max(64),
  stakeUnits: units,
  playerNumbers: z.array(z.int().positive()).min(2).max(MAX_SUPPORTED_PLAYERS_PER_MATCH),
});

export const devSimulateSchema = z.object({
  outcome: z.enum(['WIN', 'DRAW', 'CANCEL', 'VOID', 'FORFEIT']),
  winnerPlayerNumber: z.int().positive().optional(),
  forfeitPlayerNumber: z.int().positive().optional(),
});
