import { tokensToUnits, type GameDto, type GameKind, type GameModule, type PlatformSettings } from '@arena/shared';
import { all, first, runBatch, toBool } from '../lib/db';
import { AppError, notFound } from '../lib/errors';
import { getGameModule } from '../games/modules';
import type { AuditService } from './audit';

interface GameRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  thumbnail_url: string | null;
  module_key: string | null;
  kind: GameKind;
  enabled: number;
  maintenance_mode: number;
  minimum_stake_units: number;
  maximum_stake_units: number;
  minimum_players: number;
  maximum_players: number;
  game_version: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface GameUpdate {
  name?: string;
  description?: string;
  thumbnailUrl?: string;
  enabled?: boolean;
  maintenanceMode?: boolean;
  minimumStakeUnits?: number;
  maximumStakeUnits?: number;
  minimumPlayers?: number;
  maximumPlayers?: number;
  gameVersion?: string;
  moduleKey?: string;
}

/**
 * Game registry. Names, descriptions, thumbnails and modules are data — replacing them never
 * touches wallet or settlement code.
 */
export class GameService {
  constructor(
    private readonly db: D1Database,
    private readonly production: boolean,
    private readonly now: () => number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly modules?: Record<string, GameModule<any>>,
  ) {}

  private map(r: GameRow): GameDto {
    const moduleInstalled = r.kind === 'CRASH' ? r.module_key === 'aviator' : !!getGameModule(r.module_key, this.modules);
    const enabled = toBool(r.enabled);
    const maintenance = toBool(r.maintenance_mode);
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      thumbnailUrl: r.thumbnail_url,
      enabled,
      maintenanceMode: maintenance,
      minimumStakeUnits: r.minimum_stake_units,
      maximumStakeUnits: r.maximum_stake_units,
      minimumPlayers: r.minimum_players,
      maximumPlayers: r.maximum_players,
      gameVersion: r.game_version,
      moduleKey: r.module_key,
      kind: r.kind,
      moduleInstalled,
      playable: enabled && !maintenance && (moduleInstalled || !this.production),
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async list(): Promise<GameDto[]> {
    const rows = await all<GameRow>(this.db, 'SELECT * FROM games ORDER BY sort_order, id');
    return rows.map((r) => this.map(r));
  }

  async get(idOrSlug: string): Promise<GameDto> {
    const r = await first<GameRow>(this.db, 'SELECT * FROM games WHERE id = ? OR slug = ?', idOrSlug, idOrSlug);
    if (!r) throw notFound('Game');
    return this.map(r);
  }

  /** Throws unless a match may be created/joined for this game at this stake right now. */
  assertPlayable(game: GameDto, settings: PlatformSettings, stakeUnits: number, opts: { allowDisabled?: boolean } = {}): void {
    if (!settings.games_enabled && !opts.allowDisabled) throw new AppError('FEATURE_DISABLED', 'Games are currently disabled.');
    if (!opts.allowDisabled && !game.playable) throw new AppError('GAME_UNAVAILABLE');
    const min = Math.max(game.minimumStakeUnits, tokensToUnits(settings.minimum_match_stake));
    const max = Math.min(game.maximumStakeUnits, tokensToUnits(settings.maximum_match_stake));
    if (stakeUnits < min || stakeUnits > max) {
      throw new AppError('STAKE_OUT_OF_RANGE', undefined, { minimumStakeUnits: min, maximumStakeUnits: max });
    }
  }

  async update(id: string, patch: GameUpdate, adminUserId: string, reason: string, audit: AuditService): Promise<GameDto> {
    const current = await this.get(id);
    const next = {
      name: patch.name ?? current.name,
      description: patch.description ?? current.description,
      thumbnailUrl: patch.thumbnailUrl === undefined ? current.thumbnailUrl : patch.thumbnailUrl || null,
      enabled: patch.enabled ?? current.enabled,
      maintenanceMode: patch.maintenanceMode ?? current.maintenanceMode,
      minimumStakeUnits: patch.minimumStakeUnits ?? current.minimumStakeUnits,
      maximumStakeUnits: patch.maximumStakeUnits ?? current.maximumStakeUnits,
      minimumPlayers: patch.minimumPlayers ?? current.minimumPlayers,
      maximumPlayers: patch.maximumPlayers ?? current.maximumPlayers,
      gameVersion: patch.gameVersion ?? current.gameVersion,
      moduleKey: patch.moduleKey === undefined ? current.moduleKey : patch.moduleKey || null,
    };
    if (next.maximumStakeUnits < next.minimumStakeUnits) throw new AppError('VALIDATION_ERROR', 'Maximum stake must be at least the minimum stake.');
    if (next.maximumPlayers < next.minimumPlayers) throw new AppError('VALIDATION_ERROR', 'Maximum players must be at least the minimum players.');
    if (current.kind === 'ROOM' && next.minimumPlayers < 2) throw new AppError('VALIDATION_ERROR', 'Room games need at least 2 players.');
    if (current.kind === 'CRASH' && next.moduleKey !== 'aviator') throw new AppError('VALIDATION_ERROR', 'Crash games use the built-in aviator engine (module key "aviator").');
    if (next.enabled && this.production && current.kind === 'ROOM' && !getGameModule(next.moduleKey, this.modules)) {
      throw new AppError('GAME_MODULE_MISSING', 'Install a game module and set its module key before enabling this game.');
    }
    await runBatch(this.db, [
      this.db
        .prepare(
          `UPDATE games SET name = ?, description = ?, thumbnail_url = ?, enabled = ?, maintenance_mode = ?, minimum_stake_units = ?,
             maximum_stake_units = ?, minimum_players = ?, maximum_players = ?, game_version = ?, module_key = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(
          next.name,
          next.description,
          next.thumbnailUrl,
          next.enabled ? 1 : 0,
          next.maintenanceMode ? 1 : 0,
          next.minimumStakeUnits,
          next.maximumStakeUnits,
          next.minimumPlayers,
          next.maximumPlayers,
          next.gameVersion,
          next.moduleKey,
          this.now(),
          current.id,
        ),
      audit.stmt({ adminUserId, action: 'game.update', entityType: 'game', entityId: current.id, before: current, after: next, reason }),
    ]);
    return this.get(current.id);
  }
}
