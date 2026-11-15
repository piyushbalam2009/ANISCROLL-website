import {
  WatchlistEntry,
  WatchHistoryEntry,
  UserPreferences,
  SubtitlePreferences,
} from '@/types/streaming';
import { auth } from './firebase';
import {
  saveCloudWatchlistItem,
  removeCloudWatchlistItem,
  saveCloudContinueWatchingItem,
  removeCloudContinueWatchingItem,
  saveCloudWatchHistoryItem,
  removeCloudWatchHistoryItem,
  clearCloudWatchHistory,
  saveCloudPreferences,
} from './firestore';
import { mergeWatchHistoryEntry } from './continue-watching';

const WATCHLIST_KEY = 'aniscroll_watchlist';
const HISTORY_KEY = 'aniscroll_watch_history';
const SETTINGS_KEY = 'aniscroll_preferences';
const SUBTITLE_SETTINGS_KEY = 'aniscroll_subtitle_settings';

export const DEFAULT_PREFERENCES: UserPreferences = {
  autoPlayNext: true,
  autoSkipIntro: false,
  autoSkipOutro: false,
  defaultAudio: 'sub',
  defaultQuality: 'auto',
  sidebarCollapsed: false,
  compactCards: false,
};

// Safe localStorage helper for SSR
function getStored<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : defaultValue;
  } catch (e) {
    console.error('Storage read error:', e);
    return defaultValue;
  }
}

function setStored<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Storage write error:', e);
  }
}

// Cloud-to-Local Mirror Helpers (invoked by real-time Firestore listeners)
export function syncWatchlistFromCloud(items: WatchlistEntry[]): void {
  setStored(WATCHLIST_KEY, items);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aniscroll_watchlist_updated'));
  }
}

export function syncWatchHistoryFromCloud(items: WatchHistoryEntry[]): void {
  const localHistory = getStored<WatchHistoryEntry[]>(HISTORY_KEY, []);
  const localMap = new Map<string, WatchHistoryEntry>();
  for (const item of localHistory) {
    localMap.set(`${item.hoshikaId}_${item.episodeNumber}`, item);
  }

  const merged = items.map((cloudItem) => {
    const key = `${cloudItem.hoshikaId}_${cloudItem.episodeNumber}`;
    const existingLocal = localMap.get(key);
    return mergeWatchHistoryEntry(cloudItem, existingLocal, { metadataOnly: true });
  });

  setStored(HISTORY_KEY, merged);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aniscroll_history_updated'));
  }
}

export function syncPreferencesFromCloud(prefs: UserPreferences): void {
  setStored(SETTINGS_KEY, prefs);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('aniscroll_preferences_updated', { detail: prefs })
    );
  }
}

// Watchlist
export function getWatchlist(): WatchlistEntry[] {
  return getStored<WatchlistEntry[]>(WATCHLIST_KEY, []);
}

export function isInWatchlist(hoshikaId: number): boolean {
  const list = getWatchlist();
  return list.some((item) => item.hoshikaId === hoshikaId);
}

export function getWatchlistEntry(hoshikaId: number): WatchlistEntry | null {
  const list = getWatchlist();
  return list.find((item) => item.hoshikaId === hoshikaId) || null;
}

export function setWatchlistStatus(
  item: Omit<WatchlistEntry, 'addedAt'>,
  status: 'watching' | 'plan_to_watch' | 'completed' | 'on_hold' | 'dropped' | 'remove'
): boolean {
  const list = getWatchlist();
  const existsIndex = list.findIndex((x) => x.hoshikaId === item.hoshikaId);
  let updated: WatchlistEntry[];
  const now = Date.now();
  let targetEntry: WatchlistEntry | null = null;

  if (status === 'remove') {
    updated = list.filter((x) => x.hoshikaId !== item.hoshikaId);
  } else if (existsIndex >= 0) {
    targetEntry = { ...list[existsIndex], ...item, status };
    updated = list.map((x) =>
      x.hoshikaId === item.hoshikaId ? targetEntry! : x
    );
  } else {
    targetEntry = { ...item, status, addedAt: now };
    updated = [targetEntry, ...list];
  }

  setStored(WATCHLIST_KEY, updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aniscroll_watchlist_updated'));
  }

  // Persist to Cloud Firestore if authenticated
  const currentUser = auth?.currentUser;
  if (currentUser) {
    if (status === 'remove') {
      removeCloudWatchlistItem(currentUser.uid, item.hoshikaId).catch((err) =>
        console.error('Cloud watchlist remove failed:', err)
      );
    } else if (targetEntry) {
      saveCloudWatchlistItem(currentUser.uid, targetEntry).catch((err) =>
        console.error('Cloud watchlist save failed:', err)
      );
    }
  }

  return status !== 'remove';
}

export function toggleWatchlist(item: Omit<WatchlistEntry, 'addedAt'>): boolean {
  const inList = isInWatchlist(item.hoshikaId);
  return setWatchlistStatus(item, inList ? 'remove' : 'watching');
}

