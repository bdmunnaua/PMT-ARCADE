import { Hono } from 'hono';
import { z } from 'zod';
import { auditQuerySchema, FRAUD_FLAG_STATUSES, fraudFlagUpdateSchema, LOGIN_EVENT_TYPES, paginationSchema } from '@arena/shared';
import type { AppEnv } from '../../env';
import { ok, param, parseBody, parseQuery } from '../../lib/http';
import { requireAdmin } from '../../middleware';

export function adminSecurityRoutes() {
  const r = new Hono<AppEnv>();

  r.get('/fraud-flags', requireAdmin('risk.view'), async (c) => {
    const q = parseQuery(c, paginationSchema.extend({ status: z.enum(FRAUD_FLAG_STATUSES).optional() }));
    return ok(c, { ...(await c.get('services').fraud.list(q)), page: q.page, pageSize: q.pageSize });
  });
  r.post('/fraud-flags/:id/status', requireAdmin('risk.manage'), async (c) => {
    const body = await parseBody(c, fraudFlagUpdateSchema);
    const s = c.get('services');
    return ok(c, await s.fraud.updateStatus(param(c, 'id'), body.status, body.note, c.get('admin').userId, s.audit));
  });

  r.get('/login-activity', requireAdmin('security.login_activity'), async (c) => {
    const q = parseQuery(c, paginationSchema.extend({ playerNumber: z.coerce.number().int().positive().optional(), type: z.enum(LOGIN_EVENT_TYPES).optional() }));
    return ok(c, { ...(await c.get('services').admin.loginActivity(q)), page: q.page, pageSize: q.pageSize });
  });

  r.get('/audit', requireAdmin('audit.view'), async (c) => {
    const q = parseQuery(c, auditQuerySchema);
    return ok(c, { ...(await c.get('services').audit.list(q)), page: q.page, pageSize: q.pageSize });
  });

  return r;
}
