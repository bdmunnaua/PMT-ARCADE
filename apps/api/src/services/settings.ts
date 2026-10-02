import {
  checkSettings,
  coverageBps,
  DEFAULT_SETTINGS,
  isArbitrageSafe,
  LADDER_RULES,
  liabilityPoisha,
  settingsPatchSchema,
  settingsSchema,
  SETTING_KEYS,
  type PlatformSettings,
  type SettingKey,
} from '@arena/shared';
import { all } from '../lib/db';
import { freeReserveOf, reserveFigures } from './reserve';
import { AppError } from '../lib/errors';
import type { AuditService } from './audit';
import { runBatch, type Stmt } from '../lib/db';

export class SettingsService {
  private cache: { settings: PlatformSettings; updatedAt: Record<string, number> } | null = null;

  constructor(
    private readonly db: D1Database,
    private readonly production: boolean,
    private readonly now: () => number,
  ) {}

  /** Database values merged over defaults; unknown/invalid stored values fall back to defaults. */
  async getWithMeta(): Promise<{ settings: PlatformSettings; updatedAt: Record<string, number> }> {
    if (this.cache) return this.cache;
    const rows = await all<{ key: string; value: string; updated_at: number }>(this.db, 'SELECT key, value, updated_at FROM platform_settings');
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    const updatedAt: Record<string, number> = {};
    for (const r of rows) {
      if (!(SETTING_KEYS as string[]).includes(r.key)) continue;
      try {
        merged[r.key] = JSON.parse(r.value);
        updatedAt[r.key] = r.updated_at;
      } catch {
        /* keep default */
      }
    }
    const parsed = settingsSchema.safeParse(merged);
    const settings = parsed.success ? parsed.data : DEFAULT_SETTINGS;
    this.cache = { settings, updatedAt };
    return this.cache;
  }

  async get(): Promise<PlatformSettings> {
    return (await this.getWithMeta()).settings;
  }

  warnings(s: PlatformSettings): string[] {
    return checkSettings(s, this.production).warnings;
  }

  /** Refuses finance operations if the live configuration would allow arbitrage in production. */
  assertFinanceSafe(s: PlatformSettings): void {
    if (this.production && !isArbitrageSafe(s.BUY_TOKENS_PER_BDT, s.SELL_TOKENS_PER_BDT)) {
      throw new AppError('UNSAFE_CONFIGURATION', 'Exchange rates are misconfigured (sell rate must exceed buy rate). Finance requests are paused.');
    }
  }

  async update(patchInput: unknown, adminUserId: string, reason: string, audit: AuditService): Promise<{ settings: PlatformSettings; warnings: string[]; changed: SettingKey[] }> {
    const patch = settingsPatchSchema.parse(patchInput);
    const current = await this.get();
    const next = settingsSchema.parse({ ...current, ...patch });
    const check = checkSettings(next, this.production);
    if (next.SELL_TOKENS_PER_BDT < current.SELL_TOKENS_PER_BDT) {
      // fewer PMT per ৳1 = a higher PMT price: the reserve must back what would then be owed
      const f = await reserveFigures(this.db);
      const cov = coverageBps(freeReserveOf(f), liabilityPoisha(f.sellableUnits, next.SELL_TOKENS_PER_BDT));
      if (cov !== null && cov < LADDER_RULES.minCoverageBps) {
        const msg = `Raising the PMT price needs the reserve to cover at least ${LADDER_RULES.minCoverageBps / 100}% of what players could sell back at the new rate; it covers ${(cov / 100).toFixed(1)}%.`;
        if (this.production) check.errors.push(msg);
        else check.warnings.push(`${msg} Allowed only because this is not production.`);
      }
    }
    if (check.errors.length) throw new AppError('UNSAFE_CONFIGURATION', check.errors.join(' '), { errors: check.errors });

    const changed = (Object.keys(patch) as SettingKey[]).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(next[k]));
    if (changed.length === 0) return { settings: current, warnings: check.warnings, changed };

    const now = this.now();
    const stmts: Stmt[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of changed) {
      before[k] = current[k];
      after[k] = next[k];
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          )
          .bind(k, JSON.stringify(next[k]), now, adminUserId),
      );
    }
    stmts.push(audit.stmt({ adminUserId, action: 'settings.update', entityType: 'platform_settings', before, after, reason }));
    if (changed.includes('BUY_TOKENS_PER_BDT') || changed.includes('SELL_TOKENS_PER_BDT')) {
      stmts.push(
        audit.stmt({
          adminUserId,
          action: 'settings.exchange_rate_change',
          entityType: 'platform_settings',
          entityId: 'exchange_rates',
          before: { BUY_TOKENS_PER_BDT: current.BUY_TOKENS_PER_BDT, SELL_TOKENS_PER_BDT: current.SELL_TOKENS_PER_BDT },
          after: { BUY_TOKENS_PER_BDT: next.BUY_TOKENS_PER_BDT, SELL_TOKENS_PER_BDT: next.SELL_TOKENS_PER_BDT },
          reason,
        }),
      );
    }
    if (changed.includes('MATCH_FEE_BPS')) {
      stmts.push(
        audit.stmt({ adminUserId, action: 'settings.match_fee_change', entityType: 'platform_settings', entityId: 'MATCH_FEE_BPS', before: current.MATCH_FEE_BPS, after: next.MATCH_FEE_BPS, reason }),
      );
    }
    await runBatch(this.db, stmts);
    this.cache = null;
    return { settings: next, warnings: check.warnings, changed };
  }
}
