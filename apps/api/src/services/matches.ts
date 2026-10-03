/**
 * Match lifecycle up to the point of resolution: create rooms, quick match, private rooms,
 * joining (stake locking), leaving, starting. Escrow is only ever RESOLVED by SettlementService.
 */
import {
  type InvitePreviewDto,
  ACTIVE_MATCH_STATUSES,
  formatTokens,
  isTerminal,
  MAX_ACTIVE_MATCHES_PER_PLAYER,
  READY_MATCH_TTL_MS,
  splitStake,
  STUCK_MATCH_ALERT_MS,
  WAITING_MATCH_TTL_MS,
  type MatchDto,
  type MatchMode,
  type MatchStatus,
  type MatchVisibility,
  type SettlementSource,
} from '@arena/shared';
import { all, assertStmt, classifyDbError, counterValueSql, first, nextCounterStmt, runBatch, type Stmt } from '../lib/db';
import { AppError, invalidState, notFound } from '../lib/errors';
import { randomCode, ulid } from '../lib/ids';
import { toMatchDto, type MatchRepository, type MatchRow } from '../repositories/matches';
import type { UserRecord } from '../repositories/users';
import type { WalletRepository } from '../repositories/wallets';
import type { RealtimePublisher } from '../realtime/publisher';
import type { FraudService } from './fraud';
import type { GameService } from './games';
import { assertCanTransact, assertNotMaintenance } from './guards';
import type { LedgerService } from './ledger';
import type { NotificationService } from './notifications';
import type { SettingsService } from './settings';
import type { SettlementService } from './settlement';

export interface CreateMatchInput {
  gameId: string;
  stakeUnits: number;
  visibility: MatchVisibility;
  maxPlayers?: number;
  mode?: MatchMode;
}

interface Options {
  /** development simulator only: allows disabled/maintenance games */
  allowDisabledGame?: boolean;
  /** a 🤖 bot seat (BotService): bots may sit in many rooms at once */
  asBot?: boolean;
}

export class MatchService {
  constructor(
    private readonly db: D1Database,
    private readonly repo: MatchRepository,
    private readonly wallets: WalletRepository,
    private readonly ledger: LedgerService,
    private readonly games: GameService,
    private readonly settings: SettingsService,
    private readonly settlement: SettlementService,
    private readonly notifications: NotificationService,
    private readonly fraud: FraudService,
    private readonly publisher: RealtimePublisher,
    private readonly now: () => number,
  ) {}

  private async stakeSplit(userId: string, stakeUnits: number): Promise<{ fromBonus: number; fromAvailable: number }> {
    const wallet = await this.wallets.getWallet(userId);
    const split = splitStake(stakeUnits, wallet.availableUnits, wallet.bonusUnits);
    if (!split) throw new AppError('INSUFFICIENT_BALANCE');
    return split;
  }

  private lockStatements(p: { matchId: string; userId: string; gameId: string; key: string; split: { fromBonus: number; fromAvailable: number }; stakeUnits: number }): { txId: string; statements: Stmt[] } {
    const postings = [];
    if (p.split.fromAvailable > 0) postings.push({ from: { userId: p.userId, bucket: 'AVAILABLE' as const }, to: { userId: p.userId, bucket: 'LOCKED_GAME' as const }, amount: p.split.fromAvailable });
    if (p.split.fromBonus > 0) postings.push({ from: { userId: p.userId, bucket: 'BONUS' as const }, to: { userId: p.userId, bucket: 'LOCKED_GAME' as const }, amount: p.split.fromBonus });
    const tx = this.ledger.buildTransaction({
      idempotencyKey: p.key,
      type: 'GAME_STAKE_LOCK',
      referenceType: 'MATCH',
      referenceId: p.matchId,
      gameId: p.gameId,
      createdBy: { type: 'PLAYER', id: p.userId },
      metadata: { stakeUnits: p.stakeUnits, fromBonus: p.split.fromBonus, fromAvailable: p.split.fromAvailable },
      postings,
    });
    return {
      txId: tx.txId,
      statements: [
        ...tx.statements,
        this.ledger.createHoldStmt({ userId: p.userId, bucket: 'LOCKED_GAME', amount: p.stakeUnits, referenceType: 'MATCH', referenceId: p.matchId, lockTxId: tx.txId }),
      ],
    };
  }

