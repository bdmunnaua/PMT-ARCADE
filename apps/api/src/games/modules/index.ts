/**
 * Installed game modules, keyed by module key.
 *
 * The game implementations live in packages/games (one folder per game). To add a game, see
 * docs/ADDING_A_GAME.md: implement it there, add it to ROOM_GAME_MODULES, then set the registry
 * row's `module_key` in Admin → Games → Game Registry.
 */
import type { GameModule } from '@arena/shared';
import { ROOM_GAME_MODULES } from '@arena/games/server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- modules carry their own state types
export const GAME_MODULES: Record<string, GameModule<any>> = ROOM_GAME_MODULES;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getGameModule(moduleKey: string | null | undefined, registry: Record<string, GameModule<any>> = GAME_MODULES): GameModule<any> | null {
  if (!moduleKey) return null;
  return registry[moduleKey] ?? null;
}
