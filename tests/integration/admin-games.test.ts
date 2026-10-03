import { describe, expect, it } from 'vitest';
import { createHarness } from '../helpers/harness';

/** Game registry edits: the built-in games store their picture as a site path. */
describe('admin game registry', () => {
  it('saves a game whose picture is a path on this site (e.g. /games/aviator.svg)', async () => {
    const h = await createHarness();
    const admin = await h.admin('SUPER_ADMIN', 'root');
    const r = await h.call('PATCH', '/api/admin/games/game-04', { token: admin.token, body: { changes: { thumbnailUrl: '/games/aviator.svg', enabled: true }, reason: 'Turn on Aviator' } });
    expect(r.status).toBe(200);
    const bad = await h.call('PATCH', '/api/admin/games/game-04', { token: admin.token, body: { changes: { thumbnailUrl: 'javascript:alert(1)' }, reason: 'bad picture' } });
    expect(bad.status).toBe(400);
  });
});
