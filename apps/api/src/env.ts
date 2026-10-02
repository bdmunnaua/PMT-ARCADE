import type { AdminRole, Permission } from '@arena/shared';
import type { Services } from './services/container';
import type { UserRecord } from './repositories/users';
import type { VerifiedIdentity } from './auth/verifier';

/** Worker bindings and variables (see wrangler.jsonc and .dev.vars.example). */
export interface Env {
  DB: D1Database;
  REALTIME?: DurableObjectNamespace;
  GAME_ROOMS?: DurableObjectNamespace;
  CRASH_GAMES?: DurableObjectNamespace;
  ASSETS?: Fetcher;

  ENVIRONMENT: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  ALLOWED_ORIGINS?: string;
  ADMIN_REQUIRE_VERIFIED_EMAIL?: string;
  RATE_LIMIT_OVERRIDES?: string;
  /** "true" enables `dev.<name>` tokens — honoured only when ENVIRONMENT is "development". */
  DEV_AUTH?: string;

  // PMT on BNB Chain (withdrawals / deposits)
  TOKEN_SYMBOL?: string;
  TOKEN_ADDRESS?: string;
  TOKEN_DECIMALS?: string;
  CHAIN_ID?: string;
  CHAIN_NAME?: string;
  RPC_URL?: string;
  EXPLORER_TX?: string;
  /** where players send deposits; defaults to the payout hot wallet's address */
  DEPOSIT_ADDRESS?: string;
  /** comma-separated addresses that must never act as the payout wallet (the main supply wallet) */
  FORBIDDEN_PAYOUT_ADDRESSES?: string;

  // secrets
  /** private key of the SEPARATE payout hot wallet (never the main supply wallet) */
  PAYOUT_PRIVATE_KEY?: string;
  REALTIME_TICKET_SECRET?: string;
  INTERNAL_API_SECRET?: string;
}

export interface AdminContext {
  userId: string;
  role: AdminRole;
  permissions: Permission[];
}

export interface RequestMeta {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  country: string | null;
}

export interface AppVariables {
  requestId: string;
  meta: RequestMeta;
  services: Services;
  identity: VerifiedIdentity;
  user: UserRecord;
  admin: AdminContext;
  idempotencyKey: string;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };

export function isProduction(env: Pick<Env, 'ENVIRONMENT'>): boolean {
  return (env.ENVIRONMENT ?? '').toLowerCase() === 'production';
}
