#!/usr/bin/env node
/**
 * Grants SUPER_ADMIN to an existing account.
 *
 *   1. Sign in to the web app once with the account (this creates the player profile).
 *   2. npm run admin:create -- --email you@example.com            (local database)
 *      npm run admin:create -- --email you@example.com --remote   (production database)
 *
 * Requires Cloudflare access to the database (wrangler login) — that is the trust anchor.
 * Writes an audit-log entry. Re-running for an existing admin re-activates them as SUPER_ADMIN.
 */
import { createInterface } from 'node:readline/promises';
import { args, d1, q, ulid } from './lib.mjs';

const a = args();
const email = String(a.email ?? '').trim().toLowerCase();
const remote = !!a.remote;
if (!/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(email)) {
  console.error('Usage: npm run admin:create -- --email you@example.com [--remote] [--yes]');
  process.exit(1);
}

const rows = d1(`SELECT u.id, u.email, u.account_status, p.player_number, p.username FROM users u JOIN player_profiles p ON p.user_id = u.id WHERE u.email = ${q(email)};`, { remote, json: true });
const user = rows?.[0]?.results?.[0];
if (!user) {
  console.error(`No player profile found for ${email} in the ${remote ? 'PRODUCTION' : 'local'} database.`);
  console.error('Sign in to the web app once with this account (that creates the profile), then run this again.');
  process.exit(1);
}
console.log(`Found Player #${user.player_number} (@${user.username}, ${user.email}, status ${user.account_status}).`);
if (user.account_status !== 'ACTIVE') {
  console.error('The account is not ACTIVE. Refusing.');
  process.exit(1);
}
if (!a.yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Grant SUPER_ADMIN to Player #${user.player_number} in the ${remote ? 'PRODUCTION' : 'local'} database? Type "yes": `);
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Cancelled.');
    process.exit(0);
  }
}
const now = Date.now();
d1(
  `INSERT INTO admin_users (user_id, role_id, active, created_by, created_at, updated_at) VALUES (${q(user.id)}, 'SUPER_ADMIN', 1, NULL, ${now}, ${now})
     ON CONFLICT(user_id) DO UPDATE SET role_id = 'SUPER_ADMIN', active = 1, updated_at = ${now};
   INSERT INTO audit_logs (id, actor_type, admin_user_id, action, entity_type, entity_id, after_json, reason, created_at)
     VALUES (${q(ulid(now))}, 'SYSTEM', NULL, 'admin.bootstrap_super_admin', 'admin_user', ${q(user.id)}, ${q(JSON.stringify({ role: 'SUPER_ADMIN', playerNumber: user.player_number }))}, 'Granted with scripts/create-super-admin.mjs', ${now});`,
  { remote },
);
console.log(`✔ Player #${user.player_number} is now SUPER_ADMIN. Reload the web app and open /admin.`);
if (remote) console.log('  In production the admin panel also requires a verified email address.');
