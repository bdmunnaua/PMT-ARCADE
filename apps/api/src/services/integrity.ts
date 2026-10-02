/**
 * Ledger integrity checker (Admin → Finance → Ledger Integrity). Read-only: it reports problems
 * and never modifies balances. It scans the ledger, so it runs on demand only.
 */
import type { IntegrityIssueDto, IntegrityReportDto } from '@arena/shared';
import { all, first } from '../lib/db';

interface Check {
  name: string;
  run: () => Promise<IntegrityIssueDto[]>;
}

export class IntegrityService {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number,
  ) {}

  async run(): Promise<IntegrityReportDto> {
    const started = this.now();
    const db = this.db;
    const checks: Check[] = [
      {
        name: 'Every transaction is balanced (sum of entries = 0)',
        run: async () =>
          (
            await all<{ transaction_id: string; s: number }>(db, 'SELECT transaction_id, SUM(amount) AS s FROM ledger_entries GROUP BY transaction_id HAVING SUM(amount) <> 0 LIMIT 100')
          ).map((r) => ({ check: 'balanced_transactions', message: `Transaction ${r.transaction_id} is unbalanced by ${r.s} units.`, details: r })),
      },
      {
        name: 'Every transaction has entries and matching totals',
        run: async () =>
          (
            await all<{ id: string; total_units: number; credits: number | null }>(
              db,
              `SELECT t.id, t.total_units, (SELECT SUM(amount) FROM ledger_entries e WHERE e.transaction_id = t.id AND e.amount > 0) AS credits
               FROM ledger_transactions t WHERE credits IS NULL OR credits <> t.total_units LIMIT 100`,
            )
          ).map((r) => ({ check: 'transaction_totals', message: `Transaction ${r.id} total ${r.total_units} ≠ credited ${r.credits ?? 0}.`, details: r })),
      },
      {
        name: 'Cached balances equal the sum of ledger entries',
        run: async () =>
          (
            await all<{ id: string; balance: number; ledger: number }>(
              db,
              `SELECT a.id, a.balance, COALESCE(l.s, 0) AS ledger FROM wallet_accounts a
               LEFT JOIN (SELECT account_id, SUM(amount) AS s FROM ledger_entries GROUP BY account_id) l ON l.account_id = a.id
               WHERE a.balance <> COALESCE(l.s, 0) LIMIT 100`,
            )
          ).map((r) => ({ check: 'balance_reconciliation', message: `Account ${r.id}: cached ${r.balance} ≠ ledger ${r.ledger}.`, details: r })),
      },
      {
        name: 'No negative balances (except ISSUANCE and ONCHAIN_BRIDGE)',
        run: async () =>
          (await all<{ id: string; balance: number }>(db, 'SELECT id, balance FROM wallet_accounts WHERE allow_negative = 0 AND balance < 0 LIMIT 100')).map((r) => ({
            check: 'non_negative',
            message: `Account ${r.id} is negative (${r.balance}).`,
            details: r,
          })),
      },
      {
        name: 'Total supply is conserved (sum of all balances = 0)',
        run: async () => {
          const r = await first<{ s: number | null }>(db, 'SELECT SUM(balance) AS s FROM wallet_accounts');
          return (r?.s ?? 0) === 0 ? [] : [{ check: 'conservation', message: `Sum of all balances is ${r?.s}, expected 0.` }];
        },
      },
      {
        name: 'Locked balances equal active holds',
        run: async () =>
          (
            await all<{ id: string; balance: number; held: number }>(
              db,
              `SELECT a.id, a.balance, COALESCE(h.s, 0) AS held FROM wallet_accounts a
               LEFT JOIN (SELECT user_id, bucket, SUM(amount) AS s FROM wallet_holds WHERE status = 'ACTIVE' GROUP BY user_id, bucket) h
                 ON h.user_id = a.user_id AND h.bucket = a.bucket
               WHERE a.bucket IN ('LOCKED_GAME', 'LOCKED_SELL') AND a.balance <> COALESCE(h.s, 0) LIMIT 100`,
            )
          ).map((r) => ({ check: 'holds', message: `Account ${r.id}: locked ${r.balance} ≠ active holds ${r.held}.`, details: r })),
      },
      {
        name: 'Resolved matches have exactly one resolution transaction; active ones none',
        run: async () => {
          const issues: IntegrityIssueDto[] = [];
          const missing = await all<{ id: string; status: string }>(
            db,
            `SELECT m.id, m.status FROM matches m WHERE m.status IN ('SETTLED','DRAW','CANCELLED','VOID','REFUNDED')
               AND NOT EXISTS (SELECT 1 FROM ledger_transactions t WHERE t.idempotency_key = 'match:' || m.id || ':resolution') LIMIT 100`,
          );
          for (const m of missing) issues.push({ check: 'match_resolution', message: `Match ${m.id} is ${m.status} without a resolution transaction.` });
          const early = await all<{ id: string; status: string }>(
            db,
            `SELECT m.id, m.status FROM matches m WHERE m.status NOT IN ('SETTLED','DRAW','CANCELLED','VOID','REFUNDED')
               AND EXISTS (SELECT 1 FROM ledger_transactions t WHERE t.idempotency_key = 'match:' || m.id || ':resolution') LIMIT 100`,
          );
          for (const m of early) issues.push({ check: 'match_resolution', message: `Match ${m.id} is ${m.status} but already has a resolution transaction.` });
          const fees = await all<{ id: string; fee_units: number; posted: number }>(
            db,
            `SELECT m.id, m.fee_units, COALESCE((SELECT SUM(e.amount) FROM ledger_entries e WHERE e.transaction_id = m.resolution_tx_id AND e.account_id = 'sys_platform_fees'), 0) AS posted
             FROM matches m WHERE m.status = 'SETTLED' AND posted <> COALESCE(m.fee_units, 0) LIMIT 100`,
          );
          for (const f of fees) issues.push({ check: 'match_fee', message: `Match ${f.id}: recorded fee ${f.fee_units} ≠ posted ${f.posted}.` });
          return issues;
        },
      },
      {
        name: 'Completed buy requests were credited exactly once',
        run: async () =>
          (
            await all<{ id: string; status: string; credited: number }>(
              db,
              `SELECT b.id, b.status, (SELECT COUNT(*) FROM ledger_transactions t WHERE t.idempotency_key = 'buy:' || b.id || ':credit') AS credited
               FROM buy_requests b WHERE (b.status = 'COMPLETED' AND credited <> 1) OR (b.status <> 'COMPLETED' AND credited <> 0) LIMIT 100`,
            )
          ).map((r) => ({ check: 'buy_credit', message: `Buy request ${r.id} (${r.status}) has ${r.credited} credit transactions.` })),
      },
      {
        name: 'Resolved sell requests have exactly one resolution; open ones none',
        run: async () =>
          (
            await all<{ id: string; status: string; resolved: number }>(
              db,
              `SELECT s.id, s.status, (SELECT COUNT(*) FROM ledger_transactions t WHERE t.idempotency_key = 'sell:' || s.id || ':resolution') AS resolved
               FROM sell_requests s
               WHERE (s.status IN ('COMPLETED','TOKENS_UNLOCKED','CANCELLED') AND resolved <> 1)
                  OR (s.status NOT IN ('COMPLETED','TOKENS_UNLOCKED','CANCELLED') AND resolved <> 0) LIMIT 100`,
            )
          ).map((r) => ({ check: 'sell_resolution', message: `Sell request ${r.id} (${r.status}) has ${r.resolved} resolution transactions.` })),
      },
      {
        name: 'Platform fees only come from match settlements and player transfers',
        run: async () =>
          (
            await all<{ transaction_id: string; type: string }>(
              db,
              `SELECT e.transaction_id, t.type FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
               WHERE e.account_id = 'sys_platform_fees'
                 AND NOT (t.type = 'GAME_WIN_PAYOUT' AND e.posting_type = 'PLATFORM_MATCH_FEE')
                 AND NOT (t.type = 'PLAYER_TRANSFER' AND e.posting_type = 'TRANSFER_FEE')
                 AND NOT (t.type = 'ONCHAIN_WITHDRAW_PAID' AND e.posting_type = 'WITHDRAW_FEE') LIMIT 100`,
            )
          ).map((r) => ({ check: 'fee_wallet_usage', message: `PLATFORM_FEES touched by ${r.type} transaction ${r.transaction_id}.` })),
      },
      {
        name: 'Aviator bets: settled exactly once, open bets not yet',
        run: async () =>
          (
            await all<{ id: string; status: string; resolved: number }>(
              db,
              `SELECT b.id, b.status, (SELECT COUNT(*) FROM ledger_transactions t WHERE t.idempotency_key = 'crash:' || b.id || ':resolution') AS resolved
               FROM crash_bets b WHERE (b.status = 'ACTIVE' AND resolved <> 0) OR (b.status <> 'ACTIVE' AND resolved <> 1) LIMIT 100`,
            )
          ).map((r) => ({ check: 'crash_bet_resolution', message: `Aviator bet ${r.id} (${r.status}) has ${r.resolved} resolution transactions.` })),
      },
      {
        name: 'House bankroll only moved by Aviator bets and audited transfers',
        run: async () =>
          (
            await all<{ transaction_id: string; type: string }>(
              db,
              `SELECT e.transaction_id, t.type FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
               WHERE e.account_id = 'sys_house_bankroll' AND t.type NOT IN ('HOUSE_BET_WIN', 'HOUSE_BET_LOSS', 'HOUSE_BANKROLL_TRANSFER') LIMIT 100`,
            )
          ).map((r) => ({ check: 'bankroll_usage', message: `HOUSE_BANKROLL touched by ${r.type} transaction ${r.transaction_id}.` })),
      },
      {
        name: 'The rewards pool only pays free-game rewards and is only funded by the admin treasury',
        run: async () =>
          (
            await all<{ transaction_id: string; type: string }>(
              db,
              `SELECT e.transaction_id, t.type FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
               WHERE e.account_id = 'sys_rewards_pool' AND t.type NOT IN ('ARCADE_REWARD', 'REWARDS_POOL_TRANSFER') LIMIT 100`,
            )
          ).map((r) => ({ check: 'rewards_pool_usage', message: `REWARDS_POOL touched by ${r.type} transaction ${r.transaction_id}.` })),
      },
      {
        name: 'Free-game rewards are always paid as BONUS',
        run: async () =>
          (
            await all<{ transaction_id: string }>(
              db,
              `SELECT e.transaction_id FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
               WHERE t.type = 'ARCADE_REWARD' AND e.amount > 0 AND (e.bucket IS NULL OR e.bucket <> 'BONUS') LIMIT 100`,
            )
          ).map((r) => ({ check: 'arcade_reward_bucket', message: `ARCADE_REWARD transaction ${r.transaction_id} paid outside BONUS.` })),
      },
    ];

    const results: { name: string; passed: boolean }[] = [];
    const issues: IntegrityIssueDto[] = [];
    for (const c of checks) {
      const found = await c.run();
      results.push({ name: c.name, passed: found.length === 0 });
      issues.push(...found);
    }
    const stats = await first<{ t: number; e: number; a: number; h: number }>(
      db,
      `SELECT (SELECT COUNT(*) FROM ledger_transactions) AS t, (SELECT COUNT(*) FROM ledger_entries) AS e,
              (SELECT COUNT(*) FROM wallet_accounts) AS a, (SELECT COUNT(*) FROM wallet_holds WHERE status = 'ACTIVE') AS h`,
    );
    return {
      status: issues.length === 0 ? 'PASS' : 'FAIL',
      checkedAt: started,
      durationMs: this.now() - started,
      stats: { transactions: stats?.t ?? 0, entries: stats?.e ?? 0, accounts: stats?.a ?? 0, activeHolds: stats?.h ?? 0 },
      checks: results,
      issues,
    };
  }
}
