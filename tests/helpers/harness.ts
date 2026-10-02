import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { MeDto, WalletDto } from '@arena/shared';
import { createApp } from '../../apps/api/src/app';
import { createFirebaseVerifier } from '../../apps/api/src/auth/verifier';
import type { Env } from '../../apps/api/src/env';
import { NoopPublisher } from '../../apps/api/src/realtime/publisher';
import { createServices } from '../../apps/api/src/services/container';
import type { ChainClient } from '../../apps/api/src/services/chain';
import { createTestDatabase, type TestD1 } from './d1';

export const PROJECT_ID = 'arena-test-project';

/**
 * The tests check money mechanics with small, easy numbers (110/120 TOKEN per ৳, stakes from 10),
 * independent of the live price stage seeded by the migrations (1,000 PMT = ৳1). Aviator is
 * switched off at launch in the seed data, so the tests switch it on.
 */
function applyTestEconomy(db: TestD1): void {
  const set: Record<string, number> = {
    BUY_TOKENS_PER_BDT: 110,
    SELL_TOKENS_PER_BDT: 120,
    minimum_buy_bdt: 50,
    minimum_sell_tokens: 1_200,
    maximum_sell_tokens: 1_200_000,
    minimum_match_stake: 10,
    maximum_match_stake: 100_000,
    large_transaction_tokens: 100_000,
    crash_max_profit_tokens: 100_000,
  };
  for (const [k, v] of Object.entries(set)) db.exec(`UPDATE platform_settings SET value = '${v}' WHERE key = '${k}'`);
  db.exec("UPDATE games SET minimum_stake_units = 1000, maximum_stake_units = 1000000 WHERE minimum_stake_units > 0");
  db.exec("UPDATE games SET enabled = 1 WHERE id = 'game-04'");
  // test players are funded by admin grants, not bKash purchases, so there is no taka reserve;
  // the reserve rules have their own tests (tests/integration/reserve.test.ts)
  db.exec("UPDATE platform_settings SET value = 'false' WHERE key = 'reserve_guard_enabled'");
}

export interface CallResult<T = any> {
  status: number;
  body: { success: boolean; data: T; error?: { code: string; message: string; details?: unknown }; requestId: string };
}

export interface TestPlayer {
  token: string;
  uid: string;
  me: MeDto;
  id: string;
  playerNumber: number;
}

export async function createHarness(opts: { environment?: string; devAuth?: boolean; gameModules?: Record<string, any>; chain?: (env: Env) => ChainClient } = {}) {
  const db: TestD1 = createTestDatabase();
  applyTestEconomy(db);
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const verifier = createFirebaseVerifier(PROJECT_ID, createLocalJWKSet({ keys: [jwk] }));
  const clock = { offset: 0 };
  const now = () => Date.now() + clock.offset;
  const publisher = new NoopPublisher();
  const app = createApp({ verifier, publisher: () => publisher, now, gameModules: opts.gameModules, chain: opts.chain });
  const env: Env = {
    DB: db as unknown as D1Database,
    ENVIRONMENT: opts.environment ?? 'test',
    DEV_AUTH: opts.devAuth ? 'true' : undefined,
    FIREBASE_PROJECT_ID: PROJECT_ID,
    ALLOWED_ORIGINS: 'http://localhost:5173',
    REALTIME_TICKET_SECRET: 'test-realtime-secret-0123456789abcdef',
    INTERNAL_API_SECRET: 'test-internal-secret-0123456789abcdef0123456789',
  };

  async function token(uid: string, claims: { email?: string | null; name?: string; emailVerified?: boolean; audience?: string; issuer?: string; expiresIn?: string } = {}) {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({ ...(claims.email === null ? {} : { email: claims.email ?? `${uid}@example.test` }), ...(claims.name ? { name: claims.name } : {}), email_verified: claims.emailVerified ?? true, auth_time: nowSec, firebase: { sign_in_provider: 'password' } })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(claims.issuer ?? `https://securetoken.google.com/${PROJECT_ID}`)
      .setAudience(claims.audience ?? PROJECT_ID)
      .setSubject(uid)
      .setIssuedAt(nowSec)
      .setExpirationTime(claims.expiresIn ?? '1h')
      .sign(privateKey);
  }

  async function call<T = any>(method: string, path: string, o: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<CallResult<T>> {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    const res = await app.request(path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }, env);
    return { status: res.status, body: (await res.json()) as CallResult<T>['body'] };
  }

  let counter = 0;
  async function player(username?: string): Promise<TestPlayer> {
    counter += 1;
    const name = username ?? `player${counter}`;
    const uid = `uid-${name}`;
    const t = await token(uid, { email: `${name}@example.test` });
    const res = await call<MeDto>('POST', '/api/auth/session', { token: t });
    if (res.status !== 201) throw new Error(`first session failed: ${JSON.stringify(res.body)}`);
    if (res.body.data.username !== name) throw new Error(`expected username ${name}, got ${res.body.data.username}`);
    return { token: t, uid, me: res.body.data, id: res.body.data.id, playerNumber: res.body.data.playerNumber };
  }

  /** Test fixture: grants a role directly (production uses scripts/create-super-admin.mjs). */
  async function admin(role = 'SUPER_ADMIN', username?: string): Promise<TestPlayer> {
    const p = await player(username ?? `admin_${role.toLowerCase().slice(0, 8)}_${counter + 1}`);
    await db.prepare('INSERT INTO admin_users (user_id, role_id, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').bind(p.id, role, Date.now(), Date.now()).run();
    return p;
  }

  function services() {
    return createServices(env, { requestId: 'test', ip: '127.0.0.1', userAgent: 'vitest', country: null }, { publisher, now, gameModules: opts.gameModules, chain: opts.chain });
  }

  async function wallet(t: string): Promise<WalletDto> {
    const r = await call<WalletDto>('GET', '/api/me/wallet', { token: t });
    return r.body.data;
  }

  async function systemBalance(id: 'sys_admin_treasury' | 'sys_platform_fees' | 'sys_issuance'): Promise<number> {
    return (await db.prepare('SELECT balance FROM wallet_accounts WHERE id = ?').bind(id).first<number>('balance')) ?? 0;
  }

  async function issue(superAdmin: TestPlayer, units: number) {
    const r = await call('POST', '/api/admin/treasury/issue', { token: superAdmin.token, body: { amountUnits: units, reason: 'test funding' }, headers: { 'idempotency-key': `issue-${crypto.randomUUID()}` } });
    if (r.status !== 200) throw new Error(`issue failed ${JSON.stringify(r.body)}`);
  }

  /** Issues treasury supply and grants `units` AVAILABLE tokens to a player through the real API. */
  async function fund(superAdmin: TestPlayer, target: TestPlayer, units: number) {
    await issue(superAdmin, units);
    const grant = await call('POST', '/api/admin/tokens/distribute', {
      token: superAdmin.token,
      body: { playerNumber: target.playerNumber, amountUnits: units, type: 'MANUAL_GRANT', reason: 'test funding' },
      headers: { 'idempotency-key': `grant-${crypto.randomUUID()}` },
    });
    if (grant.status !== 200) throw new Error(`grant failed ${JSON.stringify(grant.body)}`);
  }

  async function enableGame(gameId = 'game-06') {
    await db.prepare('UPDATE games SET enabled = 1 WHERE id = ?').bind(gameId).run();
  }

  async function integrity() {
    return services().integrity.run();
  }

  return { db, env, app, call, token, player, admin, services, wallet, systemBalance, issue, fund, enableGame, integrity, publisher, clock };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;

export const TOKENS = (n: number) => n * 100;
