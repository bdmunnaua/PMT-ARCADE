import type { PlayerSummaryDto } from '@arena/shared';
import type { UserRecord } from '../repositories/users';

const DAY_MS = 24 * 60 * 60 * 1000;

export function playerSummary(u: UserRecord, now: number): PlayerSummaryDto {
  return {
    id: u.id,
    playerNumber: u.playerNumber,
    username: u.username,
    displayName: u.displayName,
    accountStatus: u.accountStatus,
    createdAt: u.createdAt,
    accountAgeDays: Math.max(0, Math.floor((now - u.createdAt) / DAY_MS)),
  };
}
