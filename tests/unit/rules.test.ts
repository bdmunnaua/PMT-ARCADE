import { describe, expect, it } from 'vitest';
import {
  canTransition,
  checkSettings,
  DEFAULT_SETTINGS,
  isTerminal,
  MATCH_STATUSES,
  maskAccount,
  normalizeBdMobile,
  normalizeReference,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  settingsSchema,
} from '@arena/shared';

describe('match state machine', () => {
  it('allows the happy path', () => {
    const path = ['CREATED', 'WAITING_FOR_OPPONENT', 'STAKE_LOCKING', 'READY', 'PLAYING', 'RESULT_PENDING', 'SETTLING', 'SETTLED'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });
  it('terminal states have no exits', () => {
    for (const s of MATCH_STATUSES) if (isTerminal(s)) expect(MATCH_STATUSES.some((t) => canTransition(s, t))).toBe(false);
  });
  it('a settled match can never be settled again', () => {
    expect(canTransition('SETTLED', 'SETTLING')).toBe(false);
    expect(canTransition('SETTLED', 'REFUNDED')).toBe(false);
  });
  it('cannot settle a match that never started', () => {
    expect(canTransition('WAITING_FOR_OPPONENT', 'SETTLING')).toBe(false);
  });
});

describe('settings safety', () => {
  it('defaults are valid and safe in production', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(checkSettings(DEFAULT_SETTINGS, true).errors).toEqual([]);
  });
  it('refuses buy 110 / sell 100 (arbitrage) in production', () => {
    const s = { ...DEFAULT_SETTINGS, SELL_TOKENS_PER_BDT: 100 };
    expect(checkSettings(s, true).errors.length).toBe(1);
    // outside production it is only a warning
    expect(checkSettings(s, false).errors.length).toBe(0);
    expect(checkSettings(s, false).warnings.length).toBeGreaterThan(0);
  });
  it('refuses equal rates in production', () => {
    expect(checkSettings({ ...DEFAULT_SETTINGS, SELL_TOKENS_PER_BDT: 110 }, true).errors.length).toBe(1);
  });
  it('rejects non-integer basis points', () => {
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, MATCH_FEE_BPS: 1.5 }).success).toBe(false);
  });
});

describe('payments', () => {
  it('normalises bKash numbers', () => {
    expect(normalizeBdMobile('+880 1712-345689')).toBe('01712345689');
    expect(normalizeBdMobile('01212345689')).toBeNull();
  });
  it('normalises references (trim + uppercase)', () => {
    expect(normalizeReference('  9ab8cd7EF ')).toBe('9AB8CD7EF');
    expect(normalizeReference('ab')).toBeNull();
  });
  it('masks numbers', () => {
    expect(maskAccount('01712345689')).toBe('01*******89');
  });
});

describe('roles', () => {
  it('SUPER_ADMIN has every permission', () => {
    expect([...ROLE_PERMISSIONS.SUPER_ADMIN].sort()).toEqual([...PERMISSIONS].sort());
  });
  it('SUPPORT_ADMIN cannot move tokens', () => {
    const p = ROLE_PERMISSIONS.SUPPORT_ADMIN;
    for (const perm of ['finance.distribute', 'finance.treasury', 'finance.buy.manage', 'finance.sell.manage'] as const) expect(p).not.toContain(perm);
  });
});