const SUBSCRIPTION_KEY = 'aniscroll_subscriptions';

export function isSubscribed(hoshikaId: number): boolean {
  const list = getStored<number[]>(SUBSCRIPTION_KEY, []);
  return list.includes(hoshikaId);
}

export function toggleSubscription(hoshikaId: number): boolean {
  const list = getStored<number[]>(SUBSCRIPTION_KEY, []);
  let updated: number[];
  let subscribed: boolean;
  if (list.includes(hoshikaId)) {
    updated = list.filter((id) => id !== hoshikaId);
    subscribed = false;
  } else {
    updated = [...list, hoshikaId];
    subscribed = true;
  }
  setStored(SUBSCRIPTION_KEY, updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('aniscroll_subscriptions_updated', {
        detail: { hoshikaId, subscribed },
      })
    );
  }
  return subscribed;
}

// Watch History
export function getWatchHistory(): WatchHistoryEntry[] {
  return getStored<WatchHistoryEntry[]>(HISTORY_KEY, []);
}

export function getContinueWatching(): WatchHistoryEntry[] {
  const history = getWatchHistory();
  const seenAnime = new Set<number>();
  const result: WatchHistoryEntry[] = [];

  for (const h of history) {
    if (!h.duration || h.duration <= 0) continue;
    if (h.completed) continue;
    const progress = h.currentTime / h.duration;
    // Include started episodes (< 99% complete and at least 1% or >= 5s watched)
    if ((progress >= 0.01 || h.currentTime >= 5) && progress < 0.99) {
      if (!seenAnime.has(h.hoshikaId)) {
        seenAnime.add(h.hoshikaId);
        result.push(h);
      }
    }
  }

  return result;
}

export function getSavedHistoryEntry(
  hoshikaId: number,
  episodeNumber: number
): WatchHistoryEntry | null {
  const history = getWatchHistory();
  return (
    history.find(
      (h) => h.hoshikaId === Number(hoshikaId) && h.episodeNumber === Number(episodeNumber)
    ) || null
  );
}

export function getSavedProgress(hoshikaId: number, episodeNumber: number): number {
  const entry = getSavedHistoryEntry(hoshikaId, episodeNumber);
  return entry ? entry.currentTime : 0;
}

export function saveWatchProgress(
  entry: Omit<WatchHistoryEntry, 'timestamp'> & { timestamp?: number }
): WatchHistoryEntry {
  const history = getWatchHistory();
  const existingEpisode = history.find(
    (h) => h.hoshikaId === entry.hoshikaId && h.episodeNumber === entry.episodeNumber
  );
  const existingSeries = history.find((h) => h.hoshikaId === entry.hoshikaId);

  const baseExisting: Partial<WatchHistoryEntry> | undefined = existingEpisode
    ? {
        ...existingSeries,
        ...existingEpisode,
      }
    : existingSeries
    ? {
        hoshikaId: existingSeries.hoshikaId,
        anilistId: existingSeries.anilistId,
        malId: existingSeries.malId,
        title: existingSeries.title,
        animeTitle: existingSeries.animeTitle,
        coverImage: existingSeries.coverImage,
        animeCover: existingSeries.animeCover,
        bannerImage: existingSeries.bannerImage,
        audioType: existingSeries.audioType,
      }
    : undefined;

  const fullEntry = mergeWatchHistoryEntry(entry, baseExisting);

  // Remove older entry for the same anime + episode
  const filtered = history.filter(
    (h) => !(h.hoshikaId === entry.hoshikaId && h.episodeNumber === entry.episodeNumber)
  );
  const updated: WatchHistoryEntry[] = [fullEntry, ...filtered].slice(0, 100);

  setStored(HISTORY_KEY, updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aniscroll_history_updated'));
  }

  // Persist to Cloud Firestore if authenticated
  const currentUser = auth?.currentUser;
  if (currentUser) {
    const prefs = getUserPreferences();
    const audioType = fullEntry.audioType || prefs.defaultAudio || 'sub';
    saveCloudWatchHistoryItem(currentUser.uid, fullEntry).catch((err) =>
      console.error('Cloud watch history save failed:', err)
    );
    saveCloudContinueWatchingItem(currentUser.uid, fullEntry, audioType).catch((err) =>
      console.error('Cloud continue watching save failed:', err)
    );
  }

  return fullEntry;
}

/**
 * Updates metadata (episodeTitle, episodeThumbnail, coverImage, bannerImage, anilistId)
 * on an existing watch-history record when metadata resolves after playback starts,
 * without resetting playback position or timestamp order.
 */
