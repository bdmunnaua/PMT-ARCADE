/**
 * API contracts shared by the Worker and the web client.
 * Amount fields ending in `Units` are integer TOKEN_UNITS (1 TOKEN = 100 units);
 * fields ending in `Poisha` are integer poisha (৳1 = 100 poisha). Timestamps are epoch milliseconds.
 */
import type {
  AccountStatus,
  BuyStatus,
  DisputeCategory,
  DisputeResolution,
  DisputeStatus,
  FinanceRequestKind,
  FraudFlagStatus,
  FraudFlagType,
  FraudSeverity,
  GrantType,
  LedgerTxType,
  LoginEventType,
  MatchMode,
  MatchPlayerResult,
  MatchVisibility,
  NotificationType,
  PaymentMethod,
  GameKind,
  PlayerBucket,
  PlayerTxCategory,
  PostingType,
  SellStatus,
  SenderType,
} from './enums';
import type { MatchStatus } from './match-state';
import type { AdminRole, Permission } from './permissions';
import type { PlatformSettings } from './settings';

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface PublicConfigDto {
  platformName: string;
  environment: string;
  isProduction: boolean;
  devToolsEnabled: boolean;
  maintenanceMode: boolean;
  matchFeeBps: number;
  buyTokensPerBdt: number;
  sellTokensPerBdt: number;
  minimumBuyBdt: number;
  maximumBuyBdt: number;
  minimumSellTokens: number;
  maximumSellTokens: number;
  minimumMatchStake: number;
  maximumMatchStake: number;
  buyRequestsEnabled: boolean;
  sellRequestsEnabled: boolean;
  gamesEnabled: boolean;
  paymentMethods: { id: PaymentMethod; label: string; accountLabel: string; referenceLabel: string }[];
  bkashReceivingNumber: string;
  paymentNotice: string;
  transfersEnabled: boolean;
  transferFeeBps: number;
  minimumTransferTokens: number;
  dailyTransferLimitTokens: number;
}

export interface PlayerStatsDto {
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  /** basis points, 10000 = 100% */
  winRateBps: number;
  totalStakedUnits: number;
  totalWonUnits: number;
}

export interface AdminIdentityDto {
  role: AdminRole;
  permissions: Permission[];
}

export interface MeDto {
  id: string;
  playerNumber: number;
  username: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  avatarUrl: string | null;
  accountStatus: AccountStatus;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  stats: PlayerStatsDto;
  admin: AdminIdentityDto | null;
}

export interface WalletDto {
  availableUnits: number;
  lockedGameUnits: number;
  lockedSellUnits: number;
  bonusUnits: number;
  totalUnits: number;
}

export type BucketEffects = Partial<Record<PlayerBucket, number>>;

export interface PlayerTransactionDto {
  id: string;
  type: LedgerTxType;
  category: PlayerTxCategory;
  status: 'COMPLETED';
  createdAt: number;
  referenceType: string | null;
  referenceId: string | null;
  referenceLabel: string | null;
  gameId: string | null;
  effects: BucketEffects;
  /** change of the player's total (available + locked + bonus) */
  netUnits: number;
  description: string;
}

export interface PlayerTransactionDetailDto extends PlayerTransactionDto {
  entries: { bucket: PlayerBucket; amountUnits: number; balanceAfterUnits: number; postingType: PostingType }[];
  match: { id: string; matchNumber: number; gameName: string; status: MatchStatus } | null;
  buyRequest: BuyRequestDto | null;
  sellRequest: SellRequestDto | null;
}

