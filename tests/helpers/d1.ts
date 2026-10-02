/**
 * D1-compatible adapter over node:sqlite (real SQLite: same constraints, triggers, partial
 * indexes and transactional batches as D1). Like D1, each statement/batch executes atomically
 * with respect to other requests; interleaving only happens between awaits — which is exactly
 * where real concurrent Worker requests interleave too.
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Param = string | number | bigint | null | Uint8Array;

function convert(v: unknown): Param {
  if (v === undefined) throw new Error('D1_TYPE_ERROR: Type undefined is not supported');
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as Param;
}

interface ExecResult {
  rows: Record<string, unknown>[];
  changes: number;
  lastRowId: number;
}

export class TestStatement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly params: Param[] = [],
  ) {}

  bind(...params: unknown[]): TestStatement {
    return new TestStatement(this.db, this.sql, params.map(convert));
  }

  execSync(): ExecResult {
    const st = this.db.prepare(this.sql);
    const rows = st.all(...this.params) as Record<string, unknown>[];
    const meta = this.db.prepare('SELECT changes() AS c, last_insert_rowid() AS id').get() as { c: number; id: number };
    return { rows: rows.map((r) => ({ ...r })), changes: meta.c, lastRowId: meta.id };
  }

  async first<T>(column?: string): Promise<T | null> {
    const r = this.execSync().rows[0];
    if (!r) return null;
    return (column ? r[column] : r) as T;
  }

  async all<T>() {
    const r = this.execSync();
    return { results: r.rows as T[], success: true, meta: { changes: r.changes, last_row_id: r.lastRowId } };
  }

  async run() {
    const r = this.execSync();
    return { results: [], success: true, meta: { changes: r.changes, last_row_id: r.lastRowId } };
  }

  async raw<T>() {
    return this.execSync().rows.map((r) => Object.values(r)) as T[];
  }
}

export class TestD1 {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(sql: string): TestStatement {
    return new TestStatement(this.sqlite, sql);
  }

  async batch(stmts: TestStatement[]) {
    this.sqlite.exec('BEGIN');
    try {
      const out = stmts.map((s) => {
        const r = s.execSync();
        return { results: r.rows, success: true, meta: { changes: r.changes, last_row_id: r.lastRowId } };
      });
      this.sqlite.exec('COMMIT');
      return out;
    } catch (e) {
      this.sqlite.exec('ROLLBACK');
      throw e;
    }
  }

  async exec(sql: string) {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }
}

export const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations');

export function createTestDatabase(): TestD1 {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return new TestD1(sqlite);
}
