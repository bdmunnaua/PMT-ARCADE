/**
 * Fixed-window rate limiter backed by D1 (one upsert per limited request). Only sensitive actions
 * are limited, so ordinary page loads cost no writes. Limits are configurable with the
 * RATE_LIMIT_OVERRIDES variable, e.g. {"buy_create":{"limit":3,"windowSec":3600}}.
 */
import { DEFAULT_RATE_LIMITS, type RateLimitName, type RateLimitRule } from '@arena/shared';
import { AppError } from '../lib/errors';

export function resolveRateLimits(overridesJson: string | undefined): Record<RateLimitName, RateLimitRule> {
  const limits: Record<string, RateLimitRule> = { ...DEFAULT_RATE_LIMITS };
  if (overridesJson) {
    try {
      const parsed = JSON.parse(overridesJson) as Record<string, Partial<RateLimitRule>>;
      for (const [k, v] of Object.entries(parsed)) {
        if (!(k in limits)) continue;
        const limit = Number(v.limit);
        const windowSec = Number(v.windowSec);
        if (Number.isSafeInteger(limit) && limit > 0 && Number.isSafeInteger(windowSec) && windowSec > 0) limits[k] = { limit, windowSec };
      }
    } catch {
      console.warn('RATE_LIMIT_OVERRIDES is not valid JSON; using defaults');
    }
  }
  return limits as Record<RateLimitName, RateLimitRule>;
}

export class RateLimiter {
  constructor(
    private readonly db: D1Database,
    private readonly limits: Record<RateLimitName, RateLimitRule>,
    private readonly now: () => number,
  ) {}

  /** Throws RATE_LIMITED (HTTP 429) when the subject exceeded the named limit. */
  async hit(name: RateLimitName, subject: string): Promise<{ remaining: number; resetAt: number }> {
    const rule = this.limits[name];
    const windowMs = rule.windowSec * 1000;
    const windowStart = Math.floor(this.now() / windowMs) * windowMs;
    const row = await this.db
      .prepare(
        `INSERT INTO rate_limit_counters (key, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 RETURNING count`,
      )
      .bind(`${name}:${subject}`, windowStart)
      .first<{ count: number }>();
    const count = row?.count ?? 1;
    const resetAt = windowStart + windowMs;
    if (count > rule.limit) {
      throw new AppError('RATE_LIMITED', undefined, { retryAfterSec: Math.max(1, Math.ceil((resetAt - this.now()) / 1000)) });
    }
    return { remaining: rule.limit - count, resetAt };
  }
}
