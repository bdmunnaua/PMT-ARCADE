#!/usr/bin/env node
/**
 * DEVELOPMENT SEED — local database only (refuses --remote).
 *
 * Creates sample data that passes the ledger integrity check:
 *   * 1 sample Super Admin + 5 sample players (placeholder Firebase uids — they cannot sign in;
 *     promote YOUR OWN account with `npm run admin:create`)
 *   * treasury issuance, grants, a completed purchase, pending buy requests,
 *     a pending and a completed sell request, and one settled match (1% fee)
 * The 10 game registry entries already come from migration 0002.
 * No real credentials are included.
 *
 *   npm run db:migrate:local && npm run db:seed:local
 */
import { args, d1 } from './lib.mjs';
import { buildSeedSql } from './seed-sql.mjs';

const a = args();
if (a.remote) {
  console.error('The development seed never runs against a remote database.');
  process.exit(1);
}

const sql = buildSeedSql();

console.log(`Seeding local database (${sql.length} statements)…`);
try {
  d1(sql.join('\n'));
} catch {
  console.error('Seed failed. If it already ran, reset the local database: delete apps/api/.wrangler/state and re-run migrations.');
  process.exit(1);
}
console.log('✔ Development seed loaded: 1 Super Admin (seed_admin), 5 players, 10 games, sample ledger, buy/sell requests and a settled match.');
console.log('  Seed accounts cannot sign in. Sign in with your own Firebase account, then run: npm run admin:create -- --email you@example.com');
