import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  CloudUserProfile,
  OperationType,
  handleFirestoreError,
  getCloudWatchlist,
  saveCloudWatchlistItem,
  getCloudWatchHistory,
  saveCloudWatchHistoryItem,
  saveCloudContinueWatchingItem,
  getCloudPreferences,
  saveCloudPreferences,
  markMigrationCompleted,
} from './firestore';
import {
  getWatchlist,
  getWatchHistory,
  getUserPreferences,
  syncWatchlistFromCloud,
  syncWatchHistoryFromCloud,
  syncPreferencesFromCloud,
} from './storage';
import { WatchlistEntry, WatchHistoryEntry } from '@/types/streaming';

/**
 * Migrates existing localStorage watchlist, watch history, continue watching,
 * and preferences into Cloud Firestore on first login without overwriting
 * newer cloud records or creating duplicates.
 */
export async function migrateLocalDataToFirestore(
  uid: string,
  profile: CloudUserProfile
): Promise<void> {
  if (typeof window === 'undefined') return;

  const localWatchlist = getWatchlist();
  const localHistory = getWatchHistory();
  const localPrefs = getUserPreferences();

  const [cloudWatchlist, cloudHistory, cloudPrefs] = await Promise.all([
    getCloudWatchlist(uid),
    getCloudWatchHistory(uid),
    getCloudPreferences(uid),
  ]);

  if (!profile.migrationCompleted) {
    // 1. Merge Watchlist (keep newer addedAt per hoshikaId)
    const cloudWatchlistMap = new Map<number, WatchlistEntry>();
    for (const item of cloudWatchlist) {
      cloudWatchlistMap.set(item.hoshikaId, item);
    }

    for (const localItem of localWatchlist) {
      const existingCloud = cloudWatchlistMap.get(localItem.hoshikaId);
      if (!existingCloud || localItem.addedAt > existingCloud.addedAt) {
        await saveCloudWatchlistItem(uid, localItem);
        cloudWatchlistMap.set(localItem.hoshikaId, localItem);
      }
    }

    // 2. Merge Watch History & Continue Watching (keep newer timestamp per hoshikaId + episodeNumber)
    const cloudHistoryMap = new Map<string, WatchHistoryEntry>();
    for (const item of cloudHistory) {
      cloudHistoryMap.set(`${item.hoshikaId}_${item.episodeNumber}`, item);
    }

    for (const localEntry of localHistory) {
      const key = `${localEntry.hoshikaId}_${localEntry.episodeNumber}`;
      const existingCloud = cloudHistoryMap.get(key);
      if (!existingCloud || localEntry.timestamp > existingCloud.timestamp) {
        await saveCloudWatchHistoryItem(uid, localEntry);
        await saveCloudContinueWatchingItem(
          uid,
          localEntry,
          localPrefs.defaultAudio
        );
        cloudHistoryMap.set(key, localEntry);
      }
    }

    // 3. Merge Preferences (initialize cloud preferences from local if none exist yet)
    if (!cloudPrefs) {
      await saveCloudPreferences(uid, localPrefs);
    }

    // Mark migration complete on user profile doc
    await markMigrationCompleted(uid);

    // Sync merged state back to local mirror
    syncWatchlistFromCloud(
      Array.from(cloudWatchlistMap.values()).sort((a, b) => b.addedAt - a.addedAt)
    );
    syncWatchHistoryFromCloud(
      Array.from(cloudHistoryMap.values()).sort((a, b) => b.timestamp - a.timestamp)
    );
    if (cloudPrefs) {
      syncPreferencesFromCloud(cloudPrefs);
    }
  } else {
    // Already migrated: hydrate local cache from cloud
    syncWatchlistFromCloud(cloudWatchlist);
    syncWatchHistoryFromCloud(cloudHistory);
    if (cloudPrefs) {
      syncPreferencesFromCloud(cloudPrefs);
    }
  }
}

/**
 * Attaches real-time Firestore listeners for the authenticated user's
 * watchlist, watchHistory, and preferences collections.
 */
export function subscribeToUserCloudData(uid: string): () => void {
  const unsubscribers: Unsubscribe[] = [];

  // 1. Watchlist real-time listener
  const watchlistPath = `users/${uid}/watchlist`;
  const watchlistQuery = query(
    collection(db, 'users', uid, 'watchlist'),
    where('uid', '==', uid)
  );
  const unsubWatchlist = onSnapshot(
    watchlistQuery,
    (snapshot) => {
      const items: WatchlistEntry[] = [];
      snapshot.forEach((docSnap) => {
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
      items.sort((a, b) => b.addedAt - a.addedAt);
      syncWatchlistFromCloud(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, watchlistPath);
    }
  );
  unsubscribers.push(unsubWatchlist);

  // 2. Watch History real-time listener
  const historyPath = `users/${uid}/watchHistory`;
  const historyQuery = query(
    collection(db, 'users', uid, 'watchHistory'),
    where('uid', '==', uid)
  );
  const unsubHistory = onSnapshot(
    historyQuery,
    (snapshot) => {
      const items: WatchHistoryEntry[] = [];
      snapshot.forEach((docSnap) => {
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
      items.sort((a, b) => b.timestamp - a.timestamp);
      syncWatchHistoryFromCloud(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, historyPath);
    }
  );
  unsubscribers.push(unsubHistory);

  // 3. Preferences real-time listener
  const prefsPath = `users/${uid}/preferences/settings`;
  const prefsRef = doc(db, 'users', uid, 'preferences', 'settings');
  const unsubPrefs = onSnapshot(
    prefsRef,
    (docSnap) => {
      if (!docSnap.exists()) return;
      const d = docSnap.data();
      syncPreferencesFromCloud({
        defaultAudio: d.defaultAudio === 'dub' ? 'dub' : 'sub',
        defaultQuality: ['auto', '1080p', '720p', '480p'].includes(
          d.defaultQuality
        )
          ? d.defaultQuality
          : 'auto',
        autoPlayNext: Boolean(d.autoPlayNext),
        autoSkipIntro: Boolean(d.autoSkipIntro),
        autoSkipOutro: Boolean(d.autoSkipOutro),
        sidebarCollapsed: Boolean(d.sidebarCollapsed),
        compactCards: Boolean(d.compactCards),
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, prefsPath);
    }
  );
  unsubscribers.push(unsubPrefs);

  return () => {
    unsubscribers.forEach((unsub) => unsub());
  };
}
