import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import {
  WatchlistEntry,
  WatchHistoryEntry,
  UserPreferences,
} from '@/types/streaming';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

import {
  DEFAULT_PRIVACY_SETTINGS,
  FavouriteAnimeItem,
  PublicProfileStats,
  PublicRecentActivityItem,
  UserPrivacySettings,
  generateDefaultUsername,
  sanitizeBio,
  sanitizeFavouriteAnimeList,
  sanitizePrivacySettings,
  sanitizeRecentActivityList,
} from './profile-privacy';
import { UserRole, normalizeUserRole } from './roles';
import { isBootstrappedOwnerIdentity } from './admin/admin-permissions';

export interface CloudUserProfile {
  uid: string;
  displayName: string;
  username?: string;
  bio?: string;
  email: string;
  photoURL: string;
  avatarCharacterId?: number | null;
  avatarCharacterName?: string | null;
  avatarAnimeName?: string | null;
  provider: 'password' | 'google';
  status?: 'active' | 'disabled' | 'banned';
  role?: UserRole | 'user';
  privacy?: UserPrivacySettings;
  favouriteAnime?: FavouriteAnimeItem[];
  stats?: PublicProfileStats;
  recentActivity?: PublicRecentActivityItem[];
  migrationCompleted?: boolean;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

// Defensive payload sanitizers matching firebase-blueprint.json & firestore.rules
function sanitizeString(val: string | undefined | null, maxLen: number, fallback = ''): string {
  const str = (val ?? fallback).trim();
  if (!str && fallback) return fallback.slice(0, maxLen);
  return str.slice(0, maxLen);
}

function sanitizeDocId(id: string | number): string {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

function formatCreatedAtIso(createdAt: unknown): string {
  if (typeof createdAt === 'string' && createdAt.trim()) return createdAt;
  if (createdAt && typeof (createdAt as any).toDate === 'function') {
    return (createdAt as any).toDate().toISOString();
  }
  if (createdAt && typeof (createdAt as any).seconds === 'number') {
    return new Date((createdAt as any).seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

export async function ensurePublicProfileSync(
  profile: CloudUserProfile,
  authoritativeRole?: UserRole
): Promise<void> {
  if (!profile?.uid) return;
  const pubRef = doc(db, 'publicProfiles', profile.uid);
  const role: UserRole =
    authoritativeRole ||
    (isBootstrappedOwnerIdentity(profile.uid, profile.email)
      ? 'owner'
      : normalizeUserRole(profile.role));

  const username =
    (profile.username && profile.username.trim().toLowerCase()) ||
    generateDefaultUsername({
      displayName: profile.displayName,
      email: profile.email,
      uid: profile.uid,
    });

  const privacy = sanitizePrivacySettings(profile.privacy);
  const basePublic = {
    uid: profile.uid,
    username,
    displayName: sanitizeString(profile.displayName, 120, 'AniScroll Member'),
    bio: sanitizeBio(profile.bio),
    photoURL: sanitizeString(profile.photoURL, 1024, ''),
    avatarCharacterId: profile.avatarCharacterId ?? null,
    avatarCharacterName: profile.avatarCharacterName ?? null,
    avatarAnimeName: profile.avatarAnimeName ?? null,
    status: profile.status || 'active',
    privacy,
    favouriteAnime: sanitizeFavouriteAnimeList(profile.favouriteAnime),
    stats: profile.stats || {
      watchedEpisodes: 0,
      watchlistCount: 0,
      completedCount: 0,
      updatedAt: Date.now(),
    },
    recentActivity: sanitizeRecentActivityList(profile.recentActivity),
    joinedAt: formatCreatedAtIso(profile.createdAt),
  };

  try {
    const [pubSnap, usernameSnap] = await Promise.all([
      getDoc(pubRef),
      getDoc(doc(db, 'usernames', username)),
    ]);

    if (!usernameSnap.exists()) {
      await setDoc(doc(db, 'usernames', username), {
        uid: profile.uid,
        username,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }

    if (!pubSnap.exists()) {
      await setDoc(pubRef, {
        ...basePublic,
        role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(pubRef, {
        username: basePublic.username,
        displayName: basePublic.displayName,
        bio: basePublic.bio,
        photoURL: basePublic.photoURL,
        avatarCharacterId: basePublic.avatarCharacterId,
        avatarCharacterName: basePublic.avatarCharacterName,
        avatarAnimeName: basePublic.avatarAnimeName,
        privacy: basePublic.privacy,
        favouriteAnime: basePublic.favouriteAnime,
        stats: basePublic.stats,
        recentActivity: basePublic.recentActivity,
        joinedAt: basePublic.joinedAt,
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Non-fatal: server PATCH /api/profile also syncs publicProfiles
  }
}

// 1. USER PROFILE (/users/{uid}/profile/details)
export async function getUserProfileDoc(uid: string): Promise<CloudUserProfile | null> {
  const path = `users/${uid}/profile/details`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'profile', 'details'));
    if (!snap.exists()) return null;
    return snap.data() as CloudUserProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function upsertUserProfileDoc(profile: {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string | null;
  provider: 'password' | 'google';
  migrationCompleted?: boolean;
  forcePhotoUpdate?: boolean;
}): Promise<CloudUserProfile> {
  const path = `users/${profile.uid}/profile/details`;
  const ref = doc(db, 'users', profile.uid, 'profile', 'details');

  const safeDisplayName = sanitizeString(
    profile.displayName || profile.email?.split('@')[0] || 'AniScroll Member',
    120,
    'AniScroll Member'
  );
  const safeEmail = sanitizeString(profile.email, 256, 'user@aniscroll.app');
  const safePhotoURL = sanitizeString(profile.photoURL, 1024, '');
  const safeProvider: 'password' | 'google' =
    profile.provider === 'google' ? 'google' : 'password';

  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      const initialRole: UserRole = isBootstrappedOwnerIdentity(
        profile.uid,
        safeEmail
      )
        ? 'owner'
        : 'member';
      const username = generateDefaultUsername({
        displayName: safeDisplayName,
        email: safeEmail,
        uid: profile.uid,
      });

      const createPayload: Record<string, any> = {
        uid: profile.uid,
        displayName: safeDisplayName,
        username,
        bio: '',
        email: safeEmail,
        photoURL: safePhotoURL,
        provider: safeProvider,
        status: 'active',
        role: initialRole,
        privacy: { ...DEFAULT_PRIVACY_SETTINGS },
        favouriteAnime: [],
        stats: {
          watchedEpisodes: 0,
          watchlistCount: 0,
          completedCount: 0,
          updatedAt: Date.now(),
        },
        recentActivity: [],
        migrationCompleted: Boolean(profile.migrationCompleted),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(ref, createPayload);

      const createdProfile: CloudUserProfile = {
        uid: profile.uid,
        displayName: safeDisplayName,
        username,
        bio: '',
        email: safeEmail,
        photoURL: safePhotoURL,
        provider: safeProvider,
        status: 'active',
        role: initialRole,
        privacy: { ...DEFAULT_PRIVACY_SETTINGS },
        favouriteAnime: [],
        stats: createPayload.stats,
        recentActivity: [],
        migrationCompleted: Boolean(profile.migrationCompleted),
      };
      await ensurePublicProfileSync(createdProfile, initialRole);
      return createdProfile;
    } else {
      const existingData = existingSnap.data() as CloudUserProfile;
      // Preserve custom anime avatar or existing displayName unless explicitly updated
      const preservedPhotoURL = profile.forcePhotoUpdate
        ? safePhotoURL
        : existingData.photoURL || safePhotoURL || '';
      const preservedDisplayName = existingData.displayName || safeDisplayName;
      const ensuredUsername =
        existingData.username ||
        generateDefaultUsername({
          displayName: preservedDisplayName,
          email: safeEmail,
          uid: profile.uid,
        });
      const ensuredPrivacy = sanitizePrivacySettings(existingData.privacy);

      const updatePayload: Record<string, any> = {
        displayName: preservedDisplayName,
        username: ensuredUsername,
        email: safeEmail || existingData.email,
        photoURL: preservedPhotoURL,
        provider: safeProvider,
        privacy: ensuredPrivacy,
        updatedAt: serverTimestamp(),
      };
      if (profile.migrationCompleted !== undefined) {
        updatePayload.migrationCompleted = Boolean(profile.migrationCompleted);
      }
      await updateDoc(ref, updatePayload);
      const merged: CloudUserProfile = {
        ...existingData,
        ...updatePayload,
        role: isBootstrappedOwnerIdentity(profile.uid, safeEmail)
          ? 'owner'
          : normalizeUserRole(existingData.role),
      };
      await ensurePublicProfileSync(merged);
      return merged;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncUserActivityProjection(params: {
  uid: string;
  stats: PublicProfileStats;
  recentActivity: PublicRecentActivityItem[];
}): Promise<void> {
  if (!params.uid) return;
  const cleanRecent = sanitizeRecentActivityList(params.recentActivity);
  try {
    await Promise.all([
      updateDoc(doc(db, 'users', params.uid, 'profile', 'details'), {
        stats: params.stats,
        recentActivity: cleanRecent,
        updatedAt: serverTimestamp(),
      }).catch(() => {}),
      updateDoc(doc(db, 'publicProfiles', params.uid), {
        stats: params.stats,
        recentActivity: cleanRecent,
        updatedAt: serverTimestamp(),
      }).catch(() => {}),
    ]);
  } catch {
    // Non-fatal background projection sync
  }
}

export async function markMigrationCompleted(uid: string): Promise<void> {
  const path = `users/${uid}/profile/details`;
  const ref = doc(db, 'users', uid, 'profile', 'details');
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        migrationCompleted: true,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// 2. WATCHLIST (/users/{uid}/watchlist/{animeId})
export async function getCloudWatchlist(uid: string): Promise<WatchlistEntry[]> {
  const path = `users/${uid}/watchlist`;
  try {
    const q = query(collection(db, 'users', uid, 'watchlist'), where('uid', '==', uid));
    const snap = await getDocs(q);
    const items: WatchlistEntry[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      items.push({
        hoshikaId: Number(d.hoshikaId),
        title: String(d.title || 'Anime'),
        coverImage: d.coverImage || undefined,
        format: d.format || undefined,
        rating: typeof d.rating === 'number' ? d.rating : undefined,
        seasonYear: typeof d.seasonYear === 'number' ? d.seasonYear : undefined,
        status: d.status || 'watching',
        addedAt: Number(d.addedAt || Date.now()),
      });
    });
    return items.sort((a, b) => b.addedAt - a.addedAt);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveCloudWatchlistItem(
  uid: string,
  item: WatchlistEntry
): Promise<void> {
  const docId = sanitizeDocId(item.hoshikaId);
  const path = `users/${uid}/watchlist/${docId}`;
  const ref = doc(db, 'users', uid, 'watchlist', docId);

  const validStatuses = ['watching', 'plan_to_watch', 'completed', 'on_hold', 'dropped'];
  const safeStatus =
    item.status && validStatuses.includes(item.status) ? item.status : 'watching';

  const baseFields: Record<string, any> = {
    title: sanitizeString(item.title, 300, 'Unknown Anime'),
    coverImage: item.coverImage ? sanitizeString(item.coverImage, 1024) : null,
    format: item.format ? sanitizeString(item.format, 40) : null,
    rating: typeof item.rating === 'number' ? item.rating : null,
    seasonYear: typeof item.seasonYear === 'number' ? item.seasonYear : null,
    status: safeStatus,
    addedAt: item.addedAt > 0 ? item.addedAt : Date.now(),
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        hoshikaId: Number(item.hoshikaId),
        ...baseFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...baseFields,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeCloudWatchlistItem(
  uid: string,
  hoshikaId: number
): Promise<void> {
  const docId = sanitizeDocId(hoshikaId);
  const path = `users/${uid}/watchlist/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'watchlist', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// 3. CONTINUE WATCHING (/users/{uid}/continueWatching/{animeId})
export async function getCloudContinueWatching(
  uid: string
): Promise<WatchHistoryEntry[]> {
  const path = `users/${uid}/continueWatching`;
  try {
    const q = query(
      collection(db, 'users', uid, 'continueWatching'),
      where('uid', '==', uid)
    );
    const snap = await getDocs(q);
    const items: WatchHistoryEntry[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const currentTime = Number(d.currentTime || 0);
      const duration = Number(d.duration || 1);
      const progress =
        typeof d.progress === 'number'
          ? d.progress
          : duration > 0
          ? Math.min(100, Math.max(0, Math.round((currentTime / duration) * 100)))
          : 0;
      const titleStr = String(d.animeTitle || d.title || 'Anime');
      const coverStr = d.animeCover || d.coverImage || undefined;

      items.push({
        hoshikaId: Number(d.hoshikaId),
        title: titleStr,
        animeTitle: titleStr,
        coverImage: coverStr,
        animeCover: coverStr,
        bannerImage: d.bannerImage || undefined,
        episodeNumber: Number(d.episodeNumber || 1),
        episodeTitle: d.episodeTitle || undefined,
        episodeThumbnail: d.episodeThumbnail || undefined,
        currentTime,
        duration,
        progress,
        audioType: d.audioType === 'dub' ? 'dub' : 'sub',
        timestamp: Number(d.timestamp || Date.now()),
        lastWatched: d.lastWatched || undefined,
      });
    });
    return items.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveCloudContinueWatchingItem(
  uid: string,
  entry: WatchHistoryEntry,
  audioType: 'sub' | 'dub' = 'sub'
): Promise<void> {
  const docId = sanitizeDocId(entry.hoshikaId);
  const path = `users/${uid}/continueWatching/${docId}`;
  const ref = doc(db, 'users', uid, 'continueWatching', docId);

  const safeDuration = entry.duration && entry.duration > 0 ? entry.duration : 1;
  const safeCurrentTime = Math.max(0, entry.currentTime || 0);
  const progressRatio = safeCurrentTime / safeDuration;

  // If completed (>= 95%), remove from continueWatching
  if (progressRatio >= 0.95) {
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await deleteDoc(ref);
      }
      return;
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  try {
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : null;
    const sameEpisode = existing && Number(existing.episodeNumber) === Number(entry.episodeNumber);

    const resolvedTitle = sanitizeString(
      entry.animeTitle || entry.title || existing?.animeTitle || existing?.title,
      300,
      'Unknown Anime'
    );
    const rawCover = entry.animeCover || entry.coverImage || existing?.animeCover || existing?.coverImage;
    const safeCover = rawCover ? sanitizeString(rawCover, 1024) : null;
    const rawBanner = entry.bannerImage || existing?.bannerImage;
    const safeBanner = rawBanner ? sanitizeString(rawBanner, 1024) : null;

    const incomingEpTitle = entry.episodeTitle?.trim();
    const isIncomingGeneric =
      !incomingEpTitle || /^ep(?:isode)?\.?\s*#?\d+$/i.test(incomingEpTitle);
    const rawEpTitle =
      !isIncomingGeneric
        ? incomingEpTitle
        : (sameEpisode && existing?.episodeTitle) || incomingEpTitle || null;
    const safeEpTitle = rawEpTitle ? sanitizeString(rawEpTitle, 300) : null;

    const rawEpThumb =
      entry.episodeThumbnail || (sameEpisode ? existing?.episodeThumbnail : null);
    const safeEpThumb = rawEpThumb ? sanitizeString(rawEpThumb, 1024) : null;

    const safeProgress = Math.min(
      100,
      Math.max(0, Math.round((safeCurrentTime / safeDuration) * 100))
    );
    const resolvedAudio =
      entry.audioType === 'dub' || audioType === 'dub' ? 'dub' : 'sub';
    const safeTimestamp = entry.timestamp > 0 ? entry.timestamp : Date.now();
    const safeLastWatched = sanitizeString(
      typeof entry.lastWatched === 'string'
        ? entry.lastWatched
        : new Date(safeTimestamp).toISOString(),
      64
    );

    const baseFields: Record<string, any> = {
      title: resolvedTitle,
      animeTitle: resolvedTitle,
      episodeNumber: Math.max(1, Number(entry.episodeNumber || 1)),
      currentTime: safeCurrentTime,
      duration: safeDuration,
      progress: safeProgress,
      coverImage: safeCover,
      animeCover: safeCover,
      bannerImage: safeBanner,
      episodeTitle: safeEpTitle,
      episodeThumbnail: safeEpThumb,
      audioType: resolvedAudio,
      timestamp: safeTimestamp,
      lastWatched: safeLastWatched,
    };

    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        hoshikaId: Number(entry.hoshikaId),
        ...baseFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...baseFields,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeCloudContinueWatchingItem(
  uid: string,
  hoshikaId: number
): Promise<void> {
  const docId = sanitizeDocId(hoshikaId);
  const path = `users/${uid}/continueWatching/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'continueWatching', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// 4. WATCH HISTORY (/users/{uid}/watchHistory/{historyId})
export async function getCloudWatchHistory(
  uid: string
): Promise<WatchHistoryEntry[]> {
  const path = `users/${uid}/watchHistory`;
  try {
    const q = query(
      collection(db, 'users', uid, 'watchHistory'),
      where('uid', '==', uid)
    );
    const snap = await getDocs(q);
    const items: WatchHistoryEntry[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const currentTime = Number(d.currentTime || 0);
      const duration = Number(d.duration || 0);
      const progress =
        typeof d.progress === 'number'
          ? d.progress
          : duration > 0
          ? Math.min(100, Math.max(0, Math.round((currentTime / duration) * 100)))
          : 0;
      const titleStr = String(d.animeTitle || d.title || 'Anime');
      const coverStr = d.animeCover || d.coverImage || undefined;

      items.push({
        hoshikaId: Number(d.hoshikaId),
        title: titleStr,
        animeTitle: titleStr,
        coverImage: coverStr,
        animeCover: coverStr,
        bannerImage: d.bannerImage || undefined,
        episodeNumber: Number(d.episodeNumber || 1),
        episodeTitle: d.episodeTitle || undefined,
        episodeThumbnail: d.episodeThumbnail || undefined,
        currentTime,
        duration,
        progress,
        audioType: d.audioType === 'dub' ? 'dub' : 'sub',
        timestamp: Number(d.timestamp || Date.now()),
        lastWatched: d.lastWatched || undefined,
        completed: d.status === 'completed',
      });
    });
    return items.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveCloudWatchHistoryItem(
  uid: string,
  entry: WatchHistoryEntry
): Promise<void> {
  const docId = sanitizeDocId(`${entry.hoshikaId}_${entry.episodeNumber}`);
  const path = `users/${uid}/watchHistory/${docId}`;
  const ref = doc(db, 'users', uid, 'watchHistory', docId);

  try {
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : null;

    const safeDuration = Math.max(
      0,
      Number(entry.duration || existing?.duration || 0)
    );
    const safeCurrentTime = Math.max(
      0,
      Number(
        entry.currentTime > 0
          ? entry.currentTime
          : existing?.currentTime || entry.currentTime || 0
      )
    );
    const isCompleted =
      entry.completed ||
      (safeDuration > 0 && safeCurrentTime / safeDuration >= 0.95);

    const resolvedTitle = sanitizeString(
      entry.animeTitle || entry.title || existing?.animeTitle || existing?.title,
      300,
      'Unknown Anime'
    );
    const rawCover =
      entry.animeCover || entry.coverImage || existing?.animeCover || existing?.coverImage;
    const safeCover = rawCover ? sanitizeString(rawCover, 1024) : null;
    const rawBanner = entry.bannerImage || existing?.bannerImage;
    const safeBanner = rawBanner ? sanitizeString(rawBanner, 1024) : null;

    const incomingEpTitle = entry.episodeTitle?.trim();
    const isIncomingGeneric =
      !incomingEpTitle || /^ep(?:isode)?\.?\s*#?\d+$/i.test(incomingEpTitle);
    const rawEpTitle =
      !isIncomingGeneric
        ? incomingEpTitle
        : existing?.episodeTitle || incomingEpTitle || null;
    const safeEpTitle = rawEpTitle ? sanitizeString(rawEpTitle, 300) : null;

    const rawEpThumb = entry.episodeThumbnail || existing?.episodeThumbnail;
    const safeEpThumb = rawEpThumb ? sanitizeString(rawEpThumb, 1024) : null;

    const safeProgress =
      safeDuration > 0
        ? Math.min(100, Math.max(0, Math.round((safeCurrentTime / safeDuration) * 100)))
        : typeof entry.progress === 'number'
        ? Math.min(100, Math.max(0, Math.round(entry.progress)))
        : 0;
    const resolvedAudio =
      entry.audioType === 'dub' || existing?.audioType === 'dub' ? 'dub' : 'sub';
    const safeTimestamp = entry.timestamp > 0 ? entry.timestamp : Date.now();
    const safeLastWatched = sanitizeString(
      typeof entry.lastWatched === 'string'
        ? entry.lastWatched
        : new Date(safeTimestamp).toISOString(),
      64
    );

    const baseFields: Record<string, any> = {
      title: resolvedTitle,
      animeTitle: resolvedTitle,
      coverImage: safeCover,
      animeCover: safeCover,
      bannerImage: safeBanner,
      episodeNumber: Math.max(1, Number(entry.episodeNumber || 1)),
      episodeTitle: safeEpTitle,
      episodeThumbnail: safeEpThumb,
      currentTime: safeCurrentTime,
      duration: safeDuration,
      progress: safeProgress,
      audioType: resolvedAudio,
      status: isCompleted ? 'completed' : 'watching',
      timestamp: safeTimestamp,
      lastWatched: safeLastWatched,
    };

    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        hoshikaId: Number(entry.hoshikaId),
        ...baseFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...baseFields,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeCloudWatchHistoryItem(
  uid: string,
  hoshikaId: number,
  episodeNumber: number
): Promise<void> {
  const docId = sanitizeDocId(`${hoshikaId}_${episodeNumber}`);
  const path = `users/${uid}/watchHistory/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'watchHistory', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearCloudWatchHistory(uid: string): Promise<void> {
  const path = `users/${uid}/watchHistory`;
  try {
    const q = query(
      collection(db, 'users', uid, 'watchHistory'),
      where('uid', '==', uid)
    );
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));

    const cwQuery = query(
      collection(db, 'users', uid, 'continueWatching'),
      where('uid', '==', uid)
    );
    const cwSnap = await getDocs(cwQuery);
    await Promise.all(cwSnap.docs.map((d) => deleteDoc(d.ref)));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// 5. USER PREFERENCES (/users/{uid}/preferences/settings)
export async function getCloudPreferences(
  uid: string
): Promise<UserPreferences | null> {
  const path = `users/${uid}/preferences/settings`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'preferences', 'settings'));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      defaultAudio: d.defaultAudio === 'dub' ? 'dub' : 'sub',
      defaultQuality: ['auto', '1080p', '720p', '480p'].includes(d.defaultQuality)
        ? d.defaultQuality
        : 'auto',
      autoPlayNext: Boolean(d.autoPlayNext),
      autoSkipIntro: Boolean(d.autoSkipIntro),
      autoSkipOutro: Boolean(d.autoSkipOutro),
      sidebarCollapsed: Boolean(d.sidebarCollapsed),
      compactCards: Boolean(d.compactCards),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveCloudPreferences(
  uid: string,
  prefs: UserPreferences
): Promise<void> {
  const path = `users/${uid}/preferences/settings`;
  const ref = doc(db, 'users', uid, 'preferences', 'settings');

  const baseFields: Record<string, any> = {
    theme: 'monochrome',
    defaultAudio: prefs.defaultAudio === 'dub' ? 'dub' : 'sub',
    defaultQuality: ['auto', '1080p', '720p', '480p'].includes(prefs.defaultQuality)
      ? prefs.defaultQuality
      : 'auto',
    autoPlayNext: Boolean(prefs.autoPlayNext),
    autoSkipIntro: Boolean(prefs.autoSkipIntro),
    autoSkipOutro: Boolean(prefs.autoSkipOutro),
    sidebarCollapsed: Boolean(prefs.sidebarCollapsed),
    compactCards: Boolean(prefs.compactCards),
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        ...baseFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...baseFields,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
