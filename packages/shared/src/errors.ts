export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  INVALID_TOKEN: 401,
  EMAIL_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  ACCOUNT_RESTRICTED: 403,
  ACCOUNT_SUSPENDED: 403,
  ACCOUNT_BANNED: 403,
  PROFILE_REQUIRED: 404,
  NOT_FOUND: 404,
  CONFLICT: 409,
  USERNAME_TAKEN: 409,
  ALREADY_PROCESSED: 409,
  INVALID_STATE_TRANSITION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  DUPLICATE_PAYMENT_REFERENCE: 409,
  MATCH_FULL: 409,
  ALREADY_IN_MATCH: 409,
  TOO_MANY_ACTIVE_MATCHES: 409,
  INSUFFICIENT_BALANCE: 422,
  TREASURY_INSUFFICIENT: 422,
  AMOUNT_OUT_OF_RANGE: 422,
  STAKE_OUT_OF_RANGE: 422,
  UNSAFE_CONFIGURATION: 422,
  GAME_UNAVAILABLE: 422,
  GAME_MODULE_MISSING: 422,
  BANKROLL_LIMIT: 422,
  RESERVE_LIMIT: 422,
  REWARDS_PAUSED: 422,
  PAYOUT_FAILED: 502,
  ROUND_CLOSED: 409,
  CASHOUT_TOO_LATE: 409,
  FEATURE_DISABLED: 403,
  MAINTENANCE_MODE: 503,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Some fields are invalid.',
  BAD_REQUEST: 'The request could not be processed.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  INVALID_TOKEN: 'Your session is invalid or has expired. Please sign in again.',
  EMAIL_NOT_VERIFIED: 'Please verify your email address first.',
  FORBIDDEN: 'You do not have permission to do that.',
  ACCOUNT_RESTRICTED: 'Your account is restricted. Contact support.',
  ACCOUNT_SUSPENDED: 'Your account is suspended. Contact support.',
  ACCOUNT_BANNED: 'Your account has been banned.',
  PROFILE_REQUIRED: 'Finish creating your player profile first.',
  NOT_FOUND: 'Not found.',
  CONFLICT: 'This conflicts with the current state. Refresh and try again.',
  USERNAME_TAKEN: 'That username is already taken.',
  ALREADY_PROCESSED: 'This has already been processed.',
  INVALID_STATE_TRANSITION: 'That action is not allowed in the current state.',
  IDEMPOTENCY_CONFLICT: 'This request key was already used for a different request.',
  DUPLICATE_PAYMENT_REFERENCE: 'This payment reference has already been submitted.',
  MATCH_FULL: 'This match is already full.',
  ALREADY_IN_MATCH: 'You are already in this match.',
  TOO_MANY_ACTIVE_MATCHES: 'You have too many active matches.',
  INSUFFICIENT_BALANCE: 'Insufficient available token balance.',
  TREASURY_INSUFFICIENT: 'The admin treasury does not hold enough tokens. Issue treasury tokens first.',
  AMOUNT_OUT_OF_RANGE: 'The amount is outside the allowed range.',
  STAKE_OUT_OF_RANGE: 'The stake is outside the allowed range.',
  UNSAFE_CONFIGURATION: 'This configuration is unsafe and was refused.',
  GAME_UNAVAILABLE: 'This game is not available right now.',
  GAME_MODULE_MISSING: 'This game has no installed game module yet.',
  BANKROLL_LIMIT: 'The house cannot cover this bet right now. Try a smaller amount.',
  RESERVE_LIMIT: 'Selling is paused for now: the platform reserve is busy with other sell-backs. Please try a smaller amount or try again later.',
  REWARDS_PAUSED: 'Free rewards are paused right now. Please try again later.',
  PAYOUT_FAILED: 'The blockchain payout did not go through. Please try again later.',
  ROUND_CLOSED: 'Betting is closed for this round. Wait for the next one.',
  CASHOUT_TOO_LATE: 'Too late — the plane already flew away.',
  FEATURE_DISABLED: 'This feature is currently disabled.',
  MAINTENANCE_MODE: 'The platform is under maintenance. Please try again later.',
  RATE_LIMITED: 'Too many requests. Please slow down and try again shortly.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
};

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  requestId: string;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
