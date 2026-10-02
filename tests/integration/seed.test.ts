import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain JavaScript module shared with the seed CLI
import { buildSeedSql } from '../../scripts/seed-sql.mjs';
import { createHarness } from '../helpers/harness';

describe('development seed', () => {
  it('loads cleanly and passes the full ledger integrity check', async () => {
    const h = await createHarness();
    const sql = (buildSeedSql as (now?: number) => string[])().join('\n');
    h.db.sqlite.exec(`BEGIN; ${sql} COMMIT;`);
    const report = await h.integrity();
    expect(report.issues).toEqual([]);
    expect(report.status).toBe('PASS');
    const players = await h.db.prepare('SELECT COUNT(*) AS n FROM player_profiles').first<number>('n');
    expect(players).toBe(6);
    const games = await h.db.prepare('SELECT COUNT(*) AS n FROM games').first<number>('n');
    expect(games).toBe(10);
    // seeding twice is refused by the guard statement
    expect(() => h.db.sqlite.exec(sql)).toThrow(/BATCH_ASSERTION_FAILED/);
  });
});