  async create(user: UserRecord, input: CreateMatchInput, clientKey: string, opts: Options = {}): Promise<{ match: MatchDto; replayed: boolean }> {
    assertCanTransact(user);
    const settings = await this.settings.get();
    if (!opts.allowDisabledGame) assertNotMaintenance(settings);
    const game = await this.games.get(input.gameId);
    if (game.kind !== 'ROOM') throw new AppError('GAME_UNAVAILABLE', 'This game does not use match rooms.');
    this.games.assertPlayable(game, settings, input.stakeUnits, { allowDisabled: opts.allowDisabledGame });
    const maxPlayers = Math.min(Math.max(input.maxPlayers ?? game.maximumPlayers, game.minimumPlayers), game.maximumPlayers);

    const key = `stake:${user.id}:${clientKey}`;
    const existing = await this.ledger.findByIdempotencyKey(key);
    if (existing?.reference_id) return { match: await this.get(existing.reference_id, user.id), replayed: true };

    if ((await this.repo.activeCountFor(user.id)) >= MAX_ACTIVE_MATCHES_PER_PLAYER) throw new AppError('TOO_MANY_ACTIVE_MATCHES');
    const split = await this.stakeSplit(user.id, input.stakeUnits);

    for (let attempt = 0; attempt < 3; attempt++) {
      const id = ulid();
      const now = this.now();
      const joinCode = input.visibility === 'PRIVATE' ? randomCode(6) : null;
      const lock = this.lockStatements({ matchId: id, userId: user.id, gameId: game.id, key, split, stakeUnits: input.stakeUnits });
      const stmts: Stmt[] = [
        nextCounterStmt(this.db, 'match'),
        this.db
          .prepare(
            `INSERT INTO matches (id, match_number, game_id, creator_id, mode, visibility, join_code, stake_units, min_players, max_players,
               player_count, fee_bps, game_version, status, pot_units, created_at, updated_at)
             VALUES (?, ${counterValueSql}, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'CREATED', ?, ?, ?)`,
          )
          .bind(
            id,
            'match',
            game.id,
            user.id,
            input.mode ?? 'ROOM',
            input.visibility,
            joinCode,
            input.stakeUnits,
            game.minimumPlayers,
            maxPlayers,
            settings.MATCH_FEE_BPS, // fee snapshot: later fee changes never affect this match
            game.gameVersion,
            input.stakeUnits,
            now,
            now,
          ),
        this.db
          .prepare(
            `INSERT INTO match_players (id, match_id, user_id, seat, stake_units, stake_bonus_units, stake_available_units, status, joined_at)
             VALUES (?, ?, ?, 1, ?, ?, ?, 'JOINED', ?)`,
          )
          .bind(ulid(), id, user.id, input.stakeUnits, split.fromBonus, split.fromAvailable, now),
        this.repo.eventStmt(id, 'CREATED', { stakeUnits: input.stakeUnits, visibility: input.visibility, feeBps: settings.MATCH_FEE_BPS }, 'PLAYER', user.id),
        ...lock.statements,
        this.repo.eventStmt(id, 'STAKE_LOCKED', { playerNumber: user.playerNumber, stakeUnits: input.stakeUnits, transactionId: lock.txId }, 'PLAYER', user.id),
        this.db.prepare("UPDATE matches SET status = 'WAITING_FOR_OPPONENT', updated_at = ? WHERE id = ? AND status = 'CREATED'").bind(now, id),
        this.repo.eventStmt(id, 'WAITING_FOR_OPPONENT', {}, 'SYSTEM', null),
      ];
      try {
        await runBatch(this.db, stmts);
        this.publisher.publish(`user:${user.id}`, { type: 'wallet.updated' });
        return { match: await this.get(id, user.id), replayed: false };
      } catch (e) {
        const err = classifyDbError(e);
        if (err.kind === 'BALANCE') throw new AppError('INSUFFICIENT_BALANCE');
        if (err.kind === 'IDEMPOTENCY') {
          const prior = await this.ledger.findByIdempotencyKey(key);
          if (prior?.reference_id) return { match: await this.get(prior.reference_id, user.id), replayed: true };
        }
        if (err.kind === 'UNIQUE' && err.mentions('join_code')) continue; // room code collision — retry with a new code
        throw err;
      }
    }
    throw new AppError('CONFLICT', 'Could not allocate a room code. Please try again.');
  }

