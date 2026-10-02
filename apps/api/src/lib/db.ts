/**
 * Thin helpers over D1. Every multi-statement write goes through `runBatch`, which D1 executes
 * as a single SQL transaction: if any statement fails (CHECK constraint, UNIQUE constraint,
 * batch assertion trigger …) the whole batch is rolled back.
 */
import { AppError } from './errors';

export type Stmt = D1PreparedStatement;

export type DbErrorKind = 'BALANCE' | 'IDEMPOTENCY' | 'ASSERTION' | 'UNIQUE' | 'IMMUTABLE' | 'FOREIGN_KEY' | 'CHECK' | 'OTHER';

export class DbError extends Error {
  constructor(
    readonly kind: DbErrorKind,
    readonly raw: string,
  ) {
    super(`${kind}: ${raw}`);
  }
  /** true when the failing constraint mentions all the given fragments */
  mentions(...fragments: string[]): boolean {
    return fragments.every((f) => this.raw.includes(f));
  }
}

function messageOf(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as Error & { cause?: unknown }).cause;
    return cause instanceof Error ? `${e.message} | ${cause.message}` : e.message;
  }
  return String(e);
}

export function classifyDbError(e: unknown): DbError {
  if (e instanceof DbError) return e;
  const raw = messageOf(e);
  if (raw.includes('wallet_balance_non_negative')) return new DbError('BALANCE', raw);
  if (raw.includes('ledger_transactions.idempotency_key')) return new DbError('IDEMPOTENCY', raw);
  if (raw.includes('BATCH_ASSERTION_FAILED') || raw.includes('HOLD_ALREADY_FINAL')) return new DbError('ASSERTION', raw);
  if (raw.includes('UNIQUE constraint failed')) return new DbError('UNIQUE', raw);
  if (raw.includes('LEDGER_IMMUTABLE') || raw.includes('APPEND_ONLY') || raw.includes('IMMUTABLE')) return new DbError('IMMUTABLE', raw);
  if (raw.includes('FOREIGN KEY constraint failed')) return new DbError('FOREIGN_KEY', raw);
  if (raw.includes('CHECK constraint failed') || raw.includes('NOT NULL constraint failed')) return new DbError('CHECK', raw);
  return new DbError('OTHER', raw);
}

export async function runBatch(db: D1Database, statements: Stmt[]): Promise<D1Result[]> {
  if (statements.length === 0) return [];
  try {
    return await db.batch(statements);
  } catch (e) {
    throw classifyDbError(e);
  }
}

export async function first<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<T>();
  return res.results ?? [];
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  try {
    return await db.prepare(sql).bind(...params).run();
  } catch (e) {
    throw classifyDbError(e);
  }
}

/** Statement that aborts the batch unless `conditionSql` (a SELECT returning 0/1) is 1. */
export function assertStmt(db: D1Database, conditionSql: string, ...params: unknown[]): Stmt {
  return db.prepare(`INSERT INTO batch_assert (ok) SELECT (${conditionSql})`).bind(...params);
}

/** Increments a counter; use `counterValueSql(name)` later in the same batch to read the new value. */
export function nextCounterStmt(db: D1Database, name: string): Stmt {
  return db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').bind(name);
}
export const counterValueSql = "(SELECT value FROM counters WHERE name = ?)";

export function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === '1';
}

export function parseJson<T = Record<string, unknown>>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || v === '') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** Maps low-level batch failures of wallet operations to API errors. */
export function walletDbError(e: unknown, opts: { treasury?: boolean } = {}): AppError | DbError {
  const err = classifyDbError(e);
  if (err.kind === 'BALANCE') return new AppError(opts.treasury ? 'TREASURY_INSUFFICIENT' : 'INSUFFICIENT_BALANCE');
  return err;
}

export function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}
