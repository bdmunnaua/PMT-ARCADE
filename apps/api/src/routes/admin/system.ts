import { Hono } from 'hono';
import { z } from 'zod';
import { adminRoleAssignSchema, adminUpdateSchema, paginationSchema, settingsPatchSchema, type AdminSettingsDto } from '@arena/shared';
import type { AppEnv } from '../../env';
import { ok, param, parseBody, parseQuery } from '../../lib/http';
import { requireAdmin } from '../../middleware';

const settingsBody = z.object({ changes: settingsPatchSchema, reason: z.string().trim().min(3).max(500) });
const markRead = z.object({ ids: z.array(z.string().max(64)).max(100).optional(), all: z.boolean().optional() });

export function adminSystemRoutes() {
  const r = new Hono<AppEnv>();

  // ---- admin notifications (every admin sees their own)
  r.get('/notifications', async (c) => {
    const q = parseQuery(c, paginationSchema.extend({ unread: z.enum(['1', '0']).optional() }));
    return ok(c, { ...(await c.get('services').notifications.list(c.get('admin').userId, 'ADMIN', q.page, q.pageSize, q.unread === '1')), page: q.page, pageSize: q.pageSize });
  });
  r.post('/notifications/read', async (c) => {
    const body = await parseBody(c, markRead);
    await c.get('services').notifications.markRead(c.get('admin').userId, 'ADMIN', body.all ? 'all' : (body.ids ?? []));
    return ok(c, { ok: true });
  });

  // ---- administrators
  r.get('/admins', requireAdmin('admins.manage'), async (c) => ok(c, await c.get('services').admin.listAdmins()));
  r.post('/admins', requireAdmin('admins.manage'), async (c) => {
    const body = await parseBody(c, adminRoleAssignSchema);
    const s = c.get('services');
    return ok(c, await s.admin.assignAdmin(c.get('admin'), body.playerNumber, body.role, body.reason, s.audit), 201);
  });
  r.patch('/admins/:userId', requireAdmin('admins.manage'), async (c) => {
    const body = await parseBody(c, adminUpdateSchema);
    const s = c.get('services');
    return ok(c, await s.admin.updateAdmin(c.get('admin'), param(c, 'userId'), body, s.audit));
  });

  // ---- platform settings
  r.get('/settings', requireAdmin('settings.view', 'settings.manage'), async (c) => {
    const s = c.get('services');
    const { settings, updatedAt } = await s.settings.getWithMeta();
    const dto: AdminSettingsDto = { settings, warnings: s.settings.warnings(settings), isProduction: s.production, updatedAt };
    return ok(c, dto);
  });
  r.patch('/settings', requireAdmin('settings.manage'), async (c) => {
    const body = await parseBody(c, settingsBody);
    const s = c.get('services');
    const res = await s.settings.update(body.changes, c.get('admin').userId, body.reason, s.audit);
    const meta = await s.settings.getWithMeta();
    const dto: AdminSettingsDto & { changed: string[] } = { settings: res.settings, warnings: res.warnings, isProduction: s.production, updatedAt: meta.updatedAt, changed: res.changed };
    return ok(c, dto);
  });

  return r;
}