  async join(user: UserRecord, matchId: string, opts: Options = {}): Promise<MatchDto> {
    assertCanTransact(user);
    const settings = await this.settings.get();
    if (!opts.allowDisabledGame) assertNotMaintenance(settings);
    const match = await this.repo.find(matchId);
    if (!match) throw notFound('Match');
    const all = await this.repo.players(matchId, true);
    if (all.some((p) => p.user_id === user.id)) throw new AppError('ALREADY_IN_MATCH');
    if (match.status !== 'WAITING_FOR_OPPONENT') throw invalidState('This match is not accepting players.');
    if (match.player_count >= match.max_players) throw new AppError('MATCH_FULL');
    const game = await this.games.get(match.game_id);
    this.games.assertPlayable(game, settings, match.stake_units, { allowDisabled: opts.allowDisabledGame });
    if (!opts.asBot && (await this.repo.activeCountFor(user.id)) >= MAX_ACTIVE_MATCHES_PER_PLAYER) throw new AppError('TOO_MANY_ACTIVE_MATCHES');
    const split = await this.stakeSplit(user.id, match.stake_units);

    const now = this.now();
    const lock = this.lockStatements({ matchId, userId: user.id, gameId: match.game_id, key: `match:${matchId}:stake:${user.id}`, split, stakeUnits: match.stake_units });
    const becomesReady = match.player_count + 1 >= match.max_players;
    const stmts: Stmt[] = [
      assertStmt(this.db, "SELECT EXISTS (SELECT 1 FROM matches WHERE id = ? AND status = 'WAITING_FOR_OPPONENT' AND player_count < max_players)", matchId),
      this.db
        .prepare(
          `INSERT INTO match_players (id, match_id, user_id, seat, stake_units, stake_bonus_units, stake_available_units, status, joined_at)
           VALUES (?, ?, ?, (SELECT COALESCE(MAX(seat), 0) + 1 FROM match_players WHERE match_id = ?), ?, ?, ?, 'JOINED', ?)`,
        )
        .bind(ulid(), matchId, user.id, matchId, match.stake_units, split.fromBonus, split.fromAvailable, now),
      this.repo.eventStmt(matchId, 'STAKE_LOCKING', { playerNumber: user.playerNumber }, 'PLAYER', user.id),
      ...lock.statements,
      this.db
        .prepare(
          `UPDATE matches SET player_count = player_count + 1, pot_units = pot_units + ?, updated_at = ?,
             status = CASE WHEN player_count + 1 >= max_players THEN 'READY' ELSE 'WAITING_FOR_OPPONENT' END,
             ready_at = CASE WHEN player_count + 1 >= max_players THEN ? ELSE ready_at END
           WHERE id = ?`,
        )
        .bind(match.stake_units, now, now, matchId),
      this.repo.eventStmt(matchId, 'PLAYER_JOINED', { playerNumber: user.playerNumber, stakeUnits: match.stake_units, transactionId: lock.txId }, 'PLAYER', user.id),
    ];
    if (becomesReady) stmts.push(this.repo.eventStmt(matchId, 'READY', {}, 'SYSTEM', null));
    try {
      await runBatch(this.db, stmts);
    } catch (e) {
      const err = classifyDbError(e);
      if (err.kind === 'BALANCE') throw new AppError('INSUFFICIENT_BALANCE');
      if (err.kind === 'IDEMPOTENCY' || (err.kind === 'UNIQUE' && err.mentions('match_players'))) throw new AppError('ALREADY_IN_MATCH');
      if (err.kind === 'ASSERTION') {
        const fresh = await this.repo.find(matchId);
        if (fresh && fresh.player_count >= fresh.max_players) throw new AppError('MATCH_FULL');
        throw invalidState('This match is no longer accepting players.');
      }
      throw err;
    }

    const dto = await this.get(matchId, user.id);
    this.publisher.publish(`match:${matchId}`, { type: 'match.updated' });
    this.publisher.publish(`user:${user.id}`, { type: 'wallet.updated' });
    if (dto.status === 'READY') {
      const players = await this.repo.players(matchId);
      for (const p of players) {
        await this.notifications.notifyPlayer(p.user_id, {
          type: 'MATCH_OPPONENT_FOUND',
          title: `Opponent found — Match #${dto.matchNumber}`,
          body: `${dto.gameName} for ${formatTokens(dto.stakeUnits)} each. Your room is ready.`,
          link: `/matches/${matchId}`,
        });
      }
      if (!opts.asBot) await this.fraud.checkMatchOpponents(matchId, players.map((p) => p.user_id));
    }
    return dto;
  }

