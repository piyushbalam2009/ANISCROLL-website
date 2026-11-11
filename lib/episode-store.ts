import { HoshikaEpisodeItem } from '@/types/anime';
import { WatchHistoryEntry } from '@/types/streaming';
import { needsMetadataEnrichment } from './continue-watching';
import { updateWatchHistoryMetadata } from './storage';

// In-memory client cache: animeId -> Map<number, HoshikaEpisodeItem>
const clientEpisodeCache: Record<string, Map<number, HoshikaEpisodeItem>> = {};

// In-flight request deduplication map
const inFlightRequests = new Map<string, Promise<HoshikaEpisodeItem[]>>();

// Track attempted metadata enrichments to avoid duplicate fetches
const attemptedEnrichments = new Set<string>();

/**
 * Retrieve cached episodes for an anime sorted by episode number.
 */
export function getCachedEpisodes(animeId: string | number): HoshikaEpisodeItem[] {
  const key = String(animeId);
  const map = clientEpisodeCache[key];
  if (!map) return [];
  return Array.from(map.values()).sort((a, b) => a.number - b.number);
}

/**
 * Retrieve a single episode from cache.
 */
export function getCachedEpisode(
  animeId: string | number,
  episodeNumber: number
): HoshikaEpisodeItem | undefined {
  const key = String(animeId);
  return clientEpisodeCache[key]?.get(episodeNumber);
}

/**
 * Store episodes in the client cache.
 */
export function cacheEpisodes(
  animeId: string | number,
  items: HoshikaEpisodeItem[]
): void {
  if (!items || items.length === 0) return;
  const key = String(animeId);
  if (!clientEpisodeCache[key]) {
    clientEpisodeCache[key] = new Map();
  }
  const map = clientEpisodeCache[key];
  for (const ep of items) {
    if (ep && typeof ep.number === 'number') {
      map.set(ep.number, ep);
    }
  }
}

/**
 * Check if all episodes in a given range [start, end] are present in the cache.
 */
export function isRangeCached(
  animeId: string | number,
  start: number,
  end: number
): boolean {
  const key = String(animeId);
  const map = clientEpisodeCache[key];
  if (!map) return false;

  let count = 0;
  for (let n = start; n <= end; n++) {
    if (map.has(n)) {
      count++;
    }
  }
  const expected = end - start + 1;
  return count >= expected || (count > 0 && map.has(start) && map.has(end));
}

/**
 * Fetch an episode batch for an anime with `after` pagination.
 * GET /api/episodes/{animeId}?after={after}&limit={limit}
 */
export async function fetchEpisodeBatch(
  animeId: string | number,
  after?: number,
  limit: number = 50
): Promise<HoshikaEpisodeItem[]> {
  const key = String(animeId);
  const requestKey = `${key}:after=${after ?? 0}:limit=${limit}`;

  const inFlight = inFlightRequests.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (after !== undefined) {
        params.append('after', String(after));
      }
      const res = await fetch(`/api/episodes/${key}?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch episodes (${res.status})`);
      }
      const data = await res.json();
      const items: HoshikaEpisodeItem[] = data.items || [];
      if (items.length > 0) {
        cacheEpisodes(key, items);
      }
      return items;
    } catch (err: any) {
      console.error(`Error fetching episode batch for anime ${animeId}:`, err);
      return [];
    } finally {
      inFlightRequests.delete(requestKey);
    }
  })();

  inFlightRequests.set(requestKey, promise);
  return promise;
}

/**
 * Fetch all episodes for an anime sequentially.
 */
export async function fetchAllAnimeEpisodes(
  animeId: string | number
): Promise<HoshikaEpisodeItem[]> {
  const key = String(animeId);
  const requestKey = `${key}:all`;

  const inFlight = inFlightRequests.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    try {
      const res = await fetch(`/api/episodes/${key}?all=true`);
      if (!res.ok) {
        throw new Error(`Failed to fetch all episodes (${res.status})`);
      }
      const data = await res.json();
      const items: HoshikaEpisodeItem[] = data.items || [];
      if (items.length > 0) {
        cacheEpisodes(key, items);
      }
      return items;
    } catch (err: any) {
      console.error(`Error fetching all episodes for anime ${animeId}:`, err);
      return [];
    } finally {
      inFlightRequests.delete(requestKey);
    }
  })();

  inFlightRequests.set(requestKey, promise);
  return promise;
}

/**
 * Enriches watch history / continue watching items that are missing episode thumbnails,
 * real episode titles, or anime cover images by fetching real episode & anime metadata.
 */
export async function enrichWatchHistoryEntries(
  entries: WatchHistoryEntry[]
): Promise<void> {
  if (!entries || entries.length === 0 || typeof window === 'undefined') return;

  const toEnrich = entries.filter((entry) => {
    const key = `${entry.hoshikaId}:${entry.episodeNumber}`;
    if (attemptedEnrichments.has(key)) return false;
    return needsMetadataEnrichment(entry);
  });

  if (toEnrich.length === 0) return;

  await Promise.all(
    toEnrich.map(async (entry) => {
      const key = `${entry.hoshikaId}:${entry.episodeNumber}`;
      attemptedEnrichments.add(key);

      // Check in-memory episode cache first
      const cachedEp = getCachedEpisode(entry.hoshikaId, entry.episodeNumber);
      if (
        cachedEp?.title &&
        cachedEp?.thumbnail &&
        (entry.coverImage || entry.animeCover)
      ) {
        updateWatchHistoryMetadata({
          hoshikaId: entry.hoshikaId,
          episodeNumber: entry.episodeNumber,
          episodeTitle: cachedEp.title,
          episodeThumbnail: cachedEp.thumbnail,
        });
        return;
      }

      try {
        const res = await fetch(
          `/api/episodes/${entry.hoshikaId}?episode=${entry.episodeNumber}&includeAnime=true`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data?.items) && data.items.length > 0) {
          cacheEpisodes(entry.hoshikaId, data.items);
        }

        const ep: HoshikaEpisodeItem | null =
          data?.episode ||
          (Array.isArray(data?.items)
            ? data.items.find((e: HoshikaEpisodeItem) => e.number === entry.episodeNumber)
            : null);

        const anime = data?.anime;
        const resolvedAnimeTitle =
          anime?.titleEnglish ||
          anime?.titleRomaji ||
          anime?.titleLocalized ||
          entry.animeTitle ||
          entry.title;

        updateWatchHistoryMetadata({
          hoshikaId: entry.hoshikaId,
          episodeNumber: entry.episodeNumber,
          anilistId: anime?.anilistId ?? entry.anilistId ?? null,
          title: resolvedAnimeTitle,
          animeTitle: resolvedAnimeTitle,
          coverImage: anime?.coverImage || entry.coverImage || entry.animeCover,
          animeCover: anime?.coverImage || entry.animeCover || entry.coverImage,
          bannerImage: anime?.bannerImage || entry.bannerImage,
          episodeTitle: ep?.title || entry.episodeTitle,
          episodeThumbnail: ep?.thumbnail || entry.episodeThumbnail,
        });
      } catch (err) {
        console.error('Failed to enrich watch history metadata:', err);
      }
    })
  );
}

