/**
 * Cloudflare Worker entry: REST API (/api/*), internal game-server API (/internal/*),
 * the web app's static assets, Durable Objects and the maintenance cron.
 */
import { LOGIN_EVENT_RETENTION_MS } from '@arena/shared';
import { createApp } from './app';
import type { Env } from './env';
import { run } from './lib/db';
import { DurableObjectPublisher, NoopPublisher } from './realtime/publisher';
import { createServices } from './services/container';

export { RealtimeHub } from './durable/realtime-hub';
export { GameRoom } from './durable/game-room';
export { CrashGame } from './durable/crash-game';

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/') || url.pathname === '/api') {
      return app.fetch(request, env, ctx);
    }
    // everything else is the single-page web app (served from apps/web/dist)
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },

  /** Every 10 minutes: expire stale rooms (refund), alert on stuck matches, purge old counters. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const publisher = env.REALTIME ? new DurableObjectPublisher(env.REALTIME, (p) => ctx.waitUntil(p)) : new NoopPublisher();
    const services = createServices(env, { requestId: `cron-${crypto.randomUUID()}`, ip: null, userAgent: 'cron', country: null }, { publisher });
    const now = Date.now();
    const res = await services.matches.expireStale(now);
    // Aviator rounds that stopped progressing (engine evicted): refund open bets, close the round
    for (const round of await services.crash.staleRounds(now - 10 * 60 * 1000)) {
      for (const bet of await services.crash.activeBets(round.id)) {
        await services.settlement.settleCrashBet(bet.id, { type: 'REFUND', reason: 'Round interrupted' }).catch(() => undefined);
      }
      await services.crash.markCrashed(round.id, now);
    }
    await run(env.DB, 'DELETE FROM rate_limit_counters WHERE window_start < ?', now - 24 * 60 * 60 * 1000);
    await run(env.DB, 'DELETE FROM login_security_events WHERE created_at < ?', now - LOGIN_EVENT_RETENTION_MS);
    if (res.cancelled || res.alerted) console.log(JSON.stringify({ level: 'info', cron: 'matches', ...res }));
  },
} satisfies ExportedHandler<Env>;