export function updateWatchHistoryMetadata(
  metadata: Partial<WatchHistoryEntry> & { hoshikaId: number; episodeNumber: number }
): WatchHistoryEntry | null {
  const history = getWatchHistory();
  const idx = history.findIndex(
    (h) =>
      h.hoshikaId === Number(metadata.hoshikaId) &&
      h.episodeNumber === Number(metadata.episodeNumber)
  );

  if (idx === -1) return null;

  const existing = history[idx];
  const merged = mergeWatchHistoryEntry(metadata, existing, { metadataOnly: true });

  // Only write and dispatch if metadata actually improved/changed
  const changed =
    merged.episodeTitle !== existing.episodeTitle ||
    merged.episodeThumbnail !== existing.episodeThumbnail ||
    merged.coverImage !== existing.coverImage ||
    merged.animeCover !== existing.animeCover ||
    merged.bannerImage !== existing.bannerImage ||
    merged.animeTitle !== existing.animeTitle ||
    merged.title !== existing.title ||
    merged.anilistId !== existing.anilistId ||
    merged.audioType !== existing.audioType;

  if (!changed) return existing;

  const updated = [...history];
  updated[idx] = merged;
  setStored(HISTORY_KEY, updated);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aniscroll_history_updated'));
  }

  const currentUser = auth?.currentUser;
  if (currentUser) {
    const prefs = getUserPreferences();
    const audioType = merged.audioType || prefs.defaultAudio || 'sub';
    saveCloudWatchHistoryItem(currentUser.uid, merged).catch((err) =>
      console.error('Cloud watch history metadata update failed:', err)
    );
    saveCloudContinueWatchingItem(currentUser.uid, merged, audioType).catch((err) =>
      console.error('Cloud continue watching metadata update failed:', err)
    );
  }

  return merged;
}

export function clearWatchHistory(): void {
  setStored(HISTORY_KEY, []);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aniscroll_history_updated'));
  }

  const currentUser = auth?.currentUser;
  if (currentUser) {
    clearCloudWatchHistory(currentUser.uid).catch((err) =>
      console.error('Cloud clear watch history failed:', err)
    );
  }
}

export function removeHistoryEntry(hoshikaId: number, episodeNumber: number): void {
  const history = getWatchHistory();
  const updated = history.filter(
    (h) => !(h.hoshikaId === hoshikaId && h.episodeNumber === episodeNumber)
  );
  setStored(HISTORY_KEY, updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aniscroll_history_updated'));
  }

  const currentUser = auth?.currentUser;
  if (currentUser) {
    removeCloudWatchHistoryItem(currentUser.uid, hoshikaId, episodeNumber).catch(
      (err) => console.error('Cloud remove history item failed:', err)
    );
    removeCloudContinueWatchingItem(currentUser.uid, hoshikaId).catch((err) =>
      console.error('Cloud remove continue watching item failed:', err)
    );
  }
}

// User Settings
export function getUserPreferences(): UserPreferences {
  const stored = getStored<Partial<UserPreferences>>(SETTINGS_KEY, DEFAULT_PREFERENCES);
  return {
    ...DEFAULT_PREFERENCES,
    ...(stored && typeof stored === 'object' ? stored : {}),
    defaultAudio: stored?.defaultAudio === 'dub' ? 'dub' : 'sub',
  };
}

export function saveUserPreferences(prefs: Partial<UserPreferences>): UserPreferences {
  const current = getUserPreferences();
  const updated = { ...current, ...prefs };
  setStored(SETTINGS_KEY, updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('aniscroll_preferences_updated', { detail: updated })
    );
  }

  const currentUser = auth?.currentUser;
  if (currentUser) {
    saveCloudPreferences(currentUser.uid, updated).catch((err) =>
      console.error('Cloud preferences save failed:', err)
    );
  }

  return updated;
}

// Subtitle Preferences
export const DEFAULT_SUBTITLE_PREFERENCES: SubtitlePreferences = {
  fontFamily: 'Roboto',
  fontSize: 22,
  fontWeight: 'Bold',
  textColor: '#FFFFFF',
  textColorPreset: 'White',
  backgroundColor: '#000000',
  backgroundOpacity: 65,
  isBackgroundTransparent: false,
  outline: 'Thin',
  shadow: 'Light',
  position: 'Bottom',
  alignment: 'Center',
  offsetSeconds: 0.0,
};

export function getSubtitlePreferences(): SubtitlePreferences {
  return getStored<SubtitlePreferences>(
    SUBTITLE_SETTINGS_KEY,
    DEFAULT_SUBTITLE_PREFERENCES
  );
}

export function saveSubtitlePreferences(
  prefs: Partial<SubtitlePreferences>
): SubtitlePreferences {
  const current = getSubtitlePreferences();
  const updated = { ...current, ...prefs };
  setStored(SUBTITLE_SETTINGS_KEY, updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('aniscroll_subtitles_updated', { detail: updated })
    );
  }
  return updated;
}

export function resetSubtitlePreferences(): SubtitlePreferences {
  setStored(SUBTITLE_SETTINGS_KEY, DEFAULT_SUBTITLE_PREFERENCES);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('aniscroll_subtitles_updated', {
        detail: DEFAULT_SUBTITLE_PREFERENCES,
      })
    );
  }
  return DEFAULT_SUBTITLE_PREFERENCES;
}
