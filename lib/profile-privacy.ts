import { UserRole, normalizeUserRole } from './roles';

export type ProfileVisibility = 'public' | 'members' | 'private';

export interface UserPrivacySettings {
  profileVisibility: ProfileVisibility;
  showWatchHistory: boolean;
  showWatchlist: boolean;
  showActivity: boolean;
}

export const DEFAULT_PRIVACY_SETTINGS: UserPrivacySettings = {
  profileVisibility: 'public',
  showWatchHistory: true,
  showWatchlist: true,
  showActivity: true,
};

export interface FavouriteAnimeItem {
  hoshikaId: number;
  title: string;
  coverImage?: string;
  format?: string;
  seasonYear?: number;
}

export interface PublicRecentActivityItem {
  hoshikaId: number;
  title: string;
  coverImage?: string;
  episodeNumber: number;
  timestamp: number;
}

export interface PublicProfileStats {
  watchedEpisodes: number;
  watchlistCount: number;
  completedCount: number;
  updatedAt: number;
}

export interface PublicUserProfile {
  uid: string;
  username: string;
  displayName: string;
  bio: string;
  photoURL: string;
  avatarCharacterId?: number | null;
  avatarCharacterName?: string | null;
  avatarAnimeName?: string | null;
  role: UserRole;
  status: 'active' | 'disabled' | 'banned';
  privacy: UserPrivacySettings;
  favouriteAnime: FavouriteAnimeItem[];
  stats: PublicProfileStats | null;
  recentActivity: PublicRecentActivityItem[];
  joinedAt: string;
}

const RESERVED_USERNAMES = new Set([
  'admin',
  'admins',
  'administrator',
  'api',
  'anime',
  'aniscroll',
  'continue-watching',
  'explore',
  'forgot-password',
  'genres',
  'history',
  'home',
  'login',
  'member',
  'members',
  'mod',
  'moderator',
  'owner',
  'popular',
  'profile',
  'recent',
  'register',
  'root',
  'schedule',
  'search',
  'settings',
  'staff',
  'support',
  'system',
  'trending',
  'user',
  'users',
  'watch',
  'watchlist',
]);

export function normalizeUsername(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
}

export function validateUsername(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const trimmed = String(raw || '').trim().replace(/^@+/, '').toLowerCase();
  if (!trimmed) {
    return {
      valid: false,
      normalized: '',
      error: 'Username cannot be empty.',
    };
  }
  if (trimmed.length < 3 || trimmed.length > 24) {
    return {
      valid: false,
      normalized: trimmed,
      error: 'Username must be between 3 and 24 characters.',
    };
  }
  if (!/^[a-z0-9_]+$/.test(trimmed)) {
    return {
      valid: false,
      normalized: trimmed,
      error: 'Username may only contain lowercase letters, numbers, and underscores.',
    };
  }
  if (trimmed.startsWith('_') || trimmed.endsWith('_') || trimmed.includes('__')) {
    return {
      valid: false,
      normalized: trimmed,
      error: 'Username cannot start/end with an underscore or contain consecutive underscores.',
    };
  }
  if (RESERVED_USERNAMES.has(trimmed)) {
    return {
      valid: false,
      normalized: trimmed,
      error: 'This username is reserved.',
    };
  }
  return { valid: true, normalized: trimmed };
}

export function generateDefaultUsername(params: {
  displayName?: string | null;
  email?: string | null;
  uid: string;
}): string {
  const baseRaw =
    params.displayName ||
    params.email?.split('@')[0] ||
    'member';
  const cleaned = normalizeUsername(baseRaw).slice(0, 16) || 'member';
  const suffix = params.uid
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 5) || 'user';
  const candidate = `${cleaned}_${suffix}`.slice(0, 24);
  const check = validateUsername(candidate);
  if (check.valid) return check.normalized;
  return `user_${params.uid.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'aniscroll'}`;
}

export function sanitizeBio(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\r\n/g, '\n').trim().slice(0, 300);
}