  async quickMatch(user: UserRecord, gameId: string, stakeUnits: number, clientKey: string): Promise<{ match: MatchDto; joined: boolean }> {
    const candidates = await this.repo.quickCandidates(gameId, stakeUnits, user.id);
    for (const c of candidates) {
      try {
        return { match: await this.join(user, c.id), joined: true };
      } catch (e) {
        if (e instanceof AppError && ['MATCH_FULL', 'INVALID_STATE_TRANSITION', 'ALREADY_IN_MATCH'].includes(e.code)) continue;
        throw e;
      }
    }
    const created = await this.create(user, { gameId, stakeUnits, visibility: 'PUBLIC', mode: 'QUICK' }, clientKey);
    return { match: created.match, joined: false };
  }

  /** Public preview of a private room for its invite page. Shows only what the invite already implies. */
  async invitePreview(code: string, welcomeBonusTokens: number): Promise<InvitePreviewDto> {
    const m = await first<MatchRow>(this.db, 'SELECT * FROM matches WHERE join_code = ? ORDER BY created_at DESC LIMIT 1', code.toUpperCase());
    if (!m || m.visibility !== 'PRIVATE') throw notFound('Room');
    const dto = await this.get(m.id, null);
    const host = dto.players.find((pl) => pl.seat === 0) ?? dto.players[0];
    return {
      code: code.toUpperCase(),
      matchId: dto.id,
      open: dto.status === 'WAITING_FOR_OPPONENT' && dto.playerCount < dto.maxPlayers,
      gameId: dto.gameId,
      gameName: dto.gameName,
      stakeUnits: dto.stakeUnits,
      hostName: host?.displayName || host?.username || 'A friend',
      playerCount: dto.playerCount,
      maxPlayers: dto.maxPlayers,
      welcomeBonusTokens,
    };
  }

  async joinByCode(user: UserRecord, code: string): Promise<MatchDto> {
    const match = await this.repo.findOpenByCode(code);
    if (!match) throw notFound('Room');
    return this.join(user, match.id);
  }

