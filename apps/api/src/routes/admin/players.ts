import { Hono } from 'hono';
import { accountStatusChangeSchema, adminPlayersQuerySchema, playerNoteSchema, transactionQuerySchema } from '@arena/shared';
import type { AppEnv } from '../../env';
import { ok, param, parseBody, parseQuery } from '../../lib/http';
import { requireAdmin } from '../../middleware';

export function adminPlayerRoutes() {
  const r = new Hono<AppEnv>();

  r.get('/players', requireAdmin('players.view'), async (c) => {
    const q = parseQuery(c, adminPlayersQuerySchema);
    const page = await c.get('services').admin.listPlayers(c.get('admin'), { ...q, flagged: q.flagged === '1' });
    return ok(c, { ...page, page: q.page, pageSize: q.pageSize });
  });

  r.get('/players/:id', requireAdmin('players.view'), async (c) => ok(c, await c.get('services').admin.playerDetail(c.get('admin'), param(c, 'id'))));

  r.get('/players/:id/transactions', requireAdmin('players.view'), async (c) => {
    const q = parseQuery(c, transactionQuerySchema);
    const services = c.get('services');
    const user = await services.admin.resolvePlayer(param(c, 'id'));
    return ok(c, { ...(await services.players.transactions(user.id, q)), page: q.page, pageSize: q.pageSize });
  });

  r.post('/players/:id/status', requireAdmin('players.manage'), async (c) => {
    const input = await parseBody(c, accountStatusChangeSchema);
    const services = c.get('services');
    return ok(c, await services.admin.changeStatus(c.get('admin'), param(c, 'id'), input.status, input.reason, services.audit));
  });

  r.post('/players/:id/notes', requireAdmin('support.notes', 'players.manage'), async (c) => {
    const input = await parseBody(c, playerNoteSchema);
    const services = c.get('services');
    await services.admin.addNote(c.get('admin'), param(c, 'id'), input.note, services.audit);
    return ok(c, await services.admin.playerDetail(c.get('admin'), param(c, 'id')), 201);
  });

  return r;
}
