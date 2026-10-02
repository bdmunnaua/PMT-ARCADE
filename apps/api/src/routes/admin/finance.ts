import { Hono } from 'hono';
import { z } from 'zod';
import {
  adjustmentSchema,
  bankrollTransferSchema,
  reserveMovementSchema,
  rewardsPoolTransferSchema,
  publicWalletSchema,
  cryptoRejectSchema,
  buyListQuerySchema,
  chatMessageSchema,
  distributeSchema,
  issuanceSchema,
  ledgerQuerySchema,
  paginationSchema,
  paymentSentSchema,
  rejectSchema,
  sellListQuerySchema,
  type FinanceRequestKind,
} from '@arena/shared';
import type { AppEnv } from '../../env';
import { notFound } from '../../lib/errors';
import { ok, param, parseBody, parseQuery, type Ctx } from '../../lib/http';
import { idempotency, rateLimit, requireAdmin } from '../../middleware';

const notesSchema = z.object({ notes: z.string().trim().max(2000) });
const openFlag = z.object({ open: z.enum(['1', '0']).optional() });

export function adminFinanceRoutes() {
  const r = new Hono<AppEnv>();
  const financeAction = rateLimit('admin_finance');

  r.get('/finance/overview', requireAdmin('finance.view'), async (c) => {
    const services = c.get('services');
    const dash = await services.admin.dashboard();
    return ok(c, dash.finance);
  });

  // ---------------------------------------------------------------- buy requests
  r.get('/buy-requests', requireAdmin('finance.view', 'finance.buy.manage'), async (c) => {
    const q = parseQuery(c, buyListQuerySchema.extend(openFlag.shape));
    const page = await c.get('services').buys.adminList(c.get('admin'), { ...q, open: q.open === '1' });
    return ok(c, { ...page, page: q.page, pageSize: q.pageSize });
  });
  r.get('/buy-requests/:id', requireAdmin('finance.view', 'finance.buy.manage'), async (c) => {
    const services = c.get('services');
    const admin = c.get('admin');
    const request = await services.buys.adminGet(admin, param(c, 'id'));
    const row = await services.finance.findBuy(request.id);
    const context = await services.admin.financeContext(admin, request.player.id, row?.sender_number);
    return ok(c, { request, context });
  });
  r.post('/buy-requests/:id/review', requireAdmin('finance.buy.manage'), financeAction, async (c) => {
    const s = c.get('services');
    return ok(c, await s.buys.startReview(c.get('admin'), param(c, 'id'), s.audit));
  });
  r.post('/buy-requests/:id/approve', requireAdmin('finance.buy.manage'), financeAction, async (c) => {
    const s = c.get('services');
    return ok(c, await s.buys.approve(c.get('admin'), param(c, 'id'), s.audit));
  });
  r.post('/buy-requests/:id/reject', requireAdmin('finance.buy.manage'), financeAction, async (c) => {
    const body = await parseBody(c, rejectSchema);
    const s = c.get('services');
    return ok(c, await s.buys.reject(c.get('admin'), param(c, 'id'), body.reason, s.audit));
  });
  r.post('/buy-requests/:id/notes', requireAdmin('finance.buy.manage'), async (c) => {
    const body = await parseBody(c, notesSchema);
    const s = c.get('services');
    return ok(c, await s.buys.setNotes(c.get('admin'), param(c, 'id'), body.notes, s.audit));
  });

  // ---------------------------------------------------------------- sell requests
  r.get('/sell-requests', requireAdmin('finance.view', 'finance.sell.manage'), async (c) => {
    const q = parseQuery(c, sellListQuerySchema.extend(openFlag.shape));
    const page = await c.get('services').sells.adminList(c.get('admin'), { ...q, open: q.open === '1' });
    return ok(c, { ...page, page: q.page, pageSize: q.pageSize });
  });
  r.get('/sell-requests/:id', requireAdmin('finance.view', 'finance.sell.manage'), async (c) => {
    const services = c.get('services');
    const admin = c.get('admin');
    const request = await services.sells.adminGet(admin, param(c, 'id'));
    const context = await services.admin.financeContext(admin, request.player.id);
    return ok(c, { request, context });
  });
  r.post('/sell-requests/:id/review', requireAdmin('finance.sell.manage'), financeAction, async (c) => {
    const s = c.get('services');
    return ok(c, await s.sells.startReview(c.get('admin'), param(c, 'id'), s.audit));
  });
  r.post('/sell-requests/:id/approve', requireAdmin('finance.sell.manage'), financeAction, async (c) => {
    const s = c.get('services');
    return ok(c, await s.sells.approve(c.get('admin'), param(c, 'id'), s.audit));
  });
  r.post('/sell-requests/:id/reject', requireAdmin('finance.sell.manage'), financeAction, async (c) => {
    const body = await parseBody(c, rejectSchema);
    const s = c.get('services');
    return ok(c, await s.sells.reject(c.get('admin'), param(c, 'id'), body.reason, s.audit));
  });
  r.post('/sell-requests/:id/payment-sent', requireAdmin('finance.sell.manage'), financeAction, async (c) => {
    const body = await parseBody(c, paymentSentSchema);
    const s = c.get('services');
    return ok(c, await s.sells.confirmPaymentSent(c.get('admin'), param(c, 'id'), body, s.audit));
  });
  r.post('/sell-requests/:id/notes', requireAdmin('finance.sell.manage'), async (c) => {
    const body = await parseBody(c, notesSchema);
    const s = c.get('services');
    return ok(c, await s.sells.setNotes(c.get('admin'), param(c, 'id'), body.notes, s.audit));
  });

  // ---------------------------------------------------------------- finance chat (admin side)
  const kinds: [string, FinanceRequestKind][] = [
    ['buy-requests', 'BUY'],
    ['sell-requests', 'SELL'],
  ];
  for (const [path, kind] of kinds) {
    const viewer = (c: Ctx) => ({ side: 'ADMIN' as const, userId: c.get('admin').userId });
    r.get(`/${path}/:id/messages`, requireAdmin('finance.chat', 'finance.view'), async (c) => ok(c, await c.get('services').chat.list(kind, param(c, 'id'), viewer(c))));
    r.post(`/${path}/:id/messages`, requireAdmin('finance.chat'), rateLimit('chat_message'), async (c) => {
      const body = await parseBody(c, chatMessageSchema);
      return ok(c, await c.get('services').chat.send(kind, param(c, 'id'), viewer(c), body.message), 201);
    });
    r.post(`/${path}/:id/messages/read`, requireAdmin('finance.chat'), async (c) => {
      await c.get('services').chat.markRead(kind, param(c, 'id'), viewer(c));
      return ok(c, { ok: true });
    });
  }

  // ---------------------------------------------------------------- token movements
  r.post('/tokens/distribute', requireAdmin('finance.distribute'), financeAction, idempotency, async (c) => {
    const body = await parseBody(c, distributeSchema);
    const s = c.get('services');
    const admin = c.get('admin');
    return ok(c, await s.treasury.grant(admin, { ...body, idempotencyKey: `grant:${admin.userId}:${c.get('idempotencyKey')}` }, s.audit));
  });

  r.post('/treasury/issue', requireAdmin('finance.treasury'), financeAction, idempotency, async (c) => {
    const body = await parseBody(c, issuanceSchema);
    const s = c.get('services');
    return ok(c, await s.treasury.issue(c.get('admin'), body.amountUnits, body.reason, c.get('idempotencyKey'), s.audit));
  });

  r.post('/adjustments', requireAdmin('finance.treasury'), financeAction, idempotency, async (c) => {
    const body = await parseBody(c, adjustmentSchema);
    const s = c.get('services');
    return ok(c, await s.treasury.adjust(c.get('admin'), { ...body, clientKey: c.get('idempotencyKey') }, s.audit));
  });

  // ---------------------------------------------------------------- ledger & system wallets
  r.get('/ledger', requireAdmin('finance.ledger.view'), async (c) => {
    const q = parseQuery(c, ledgerQuerySchema);
    const s = c.get('services');
    let userId: string | undefined;
    if (q.playerNumber) {
      const u = await s.users.findByPlayerNumber(q.playerNumber);
      if (!u) throw notFound('Player');
      userId = u.id;
    }
    return ok(c, { ...(await s.ledgerRead.adminTransactions({ ...q, userId })), page: q.page, pageSize: q.pageSize });
  });
  r.get('/ledger/:id', requireAdmin('finance.ledger.view'), async (c) => {
    const tx = await c.get('services').ledgerRead.adminTransaction(param(c, 'id'));
    if (!tx) throw notFound('Transaction');
    return ok(c, tx);
  });

  /** Read-only reconciliation. Never modifies balances. */
  r.post('/ledger/integrity', requireAdmin('finance.integrity'), async (c) => {
    const s = c.get('services');
    const report = await s.integrity.run();
    await s.audit.log({ adminUserId: c.get('admin').userId, action: 'ledger.integrity_check', entityType: 'ledger', after: { status: report.status, issues: report.issues.length } });
    return ok(c, report);
  });

  for (const [path, account] of [
    ['treasury', 'ADMIN_TREASURY'],
    ['platform-fees', 'PLATFORM_FEES'],
  ] as const) {
    r.get(`/${path}`, requireAdmin('finance.view'), async (c) => {
      const q = parseQuery(c, paginationSchema);
      const s = c.get('services');
      const [balanceUnits, entries, issued] = await Promise.all([
        s.wallets.getSystemBalance(account),
        s.ledgerRead.systemEntries(account, q.page, q.pageSize),
        account === 'ADMIN_TREASURY' ? s.wallets.getSystemBalance('ISSUANCE') : Promise.resolve(0),
      ]);
      return ok(c, { account, balanceUnits, issuedUnits: account === 'ADMIN_TREASURY' ? -issued : undefined, entries: entries.items, hasMore: entries.hasMore, page: q.page, pageSize: q.pageSize });
    });
  }

  // ---------------------------------------------------------------- house bankroll (Aviator)
  // ---- PMT withdrawals to crypto wallets (BNB Chain)
  r.get('/crypto/withdrawals', requireAdmin('finance.view', 'finance.sell.manage'), async (c) => ok(c, await c.get('services').onchain.adminList(c.req.query('status') || null)));
  r.get('/crypto/hot-wallet', requireAdmin('finance.view'), async (c) => ok(c, await c.get('services').onchain.hotWallet()));
  r.post('/crypto/withdrawals/:id/pay', requireAdmin('finance.sell.manage'), financeAction, async (c) => {
    const s = c.get('services');
    return ok(c, await s.onchain.pay(c.get('admin'), param(c, 'id'), s.audit));
  });
  r.post('/crypto/withdrawals/:id/reject', requireAdmin('finance.sell.manage'), financeAction, async (c) => {
    const { reason } = await parseBody(c, cryptoRejectSchema);
    const s = c.get('services');
    return ok(c, await s.onchain.reject(c.get('admin'), param(c, 'id'), reason, s.audit));
  });

  // ---- rewards pool (free games, check-ins, referrals)
  r.get('/rewards-pool', requireAdmin('finance.view'), async (c) => {
    const q = parseQuery(c, paginationSchema);
    const s = c.get('services');
    const [summary, entries] = await Promise.all([s.arcade.pool(), s.ledgerRead.systemEntries('REWARDS_POOL', q.page, q.pageSize)]);
    return ok(c, { ...summary, ...entries });
  });
  r.post('/rewards-pool/transfer', requireAdmin('finance.treasury'), financeAction, idempotency, async (c) => {
    const body = await parseBody(c, rewardsPoolTransferSchema);
    const s = c.get('services');
    return ok(c, await s.treasury.transferRewardsPool(c.get('admin'), { ...body, clientKey: c.get('idempotencyKey') }, s.audit));
  });

  // ---- wallets published on the transparency page
  r.get('/public-wallets', requireAdmin('finance.view'), async (c) => ok(c, await c.get('services').transparency.wallets(true)));
  r.post('/public-wallets', requireAdmin('finance.treasury'), financeAction, async (c) => {
    const body = await parseBody(c, publicWalletSchema);
    const s = c.get('services');
    return ok(c, await s.transparency.addWallet(c.get('admin').userId, body, s.audit));
  });
  r.delete('/public-wallets/:id', requireAdmin('finance.treasury'), financeAction, async (c) => {
    const s = c.get('services');
    await s.transparency.removeWallet(c.get('admin').userId, param(c, 'id'), s.audit);
    return ok(c, { removed: true });
  });

  // ---- taka reserve behind PMT sell-backs, and the price ladder
  r.get('/reserve', requireAdmin('finance.view'), async (c) => ok(c, await c.get('services').reserve.status()));
  r.post('/reserve/move', requireAdmin('finance.treasury'), financeAction, idempotency, async (c) => {
    const body = await parseBody(c, reserveMovementSchema);
    const s = c.get('services');
    return ok(c, await s.reserve.move(c.get('admin'), body, c.get('idempotencyKey'), s.audit));
  });

  r.get('/house-bankroll', requireAdmin('finance.view'), async (c) => {
    const q = parseQuery(c, paginationSchema);
    const s = c.get('services');
    const [summary, entries] = await Promise.all([s.crash.bankroll(), s.ledgerRead.systemEntries('HOUSE_BANKROLL', q.page, q.pageSize)]);
    return ok(c, { ...summary, entries: entries.items, hasMore: entries.hasMore, page: q.page, pageSize: q.pageSize });
  });
  r.post('/house-bankroll/transfer', requireAdmin('finance.treasury'), financeAction, idempotency, async (c) => {
    const body = await parseBody(c, bankrollTransferSchema);
    const s = c.get('services');
    return ok(c, await s.treasury.transferBankroll(c.get('admin'), { ...body, clientKey: c.get('idempotencyKey') }, s.audit));
  });

  return r;
}