  /**
   * The host starts the game with the people already in the room (no bots): the room shrinks to
   * the players present. Needs at least the game's minimum (Ludo: 2).
   */
  async startNow(user: UserRecord, matchId: string): Promise<MatchDto> {
    const match = await this.repo.find(matchId);
    if (!match) throw notFound('Match');
    if (match.creator_id !== user.id) throw new AppError('FORBIDDEN', 'Only the player who opened the room can start it.');
    if (match.status !== 'WAITING_FOR_OPPONENT') throw invalidState('This room is not waiting for players.');
    if (match.player_count < match.min_players) throw new AppError('VALIDATION_ERROR', `This game needs at least ${match.min_players} players.`);
    const now = this.now();
    await runBatch(this.db, [
      this.db
        .prepare("UPDATE matches SET max_players = player_count, status = 'READY', ready_at = ?, updated_at = ? WHERE id = ? AND status = 'WAITING_FOR_OPPONENT' AND player_count >= min_players")
        .bind(now, now, matchId),
      assertStmt(this.db, "SELECT EXISTS (SELECT 1 FROM matches WHERE id = ? AND status = 'READY')", matchId),
      this.repo.eventStmt(matchId, 'READY', { startedBy: user.playerNumber, players: match.player_count }, 'PLAYER', user.id),
    ]);
    const dto = await this.get(matchId, user.id);
    this.publisher.publish(`match:${matchId}`, { type: 'match.updated' });
    const players = await this.repo.players(matchId);
    for (const p of players) {
      if (p.user_id === user.id) continue;
      await this.notifications.notifyPlayer(p.user_id, {
        type: 'MATCH_OPPONENT_FOUND',
        title: `Game starting — Match #${dto.matchNumber}`,
        body: `${dto.gameName} for ${formatTokens(dto.stakeUnits)} each. The host started the game.`,
        link: `/matches/${matchId}`,
      });
    }
    await this.fraud.checkMatchOpponents(matchId, players.map((p) => p.user_id));
    return dto;
  }

  /** Creator leaving cancels the room (everyone refunded); anyone else gets only their own stake back. */
  async leave(user: UserRecord, matchId: string): Promise<MatchDto> {
    const match = await this.repo.find(matchId);
    if (!match) throw notFound('Match');
    const players = await this.repo.players(matchId);
    if (!players.some((p) => p.user_id === user.id)) throw notFound('Match');
    if (match.creator_id === user.id) {
      if (!['CREATED', 'WAITING_FOR_OPPONENT', 'READY'].includes(match.status) || (match.status === 'READY' && match.started_at)) {
        throw invalidState('The match has already started.');
      }
      await this.settlement.settleMatch({ matchId, outcome: { type: 'CANCEL', reason: 'Cancelled by room creator' }, source: 'SYSTEM', actorId: user.id });
    } else {
      await this.settlement.releaseLeavingPlayer(matchId, user.id);
    }
    return this.get(matchId, user.id);
  }

  async markPlaying(matchId: string, source: SettlementSource, actorId: string | null): Promise<void> {
    const now = this.now();
    const res = await runBatch(this.db, [
      this.db.prepare("UPDATE matches SET status = 'PLAYING', started_at = ?, updated_at = ? WHERE id = ? AND status = 'READY'").bind(now, now, matchId),
    ]);
    if ((res[0]?.meta?.changes ?? 0) === 0) {
      const m = await this.repo.find(matchId);
      if (m?.status === 'PLAYING') return;
      throw invalidState('Only a READY match can start.');
    }
    await this.recordEvent(matchId, 'STARTED', {}, source, actorId);
    this.publisher.publish(`match:${matchId}`, { type: 'match.updated', data: { status: 'PLAYING' } });
  }

  async markResultPending(matchId: string, proposed: unknown, source: SettlementSource): Promise<void> {
    const now = this.now();
    await runBatch(this.db, [
      this.db.prepare("UPDATE matches SET status = 'RESULT_PENDING', ended_at = ?, updated_at = ? WHERE id = ? AND status = 'PLAYING'").bind(now, now, matchId),
      this.repo.eventStmt(matchId, 'RESULT_REPORTED', proposed, source, null),
    ]);
  }

