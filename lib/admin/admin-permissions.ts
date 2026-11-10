export type AdminRole = 'owner' | 'administrator' | 'editor' | 'analyst';

export interface AdminPermissions {
  manageAdmins: boolean;
  manageUsers: boolean;
  manageArtwork: boolean;
  uploadLogos: boolean;
  deleteLogos: boolean;
  manageAnime: boolean;
  manageAnnouncements: boolean;
  manageSettings: boolean;
  viewAnalytics: boolean;
  viewLogs: boolean;
}

export interface AdminRecord {
  uid: string;
  email: string;
  displayName: string;
  role: AdminRole;
  permissions: AdminPermissions;
  status: 'active' | 'invited' | 'revoked';
  addedBy: string;
  addedAt: string;
  lastLogin: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export const BOOTSTRAPPED_OWNER_EMAIL = 'balampiyush2009@gmail.com';
export const BOOTSTRAPPED_OWNER_UID = 'ClYKhPNBohZuDPPS3upXVyQvUEq2';

export const DEFAULT_ROLE_PERMISSIONS: Record<AdminRole, AdminPermissions> = {
  owner: {
    manageAdmins: true,
    manageUsers: true,
    manageArtwork: true,
    uploadLogos: true,
    deleteLogos: true,
    manageAnime: true,
    manageAnnouncements: true,
    manageSettings: true,
    viewAnalytics: true,
    viewLogs: true,
  },
  administrator: {
    manageAdmins: false,
    manageUsers: true,
    manageArtwork: true,
    uploadLogos: true,
    deleteLogos: true,
    manageAnime: true,
    manageAnnouncements: true,
    manageSettings: true,
    viewAnalytics: true,
    viewLogs: true,
  },
  editor: {
    manageAdmins: false,
    manageUsers: false,
    manageArtwork: true,
    uploadLogos: true,
    deleteLogos: false,
    manageAnime: true,
    manageAnnouncements: true,
    manageSettings: false,
    viewAnalytics: true,
    viewLogs: true,
  },
  analyst: {
    manageAdmins: false,
    manageUsers: false,
    manageArtwork: false,
    uploadLogos: false,
    deleteLogos: false,
    manageAnime: false,
    manageAnnouncements: false,
    manageSettings: false,
    viewAnalytics: true,
    viewLogs: true,
  },
};

export const ROLE_LABELS: Record<AdminRole, { label: string; badge: string; description: string }> = {
  owner: {
    label: 'Owner',
    badge: 'FULL ROOT ACCESS',
    description: 'Primary owner with full administrative, security, and administrator management control.',
  },
  administrator: {
    label: 'Administrator',
    badge: 'SYSTEM ADMIN',
    description: 'Full access to artwork, users, anime, announcements, streaming logs, and settings.',
  },
  editor: {
    label: 'Content Editor',
    badge: 'CONTENT & ARTWORK',
    description: 'Can manage anime artwork, upload transparent logos, curate featured anime, and publish announcements.',
  },
  analyst: {
    label: 'Viewer / Analyst',
    badge: 'READ-ONLY ANALYST',
    description: 'Read-only access to dashboard metrics, missing logo reports, streaming health, and audit logs.',
  },
};

export function isBootstrappedOwnerIdentity(
  uidOrObj?: string | { uid?: string | null; email?: string | null } | null,
  emailArg?: string | null
): boolean {
  const uid =
    typeof uidOrObj === 'object' && uidOrObj !== null
      ? uidOrObj.uid
      : uidOrObj;
  const email =
    typeof uidOrObj === 'object' && uidOrObj !== null
      ? uidOrObj.email
      : emailArg;

  if (typeof uid === 'string' && uid.trim() === BOOTSTRAPPED_OWNER_UID) {
    return true;
  }
  const normalizedEmail = (typeof email === 'string' ? email : '').trim().toLowerCase();
  if (normalizedEmail === BOOTSTRAPPED_OWNER_EMAIL) {
    return true;
  }
  const envOwnerEmail = (process.env.ADMIN_OWNER_EMAIL || '').trim().toLowerCase();
  if (envOwnerEmail && normalizedEmail === envOwnerEmail) {
    return true;
  }
  const envOwnerUid = (process.env.ADMIN_OWNER_UID || '').trim();
  if (envOwnerUid && typeof uid === 'string' && uid === envOwnerUid) {
    return true;
  }
  return false;
}

export function buildOwnerAdminRecord(uid: string, email: string, displayName?: string | null): AdminRecord {
  const nowIso = new Date().toISOString();
  return {
    uid,
    email: email.trim().toLowerCase(),
    displayName: (displayName || email.split('@')[0] || 'Primary Owner').slice(0, 120),
    role: 'owner',
    permissions: { ...DEFAULT_ROLE_PERMISSIONS.owner },
    status: 'active',
    addedBy: 'system_bootstrap',
    addedAt: nowIso,
    lastLogin: nowIso,
  };
}

export function hasAdminPermission(
  admin: AdminRecord | null | undefined,
  permission: keyof AdminPermissions
): boolean {
  if (!admin || admin.status !== 'active') return false;
  if (admin.role === 'owner') return true;
  return Boolean(admin.permissions?.[permission]);
}
