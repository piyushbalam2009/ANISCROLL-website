import {
  AdminPermissions,
  AdminRecord,
  AdminRole,
  BOOTSTRAPPED_OWNER_EMAIL,
  BOOTSTRAPPED_OWNER_UID,
  DEFAULT_ROLE_PERMISSIONS,
  isBootstrappedOwnerIdentity,
} from './admin/admin-permissions';

export type UserRole = 'member' | 'mod' | 'admin' | 'owner';

export const USER_ROLE_ORDER: readonly UserRole[] = ['member', 'mod', 'admin', 'owner'];

export const USER_ROLE_RANK: Record<UserRole, number> = {
  member: 0,
  mod: 1,
  admin: 2,
  owner: 3,
};

export interface RoleDefinition {
  role: UserRole;
  label: string;
  shortLabel: string;
  description: string;
  canModerateContent: boolean;
  canManageUsers: boolean;
  canManageSite: boolean;
  canManageAdmins: boolean;
}

export const ROLE_DEFINITIONS: Record<UserRole, RoleDefinition> = {
  member: {
    role: 'member',
    label: 'Member',
    shortLabel: 'MEMBER',
    description:
      'Standard user. Can customize own profile, choose an anime avatar, manage privacy/settings, and view public profiles.',
    canModerateContent: false,
    canManageUsers: false,
    canManageSite: false,
    canManageAdmins: false,
  },
  mod: {
    role: 'mod',
    label: 'Mod',
    shortLabel: 'MOD',
    description:
      'Moderator. Can moderate community profiles/members and access moderation tools without changing admin roles or site config.',
    canModerateContent: true,
    canManageUsers: false,
    canManageSite: false,
    canManageAdmins: false,
  },
  admin: {
    role: 'admin',
    label: 'Admin',
    shortLabel: 'ADMIN',
    description:
      'Administrator. Can manage members, moderate accounts, manage anime/artwork, and assign Member/Mod roles (cannot alter Owner or Admins).',
    canModerateContent: true,
    canManageUsers: true,
    canManageSite: true,
    canManageAdmins: false,
  },
  owner: {
    role: 'owner',
    label: 'Owner',
    shortLabel: 'OWNER',
    description:
      'Full administrative authority. Can assign or remove Mod and Admin roles, manage all accounts, and configure platform security.',
    canModerateContent: true,
    canManageUsers: true,
    canManageSite: true,
    canManageAdmins: true,
  },
};

/**
 * Normalizes legacy role strings ('user', 'administrator', 'editor', 'analyst', etc.)
 * into one of the four authoritative roles: 'member' | 'mod' | 'admin' | 'owner'.
 */
export function normalizeUserRole(raw?: unknown): UserRole {
  if (typeof raw !== 'string') return 'member';
  const clean = raw.trim().toLowerCase();
  if (clean === 'owner' || clean === 'co-owner') return 'owner';
  if (clean === 'admin' || clean === 'administrator') return 'admin';
  if (
    clean === 'mod' ||
    clean === 'moderator' ||
    clean === 'editor' ||
    clean === 'analyst'
  ) {
    return 'mod';
  }
  return 'member';
}

export function adminRoleToUserRole(adminRole?: string | null): UserRole {
  return normalizeUserRole(adminRole);
}

export function userRoleToAdminRole(role: UserRole): AdminRole | null {
  switch (role) {
    case 'owner':
      return 'owner';
    case 'admin':
      return 'administrator';
    case 'mod':
      return 'editor';
    case 'member':
    default:
      return null;
  }
}

export function getAdminPermissionsForUserRole(
  role: UserRole
): AdminPermissions | null {
  const adminRole = userRoleToAdminRole(role);
  if (!adminRole) return null;
  if (role === 'mod') {
    return {
      ...DEFAULT_ROLE_PERMISSIONS.editor,
      manageAdmins: false,
      manageUsers: true,
      manageArtwork: false,
      uploadLogos: false,
      deleteLogos: false,
      manageAnime: false,
      manageAnnouncements: false,
      manageSettings: false,
      viewAnalytics: false,
      viewLogs: true,
    };
  }
  return { ...DEFAULT_ROLE_PERMISSIONS[adminRole] };
}

/**
 * Computes the authoritative effective role for a user across bootstrapped owner identity,
 * active /admins/{uid} RBAC record, and stored profile role without ever downgrading
 * legitimate existing elevated roles during Member migration.
 */
export function resolveEffectiveUserRole(params: {
  uid?: string | null;
  email?: string | null;
  profileRole?: unknown;
  adminRecord?: Pick<AdminRecord, 'role' | 'status'> | null;
}): UserRole {
  if (isBootstrappedOwnerIdentity(params.uid, params.email)) {
    return 'owner';
  }

  if (params.adminRecord && params.adminRecord.status === 'active') {
    const fromAdmin = adminRoleToUserRole(params.adminRecord.role);
    if (fromAdmin !== 'member') {
      return fromAdmin;
    }
  }

  return normalizeUserRole(params.profileRole);
}

export function isHigherOrEqualRole(role: UserRole, minimum: UserRole): boolean {
  return USER_ROLE_RANK[role] >= USER_ROLE_RANK[minimum];
}

