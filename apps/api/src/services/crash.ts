/**
 * Aviator (crash) — rounds and bets. Money movements:
 *   bet      : BONUS/AVAILABLE → LOCKED_GAME (GAME_STAKE_LOCK, hold CRASH_BET) — here, via the ledger
 *   cash-out : LOCKED_GAME → AVAILABLE + HOUSE_BANKROLL → AVAILABLE (profit)   — SettlementService
 *   crash    : LOCKED_GAME → HOUSE_BANKROLL                                     — SettlementService
 * The round timeline (betting → flying → crash) is driven by the CrashGame Durable Object.
 *
 * Bankroll safety: every bet stores its maximum possible profit. A bet is accepted only if
 * HOUSE_BANKROLL ≥ Σ max profit of all open bets in the round (checked inside the same SQL
 * transaction), so a round can never pay out more than the bankroll holds.
 */
import {
  crashPointX100,
  maxProfitUnits,
  randomSeedHex,
  sha256Hex,
  CRASH_BETTING_MS,
} from '@arena/games/aviator';
import { splitStake, tokensToUnits, type CrashBetDto, type CrashRoundDto, type HouseBankrollDto } from '@arena/shared';
import { all, assertStmt, classifyDbError, first, nextCounterStmt, run, runBatch } from '../lib/db';
import { AppError, notFound } from '../lib/errors';
import { ulid } from '../lib/ids';
import type { UserRecord } from '../repositories/users';
import type { WalletRepository } from '../repositories/wallets';
import type { GameService } from './games';
import { assertCanTransact, assertNotMaintenance } from './guards';
import type { LedgerService } from './ledger';
import type { SettingsService } from './settings';

export interface CrashRoundRow {
  id: string;
  round_number: number;
  game_id: string;
  status: 'BETTING' | 'FLYING' | 'CRASHED';
  server_seed_hash: string;
  server_seed: string | null;
  crash_x100: number | null;
  betting_ends_at: number;
  started_at: number | null;
  crashed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CrashBetRow {
  id: string;
  round_id: string;
  user_id: string;
  panel: 1 | 2;
  stake_units: number;
  stake_bonus_units: number;
  stake_available_units: number;
  max_profit_units: number;
  auto_cashout_x100: number | null;
  status: CrashBetDto['status'];
  cashout_x100: number | null;
  payout_units: number | null;
  created_at: number;
}

export function toRoundDto(r: CrashRoundRow): CrashRoundDto {
  const crashed = r.status === 'CRASHED';
  return {
    id: r.id,
    roundNumber: r.round_number,
    phase: r.status,
    serverSeedHash: r.server_seed_hash,
    serverSeed: crashed ? r.server_seed : null,
    crashX100: crashed ? r.crash_x100 : null,
    bettingEndsAt: r.betting_ends_at,
    startedAt: r.started_at,
    crashedAt: r.crashed_at,
  };
}

export class CrashService {
  constructor(
    private readonly db: D1Database,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletRepository,
    private readonly settings: SettingsService,
    private readonly games: GameService,
    private readonly now: () => number,
  ) {}

  async latestRound(gameId: string): Promise<CrashRoundRow | null> {
    return first<CrashRoundRow>(this.db, 'SELECT * FROM crash_rounds WHERE game_id = ? ORDER BY round_number DESC LIMIT 1', gameId);
  }

  async round(id: string): Promise<CrashRoundRow | null> {
    return first<CrashRoundRow>(this.db, 'SELECT * FROM crash_rounds WHERE id = ?', id);
  }

  /** Opens a new betting round. The crash point is fixed now (provably fair commitment). */
  async createRound(gameId: string): Promise<CrashRoundRow> {
    const s = await this.settings.get();
    const id = ulid();
    const now = this.now();
    const seed = randomSeedHex();
    const hash = await sha256Hex(seed);
    const [, numberRes] = await runBatch(this.db, [nextCounterStmt(this.db, 'crash_round'), this.db.prepare("SELECT value FROM counters WHERE name = 'crash_round'")]);
    const roundNumber = Number((numberRes?.results?.[0] as { value: number }).value);
    const crash = await crashPointX100(seed, roundNumber, s.crash_max_multiplier_x100);
    await run(
      this.db,
      `INSERT INTO crash_rounds (id, round_number, game_id, status, server_seed_hash, server_seed, crash_x100, betting_ends_at, created_at, updated_at)
       VALUES (?, ?, ?, 'BETTING', ?, ?, ?, ?, ?, ?)`,
      id,
      roundNumber,
      gameId,
      hash,
      seed,
      crash,
      now + CRASH_BETTING_MS,
      now,
      now,
    );
    return (await this.round(id))!;
  }

  async markFlying(roundId: string, startedAt: number): Promise<void> {
    await run(this.db, "UPDATE crash_rounds SET status = 'FLYING', started_at = ?, updated_at = ? WHERE id = ? AND status = 'BETTING'", startedAt, startedAt, roundId);
  }

