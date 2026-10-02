/**
 * Architectural invariants enforced by scanning the source:
 *   * exactly ONE module writes balances / ledger entries (services/ledger.ts)
 *   * exactly ONE module resolves match escrow (services/settlement.ts)
 *   * no unfinished-work markers or fake implementations in production code
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
function files(dir: string, exts = ['.ts', '.tsx']): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, exts));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}
const sources = [...files(join(ROOT, 'apps', 'api', 'src')), ...files(join(ROOT, 'apps', 'web', 'src')), ...files(join(ROOT, 'packages', 'shared', 'src')), ...files(join(ROOT, 'packages', 'games', 'src'))];
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');

describe('single-writer invariants', () => {
  it('only the ledger service updates balances or inserts ledger rows', () => {
    const offenders = sources.filter((f) => /UPDATE\s+wallet_accounts|INSERT\s+INTO\s+ledger_(entries|transactions)/i.test(readFileSync(f, 'utf8')));
    expect(offenders.map(rel)).toEqual(['apps/api/src/services/ledger.ts']);
  });

  it('only the settlement service posts game payouts and refunds', () => {
    // any ledger transaction built with an escrow-resolution type
    const builds = /buildTransaction\(\{[\s\S]{0,250}?'(GAME_WIN_PAYOUT|GAME_STAKE_REFUND|HOUSE_BET_WIN|HOUSE_BET_LOSS|HOUSE_BET_REFUND)'/;
    const offenders = sources.filter((f) => builds.test(readFileSync(f, 'utf8')));
    expect(offenders.map(rel)).toEqual(['apps/api/src/services/settlement.ts']);
    // and nothing else moves tokens out of LOCKED_GAME
    const lockedGameDebits = sources.filter((f) => /from:\s*\{\s*userId[^}]*bucket:\s*'LOCKED_GAME'/.test(readFileSync(f, 'utf8')));
    expect(lockedGameDebits.map(rel)).toEqual(['apps/api/src/services/settlement.ts']);
  });

  it('no TODO/FIXME markers or fake implementations in source', () => {
    const bad = sources.filter((f) => /\b(TODO|FIXME)\b|mockBalance|fakeApprove/.test(readFileSync(f, 'utf8')));
    expect(bad.map(rel)).toEqual([]);
  });
});
