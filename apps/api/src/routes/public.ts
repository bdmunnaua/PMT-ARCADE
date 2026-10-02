import { Hono } from 'hono';
import { PAYMENT_PROVIDERS, paginationSchema, type PublicConfigDto } from '@arena/shared';
import type { AppEnv } from '../env';
import { ok, param, parseQuery } from '../lib/http';

export function publicRoutes() {
  const r = new Hono<AppEnv>();

  r.get('/health', (c) => ok(c, { status: 'ok', environment: c.env.ENVIRONMENT, time: Date.now() }));

  /** Public, non-sensitive configuration for the web client. */
  r.get('/config', async (c) => {
    const services = c.get('services');
    const s = await services.settings.get();
    const dto: PublicConfigDto = {
      platformName: s.platform_name,
      environment: c.env.ENVIRONMENT,
      isProduction: services.production,
      devToolsEnabled: !services.production,
      maintenanceMode: s.maintenance_mode,
      matchFeeBps: s.MATCH_FEE_BPS,
      buyTokensPerBdt: s.BUY_TOKENS_PER_BDT,
      sellTokensPerBdt: s.SELL_TOKENS_PER_BDT,
      minimumBuyBdt: s.minimum_buy_bdt,
      maximumBuyBdt: s.maximum_buy_bdt,
      minimumSellTokens: s.minimum_sell_tokens,
      maximumSellTokens: s.maximum_sell_tokens,
      minimumMatchStake: s.minimum_match_stake,
      maximumMatchStake: s.maximum_match_stake,
      buyRequestsEnabled: s.buy_requests_enabled,
      sellRequestsEnabled: s.sell_requests_enabled,
      gamesEnabled: s.games_enabled,
      paymentMethods: s.enabled_payment_methods.map((id) => {
        const p = PAYMENT_PROVIDERS[id];
        return { id, label: p.label, accountLabel: p.accountLabel, referenceLabel: p.referenceLabel };
      }),
      bkashReceivingNumber: s.bkash_receiving_number,
      paymentNotice: s.payment_provider_notice,
      transfersEnabled: s.transfers_enabled,
      transferFeeBps: s.transfer_fee_bps,
      minimumTransferTokens: s.minimum_transfer_tokens,
      dailyTransferLimitTokens: s.daily_transfer_limit_tokens,
    };
    return ok(c, dto);
  });

  /** Aggregate figures for the public transparency page (no personal data). */
  r.get('/transparency', async (c) => {
    c.header('Cache-Control', 'public, max-age=60');
    return ok(c, await c.get('services').transparency.get());
  });

  r.get('/games', async (c) => ok(c, await c.get('services').games.list()));
  r.get('/games/:id', async (c) => ok(c, await c.get('services').games.get(param(c, 'id'))));

  r.get('/leaderboard', async (c) => {
    const q = parseQuery(c, paginationSchema);
    return ok(c, { ...(await c.get('services').players.leaderboard(q.page, q.pageSize)), page: q.page, pageSize: q.pageSize });
  });

  return r;
}
