import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { ERROR_MESSAGES, type GameModule } from '@arena/shared';
import { isProduction, type AppEnv, type Env } from './env';
import { createDevVerifier, createFirebaseVerifier, DEV_TOKEN_PREFIX, devAuthEnabled, type TokenVerifier } from './auth/verifier';
import { AppError } from './lib/errors';
import { DbError } from './lib/db';
import { authenticate } from './middleware';
import { DurableObjectPublisher, NoopPublisher, type RealtimePublisher } from './realtime/publisher';
import { createServices, type ContainerOptions } from './services/container';
import { publicRoutes } from './routes/public';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { matchRoutes } from './routes/matches';
import { walletRoutes } from './routes/wallet';
import { disputeRoutes } from './routes/disputes';
import { realtimeRoutes } from './routes/realtime';
import { adminRoutes } from './routes/admin';
import { internalRoutes } from './routes/internal';
import { devRoutes } from './routes/dev';
import { crashRoutes } from './routes/crash';
import { arcadeRoutes } from './routes/arcade';

export interface AppDeps {
  /** Override token verification (tests use a locally generated key pair). */
  verifier?: TokenVerifier;
  publisher?: (env: Env, waitUntil: (p: Promise<unknown>) => void) => RealtimePublisher;
  now?: () => number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gameModules?: Record<string, GameModule<any>>;
  chain?: ContainerOptions['chain'];
}

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<AppEnv>();
  const verifiers = new Map<string, TokenVerifier>();
  const devVerifier = createDevVerifier();
  const getVerifier = (env: Env, token: string): TokenVerifier => {
    if (token.startsWith(DEV_TOKEN_PREFIX) && devAuthEnabled(env) && !isProduction(env)) return devVerifier;
    if (deps.verifier) return deps.verifier;
    let v = verifiers.get(env.FIREBASE_PROJECT_ID);
    if (!v) {
      v = createFirebaseVerifier(env.FIREBASE_PROJECT_ID);
      verifiers.set(env.FIREBASE_PROJECT_ID, v);
    }
    return v;
  };

  const context: MiddlewareHandler<AppEnv> = async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    const meta = {
      requestId,
      ip: c.req.header('cf-connecting-ip') ?? null,
      userAgent: c.req.header('user-agent') ?? null,
      country: c.req.header('cf-ipcountry') ?? null,
    };
    c.set('meta', meta);
    const waitUntil = (p: Promise<unknown>) => {
      try {
        c.executionCtx.waitUntil(p);
      } catch {
        void p; // no execution context (tests) — the promise still runs
      }
    };
    const publisher = deps.publisher ? deps.publisher(c.env, waitUntil) : c.env.REALTIME ? new DurableObjectPublisher(c.env.REALTIME, waitUntil) : new NoopPublisher();
    c.set('services', createServices(c.env, meta, { publisher, now: deps.now, gameModules: deps.gameModules, chain: deps.chain }));
    await next();
    c.header('X-Request-Id', requestId);
  };

  app.use('*', context);
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      crossOriginResourcePolicy: 'same-site',
      referrerPolicy: 'no-referrer',
      strictTransportSecurity: 'max-age=63072000; includeSubDomains',
    }),
  );
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });
  app.use(
    '/api/*',
    cors({
      origin: (origin, c) => (allowedOrigins(c.env as Env).includes(origin) ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
      credentials: false,
    }),
  );

  app.onError((err, c) => {
    const requestId = c.get('requestId') ?? 'unknown';
    if (err instanceof AppError) {
      if (err.status >= 500) console.error(JSON.stringify({ level: 'error', requestId, code: err.code, message: err.message }));
      return c.json({ success: false as const, error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) }, requestId }, err.status as 400);
    }
    const prod = isProduction(c.env);
    console.error(
      JSON.stringify({ level: 'error', requestId, kind: err instanceof DbError ? `db:${err.kind}` : err.name, message: err.message, stack: prod ? undefined : err.stack }),
    );
    return c.json(
      {
        success: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: ERROR_MESSAGES.INTERNAL_ERROR, ...(prod ? {} : { details: { message: err.message } }) },
        requestId,
      },
      500,
    );
  });
  app.notFound((c) => c.json({ success: false as const, error: { code: 'NOT_FOUND' as const, message: ERROR_MESSAGES.NOT_FOUND }, requestId: c.get('requestId') }, 404));

  const auth = authenticate(getVerifier);
  app.route('/api', publicRoutes());
  app.route('/api/auth', authRoutes(auth));
  app.route('/api', meRoutes(auth));
  app.route('/api/matches', matchRoutes(auth));
  app.route('/api/wallet', walletRoutes(auth));
  app.route('/api/disputes', disputeRoutes(auth));
  app.route('/api/crash', crashRoutes(auth));
  app.route('/api/arcade', arcadeRoutes(auth));
  app.route('/api', realtimeRoutes(auth));
  app.route('/api/admin', adminRoutes(auth));
  app.route('/internal', internalRoutes());
  app.route('/api/dev', devRoutes(auth));
  return app;
}
