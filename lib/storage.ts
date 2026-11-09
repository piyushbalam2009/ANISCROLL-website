import {
  WatchlistEntry,
  WatchHistoryEntry,
  UserPreferences,
  SubtitlePreferences,
} from '@/types/streaming';

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

  if (status === 'remove') {
    updated = list.filter((x) => x.hoshikaId !== item.hoshikaId);
  } else if (existsIndex >= 0) {
    updated = list.map((x) => (x.hoshikaId === item.hoshikaId ? { ...x, status } : x));
  } else {
    updated = [{ ...item, status, addedAt: Date.now() }, ...list];
  }

  setStored(WATCHLIST_KEY, updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aniscroll_watchlist_updated'));
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
  // Filter items where progress is between 5% and 95%
  return history.filter((h) => {
    if (!h.duration || h.duration <= 0) return false;
    const progress = h.currentTime / h.duration;
    return progress > 0.03 && progress < 0.95;
  });
}

export function getSavedProgress(hoshikaId: number, episodeNumber: number): number {
  const history = getWatchHistory();
  const entry = history.find(
    (h) => h.hoshikaId === hoshikaId && h.episodeNumber === episodeNumber
  );
  return entry ? entry.currentTime : 0;
}

export function saveWatchProgress(entry: Omit<WatchHistoryEntry, 'timestamp'>): void {
  const history = getWatchHistory();
  // Remove older entry for the same anime + episode
  const filtered = history.filter(
    (h) => !(h.hoshikaId === entry.hoshikaId && h.episodeNumber === entry.episodeNumber)
  );
  const updated: WatchHistoryEntry[] = [
    { ...entry, timestamp: Date.now() },
    ...filtered,
  ].slice(0, 100); // Keep max 100 entries

  setStored(HISTORY_KEY, updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aniscroll_history_updated'));
  }
}

export function clearWatchHistory(): void {
  setStored(HISTORY_KEY, []);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aniscroll_history_updated'));
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
}

// User Settings
export function getUserPreferences(): UserPreferences {
  return getStored<UserPreferences>(SETTINGS_KEY, DEFAULT_PREFERENCES);
}

export function saveUserPreferences(prefs: Partial<UserPreferences>): UserPreferences {
  const current = getUserPreferences();
  const updated = { ...current, ...prefs };
  setStored(SETTINGS_KEY, updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aniscroll_preferences_updated', { detail: updated }));
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
  return getStored<SubtitlePreferences>(SUBTITLE_SETTINGS_KEY, DEFAULT_SUBTITLE_PREFERENCES);
}

export function saveSubtitlePreferences(prefs: Partial<SubtitlePreferences>): SubtitlePreferences {
  const current = getSubtitlePreferences();
  const updated = { ...current, ...prefs };
  setStored(SUBTITLE_SETTINGS_KEY, updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aniscroll_subtitles_updated', { detail: updated }));
  }
  return updated;
}

export function resetSubtitlePreferences(): SubtitlePreferences {
  setStored(SUBTITLE_SETTINGS_KEY, DEFAULT_SUBTITLE_PREFERENCES);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('aniscroll_subtitles_updated', { detail: DEFAULT_SUBTITLE_PREFERENCES })
    );
  }
  return DEFAULT_SUBTITLE_PREFERENCES;
}