  async recordEvent(matchId: string, type: string, payload: unknown, actorType: string, actorId: string | null): Promise<void> {
    await this.repo.eventStmt(matchId, type, payload, actorType, actorId).run();
  }

  async get(matchId: string, viewerId: string | null): Promise<MatchDto> {
    const m = await this.repo.find(matchId);
    if (!m) throw notFound('Match');
    const [players, names] = await Promise.all([this.repo.players(matchId), this.repo.gameNames([m.game_id])]);
    return toMatchDto(m, players, names.get(m.game_id) ?? m.game_id, viewerId);
  }

  async toDtos(rows: MatchRow[], viewerId: string | null): Promise<MatchDto[]> {
    const [players, names] = await Promise.all([this.repo.playersForMatches(rows.map((r) => r.id)), this.repo.gameNames(rows.map((r) => r.game_id))]);
    return rows.map((m) => toMatchDto(m, players.get(m.id) ?? [], names.get(m.game_id) ?? m.game_id, viewerId));
  }

  async listMine(userId: string, q: { page: number; pageSize: number; status?: MatchStatus }): Promise<{ items: MatchDto[]; hasMore: boolean }> {
    const rows = await this.repo.listForUser(userId, q);
    return { items: await this.toDtos(rows.slice(0, q.pageSize), userId), hasMore: rows.length > q.pageSize };
  }

  async listOpen(gameId: string | undefined, viewerId: string): Promise<MatchDto[]> {
    return this.toDtos(await this.repo.openPublic(gameId), viewerId);
  }

  /**
   * Cron: cancel & refund rooms that waited too long or never started; alert admins about
   * matches stuck in PLAYING (never auto-settled — a human decides).
   */
  async expireStale(now: number): Promise<{ cancelled: number; alerted: number }> {
    let cancelled = 0;
    let alerted = 0;
    const stale = await all<{ id: string }>(
      this.db,
      `SELECT id FROM matches WHERE (status = 'WAITING_FOR_OPPONENT' AND updated_at < ?) OR (status = 'READY' AND updated_at < ?) LIMIT 50`,
      now - WAITING_MATCH_TTL_MS,
      now - READY_MATCH_TTL_MS,
    );
    for (const m of stale) {
      try {
        await this.settlement.settleMatch({ matchId: m.id, outcome: { type: 'CANCEL', reason: 'Expired before the match started' }, source: 'SYSTEM' });
        cancelled++;
      } catch (e) {
        console.warn('expire match failed', m.id, e instanceof Error ? e.message : e);
      }
    }
    const stuck = await all<{ id: string; match_number: number }>(
      this.db,
      `SELECT m.id, m.match_number FROM matches m WHERE m.status IN ('PLAYING', 'RESULT_PENDING') AND m.updated_at < ?
         AND NOT EXISTS (SELECT 1 FROM match_events e WHERE e.match_id = m.id AND e.type = 'STUCK_ALERT') LIMIT 20`,
      now - STUCK_MATCH_ALERT_MS,
    );
    for (const m of stuck) {
      await this.recordEvent(m.id, 'STUCK_ALERT', {}, 'SYSTEM', null);
      await this.notifications.notifyAdmins('matches.manage', {
        type: 'ADMIN_STUCK_MATCH',
        title: `Match #${m.match_number} looks stuck`,
        body: 'It has been in progress for a long time. Review it and void it if the game server failed.',
        link: `/admin/games/matches/${m.id}`,
      });
      alerted++;
    }
    return { cancelled, alerted };
  }

  async activeMatchCount(): Promise<number> {
    const r = await first<{ n: number }>(this.db, `SELECT COUNT(*) AS n FROM matches WHERE status IN (${ACTIVE_MATCH_STATUSES.map(() => '?').join(',')})`, ...ACTIVE_MATCH_STATUSES);
    return r?.n ?? 0;
  }

  isFinal(status: MatchStatus): boolean {
    return isTerminal(status);
  }
}