export interface GameDto {
  id: string;
  slug: string;
  name: string;
  description: string;
  thumbnailUrl: string | null;
  enabled: boolean;
  maintenanceMode: boolean;
  minimumStakeUnits: number;
  maximumStakeUnits: number;
  minimumPlayers: number;
  maximumPlayers: number;
  gameVersion: string;
  moduleKey: string | null;
  kind: GameKind;
  moduleInstalled: boolean;
  playable: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface MatchPlayerDto {
  playerNumber: number;
  username: string;
  displayName: string;
  seat: number;
  isYou: boolean;
  result: MatchPlayerResult | null;
  payoutUnits: number | null;
}

export interface MatchDto {
  id: string;
  matchNumber: number;
  gameId: string;
  gameName: string;
  status: MatchStatus;
  mode: MatchMode;
  visibility: MatchVisibility;
  joinCode: string | null;
  stakeUnits: number;
  potUnits: number;
  feeBps: number;
  feeUnits: number | null;
  payoutUnits: number | null;
  minPlayers: number;
  maxPlayers: number;
  playerCount: number;
  players: MatchPlayerDto[];
  winnerPlayerNumber: number | null;
  resultType: string | null;
  isCreator: boolean;
  isParticipant: boolean;
  myResult: MatchPlayerResult | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface RequestEventDto {
  status: string;
  note: string | null;
  actorType: SenderType;
  createdAt: number;
}

export interface BuyRequestDto {
  id: string;
  requestNumber: number;
  status: BuyStatus;
  amountPoisha: number;
  tokenUnits: number;
  rateTokensPerBdt: number;
  paymentMethod: PaymentMethod;
  senderNumber: string;
  paymentReference: string;
  note: string | null;
  rejectionReason: string | null;
  ledgerTxId: string | null;
  createdAt: number;
  updatedAt: number;
  reviewedAt: number | null;
  completedAt: number | null;
  unreadMessages: number;
  events: RequestEventDto[];
}

export interface SellPaymentDto {
  amountSentPoisha: number;
  outgoingReference: string;
  note: string | null;
  sentAt: number;
}

export interface SellRequestDto {
  id: string;
  requestNumber: number;
  status: SellStatus;
  amountUnits: number;
  bdtPoisha: number;
  rateTokensPerBdt: number;
  paymentMethod: PaymentMethod;
  receivingNumber: string;
  note: string | null;
  rejectionReason: string | null;
  payment: SellPaymentDto | null;
  ledgerTxId: string | null;
  createdAt: number;
  updatedAt: number;
  reviewedAt: number | null;
  completedAt: number | null;
  unreadMessages: number;
  events: RequestEventDto[];
}

export interface ChatMessageDto {
  id: string;
  requestKind: FinanceRequestKind;
  requestId: string;
  senderType: SenderType;
  senderLabel: string;
  isMine: boolean;
  message: string;
  createdAt: number;
  readAt: number | null;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: number | null;
  createdAt: number;
}

export interface LeaderboardEntryDto {
  rank: number;
  playerNumber: number;
  username: string;
  displayName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRateBps: number;
}

export interface DisputeDto {
  id: string;
  disputeNumber: number;
  matchId: string;
  matchNumber: number;
  gameName: string;
  category: DisputeCategory;
  description: string;
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  resolutionNote: string | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

// ---------------- admin ----------------

export interface AdminDashboardDto {
  players: { total: number; newToday: number; restricted: number; suspended: number; banned: number };
  finance: {
    pendingBuy: number;
    pendingSell: number;
    treasuryUnits: number;
    platformFeesUnits: number;
    issuedUnits: number;
    houseBankrollUnits: number;
    buyVolume24hPoisha: number;
    sellVolume24hPoisha: number;
  };
  games: { liveMatches: number; waitingMatches: number; openDisputes: number; settled24h: number; fees24hUnits: number };
  risk: { openFlags: number; highFlags: number };
  /** taka reserve behind PMT sell-backs (see ReserveDto) */
  reserve: { reservePoisha: number; coverageBps: number | null; safeToWithdrawPoisha: number; stagePriceBdt: number | null };
  freeGames: { plays24h: number; players24h: number; rewards24hUnits: number; poolUnits: number };
  crypto: { pendingWithdrawals: number };
}

export interface AdminPlayerRowDto {
  id: string;
  playerNumber: number;
  username: string;
  displayName: string;
  email: string | null;
  accountStatus: AccountStatus;
  createdAt: number;
  lastLoginAt: number | null;
  openFlags: number;
  wallet: WalletDto;
}

export interface FraudFlagDto {
  id: string;
  userId: string | null;
  playerNumber: number | null;
  username: string | null;
  type: FraudFlagType;
  severity: FraudSeverity;
  status: FraudFlagStatus;
  details: Record<string, unknown>;
  relatedType: string | null;
  relatedId: string | null;
  createdAt: number;
  reviewedAt: number | null;
  reviewNote: string | null;
}

export interface AdminPlayerDetailDto extends AdminPlayerRowDto {
  emailVerified: boolean;
  avatarUrl: string | null;
  updatedAt: number;
  accountAgeDays: number;
  stats: PlayerStatsDto;
  adminRole: AdminRole | null;
  flags: FraudFlagDto[];
  notes: { id: string; note: string; adminLabel: string; createdAt: number }[];
  recentTransactions: PlayerTransactionDto[];
  recentBuyRequests: AdminBuyRequestDto[];
  recentSellRequests: AdminSellRequestDto[];
  recentMatches: MatchDto[];
}

export interface PlayerSummaryDto {
  id: string;
  playerNumber: number;
  username: string;
  displayName: string;
  accountStatus: AccountStatus;
  createdAt: number;
  accountAgeDays: number;
}

export interface AdminBuyRequestDto extends BuyRequestDto {
  player: PlayerSummaryDto;
  reviewedBy: string | null;
  adminNotes: string | null;
}

export interface AdminSellRequestDto extends SellRequestDto {
  player: PlayerSummaryDto;
  reviewedBy: string | null;
  adminNotes: string | null;
}

export interface AdminFinanceContextDto {
  wallet: WalletDto;
  riskFlags: FraudFlagDto[];
  previousBuys: { count: number; completedCount: number; completedPoisha: number; recent: BuyRequestDto[] };
  previousSells: { count: number; completedCount: number; completedPoisha: number; recent: SellRequestDto[] };
  matchSummary: PlayerStatsDto;
  recentTransactions: PlayerTransactionDto[];
  senderNumberAccountCount?: number;
}

export interface LedgerEntryDto {
  id: string;
  accountId: string;
  accountLabel: string;
  playerNumber: number | null;
  bucket: string;
  amountUnits: number;
  balanceAfterUnits: number;
  postingType: PostingType;
}

export interface LedgerTransactionDto {
  id: string;
  idempotencyKey: string;
  type: LedgerTxType;
  referenceType: string | null;
  referenceId: string | null;
  gameId: string | null;
  createdByType: string;
  createdById: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
  totalUnits: number;
  entries: LedgerEntryDto[];
}

export interface IntegrityIssueDto {
  check: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface IntegrityReportDto {
  status: 'PASS' | 'FAIL';
  checkedAt: number;
  durationMs: number;
  stats: { transactions: number; entries: number; accounts: number; activeHolds: number };
  checks: { name: string; passed: boolean }[];
  issues: IntegrityIssueDto[];
}

export interface SystemWalletDto {
  account: 'ADMIN_TREASURY' | 'PLATFORM_FEES';
  balanceUnits: number;
  issuedUnits?: number;
  entries: SystemWalletEntryDto[];
}

export interface SystemWalletEntryDto extends LedgerEntryDto {
  transactionId: string;
  transactionType: LedgerTxType;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: number;
}

export interface AuditLogDto {
  id: string;
  adminUserId: string | null;
  adminLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: number;
}

export interface LoginEventDto {
  id: string;
  userId: string | null;
  playerNumber: number | null;
  eventType: LoginEventType;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  detail: string | null;
  createdAt: number;
}

export interface AdminUserDto {
  userId: string;
  playerNumber: number;
  username: string;
  email: string | null;
  role: AdminRole;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AdminSettingsDto {
  settings: PlatformSettings;
  warnings: string[];
  isProduction: boolean;
  updatedAt: Record<string, number>;
}

export interface AdminDisputeDto extends DisputeDto {
  player: PlayerSummaryDto;
  match: MatchDto;
  events: { type: string; payload: unknown; createdAt: number }[];
  settlementTxId: string | null;
}

export interface GrantResultDto {
  transactionId: string;
  playerNumber: number;
  amountUnits: number;
  type: GrantType;
  replayed: boolean;
}

// ---------------- aviator (crash) ----------------

export interface CrashRoundDto {
  id: string;
  roundNumber: number;
  phase: 'BETTING' | 'FLYING' | 'CRASHED';
  serverSeedHash: string;
  /** revealed only after the crash */
  serverSeed: string | null;
  /** revealed only after the crash */
  crashX100: number | null;
  bettingEndsAt: number;
  startedAt: number | null;
  crashedAt: number | null;
}

export interface CrashBetDto {
  id: string;
  /** bet panel 1 or 2 */
  panel: 1 | 2;
  roundNumber: number;
  playerNumber: number;
  username: string;
  isYou: boolean;
  stakeUnits: number;
  autoCashoutX100: number | null;
  status: 'ACTIVE' | 'CASHED_OUT' | 'LOST' | 'REFUNDED';
  cashoutX100: number | null;
  payoutUnits: number | null;
  createdAt: number;
}

export interface CrashStateDto {
  gameId: string;
  serverNow: number;
  round: CrashRoundDto | null;
  /** your bets in this round, at most one per panel */
  myBets: CrashBetDto[];
  bets: CrashBetDto[];
  history: { roundNumber: number; crashX100: number }[];
  limits: { minBetUnits: number; maxBetUnits: number; maxX100: number; maxProfitUnits: number };
}

/** Free arcade games (the original pmtarcade.com games). */
export interface ArcadeGameDto {
  id: string;
  name: string;
  genre: string;
  emoji: string;
  tag: string;
  colors: [string, string];
  isNew: boolean;
  /** PMT per score point = 1 / divisor, capped at maxPerRun PMT per game */
  divisor: number;
  maxPerRunTokens: number;
}
export interface ArcadeConfigDto {
  enabled: boolean;
  games: ArcadeGameDto[];
  checkin: number[];
  dailyCapTokens: number;
  welcomeBonusTokens: number;
  referralBonusTokens: number;
  referralWelcomeTokens: number;
  referralUnlockTokens: number;
  /** what the rewards pool still holds — when empty, games pay nothing */
  poolUnits: number;
}
export interface ArcadeMeDto {
  refCode: string;
  refCount: number;
  referred: boolean;
  refPaid: boolean;
  streak: number;
  checkedInToday: boolean;
  nextCheckinTokens: number;
  earnedTodayUnits: number;
  dailyCapUnits: number;
  lifetimeUnits: number;
  bestScores: Record<string, number>;
}
export interface ArcadeRunResultDto {
  rewardUnits: number;
  score: number;
  message: string;
}
export interface ArcadeLeaderboardDto {
  game: string;
  since: number;
  rows: { playerNumber: number; name: string; score: number; isYou?: boolean }[];
}
/** Weekly free-game tournament: best score in the featured game, Monday → Monday (Bangladesh time). */
export interface TournamentRowDto {
  rank: number;
  playerNumber: number;
  name: string;
  score: number;
  /** prize for this place (paid, or what it would pay if the week ended now) */
  prizeUnits: number;
  isYou?: boolean;
}
export interface TournamentWeekDto {
  weekStart: string;
  gameId: string;
  startsAt: number;
  endsAt: number;
}
export interface TournamentDto {
  enabled: boolean;
  current: TournamentWeekDto & { prizesUnits: number[]; players: number; rows: TournamentRowDto[]; you: { rank: number; score: number } | null };
  next: TournamentWeekDto;
  /** the week before: PENDING while late scores can still arrive, then PAID / NO_ENTRIES / OFF */
  last: (TournamentWeekDto & { status: 'PENDING' | 'PAID' | 'NO_ENTRIES' | 'OFF'; rows: TournamentRowDto[] }) | null;
}
export interface RewardsPoolDto {
  balanceUnits: number;
  paidTodayUnits: number;
  paid7dUnits: number;
  plays7d: number;
  players7d: number;
  flagged7d: number;
}

/** PMT on BNB Chain (player view). */
export interface CryptoStatusDto {
  configured: boolean;
  withdrawalsEnabled: boolean;
  depositsEnabled: boolean;
  tokenSymbol: string;
  tokenAddress: string;
  chainName: string;
  explorerTx: string;
  depositAddress: string | null;
  minWithdrawTokens: number;
  withdrawFeeTokens: number;
  minDepositTokens: number;
  confirmations: number;
  myAddress: string | null;
  withdrawals: CryptoWithdrawalDto[];
  deposits: CryptoDepositDto[];
}
export interface CryptoWithdrawalDto {
  id: string;
  playerNumber?: number;
  username?: string;
  address: string;
  amountUnits: number;
  feeUnits: number;
  /** what arrives in the wallet: amount − fee */
  sentUnits: number;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'REJECTED' | 'FAILED';
  txHash: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface CryptoDepositDto {
  id: string;
  txHash: string;
  amountUnits: number;
  createdAt: number;
}
export interface HotWalletDto {
  configured: boolean;
  address: string | null;
  gasBnb: string | null;
  tokenBalance: string | null;
  pendingUnits: number;
  /** set when the configured payout key belongs to a forbidden wallet (the supply wallet) and is refused */
  blockedAddress: string | null;
}

/** A published on-chain wallet with its live PMT balance (whole PMT, as text). */
export interface PublicWalletDto {
  id: string;
  label: string;
  address: string;
  purpose: string;
  plannedTokens: number | null;
  sort: number;
  /** live on-chain PMT balance; null when the chain could not be read */
  balance: string | null;
}

/** Public, aggregate-only figures for the transparency page. No personal data. */
export interface TransparencyDto {
  generatedAt: number;
  token: { symbol: string; address: string; chainName: string; totalSupply: number };
  players: number;
  /** PMT inside the platform, in units (1 PMT = 100 units) */
  inApp: { issuedUnits: number; playersSellableUnits: number; playersBonusUnits: number; rewardsPoolUnits: number; treasuryUnits: number; feesUnits: number };
  reserve: { reservePoisha: number; liabilityPoisha: number; coverageBps: number | null; buyRate: number; sellRate: number };
  /** sum of every ledger balance; 0 means every PMT is accounted for */
  ledgerSum: number;
  lastIntegrityCheck: { status: string; at: number } | null;
  onchain: { withdrawnUnits: number; depositedUnits: number };
  wallets: PublicWalletDto[];
}

/** A PMT transfer between players, as the sender sees it. */
export interface TransferDto {
  id: string;
  toPlayerNumber: number;
  toUsername: string;
  amountUnits: number;
  feeUnits: number;
  /** what the recipient got: amount − fee */
  receivedUnits: number;
  note: string | null;
  createdAt: number;
}

export interface TransferRecipientDto {
  playerNumber: number;
  username: string;
  displayName: string;
}

/** Taka reserve backing PMT sell-backs, and the price ladder (admin → Finance → Reserve & price). */
export interface ReserveDto {
  /** taka received from players' PMT purchases */
  receivedPoisha: number;
  /** taka paid to players for sold PMT */
  paidOutPoisha: number;
  /** owner withdrawals minus owner deposits */
  ownerNetWithdrawnPoisha: number;
  reservePoisha: number;
  /** taka promised to sell requests that are not paid yet */
  pendingSellPoisha: number;
  /** reserve − pending sells: what new sells can use */
  freeReservePoisha: number;
  /** PMT players hold that they could sell (AVAILABLE + staked), in units */
  sellableUnits: number;
  /** taka owed if every sellable PMT were sold back at today's sell rate */
  liabilityPoisha: number;
  coverageBps: number | null;
  /** what the owner can take out as income while still covering 100% of what is owed */
  safeToWithdrawPoisha: number;
  rates: { buy: number; sell: number };
  stage: { index: number; of: number; priceBdt: number | null };
  next: {
    buy: number;
    sell: number;
    priceBdt: number;
    liabilityPoisha: number;
    coverageBps: number | null;
    coverageOk: boolean;
    netBuy30dPoisha: number;
    demandOk: boolean;
    daysSinceChange: number | null;
    timeOk: boolean;
    ready: boolean;
  } | null;
  last30d: { boughtPoisha: number; soldPoisha: number };
  movements: { id: string; kind: 'OWNER_WITHDRAWAL' | 'OWNER_DEPOSIT'; amountPoisha: number; reason: string; createdAt: number }[];
}

export interface HouseBankrollDto {
  balanceUnits: number;
  openExposureUnits: number;
  stats24h: { bets: number; stakedUnits: number; paidUnits: number; houseResultUnits: number };
}