export function sanitizePrivacySettings(raw: unknown): UserPrivacySettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PRIVACY_SETTINGS };
  }
  const obj = raw as Record<string, unknown>;
  const vis: ProfileVisibility =
    obj.profileVisibility === 'private'
      ? 'private'
      : obj.profileVisibility === 'members'
      ? 'members'
      : 'public';

  return {
    profileVisibility: vis,
    showWatchHistory:
      typeof obj.showWatchHistory === 'boolean'
        ? obj.showWatchHistory
        : DEFAULT_PRIVACY_SETTINGS.showWatchHistory,
    showWatchlist:
      typeof obj.showWatchlist === 'boolean'
        ? obj.showWatchlist
        : DEFAULT_PRIVACY_SETTINGS.showWatchlist,
    showActivity:
      typeof obj.showActivity === 'boolean'
        ? obj.showActivity
        : DEFAULT_PRIVACY_SETTINGS.showActivity,
  };
}

export function sanitizeFavouriteAnimeList(raw: unknown): FavouriteAnimeItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const result: FavouriteAnimeItem[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const hoshikaId = Number(obj.hoshikaId);
    if (!Number.isFinite(hoshikaId) || hoshikaId <= 0 || seen.has(hoshikaId)) {
      continue;
    }
    seen.add(hoshikaId);
    const title =
      typeof obj.title === 'string' && obj.title.trim()
        ? obj.title.trim().slice(0, 200)
        : `Anime #${hoshikaId}`;
    result.push({
      hoshikaId,
      title,
      coverImage:
        typeof obj.coverImage === 'string' && obj.coverImage.trim()
          ? obj.coverImage.trim().slice(0, 1024)
          : undefined,
      format:
        typeof obj.format === 'string' && obj.format.trim()
          ? obj.format.trim().slice(0, 40)
          : undefined,
      seasonYear:
        typeof obj.seasonYear === 'number' && Number.isFinite(obj.seasonYear)
          ? obj.seasonYear
          : undefined,
    });
    if (result.length >= 12) break;
  }

  return result;
}

export function sanitizeRecentActivityList(
  raw: unknown
): PublicRecentActivityItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: PublicRecentActivityItem[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const hoshikaId = Number(obj.hoshikaId);
    const episodeNumber = Number(obj.episodeNumber) || 1;
    if (!Number.isFinite(hoshikaId) || hoshikaId <= 0) continue;
    const dedupeKey = `${hoshikaId}_${episodeNumber}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const title =
      typeof obj.title === 'string' && obj.title.trim()
        ? obj.title.trim().slice(0, 200)
        : `Anime #${hoshikaId}`;

    result.push({
      hoshikaId,
      title,
      coverImage:
        typeof obj.coverImage === 'string' && obj.coverImage.trim()
          ? obj.coverImage.trim().slice(0, 1024)
          : undefined,
      episodeNumber: Math.max(1, Math.round(episodeNumber)),
      timestamp: Number(obj.timestamp) > 0 ? Number(obj.timestamp) : Date.now(),
    });
    if (result.length >= 12) break;
  }

  return result;
}

/**
 * Projects any raw Firestore user/public profile document into a PII-free PublicUserProfile.
 * Explicitly strips email and sensitive auth tokens.
 */
