export const PLAYER_NUMBER_START = 100001;
export const GAME_SLOT_COUNT = 10;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const MAX_ACTIVE_MATCHES_PER_PLAYER = 3;
/** live games that have a 🤖 bot player */
export const BOT_MODULE_KEYS = ['ludo', 'call-bridge', 'twenty-nine', 'carrom', 'chess'] as const;
/** a quick-match room with no opponent after this long gets a 🤖 bot (bot games only) */
export const QUICK_MATCH_BOT_AFTER_MS = 25_000;
export const MAX_SUPPORTED_PLAYERS_PER_MATCH = 16;

/** Matches waiting this long for opponents are cancelled and refunded by the cron job. */
export const WAITING_MATCH_TTL_MS = 30 * 60 * 1000;
/** READY matches that never start are cancelled and refunded after this long. */
export const READY_MATCH_TTL_MS = 10 * 60 * 1000;
/** PLAYING matches older than this raise an admin alert (never auto-settled). */
export const STUCK_MATCH_ALERT_MS = 6 * 60 * 60 * 1000;

/** Players may open a dispute up to this long after a match ends. */
export const DISPUTE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const REALTIME_TICKET_TTL_MS = 60 * 1000;
export const INTERNAL_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

export const CHAT_MESSAGE_MAX_LENGTH = 2000;

/** Fraud heuristics (signals only — never automatic bans). */
export const FRAUD_RULES = {
  sharedSenderAccountsThreshold: 3, // same sender number used by this many distinct accounts
  purchaseVelocityPerDay: 5, // buy requests in 24h
  newAccountAgeMs: 3 * 24 * 60 * 60 * 1000, // accounts younger than this selling large amounts
  newAccountLargeSellTokens: 10_000,
} as const;

export interface RateLimitRule {
  limit: number;
  windowSec: number;
}

/** Default rate limits per user (or per IP when anonymous). Override with RATE_LIMIT_OVERRIDES. */
export const DEFAULT_RATE_LIMITS = {
  auth_session: { limit: 20, windowSec: 60 },
  buy_create: { limit: 5, windowSec: 3600 },
  sell_create: { limit: 5, windowSec: 3600 },
  transfer_create: { limit: 20, windowSec: 3600 },
  player_message: { limit: 5, windowSec: 3600 },
  creator_submit: { limit: 5, windowSec: 3600 },
  arcade_run: { limit: 150, windowSec: 3600 },
  arcade_checkin: { limit: 10, windowSec: 3600 },
  crypto_action: { limit: 10, windowSec: 3600 },
  chat_message: { limit: 20, windowSec: 60 },
  match_create: { limit: 20, windowSec: 600 },
  match_join: { limit: 40, windowSec: 600 },
  dispute_create: { limit: 5, windowSec: 3600 },
  admin_finance: { limit: 60, windowSec: 60 },
  realtime_ticket: { limit: 120, windowSec: 60 },
  voice_ice: { limit: 60, windowSec: 600 },
  voice_report: { limit: 30, windowSec: 600 },
  crash_bet: { limit: 30, windowSec: 60 },
  crash_cashout: { limit: 60, windowSec: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof DEFAULT_RATE_LIMITS;

export const LOGIN_EVENT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
