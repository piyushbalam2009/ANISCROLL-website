import { AdminPermissions, AdminRecord, hasAdminPermission } from './admin-permissions';
import { adminRoleToUserRole, UserRole } from '../roles';

export type AdminSectionId =
  | 'overview'
  | 'content'
  | 'users'
  | 'monitoring'
  | 'configuration';

export interface AdminNavItemConfig {
  id: string;
  label: string;
  href: string;
  exact?: boolean;
  badge?: string;
  section: AdminSectionId;
  minRole: UserRole;
  requiredPermission?: keyof AdminPermissions;
  /**
   * Optional explicit capability tag so Mod access is strictly scoped
   * to Overview, Users (member moderation), Moderation Queue, and Activity Logs.
   */
  allowMod?: boolean;
}

export interface AdminNavSectionConfig {
  id: AdminSectionId;
  title: string;
  items: AdminNavItemConfig[];
}

export const ADMIN_NAV_SECTIONS: AdminNavSectionConfig[] = [
  {
    id: 'overview',
    title: 'Overview',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        href: '/admin',
        exact: true,
        badge: 'KPI',
        section: 'overview',
        minRole: 'mod',
        allowMod: true,
      },
      {
        id: 'analytics',
        label: 'Analytics',
        href: '/admin/analytics',
        exact: false,
        section: 'overview',
        minRole: 'admin',
        requiredPermission: 'viewAnalytics',
        allowMod: false,
      },
    ],
  },
  {
    id: 'content',
    title: 'Content Management',
    items: [
      {
        id: 'anime',
        label: 'Anime',
        href: '/admin/anime',
        exact: false,
        section: 'content',
        minRole: 'admin',
        requiredPermission: 'manageAnime',
        allowMod: false,
      },
      {
        id: 'episodes',
        label: 'Episodes',
        href: '/admin/episodes',
        exact: false,
        section: 'content',
        minRole: 'admin',
        requiredPermission: 'manageAnime',
        allowMod: false,
      },
      {
        id: 'artwork',
        label: 'Artwork',
        href: '/admin/artwork',
        exact: false,
        badge: 'FANART',
        section: 'content',
        minRole: 'admin',
        requiredPermission: 'manageArtwork',
        allowMod: false,
      },
      {
        id: 'missing-logos',
        label: 'Missing Logos',
        href: '/admin/missing-logos',
        exact: false,
        badge: 'SCAN',
        section: 'content',
        minRole: 'admin',
        requiredPermission: 'manageArtwork',
        allowMod: false,
      },
      {
        id: 'homepage',
        label: 'Homepage',
        href: '/admin/homepage',
        exact: false,
        section: 'content',
        minRole: 'admin',
        requiredPermission: 'manageAnime',
        allowMod: false,
      },
      {
        id: 'announcements',
        label: 'Announcements',
        href: '/admin/announcements',
        exact: false,
        section: 'content',
        minRole: 'admin',
        requiredPermission: 'manageAnnouncements',
        allowMod: false,
      },
    ],
  },
  {
    id: 'users',
    title: 'User Management',
    items: [
      {
        id: 'users-list',
        label: 'Users',
        href: '/admin/users',
        exact: false,
        section: 'users',
        minRole: 'mod',
        requiredPermission: 'manageUsers',
        allowMod: true,
      },
      {
        id: 'roles',
        label: 'Roles & Permissions',
        href: '/admin/admins',
        exact: false,
        badge: 'RBAC',
        section: 'users',
        minRole: 'admin',
        allowMod: false,
      },
      {
        id: 'moderation',
        label: 'Reports & Moderation',
        href: '/admin/moderation',
        exact: false,
        badge: 'QUEUE',
        section: 'users',
        minRole: 'mod',
        allowMod: true,
      },
    ],
  },
  {
    id: 'monitoring',
    title: 'System Monitoring',
    items: [
      {
        id: 'api-health',
        label: 'API Health',
        href: '/admin/monitoring',
        exact: false,
        badge: 'LIVE',
        section: 'monitoring',
        minRole: 'admin',
        requiredPermission: 'viewAnalytics',
        allowMod: false,
      },
      {
        id: 'streaming',
        label: 'Streaming Monitor',
        href: '/admin/streaming',
        exact: false,
        section: 'monitoring',
        minRole: 'admin',
        requiredPermission: 'viewAnalytics',
        allowMod: false,
      },
      {
        id: 'cache',
        label: 'Cache Control',
        href: '/admin/cache',
        exact: false,
        section: 'monitoring',
        minRole: 'admin',
        requiredPermission: 'manageSettings',
        allowMod: false,
      },
      {
        id: 'errors',
        label: 'Error Logs',
        href: '/admin/errors',
        exact: false,
        section: 'monitoring',
        minRole: 'admin',
        requiredPermission: 'viewLogs',
        allowMod: false,
      },
    ],
  },
  {
    id: 'configuration',
    title: 'Configuration',
    items: [
      {
        id: 'settings',
        label: 'Website Settings',
        href: '/admin/settings',
        exact: false,
        section: 'configuration',
        minRole: 'admin',
        requiredPermission: 'manageSettings',
        allowMod: false,
      },
      {
        id: 'activity',
        label: 'Activity Logs',
        href: '/admin/activity',
        exact: false,
        badge: 'AUDIT',
        section: 'configuration',
        minRole: 'mod',
        requiredPermission: 'viewLogs',
        allowMod: true,
      },
    ],
  },
];

