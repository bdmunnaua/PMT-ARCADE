import type { PlatformSettings } from '@arena/shared';
import { AppError } from '../lib/errors';
import type { UserRecord } from '../repositories/users';

/** Only ACTIVE accounts may create matches, join matches, buy or sell. */
export function assertCanTransact(user: UserRecord): void {
  switch (user.accountStatus) {
    case 'ACTIVE':
      return;
    case 'RESTRICTED':
      throw new AppError('ACCOUNT_RESTRICTED');
    case 'SUSPENDED':
      throw new AppError('ACCOUNT_SUSPENDED');
    case 'BANNED':
      throw new AppError('ACCOUNT_BANNED');
  }
}

export function assertNotMaintenance(settings: PlatformSettings): void {
  if (settings.maintenance_mode) throw new AppError('MAINTENANCE_MODE');
}
