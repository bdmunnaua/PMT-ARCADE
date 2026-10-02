// Shared helpers for the maintenance scripts (Node ≥ 22, no dependencies).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const API_DIR = join(ROOT, 'apps', 'api');
const TMP = join(ROOT, 'scripts', '.seed');

export function args() {
  const out = { _: [] };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const key = a[i].slice(2);
      const next = a[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else out[key] = true;
    } else out._.push(a[i]);
  }
  return out;
}

/** Runs SQL through `wrangler d1 execute` (via a temp file, so no shell quoting issues). */
export function d1(sql, { remote = false, json = false } = {}) {
  mkdirSync(TMP, { recursive: true });
  const file = join(TMP, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, sql);
  const target = remote ? ['--remote', '--env', 'production'] : ['--local'];
  // remote --file runs as an import and returns only a summary, so reads (json) go via --command
  if (json && sql.includes('"')) throw new Error('d1(): read queries must not contain double quotes');
  const source = json ? ['--command', `"${sql.replace(/\s+/g, ' ').trim()}"`] : ['--file', JSON.stringify(file)];
  const res = spawnSync('npx', ['wrangler', 'd1', 'execute', 'DB', ...target, ...source, ...(json ? ['--json'] : []), '--yes'], {
    cwd: API_DIR,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  });
  if (res.status !== 0) {
    process.stderr.write(res.stdout + res.stderr);
    throw new Error('wrangler d1 execute failed');
  }
  if (!json) return res.stdout;
  const start = res.stdout.indexOf('[');
  return JSON.parse(res.stdout.slice(start));
}

export const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function ulid(now = Date.now()) {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[Math.floor(Math.random() * 32)];
  return time + rand;
}
