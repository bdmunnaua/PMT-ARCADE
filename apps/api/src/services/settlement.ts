/**
 * THE settlement service — the only code that resolves match escrow.
 *
 * Inputs are server-side decisions only: a GameRoom Durable Object running a game module, the
 * HMAC-protected internal API, an administrator resolving a dispute, the cron job (expired
 * rooms) or — outside production only — the development simulator. There is no public endpoint
 * through which a browser can report a winner.
 *
 * Every resolution of a match uses the idempotency key `match:<id>:resolution`, so a match can be
 * settled, drawn, voided, refunded or cancelled exactly once, even under concurrent calls.
 */
import {
  canTransition,
  formatTokens,
  isTerminal,
  planRefund,
  planWinSettlement,
  type MatchOutcome,
  type MatchStatus,
  type SettlementParticipant,
  type SettlementSource,
} from '@arena/shared';
import { assertStmt, classifyDbError, first, runBatch, type Stmt } from '../lib/db';
import { payoutUnits as crashPayoutUnits } from '@arena/games/aviator';
import { AppError, alreadyProcessed, invalidState, notFound } from '../lib/errors';
import type { MatchPlayerRow, MatchRepository, MatchRow } from '../repositories/matches';
import type { RealtimePublisher } from '../realtime/publisher';
import type { LedgerService, Posting } from './ledger';
import type { NotificationService } from './notifications';

export type ResolutionOutcome = MatchOutcome | { type: 'CANCEL'; reason: string };

export interface SettleInput {
  matchId: string;
  outcome: ResolutionOutcome;
  source: SettlementSource;
  actorId?: string | null;
  resultProof?: string | null;
  /** extra statements (e.g. audit log) that must commit atomically with the settlement */
  extraStatements?: Stmt[];
}

export interface SettlementResult {
  matchId: string;
  status: MatchStatus;
  transactionId: string;
  potUnits: number;
  feeUnits: number;
  payoutUnits: number;
  winnerUserId: string | null;
  payouts: Record<string, number>;
}

const FINAL_STATUS: Record<ResolutionOutcome['type'], MatchStatus> = {
  WIN: 'SETTLED',
  DRAW: 'DRAW',
  VOID: 'VOID',
  REFUND: 'REFUNDED',
  CANCEL: 'CANCELLED',
};

function participants(players: MatchPlayerRow[]): SettlementParticipant[] {
  return players.map((p) => ({
    userId: p.user_id,
    stakeUnits: p.stake_units,
    stakeBonusUnits: p.stake_bonus_units,
    stakeAvailableUnits: p.stake_available_units,
  }));
}

export class SettlementService {
  constructor(
    private readonly db: D1Database,
    private readonly matches: MatchRepository,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationService,
    private readonly publisher: RealtimePublisher,
    private readonly now: () => number,
  ) {}

