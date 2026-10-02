import type { MatchDto } from '@arena/shared';
import type { GameRoomConnection } from './useGameRoom';

/** Props every game client receives. The client may only SEND moves — results come from the server. */
export interface GameClientProps {
  match: MatchDto;
  room: GameRoomConnection;
}
