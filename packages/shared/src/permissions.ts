export const PERMISSIONS = [
  'players.view',
  'players.manage',
  'players.view_sensitive',
  'support.view',
  'support.notes',
  'finance.view',
  'finance.buy.manage',
  'finance.sell.manage',
  'finance.chat',
  'finance.distribute',
  'finance.treasury',
  'finance.ledger.view',
  'finance.integrity',
  'games.view',
  'games.manage',
  'matches.view',
  'matches.manage',
  'disputes.view',
  'disputes.manage',
  'risk.view',
  'risk.manage',
  'security.login_activity',
  'audit.view',
  'admins.manage',
  'settings.view',
  'settings.manage',
  'dev.simulator',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ADMIN_ROLES = ['SUPER_ADMIN', 'FINANCE_ADMIN', 'GAME_ADMIN', 'SUPPORT_ADMIN', 'RISK_ADMIN'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/**
 * Default role → permission matrix. The database tables admin_roles / admin_permissions are
 * seeded from exactly this matrix by migration 0002 (a test asserts they match). The server
 * always reads permissions from the database; this constant is only the seed and the UI hint.
 */
export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  FINANCE_ADMIN: [
    'players.view',
    'players.view_sensitive',
    'finance.view',
    'finance.buy.manage',
    'finance.sell.manage',
    'finance.chat',
    'finance.distribute',
    'finance.ledger.view',
    'finance.integrity',
    'risk.view',
    'matches.view',
    'settings.view',
  ],
  GAME_ADMIN: ['players.view', 'games.view', 'games.manage', 'matches.view', 'matches.manage', 'disputes.view', 'disputes.manage', 'settings.view', 'dev.simulator'],
  SUPPORT_ADMIN: ['players.view', 'support.view', 'support.notes', 'finance.view', 'matches.view', 'disputes.view', 'games.view'],
  RISK_ADMIN: [
    'players.view',
    'players.manage',
    'players.view_sensitive',
    'risk.view',
    'risk.manage',
    'security.login_activity',
    'audit.view',
    'finance.view',
    'finance.ledger.view',
    'matches.view',
    'disputes.view',
  ],
};

export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  FINANCE_ADMIN: 'Finance Admin',
  GAME_ADMIN: 'Game Admin',
  SUPPORT_ADMIN: 'Support Admin',
  RISK_ADMIN: 'Risk Admin',
};

export function hasPermission(perms: readonly string[] | undefined, p: Permission): boolean {
  return !!perms && perms.includes(p);
}
