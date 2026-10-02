import { Hono, type MiddlewareHandler } from 'hono';
import { buyListQuerySchema, chatMessageSchema, createBuyRequestSchema, createSellRequestSchema, createTransferSchema, cryptoAddressSchema, cryptoDepositSchema, cryptoWithdrawSchema, sellListQuerySchema, type FinanceRequestKind } from '@arena/shared';
import type { AppEnv } from '../env';
import { AppError } from '../lib/errors';
import { ok, param, parseBody, parseQuery, type Ctx } from '../lib/http';
import { idempotency, rateLimit, requireUser } from '../middleware';

export function walletRoutes(auth: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  r.use('*', auth, requireUser);

  // ---- buy requests
  r.post('/buy-requests', rateLimit('buy_create'), idempotency, async (c) => {
    const input = await parseBody(c, createBuyRequestSchema);
    const res = await c.get('services').buys.create(c.get('user'), input, c.get('idempotencyKey'));
    return ok(c, res, res.replayed ? 200 : 201);
  });
  r.get('/buy-requests', async (c) => {
    const q = parseQuery(c, buyListQuerySchema);
    return ok(c, { ...(await c.get('services').buys.listForOwner(c.get('user').id, q)), page: q.page, pageSize: q.pageSize });
  });
  r.get('/buy-requests/:id', async (c) => ok(c, await c.get('services').buys.getForOwner(c.get('user').id, param(c, 'id'))));
  r.post('/buy-requests/:id/cancel', async (c) => ok(c, await c.get('services').buys.cancel(c.get('user'), param(c, 'id'))));

  // ---- sell requests
  r.post('/sell-requests', rateLimit('sell_create'), idempotency, async (c) => {
    const input = await parseBody(c, createSellRequestSchema);
    const res = await c.get('services').sells.create(c.get('user'), input, c.get('idempotencyKey'));
    return ok(c, res, res.replayed ? 200 : 201);
  });
  r.get('/sell-requests', async (c) => {
    const q = parseQuery(c, sellListQuerySchema);
    return ok(c, { ...(await c.get('services').sells.listForOwner(c.get('user').id, q)), page: q.page, pageSize: q.pageSize });
  });
  r.get('/sell-requests/:id', async (c) => ok(c, await c.get('services').sells.getForOwner(c.get('user').id, param(c, 'id'))));
  r.post('/sell-requests/:id/cancel', async (c) => ok(c, await c.get('services').sells.cancel(c.get('user'), param(c, 'id'))));

  // ---- PMT on BNB Chain
  r.get('/crypto', async (c) => ok(c, await c.get('services').onchain.status(c.get('user'))));
  r.post('/crypto/address', rateLimit('crypto_action'), async (c) => {
    const { address } = await parseBody(c, cryptoAddressSchema);
    return ok(c, await c.get('services').onchain.setAddress(c.get('user'), address));
  });
  r.post('/crypto/withdrawals', rateLimit('crypto_action'), idempotency, async (c) => {
    const { amountUnits } = await parseBody(c, cryptoWithdrawSchema);
    const res = await c.get('services').onchain.withdraw(c.get('user'), amountUnits, c.get('idempotencyKey'));
    return ok(c, res, res.replayed ? 200 : 201);
  });
  r.post('/crypto/deposits', rateLimit('crypto_action'), async (c) => {
    const { txHash } = await parseBody(c, cryptoDepositSchema);
    return ok(c, await c.get('services').onchain.deposit(c.get('user'), txHash), 201);
  });

  // ---- PMT transfers to other players
  r.get('/transfers/recipient/:playerNumber', async (c) => {
    const n = Number(param(c, 'playerNumber'));
    if (!Number.isInteger(n) || n <= 0) throw new AppError('VALIDATION_ERROR', 'Enter a player number.');
    return ok(c, await c.get('services').transfers.recipient(n));
  });
  r.post('/transfers', rateLimit('transfer_create'), idempotency, async (c) => {
    const input = await parseBody(c, createTransferSchema);
    const res = await c.get('services').transfers.send(c.get('user'), input, c.get('idempotencyKey'));
    return ok(c, res, res.replayed ? 200 : 201);
  });

  // ---- finance chat (player side)
  const kinds: [string, FinanceRequestKind][] = [
    ['buy-requests', 'BUY'],
    ['sell-requests', 'SELL'],
  ];
  for (const [path, kind] of kinds) {
    const viewer = (c: Ctx) => ({ side: 'PLAYER' as const, userId: c.get('user').id });
    r.get(`/${path}/:id/messages`, async (c) => ok(c, await c.get('services').chat.list(kind, param(c, 'id'), viewer(c))));
    r.post(`/${path}/:id/messages`, rateLimit('chat_message'), async (c) => {
      const input = await parseBody(c, chatMessageSchema);
      return ok(c, await c.get('services').chat.send(kind, param(c, 'id'), viewer(c), input.message), 201);
    });
    r.post(`/${path}/:id/messages/read`, async (c) => {
      await c.get('services').chat.markRead(kind, param(c, 'id'), viewer(c));
      return ok(c, { ok: true });
    });
  }

  return r;
}
