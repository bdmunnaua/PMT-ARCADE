import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { matchListQuerySchema, paginationSchema, transactionQuerySchema, updateProfileSchema } from '@arena/shared';
import type { AppEnv } from '../env';
import { ok, param, parseBody, parseQuery } from '../lib/http';
import { requireUser } from '../middleware';

const markReadSchema = z.object({ ids: z.array(z.string().max(64)).max(100).optional(), all: z.boolean().optional() });

export function meRoutes(auth: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  r.use('/me', auth, requireUser);
  r.use('/me/*', auth, requireUser);
  r.use('/notifications', auth, requireUser);
  r.use('/notifications/*', auth, requireUser);

  r.get('/me', async (c) => ok(c, await c.get('services').players.me(c.get('user'))));

  r.patch('/me', async (c) => {
    const input = await parseBody(c, updateProfileSchema);
    const services = c.get('services');
    const user = await services.players.updateProfile(c.get('user'), input);
    return ok(c, await services.players.me(user));
  });

  r.get('/me/wallet', async (c) => ok(c, await c.get('services').wallets.getWallet(c.get('user').id)));

  r.get('/me/transactions', async (c) => {
    const q = parseQuery(c, transactionQuerySchema);
    const page = await c.get('services').players.transactions(c.get('user').id, q);
    return ok(c, { ...page, page: q.page, pageSize: q.pageSize });
  });

  r.get('/me/transactions/:id', async (c) => ok(c, await c.get('services').players.transactionDetail(c.get('user').id, param(c, 'id'))));

  r.get('/me/matches', async (c) => {
    const q = parseQuery(c, matchListQuerySchema);
    const page = await c.get('services').matches.listMine(c.get('user').id, q);
    return ok(c, { ...page, page: q.page, pageSize: q.pageSize });
  });

  r.get('/notifications', async (c) => {
    const q = parseQuery(c, paginationSchema.extend({ unread: z.enum(['1', '0']).optional() }));
    const page = await c.get('services').notifications.list(c.get('user').id, 'PLAYER', q.page, q.pageSize, q.unread === '1');
    return ok(c, { ...page, page: q.page, pageSize: q.pageSize });
  });

  r.get('/notifications/unread-count', async (c) => {
    const services = c.get('services');
    const user = c.get('user');
    const [player, admin] = await Promise.all([services.notifications.unreadCount(user.id, 'PLAYER'), services.notifications.unreadCount(user.id, 'ADMIN')]);
    return ok(c, { player, admin });
  });

  r.post('/notifications/read', async (c) => {
    const input = await parseBody(c, markReadSchema);
    await c.get('services').notifications.markRead(c.get('user').id, 'PLAYER', input.all ? 'all' : (input.ids ?? []));
    return ok(c, { ok: true });
  });

  return r;
}