  async settleMatch(input: SettleInput): Promise<SettlementResult> {
    const match = await this.matches.find(input.matchId);
    if (!match) throw notFound('Match');
    if (isTerminal(match.status)) throw alreadyProcessed('This match has already been resolved.');

    const kind = input.outcome.type;
    const finalStatus = FINAL_STATUS[kind];
    if (kind === 'CANCEL') {
      if (!canTransition(match.status, 'CANCELLED')) throw invalidState(`A ${match.status} match cannot be cancelled.`);
    } else if (!canTransition(match.status, 'SETTLING') || !canTransition('SETTLING', finalStatus)) {
      throw invalidState(`A ${match.status} match cannot be resolved as ${finalStatus}.`);
    }
    if (match.status === 'DISPUTED' && input.source !== 'ADMIN') {
      throw invalidState('A disputed match can only be resolved by an administrator.');
    }

    const players = await this.matches.players(match.id);
    if (players.length === 0) throw invalidState('Match has no staked players.');

    let winnerUserId: string | null = null;
    let winnerIds: string[] = [];
    const plan = (() => {
      if (input.outcome.type === 'WIN') {
        winnerUserId = input.outcome.winnerUserId;
        winnerIds = [winnerUserId, ...(input.outcome.teammateUserIds ?? [])];
        if (players.length < 2) throw invalidState('A match needs at least two players to have a winner.');
        if (new Set(winnerIds).size !== winnerIds.length || winnerIds.length >= players.length) throw new AppError('VALIDATION_ERROR', 'Invalid set of winners.');
        for (const w of winnerIds) if (!players.some((p) => p.user_id === w)) throw new AppError('VALIDATION_ERROR', 'The winner is not a player in this match.');
        return planWinSettlement(participants(players), winnerIds, match.fee_bps);
      }
      return planRefund(participants(players));
    })();

    const feeUnits = plan.kind === 'WIN' ? plan.feeUnits : 0;
    const payoutUnits = plan.kind === 'WIN' ? plan.payoutUnits : 0;
    const now = this.now();
    const postings: Posting[] = plan.postings.map((p) => ({
      from: { userId: p.fromUserId, bucket: 'LOCKED_GAME' },
      to: 'system' in p.to ? { system: 'PLATFORM_FEES' } : { userId: p.to.userId, bucket: p.to.bucket },
      amount: p.amount,
      postingType: p.postingType,
    }));
    const reason = 'reason' in input.outcome ? input.outcome.reason : null;
    const tx = this.ledger.buildTransaction({
      idempotencyKey: `match:${match.id}:resolution`,
      type: plan.kind === 'WIN' ? 'GAME_WIN_PAYOUT' : 'GAME_STAKE_REFUND',
      referenceType: 'MATCH',
      referenceId: match.id,
      gameId: match.game_id,
      createdBy: { type: input.source === 'ADMIN' ? 'ADMIN' : 'SYSTEM', id: input.actorId ?? null },
      metadata: { outcome: kind, reason, source: input.source, potUnits: plan.potUnits, feeUnits, feeBps: match.fee_bps, payoutUnits },
      postings,
    });

    const db = this.db;
    const stmts: Stmt[] = [
      // optimistic concurrency: the match must still be in the state we validated
      assertStmt(db, 'SELECT EXISTS (SELECT 1 FROM matches WHERE id = ? AND status = ?)', match.id, match.status),
      ...tx.statements,
      ...this.ledger.finalizeHoldsStmts({
        referenceType: 'MATCH',
        referenceId: match.id,
        status: plan.kind === 'WIN' ? 'CAPTURED' : 'RELEASED',
        releaseTxId: tx.txId,
        expectedActive: players.length,
      }),
      db
        .prepare(
          `UPDATE matches SET status = ?, result_type = ?, winner_user_id = ?, fee_units = ?, payout_units = ?, resolution_tx_id = ?,
             result_source = ?, result_proof = ?, void_reason = ?, ended_at = COALESCE(ended_at, ?), settled_at = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(finalStatus, kind, winnerUserId, feeUnits, payoutUnits, tx.txId, input.source, input.resultProof ?? null, reason, now, now, now, match.id),
    ];

    for (const p of players) {
      const result = kind === 'WIN' ? (winnerIds.includes(p.user_id) ? 'WIN' : 'LOSS') : kind === 'DRAW' ? 'DRAW' : 'REFUNDED';
      const payout = plan.payouts[p.user_id] ?? 0;
      stmts.push(db.prepare('UPDATE match_players SET result = ?, payout_units = ? WHERE match_id = ? AND user_id = ?').bind(result, payout, match.id, p.user_id));
      if (kind === 'WIN' || kind === 'DRAW') {
        stmts.push(
          db
            .prepare(
              `UPDATE player_stats SET games_played = games_played + 1, wins = wins + ?, losses = losses + ?, draws = draws + ?,
                 total_staked_units = total_staked_units + ?, total_won_units = total_won_units + ?, updated_at = ? WHERE user_id = ?`,
            )
            .bind(result === 'WIN' ? 1 : 0, result === 'LOSS' ? 1 : 0, result === 'DRAW' ? 1 : 0, p.stake_units, result === 'WIN' ? payout : 0, now, p.user_id),
        );
      }
    }
    if (kind !== 'CANCEL') stmts.push(this.matches.eventStmt(match.id, 'SETTLING', { outcome: kind }, input.source, input.actorId ?? null));
    stmts.push(
      this.matches.eventStmt(
        match.id,
        finalStatus,
        { outcome: kind, winnerUserId, winnerUserIds: winnerIds, potUnits: plan.potUnits, feeUnits, payoutUnits, transactionId: tx.txId, reason },
        input.source,
        input.actorId ?? null,
      ),
      ...(input.extraStatements ?? []),
    );

    try {
      await runBatch(db, stmts);
    } catch (e) {
      throw await this.mapFailure(match.id, e);
    }

    await this.afterResolution(match, players, finalStatus, winnerIds, plan.payouts);
    return { matchId: match.id, status: finalStatus, transactionId: tx.txId, potUnits: plan.potUnits, feeUnits, payoutUnits, winnerUserId, payouts: plan.payouts };
  }

  /** A non-creator leaves a room that is still waiting: only their stake is returned. */
  async releaseLeavingPlayer(matchId: string, userId: string): Promise<void> {
    const match = await this.matches.find(matchId);
    if (!match) throw notFound('Match');
    if (match.status !== 'WAITING_FOR_OPPONENT') throw invalidState('You can only leave a room before it is full.');
    const player = (await this.matches.players(matchId)).find((p) => p.user_id === userId);
    if (!player) throw notFound('Match player');
    const plan = planRefund(participants([player]));
    const tx = this.ledger.buildTransaction({
      idempotencyKey: `match:${matchId}:leave:${userId}`,
      type: 'GAME_STAKE_REFUND',
      referenceType: 'MATCH',
      referenceId: matchId,
      gameId: match.game_id,
      createdBy: { type: 'PLAYER', id: userId },
      metadata: { outcome: 'LEFT' },
      postings: plan.postings.map((p) => ({
        from: { userId, bucket: 'LOCKED_GAME' as const },
        to: 'system' in p.to ? { system: 'PLATFORM_FEES' as const } : { userId: p.to.userId, bucket: p.to.bucket },
        amount: p.amount,
        postingType: p.postingType,
      })),
    });
    const now = this.now();
    try {
      await runBatch(this.db, [
        assertStmt(
          this.db,
          `SELECT EXISTS (SELECT 1 FROM matches m JOIN match_players mp ON mp.match_id = m.id
             WHERE m.id = ? AND m.status = 'WAITING_FOR_OPPONENT' AND mp.user_id = ? AND mp.status = 'JOINED')`,
          matchId,
          userId,
        ),
        ...tx.statements,
        ...this.ledger.finalizeHoldsStmts({ referenceType: 'MATCH', referenceId: matchId, userId, status: 'RELEASED', releaseTxId: tx.txId, expectedActive: 1 }),
        this.db
          .prepare("UPDATE match_players SET status = 'LEFT', result = 'REFUNDED', payout_units = ?, left_at = ? WHERE match_id = ? AND user_id = ?")
          .bind(player.stake_units, now, matchId, userId),
        this.db
          .prepare('UPDATE matches SET player_count = player_count - 1, pot_units = pot_units - ?, updated_at = ? WHERE id = ?')
          .bind(player.stake_units, now, matchId),
        this.matches.eventStmt(matchId, 'PLAYER_LEFT', { playerNumber: player.player_number, refundUnits: player.stake_units, transactionId: tx.txId }, 'PLAYER', userId),
      ]);
    } catch (e) {
      throw await this.mapFailure(matchId, e);
    }
    this.publisher.publish(`match:${matchId}`, { type: 'match.updated' });
    this.publisher.publish(`user:${userId}`, { type: 'wallet.updated' });
  }

  /**
   * Resolves one Aviator bet, exactly once (`crash:<betId>:resolution`):
   *   WIN    → stake back + profit (capped by the bet's snapshotted max profit) from HOUSE_BANKROLL
   *   LOSS   → stake to HOUSE_BANKROLL
   *   REFUND → stake back to its original buckets (round failure)
   * The multiplier for WIN is decided by the CrashGame Durable Object from the server clock.
   */
  async settleCrashBet(betId: string, decision: { type: 'WIN'; x100: number } | { type: 'LOSS' } | { type: 'REFUND'; reason: string }): Promise<{ payoutUnits: number; status: 'CASHED_OUT' | 'LOST' | 'REFUNDED' }> {
    const bet = await first<{
      id: string;
      round_id: string;
      user_id: string;
      stake_units: number;
      stake_bonus_units: number;
      stake_available_units: number;
      max_profit_units: number;
      status: string;
      round_number: number;
      game_id: string;
    }>(this.db, 'SELECT b.*, r.round_number, r.game_id FROM crash_bets b JOIN crash_rounds r ON r.id = b.round_id WHERE b.id = ?', betId);
    if (!bet) throw notFound('Bet');
    if (bet.status !== 'ACTIVE') throw alreadyProcessed('This bet is already settled.');
    const me = { userId: bet.user_id, bucket: 'LOCKED_GAME' as const };
    const postings: Posting[] = [];
    let payout = 0;
    let status: 'CASHED_OUT' | 'LOST' | 'REFUNDED';
    let type: 'HOUSE_BET_WIN' | 'HOUSE_BET_LOSS' | 'HOUSE_BET_REFUND';
    if (decision.type === 'WIN') {
      if (!Number.isInteger(decision.x100) || decision.x100 < 100) throw new AppError('VALIDATION_ERROR', 'Bad multiplier');
      payout = crashPayoutUnits(bet.stake_units, decision.x100, bet.max_profit_units);
      const profit = payout - bet.stake_units;
      // bonus stays bonus: the stake returns to the buckets it came from, and the bonus-funded
      // share of the profit is paid as bonus (rounded down, in favour of keeping bonus apart)
      const bonusProfit = Math.floor((profit * bet.stake_bonus_units) / bet.stake_units);
      if (bet.stake_available_units > 0) postings.push({ from: me, to: { userId: bet.user_id, bucket: 'AVAILABLE' }, amount: bet.stake_available_units });
      if (bet.stake_bonus_units > 0) postings.push({ from: me, to: { userId: bet.user_id, bucket: 'BONUS' }, amount: bet.stake_bonus_units });
      if (bonusProfit > 0) postings.push({ from: { system: 'HOUSE_BANKROLL' }, to: { userId: bet.user_id, bucket: 'BONUS' }, amount: bonusProfit });
      if (profit - bonusProfit > 0) postings.push({ from: { system: 'HOUSE_BANKROLL' }, to: { userId: bet.user_id, bucket: 'AVAILABLE' }, amount: profit - bonusProfit });
      status = 'CASHED_OUT';
      type = 'HOUSE_BET_WIN';
    } else if (decision.type === 'LOSS') {
      postings.push({ from: me, to: { system: 'HOUSE_BANKROLL' }, amount: bet.stake_units });
      status = 'LOST';
      type = 'HOUSE_BET_LOSS';
    } else {
      if (bet.stake_available_units > 0) postings.push({ from: me, to: { userId: bet.user_id, bucket: 'AVAILABLE' }, amount: bet.stake_available_units });
      if (bet.stake_bonus_units > 0) postings.push({ from: me, to: { userId: bet.user_id, bucket: 'BONUS' }, amount: bet.stake_bonus_units });
      payout = bet.stake_units;
      status = 'REFUNDED';
      type = 'HOUSE_BET_REFUND';
    }
    const tx = this.ledger.buildTransaction({
      idempotencyKey: `crash:${betId}:resolution`,
      type,
      referenceType: 'CRASH_BET',
      referenceId: betId,
      gameId: bet.game_id,
      createdBy: { type: 'SYSTEM', id: null },
      metadata: { label: `Aviator round #${bet.round_number}`, x100: decision.type === 'WIN' ? decision.x100 : null, reason: decision.type === 'REFUND' ? decision.reason : null },
      postings,
    });
    const now = this.now();
    try {
      await runBatch(this.db, [
        assertStmt(this.db, "SELECT EXISTS (SELECT 1 FROM crash_bets WHERE id = ? AND status = 'ACTIVE')", betId),
        ...(decision.type === 'WIN' ? [assertStmt(this.db, "SELECT EXISTS (SELECT 1 FROM crash_rounds WHERE id = ? AND status = 'FLYING')", bet.round_id)] : []),
        ...tx.statements,
        ...this.ledger.finalizeHoldsStmts({ referenceType: 'CRASH_BET', referenceId: betId, status: decision.type === 'REFUND' ? 'RELEASED' : 'CAPTURED', releaseTxId: tx.txId, expectedActive: 1 }),
        this.db
          .prepare('UPDATE crash_bets SET status = ?, cashout_x100 = ?, payout_units = ?, resolution_tx_id = ?, updated_at = ? WHERE id = ?')
          .bind(status, decision.type === 'WIN' ? decision.x100 : null, payout, tx.txId, now, betId),
      ]);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'IDEMPOTENCY' || err.kind === 'ASSERTION') {
        if (decision.type === 'WIN') throw new AppError('CASHOUT_TOO_LATE');
        throw alreadyProcessed('This bet is already settled.');
      }
      if (err.kind === 'BALANCE') throw new AppError('BANKROLL_LIMIT');
      throw err;
    }
    this.publisher.publish(`user:${bet.user_id}`, { type: 'wallet.updated' });
    return { payoutUnits: payout, status };
  }

  private async mapFailure(matchId: string, e: unknown): Promise<Error> {
    const err = classifyDbError(e);
    if (err.kind === 'IDEMPOTENCY' || err.kind === 'ASSERTION' || err.kind === 'UNIQUE') {
      const fresh = await this.matches.find(matchId);
      if (fresh && isTerminal(fresh.status)) return alreadyProcessed('This match has already been resolved.');
      return new AppError('CONFLICT', 'The match changed while it was being resolved. Refresh and try again.');
    }
    if (err.kind === 'BALANCE') return new AppError('CONFLICT', 'Escrow balances do not match the match stakes. Run the ledger integrity check.');
    return err;
  }

  private async afterResolution(match: MatchRow, players: MatchPlayerRow[], status: MatchStatus, winnerIds: string[], payouts: Record<string, number>): Promise<void> {
    const label = `Match #${match.match_number}`;
    for (const p of players) {
      const payout = payouts[p.user_id] ?? 0;
      let title: string;
      let body: string;
      if (status === 'SETTLED') {
        title = winnerIds.includes(p.user_id) ? `You won ${label}!` : `${label} result`;
        body = winnerIds.includes(p.user_id) ? `${formatTokens(payout)} has been added to your available balance.` : `You lost your stake of ${formatTokens(p.stake_units)}.`;
      } else {
        title = `${label}: ${status === 'DRAW' ? 'draw' : status.toLowerCase()}`;
        body = `Your stake of ${formatTokens(payout)} has been returned.`;
      }
      await this.notifications.notifyPlayer(p.user_id, { type: status === 'SETTLED' ? 'MATCH_RESULT' : 'REFUND', title, body, link: `/matches/${match.id}` });
      this.publisher.publish(`user:${p.user_id}`, { type: 'wallet.updated' });
    }
    this.publisher.publish(`match:${match.id}`, { type: 'match.updated', data: { status } });
  }
}
