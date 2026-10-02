#!/usr/bin/env node
/**
 * Carries balances from the old pmtarcade.com database into the merged platform.
 *
 *   1. Back up the old database:  npx wrangler d1 export arcade --remote --output backup.sql
 *      (run inside the old pmtarcade/worker folder)
 *   2. npm run arcade:import -- --file backup.sql            (local database)
 *      npm run arcade:import -- --file backup.sql --remote   (production database)
 *
 * Each old account becomes a row in arcade_legacy_accounts, keyed by its Firebase uid. When the
 * player first signs in to the new site, their coins are credited once as bonus PMT
 * (1 coin = 1 PMT) from the rewards pool, and their invite code, streak and lifetime earnings
 * carry over. Banned accounts carry over nothing. Re-running is safe: existing rows are kept.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { args, d1, q } from './lib.mjs';

const a = args();
if (!a.file) {
  console.error('Usage: npm run arcade:import -- --file backup.sql [--remote]');
  process.exit(1);
}

// load the backup into a throw-away in-memory database and read the users from it
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(a.file, 'utf8'));
const users = db.prepare('SELECT uid, email, name, coins, lifetime, ref_code, streak, last_checkin, banned FROM users').all();
if (!users.length) {
  console.error('No users found in the backup.');
  process.exit(1);
}

const rows = users.map((u) => {
  const coins = u.banned ? 0 : Math.max(0, Math.floor(u.coins));
  return `INSERT OR IGNORE INTO arcade_legacy_accounts (firebase_uid, email, name, coins, lifetime, ref_code, streak, last_checkin)
VALUES (${q(u.uid)}, ${q(u.email)}, ${q(u.name)}, ${coins}, ${Math.max(0, Math.floor(u.lifetime))}, ${q(u.ref_code)}, ${u.streak ?? 0}, ${q(u.last_checkin)});`;
});
d1(rows.join('\n'), { remote: !!a.remote });

const total = users.reduce((n, u) => n + (u.banned ? 0 : Math.floor(u.coins)), 0);
console.log(`Imported ${users.length} accounts into the ${a.remote ? 'PRODUCTION' : 'local'} database (${total.toLocaleString()} coins = ${total.toLocaleString()} PMT owed as bonus).`);
console.log('Make sure the rewards pool holds at least that much before players sign in (Admin → Finance → Rewards pool).');