export function toPublicUserProfile(
  raw: Record<string, any>,
  effectiveRole?: UserRole
): PublicUserProfile {
  const privacy = sanitizePrivacySettings(raw.privacy);
  const role = effectiveRole || normalizeUserRole(raw.role);

  const createdRaw = raw.joinedAt || raw.createdAt;
  let joinedAt = '';
  if (typeof createdRaw === 'string') {
    joinedAt = createdRaw;
  } else if (createdRaw && typeof createdRaw?.toDate === 'function') {
    joinedAt = createdRaw.toDate().toISOString();
  } else if (createdRaw && typeof createdRaw?.seconds === 'number') {
    joinedAt = new Date(createdRaw.seconds * 1000).toISOString();
  }

  const rawStats = raw.stats && typeof raw.stats === 'object' ? raw.stats : null;
  const stats: PublicProfileStats | null = rawStats
    ? {
        watchedEpisodes: Math.max(0, Number(rawStats.watchedEpisodes) || 0),
        watchlistCount: Math.max(0, Number(rawStats.watchlistCount) || 0),
        completedCount: Math.max(0, Number(rawStats.completedCount) || 0),
        updatedAt: Number(rawStats.updatedAt) || 0,
      }
    : {
        watchedEpisodes: 0,
        watchlistCount: 0,
        completedCount: 0,
        updatedAt: 0,
      };

  return {
    uid: String(raw.uid || ''),
    username:
      typeof raw.username === 'string' && raw.username.trim()
        ? raw.username.trim().toLowerCase()
        : generateDefaultUsername({
            displayName: raw.displayName,
            email: raw.email,
            uid: String(raw.uid || 'user'),
          }),
    displayName: String(raw.displayName || 'AniScroll Member').slice(0, 120),
    bio: sanitizeBio(raw.bio),
    photoURL: typeof raw.photoURL === 'string' ? raw.photoURL.slice(0, 1024) : '',
    avatarCharacterId:
      typeof raw.avatarCharacterId === 'number' && raw.avatarCharacterId > 0
        ? raw.avatarCharacterId
        : null,
    avatarCharacterName:
      typeof raw.avatarCharacterName === 'string' && raw.avatarCharacterName.trim()
        ? raw.avatarCharacterName.trim().slice(0, 120)
        : null,
    avatarAnimeName:
      typeof raw.avatarAnimeName === 'string' && raw.avatarAnimeName.trim()
        ? raw.avatarAnimeName.trim().slice(0, 200)
        : null,
    role,
    status:
      raw.status === 'banned' || raw.status === 'disabled'
        ? raw.status
        : 'active',
    privacy,
    favouriteAnime: sanitizeFavouriteAnimeList(raw.favouriteAnime),
    stats,
    recentActivity: sanitizeRecentActivityList(raw.recentActivity),
    joinedAt: joinedAt || new Date().toISOString(),
  };
}

export interface ViewerContext {
  uid?: string | null;
  role?: UserRole | null;
}

export interface PrivacyFilterResult {
  accessible: boolean;
  reason?: string;
  isOwnerViewer: boolean;
  profile: PublicUserProfile | null;
}

/**
 * Enforces user privacy settings against the requesting viewer before serving any
 * public profile data over an API response or UI view.
 */
export function filterPublicProfileForViewer(
  rawProfile: PublicUserProfile,
  viewer?: ViewerContext | null
): PrivacyFilterResult {
  const isOwnerViewer = Boolean(viewer?.uid && viewer.uid === rawProfile.uid);
  const isPrivilegedStaff =
    viewer?.role === 'owner' || viewer?.role === 'admin';

  if (isOwnerViewer || isPrivilegedStaff) {
    return {
      accessible: true,
      isOwnerViewer,
      profile: rawProfile,
    };
  }

  if (rawProfile.privacy.profileVisibility === 'private') {
    return {
      accessible: false,
      reason: 'This profile is private.',
      isOwnerViewer: false,
      profile: null,
    };
  }

  if (rawProfile.privacy.profileVisibility === 'members' && !viewer?.uid) {
    return {
      accessible: false,
      reason: 'Sign in with an AniScroll account to view this member-only profile.',
      isOwnerViewer: false,
      profile: null,
    };
  }

  const showHistory = rawProfile.privacy.showWatchHistory;
  const showWatchlist = rawProfile.privacy.showWatchlist;
  const showActivity = rawProfile.privacy.showActivity;

  const filteredStats: PublicProfileStats | null =
    showActivity || showHistory || showWatchlist
      ? {
          watchedEpisodes: showHistory || showActivity ? rawProfile.stats?.watchedEpisodes ?? 0 : 0,
          watchlistCount: showWatchlist ? rawProfile.stats?.watchlistCount ?? 0 : 0,
          completedCount: showWatchlist ? rawProfile.stats?.completedCount ?? 0 : 0,
          updatedAt: rawProfile.stats?.updatedAt ?? 0,
        }
      : null;

  return {
    accessible: true,
    isOwnerViewer: false,
    profile: {
      ...rawProfile,
      stats: filteredStats,
      favouriteAnime: showWatchlist ? rawProfile.favouriteAnime : [],
      recentActivity: showHistory && showActivity ? rawProfile.recentActivity : [],
    },
  };
}
