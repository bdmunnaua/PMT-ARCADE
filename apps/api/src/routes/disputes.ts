import { Hono, type MiddlewareHandler } from 'hono';
import { paginationSchema } from '@arena/shared';
import type { AppEnv } from '../env';
import { ok, param, parseQuery } from '../lib/http';
import { requireUser } from '../middleware';

export function disputeRoutes(auth: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  r.use('*', auth, requireUser);
  r.get('/', async (c) => {
    const q = parseQuery(c, paginationSchema);
    return ok(c, { ...(await c.get('services').disputes.listForOwner(c.get('user').id, q.page, q.pageSize)), page: q.page, pageSize: q.pageSize });
  });
  r.get('/:id', async (c) => ok(c, await c.get('services').disputes.getForOwner(c.get('user').id, param(c, 'id'))));
  return r;
}