  async markCrashed(roundId: string, crashedAt: number): Promise<void> {
    await run(this.db, "UPDATE crash_rounds SET status = 'CRASHED', crashed_at = ?, updated_at = ? WHERE id = ? AND status <> 'CRASHED'", crashedAt, crashedAt, roundId);
  }

  async placeBet(user: UserRecord, round: CrashRoundRow, input: { amountUnits: number; autoCashoutX100?: number; panel?: 1 | 2 }, clientKey: string): Promise<CrashBetRow> {
    const prior = await first<CrashBetRow>(this.db, 'SELECT * FROM crash_bets WHERE user_id = ? AND client_key = ?', user.id, clientKey);
    if (prior) return prior;
    assertCanTransact(user);
    const s = await this.settings.get();
    assertNotMaintenance(s);
    if (!s.games_enabled) throw new AppError('FEATURE_DISABLED', 'Games are currently disabled.');
    const game = await this.games.get(round.game_id);
    if (game.kind !== 'CRASH' || !game.enabled || game.maintenanceMode) throw new AppError('GAME_UNAVAILABLE');
    const min = Math.max(game.minimumStakeUnits, tokensToUnits(s.minimum_match_stake));
    const max = Math.min(game.maximumStakeUnits, tokensToUnits(s.maximum_match_stake));
    if (input.amountUnits < min || input.amountUnits > max) throw new AppError('STAKE_OUT_OF_RANGE', undefined, { minimumStakeUnits: min, maximumStakeUnits: max });
    if (round.status !== 'BETTING' || this.now() >= round.betting_ends_at) throw new AppError('ROUND_CLOSED');
    const wallet = await this.wallets.getWallet(user.id);
    const split = splitStake(input.amountUnits, wallet.availableUnits, wallet.bonusUnits);
    if (!split) throw new AppError('INSUFFICIENT_BALANCE');
    const maxProfit = maxProfitUnits(input.amountUnits, s.crash_max_multiplier_x100, tokensToUnits(s.crash_max_profit_tokens));

    const id = ulid();
    const now = this.now();
    const postings = [];
    if (split.fromAvailable > 0) postings.push({ from: { userId: user.id, bucket: 'AVAILABLE' as const }, to: { userId: user.id, bucket: 'LOCKED_GAME' as const }, amount: split.fromAvailable });
    if (split.fromBonus > 0) postings.push({ from: { userId: user.id, bucket: 'BONUS' as const }, to: { userId: user.id, bucket: 'LOCKED_GAME' as const }, amount: split.fromBonus });
    const tx = this.ledger.buildTransaction({
      idempotencyKey: `crash:${id}:lock`,
      type: 'GAME_STAKE_LOCK',
      referenceType: 'CRASH_BET',
      referenceId: id,
      gameId: round.game_id,
      createdBy: { type: 'PLAYER', id: user.id },
      metadata: { label: `Aviator round #${round.round_number}`, stakeUnits: input.amountUnits },
      postings,
    });
    try {
      await runBatch(this.db, [
        assertStmt(this.db, "SELECT EXISTS (SELECT 1 FROM crash_rounds WHERE id = ? AND status = 'BETTING' AND betting_ends_at > ?)", round.id, now),
        assertStmt(
          this.db,
          `SELECT (SELECT balance FROM wallet_accounts WHERE id = 'sys_house_bankroll')
                  >= ? + (SELECT COALESCE(SUM(max_profit_units), 0) FROM crash_bets WHERE round_id = ? AND status = 'ACTIVE')`,
          maxProfit,
          round.id,
        ),
        ...tx.statements,
        this.db
          .prepare(
            `INSERT INTO crash_bets (id, round_id, user_id, panel, stake_units, stake_bonus_units, stake_available_units, max_profit_units, auto_cashout_x100, status, client_key, lock_tx_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
          )
          .bind(id, round.id, user.id, input.panel ?? 1, input.amountUnits, split.fromBonus, split.fromAvailable, maxProfit, input.autoCashoutX100 ?? null, clientKey, tx.txId, now, now),
        this.ledger.createHoldStmt({ userId: user.id, bucket: 'LOCKED_GAME', amount: input.amountUnits, referenceType: 'CRASH_BET', referenceId: id, lockTxId: tx.txId }),
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'BALANCE') throw new AppError('INSUFFICIENT_BALANCE');
      if (err.kind === 'UNIQUE' && err.mentions('client_key')) {
        const replay = await first<CrashBetRow>(this.db, 'SELECT * FROM crash_bets WHERE user_id = ? AND client_key = ?', user.id, clientKey);
        if (replay) return replay;
      }
      if (err.kind === 'UNIQUE' && err.mentions('crash_bets')) throw new AppError('CONFLICT', 'You already have a bet on this panel in this round.');
      if (err.kind === 'ASSERTION') {
        const fresh = await this.round(round.id);
        throw new AppError(fresh?.status === 'BETTING' && fresh.betting_ends_at > this.now() ? 'BANKROLL_LIMIT' : 'ROUND_CLOSED');
      }
      throw err;
    }
    return (await first<CrashBetRow>(this.db, 'SELECT * FROM crash_bets WHERE id = ?', id))!;
  }

  async bet(id: string): Promise<CrashBetRow | null> {
    return first<CrashBetRow>(this.db, 'SELECT * FROM crash_bets WHERE id = ?', id);
  }

  async activeBets(roundId: string): Promise<CrashBetRow[]> {
    return all<CrashBetRow>(this.db, "SELECT * FROM crash_bets WHERE round_id = ? AND status = 'ACTIVE' ORDER BY created_at", roundId);
  }

  async betFor(roundId: string, userId: string, panel: 1 | 2): Promise<CrashBetRow | null> {
    return first<CrashBetRow>(this.db, 'SELECT * FROM crash_bets WHERE round_id = ? AND user_id = ? AND panel = ?', roundId, userId, panel);
  }

  async roundBets(round: CrashRoundRow, viewerId: string | null): Promise<CrashBetDto[]> {
    const rows = await all<CrashBetRow & { player_number: number; username: string }>(
      this.db,
      `SELECT b.*, p.player_number, p.username FROM crash_bets b JOIN player_profiles p ON p.user_id = b.user_id
       WHERE b.round_id = ? ORDER BY b.stake_units DESC LIMIT 100`,
      round.id,
    );
    return rows.map((r) => this.toBetDto(r, round.round_number, viewerId));
  }

  toBetDto(r: CrashBetRow & { player_number: number; username: string }, roundNumber: number, viewerId: string | null): CrashBetDto {
    return {
      id: r.id,
      panel: r.panel,
      roundNumber,
      playerNumber: r.player_number,
      username: r.username,
      isYou: r.user_id === viewerId,
      stakeUnits: r.stake_units,
      autoCashoutX100: r.user_id === viewerId ? r.auto_cashout_x100 : null,
      status: r.status,
      cashoutX100: r.cashout_x100,
      payoutUnits: r.payout_units,
      createdAt: r.created_at,
    };
  }

  async history(gameId: string, limit = 20): Promise<CrashRoundDto[]> {
    const rows = await all<CrashRoundRow>(this.db, "SELECT * FROM crash_rounds WHERE game_id = ? AND status = 'CRASHED' ORDER BY round_number DESC LIMIT ?", gameId, limit);
    return rows.map(toRoundDto);
  }

  async myBets(userId: string, page: number, pageSize: number): Promise<{ items: CrashBetDto[]; hasMore: boolean }> {
    const rows = await all<CrashBetRow & { player_number: number; username: string; round_number: number }>(
      this.db,
      `SELECT b.*, p.player_number, p.username, r.round_number FROM crash_bets b
       JOIN player_profiles p ON p.user_id = b.user_id JOIN crash_rounds r ON r.id = b.round_id
       WHERE b.user_id = ? ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
      userId,
      pageSize + 1,
      (page - 1) * pageSize,
    );
    return { hasMore: rows.length > pageSize, items: rows.slice(0, pageSize).map((r) => this.toBetDto(r, r.round_number, userId)) };
  }

  async bankroll(): Promise<HouseBankrollDto> {
    const dayAgo = this.now() - 24 * 60 * 60 * 1000;
    const r = await first<{ balance: number; exposure: number; bets: number; staked: number; paid: number }>(
      this.db,
      `SELECT (SELECT balance FROM wallet_accounts WHERE id = 'sys_house_bankroll') AS balance,
              (SELECT COALESCE(SUM(max_profit_units), 0) FROM crash_bets WHERE status = 'ACTIVE') AS exposure,
              (SELECT COUNT(*) FROM crash_bets WHERE created_at >= ?) AS bets,
              (SELECT COALESCE(SUM(stake_units), 0) FROM crash_bets WHERE created_at >= ?) AS staked,
              (SELECT COALESCE(SUM(payout_units), 0) FROM crash_bets WHERE created_at >= ? AND status = 'CASHED_OUT') AS paid`,
      dayAgo,
      dayAgo,
      dayAgo,
    );
    const refunded = await first<{ n: number }>(this.db, "SELECT COALESCE(SUM(stake_units), 0) AS n FROM crash_bets WHERE created_at >= ? AND status = 'REFUNDED'", dayAgo);
    const staked = (r?.staked ?? 0) - (refunded?.n ?? 0);
    return {
      balanceUnits: r?.balance ?? 0,
      openExposureUnits: r?.exposure ?? 0,
      stats24h: { bets: r?.bets ?? 0, stakedUnits: staked, paidUnits: r?.paid ?? 0, houseResultUnits: staked - (r?.paid ?? 0) },
    };
  }

  /** Rounds that stopped progressing (e.g. the Durable Object was evicted mid-round). */
  async staleRounds(olderThan: number): Promise<CrashRoundRow[]> {
    return all<CrashRoundRow>(this.db, "SELECT * FROM crash_rounds WHERE status <> 'CRASHED' AND updated_at < ? LIMIT 20", olderThan);
  }

  async requireRound(id: string): Promise<CrashRoundRow> {
    const r = await this.round(id);
    if (!r) throw notFound('Round');
    return r;
  }

}