export const ALL_ADMIN_NAV_ITEMS: AdminNavItemConfig[] =
  ADMIN_NAV_SECTIONS.flatMap((section) => section.items);

export function canRoleAccessNavItem(
  role: UserRole,
  adminRecord: AdminRecord | null | undefined,
  item: AdminNavItemConfig
): boolean {
  if (role === 'member') return false;
  if (role === 'owner') return true;
  if (!adminRecord || adminRecord.status !== 'active') return false;

  if (role === 'mod') {
    if (!item.allowMod) return false;
    if (item.requiredPermission && !hasAdminPermission(adminRecord, item.requiredPermission)) {
      return false;
    }
    return true;
  }

  // role === 'admin'
  if (item.minRole === 'owner') return false;
  if (item.requiredPermission && !hasAdminPermission(adminRecord, item.requiredPermission)) {
    return false;
  }
  return true;
}

export function getAuthorizedNavSections(
  role: UserRole,
  adminRecord: AdminRecord | null | undefined
): AdminNavSectionConfig[] {
  if (role === 'member') return [];
  return ADMIN_NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) =>
      canRoleAccessNavItem(role, adminRecord, item)
    ),
  })).filter((section) => section.items.length > 0);
}

/**
 * Checks whether an authenticated staff member is authorized to view a specific /admin/* pathname.
 */
export function canAccessAdminPathname(
  pathname: string,
  adminRecord: AdminRecord | null | undefined,
  explicitRole?: UserRole
): boolean {
  const role: UserRole =
    explicitRole ||
    (adminRecord ? adminRoleToUserRole(adminRecord.role) : 'member');

  if (role === 'member') return false;
  if (role === 'owner') return true;
  if (!adminRecord || adminRecord.status !== 'active') return false;

  const normalizedPath = pathname.split('?')[0] || '/admin';
  if (normalizedPath === '/admin') {
    return canRoleAccessNavItem(role, adminRecord, ALL_ADMIN_NAV_ITEMS[0]!);
  }

  // Match longest prefix first (so /admin/artwork/123 matches /admin/artwork)
  const sortedItems = [...ALL_ADMIN_NAV_ITEMS]
    .filter((item) => item.href !== '/admin')
    .sort((a, b) => b.href.length - a.href.length);

  const matched = sortedItems.find(
    (item) =>
      normalizedPath === item.href || normalizedPath.startsWith(`${item.href}/`)
  );

  if (!matched) {
    return role === 'admin';
  }

  return canRoleAccessNavItem(role, adminRecord, matched);
}

export function getBreadcrumbForAdminPath(pathname: string): {
  sectionTitle: string;
  pageLabel: string;
} {
  const normalized = pathname.split('?')[0] || '/admin';
  if (normalized === '/admin') {
    return { sectionTitle: 'Overview', pageLabel: 'Dashboard' };
  }
  if (normalized.startsWith('/admin/artwork/')) {
    const id = normalized.slice('/admin/artwork/'.length).split('/')[0] || '';
    return {
      sectionTitle: 'Content Management',
      pageLabel: id ? `Artwork Studio #${id}` : 'Artwork Studio',
    };
  }
  const sortedItems = [...ALL_ADMIN_NAV_ITEMS]
    .filter((item) => item.href !== '/admin')
    .sort((a, b) => b.href.length - a.href.length);
  const matched = sortedItems.find(
    (item) => normalized === item.href || normalized.startsWith(`${item.href}/`)
  );
  if (!matched) {
    return { sectionTitle: 'Admin', pageLabel: 'Console' };
  }
  const section = ADMIN_NAV_SECTIONS.find((s) => s.id === matched.section);
  return {
    sectionTitle: section?.title || 'Admin',
    pageLabel: matched.label,
  };
}
