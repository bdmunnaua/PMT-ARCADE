import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import type { AppEnv } from '../env';
import { AppError } from './errors';

export type Ctx = Context<AppEnv>;

export function ok<T>(c: Ctx, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ success: true as const, data, requestId: c.get('requestId') }, status);
}

function validationError(issues: z.core.$ZodIssue[]): AppError {
  return new AppError(
    'VALIDATION_ERROR',
    issues[0]?.message && issues.length === 1 ? issues[0].message : undefined,
    { issues: issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
  );
}

export async function parseBody<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', 'The request body must be valid JSON.');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw validationError(r.error.issues);
  return r.data;
}

export function parseQuery<S extends z.ZodType>(c: Ctx, schema: S): z.output<S> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw validationError(r.error.issues);
  return r.data;
}

export function param(c: Ctx, name: string): string {
  const v = c.req.param(name);
  if (!v || v.length > 64) throw new AppError('NOT_FOUND');
  return v;
}
