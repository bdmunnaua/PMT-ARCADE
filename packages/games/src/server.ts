/**
 * Server-side game modules (authoritative rules). Imported by the API Worker only.
 * Each game lives in its own folder: rules.ts (pure rules) + module.ts (GameModule adapter).
 * Aviator is house-banked and runs in its own Durable Object (apps/api/src/durable/crash-game.ts)
 * using aviator/crash.ts — it is not a GameModule.
 */
import type { GameModule } from '@arena/shared';
import { callBridgeModule } from './call-bridge/module';
import { carromModule } from './carrom/module';
import { chessModule } from './chess/module';
import { ludoModule } from './ludo/module';
import { twentyNineModule } from './twenty-nine/module';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ROOM_GAME_MODULES: Record<string, GameModule<any>> = {
  [ludoModule.moduleKey]: ludoModule,
  [callBridgeModule.moduleKey]: callBridgeModule,
  [twentyNineModule.moduleKey]: twentyNineModule,
  [carromModule.moduleKey]: carromModule,
  [chessModule.moduleKey]: chessModule,
};

export { ludoModule, callBridgeModule, twentyNineModule, carromModule, chessModule };
