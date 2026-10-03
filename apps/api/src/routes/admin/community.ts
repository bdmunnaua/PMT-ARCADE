import { Hono } from 'hono';
import { z } from 'zod';
import { creatorRejectSchema, creatorReviewSchema, messageReplySchema, messageStatusSchema, paginationSchema } from '@arena/shared';
import type { AppEnv } from '../../env';
import { ok, param, parseBody, parseQuery } from '../../lib/http';
import { rateLimit, requireAdmin } from '../../middleware';

const messageQuery = paginationSchema.extend({ status: z.enum(['NEW', 'READ', 'REPLIED', 'CLOSED']).optional() });
const creatorQuery = paginationSchema.extend({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() });

/** Player messages (advice, requests) and creator-reward submissions. */
export function adminCommunityRoutes() {
  const r = new Hono<AppEnv>();
  const action = rateLimit('admin_finance');

  r.get('/messages', requireAdmin('support.view'), async (c) => {
    const q = parseQuery(c, messageQuery);
    return ok(c, { ...(await c.get('services').inbox.adminList(q.status, q.page, q.pageSize)), page: q.page, pageSize: q.pageSize });
  });
  r.post('/messages/:id/reply', requireAdmin('support.view'), action, async (c) => {
    const { reply } = await parseBody(c, messageReplySchema);
    const s = c.get('services');
    return ok(c, await s.inbox.reply(c.get('admin').userId, param(c, 'id'), reply, s.audit));
  });
  r.post('/messages/:id/status', requireAdmin('support.view'), action, async (c) => {
    const { status } = await parseBody(c, messageStatusSchema);
    const s = c.get('services');
    return ok(c, await s.inbox.setStatus(c.get('admin').userId, param(c, 'id'), status, s.audit));
  });

  r.get('/creators', requireAdmin('support.view'), async (c) => {
    const q = parseQuery(c, creatorQuery);
    return ok(c, { ...(await c.get('services').creators.adminList(q.status, q.page, q.pageSize)), page: q.page, pageSize: q.pageSize });
  });
  // paying a reward moves PMT, so it needs the token-distribution permission
  r.post('/creators/:id/approve', requireAdmin('finance.distribute'), action, async (c) => {
    const { note } = await parseBody(c, creatorReviewSchema);
    const s = c.get('services');
    return ok(c, await s.creators.approve(c.get('admin').userId, param(c, 'id'), note, s.audit));
  });
  r.post('/creators/:id/reject', requireAdmin('support.view'), action, async (c) => {
    const { note } = await parseBody(c, creatorRejectSchema);
    const s = c.get('services');
    return ok(c, await s.creators.reject(c.get('admin').userId, param(c, 'id'), note, s.audit));
  });
  return r;
}
