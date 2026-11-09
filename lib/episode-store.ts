import { HoshikaEpisodeItem } from '@/types/anime';

// In-memory client cache: animeId -> Map<number, HoshikaEpisodeItem>
const clientEpisodeCache: Record<string, Map<number, HoshikaEpisodeItem>> = {};

// In-flight request deduplication map
const inFlightRequests = new Map<string, Promise<HoshikaEpisodeItem[]>>();

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
