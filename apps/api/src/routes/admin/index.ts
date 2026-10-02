import { Hono, type MiddlewareHandler } from 'hono';
import type { AdminDashboardDto } from '@arena/shared';
import { first } from '../../lib/db';
import type { AppEnv } from '../../env';
import { ok } from '../../lib/http';
import { requireAdmin, requireUser } from '../../middleware';
import { adminFinanceRoutes } from './finance';
import { adminGameRoutes } from './games';
import { adminPlayerRoutes } from './players';
import { adminSecurityRoutes } from './security';
import { adminSystemRoutes } from './system';

/**
 * /api/admin — every route requires a verified identity, an ACTIVE account, an active admin role
 * and (per route) a specific permission read from the database. Hiding buttons in the UI is never
 * the protection.
 */
export function adminRoutes(auth: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  r.use('*', auth, requireUser, requireAdmin());

  r.get('/me', (c) => ok(c, c.get('admin')));
  r.get('/dashboard', async (c) => {
    const s = c.get('services');
    const since = Date.now() - 86_400_000;
    const [base, reserve, pool, games, crypto] = await Promise.all([
      s.admin.dashboard(),
      s.reserve.status(),
      s.arcade.pool(),
      first<{ plays: number; players: number; rewards: number }>(
        c.env.DB,
        'SELECT COUNT(*) AS plays, COUNT(DISTINCT user_id) AS players, COALESCE(SUM(reward_units), 0) AS rewards FROM arcade_runs WHERE started_at >= ?',
        since,
      ),
      first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM onchain_withdrawals WHERE status IN ('PENDING', 'FAILED')"),
    ]);
    const dto: AdminDashboardDto = {
      ...base,
      reserve: { reservePoisha: reserve.reservePoisha, coverageBps: reserve.coverageBps, safeToWithdrawPoisha: reserve.safeToWithdrawPoisha, stagePriceBdt: reserve.stage.priceBdt },
      freeGames: { plays24h: games?.plays ?? 0, players24h: games?.players ?? 0, rewards24hUnits: games?.rewards ?? 0, poolUnits: pool.balanceUnits },
      crypto: { pendingWithdrawals: crypto?.n ?? 0 },
    };
    return ok(c, dto);
  });

  r.route('/', adminPlayerRoutes());
  r.route('/', adminGameRoutes());
  r.route('/', adminFinanceRoutes());
  r.route('/', adminSecurityRoutes());
  r.route('/', adminSystemRoutes());
  return r;
}