export function getAssignableRolesForActor(
  actorRole: UserRole,
  targetCurrentRole: UserRole,
  options?: { isTargetBootstrappedOwner?: boolean; isSelf?: boolean }
): UserRole[] {
  if (options?.isTargetBootstrappedOwner) {
    return ['owner'];
  }
  if (options?.isSelf && actorRole === 'owner') {
    return ['owner'];
  }
  if (actorRole === 'owner') {
    return ['member', 'mod', 'admin', 'owner'];
  }
  if (actorRole === 'admin') {
    if (targetCurrentRole === 'owner' || targetCurrentRole === 'admin') {
      return [];
    }
    return ['member', 'mod'];
  }
  return [];
}

export interface RoleAssignmentCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Strictly enforces role assignment permissions on both client UI and server APIs.
 * - Members and Mods cannot assign any roles.
 * - Admins can assign/change Member <-> Mod only, and cannot touch Owner or other Admins.
 * - Owners can assign/remove Member, Mod, Admin, and Co-Owner, but cannot demote the primary Owner.
 * - Nobody can self-escalate or demote the bootstrapped Owner.
 */
export function canActorAssignRole(params: {
  actorRole: UserRole;
  actorUid: string;
  targetUid: string;
  targetEmail?: string | null;
  targetCurrentRole: UserRole;
  targetNextRole: UserRole;
}): RoleAssignmentCheckResult {
  const {
    actorRole,
    actorUid,
    targetUid,
    targetEmail,
    targetCurrentRole,
    targetNextRole,
  } = params;

  if (!actorUid || !targetUid) {
    return { allowed: false, reason: 'Invalid actor or target user ID.' };
  }

  if (actorRole !== 'owner' && actorRole !== 'admin') {
    return {
      allowed: false,
      reason: 'Only Administrators and the Owner can change user roles.',
    };
  }

  const isTargetPrimaryOwner =
    targetUid === BOOTSTRAPPED_OWNER_UID ||
    (typeof targetEmail === 'string' &&
      targetEmail.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL);

  if (isTargetPrimaryOwner && targetNextRole !== 'owner') {
    return {
      allowed: false,
      reason: 'The primary Owner role cannot be downgraded or removed.',
    };
  }

  if (actorUid === targetUid && actorRole !== 'owner') {
    return {
      allowed: false,
      reason: 'You cannot modify your own role.',
    };
  }

  if (actorUid === targetUid && targetNextRole !== 'owner') {
    return {
      allowed: false,
      reason: 'Owners cannot remove their own Owner authority.',
    };
  }

  if (actorRole === 'admin') {
    if (targetCurrentRole === 'owner' || targetCurrentRole === 'admin') {
      return {
        allowed: false,
        reason: 'Administrators cannot modify Owner or other Administrator roles.',
      };
    }
    if (targetNextRole === 'owner' || targetNextRole === 'admin') {
      return {
        allowed: false,
        reason: 'Only the Owner can assign Admin or Owner roles.',
      };
    }
    return { allowed: true };
  }

  // Owner
  if (targetCurrentRole === 'owner' && isTargetPrimaryOwner && targetNextRole !== 'owner') {
    return {
      allowed: false,
      reason: 'Primary Owner cannot be downgraded.',
    };
  }

  return { allowed: true };
}

export function canActorModerateUser(params: {
  actorRole: UserRole;
  actorUid: string;
  targetUid: string;
  targetEmail?: string | null;
  targetCurrentRole: UserRole;
  action?: 'disable' | 'ban' | 'enable' | 'delete';
}): RoleAssignmentCheckResult {
  const { actorRole, actorUid, targetUid, targetEmail, targetCurrentRole, action } =
    params;

  if (!actorUid || !targetUid) {
    return { allowed: false, reason: 'Invalid actor or target user ID.' };
  }

  if (actorUid === targetUid) {
    return {
      allowed: false,
      reason: 'You cannot disable, ban, or delete your own active account.',
    };
  }

  const isTargetPrimaryOwner =
    targetUid === BOOTSTRAPPED_OWNER_UID ||
    (typeof targetEmail === 'string' &&
      targetEmail.trim().toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL);

  if (isTargetPrimaryOwner || targetCurrentRole === 'owner') {
    return {
      allowed: false,
      reason: 'Owner accounts are protected from moderation or deletion.',
    };
  }

  if (actorRole === 'member') {
    return { allowed: false, reason: 'Members cannot moderate user accounts.' };
  }

  if (actorRole === 'mod') {
    if (action === 'delete') {
      return {
        allowed: false,
        reason: 'Moderators cannot permanently delete user accounts.',
      };
    }
    if (targetCurrentRole !== 'member') {
      return {
        allowed: false,
        reason: 'Moderators can only moderate Member accounts.',
      };
    }
    return { allowed: true };
  }

  if (actorRole === 'admin' && targetCurrentRole === 'admin') {
    return {
      allowed: false,
      reason: 'Administrators cannot moderate or delete other Administrators.',
    };
  }

  return { allowed: true };
}
