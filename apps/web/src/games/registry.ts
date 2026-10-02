/**
 * Browser-side game clients, keyed by the registry row's module_key (same key as the server
 * GameModule in packages/games). Each client renders its game and talks to its GameRoom through
 * `useGameRoom`; it can only SEND moves — results always come from the server.
 * Aviator is not listed here: it is house-banked and rendered by aviator/AviatorGame.tsx.
 */
import type { ComponentType } from 'react';
import { CallBridgeClient } from './call-bridge/CallBridgeClient';
import { CarromClient } from './carrom/CarromClient';
import { ChessClient } from './chess/ChessClient';
import { LudoClient } from './ludo/LudoClient';
import { TwentyNineClient } from './twenty-nine/TwentyNineClient';
import type { GameClientProps } from './types';

export type { GameClientProps } from './types';

export const GAME_CLIENTS: Record<string, ComponentType<GameClientProps>> = {
  ludo: LudoClient,
  'call-bridge': CallBridgeClient,
  'twenty-nine': TwentyNineClient,
  carrom: CarromClient,
  chess: ChessClient,
};
