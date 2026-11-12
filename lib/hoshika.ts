import { appCache } from './cache';
import {
  classifyUpstreamError,
  recordUpstreamMetric,
} from './perf-monitor';
import {
  normalizeCatalogQuery,
  buildCatalogCacheKey,
  deduplicateAnimeList,
  processCatalogItems,
} from './explore-catalog';
import { HoshikaAnimeItem, HoshikaEpisodeItem, ScheduleItem } from '@/types/anime';

const BASE_URL = 'https://hoshika.app/api/v1';
const HOSHIKA_TIMEOUT_MS = 6500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Core Hoshika fetcher with:
 * - In-memory LRU + Stale-While-Revalidate (SWR) caching
 * - In-flight request deduplication (via appCache.getOrSet)
 * - Structured error classification (timeout, 429, 5xx, invalid JSON)
 * - 1 bounded retry with jitter for transient 5xx / network errors
 * - Stale-on-error fallback
 */
export async function fetchFromHoshika<T>(
  endpoint: string,
  cacheTtlSeconds: number = 300
): Promise<T | null> {
  const cacheKey = `hoshika:${endpoint}`;

  // Fast path check for telemetry before entering getOrSet
  const preState = appCache.getEntryState<T>(cacheKey);
  if (preState.status === 'fresh' && preState.value !== null) {
    recordUpstreamMetric({
      provider: 'hoshika',
      endpoint,
      durationMs: 0,
      status: 200,
      fromCache: true,
    });
  } else if (preState.status === 'stale' && preState.value !== null) {
    recordUpstreamMetric({
      provider: 'hoshika',
      endpoint,
      durationMs: 0,
      status: 200,
      fromCache: true,
      staleRevalidated: true,
    });
  }

  return appCache.getOrSet<T | null>(
    cacheKey,
    async () => {
      const maxAttempts = 2;
      let attempt = 0;

      while (attempt < maxAttempts) {
        attempt++;
        const startTime = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HOSHIKA_TIMEOUT_MS);

        try {
          const res = await fetch(`${BASE_URL}${endpoint}`, {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'AniScroll/1.0',
            },
            signal: controller.signal,
            next: { revalidate: cacheTtlSeconds },
          });

          const durationMs = Date.now() - startTime;

          if (!res.ok) {
            const structuredErr = classifyUpstreamError({
              provider: 'hoshika',
              endpoint,
              status: res.status,
              durationMs,
              retryAfterHeader: res.headers.get('Retry-After'),
            });

            recordUpstreamMetric({
              provider: 'hoshika',
              endpoint,
              durationMs,
              status: res.status,
              fromCache: false,
              errorCode: structuredErr.code,
            });

            // Only retry transient 5xx server errors once; never aggressively retry 429 or 4xx
            if (
              structuredErr.code === 'server_error' &&
              attempt < maxAttempts
            ) {
              await sleep(250 + Math.floor(Math.random() * 150));
              continue;
            }

            return null;
          }

          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) {
            recordUpstreamMetric({
              provider: 'hoshika',
              endpoint,
              durationMs,
              status: res.status,
              fromCache: false,
              errorCode: 'invalid_json',
            });
            return null;
          }

          const data = await res.json();
          if (!data || typeof data !== 'object' || data.ok === false) {
            recordUpstreamMetric({
              provider: 'hoshika',
              endpoint,
              durationMs,
              status: res.status,
              fromCache: false,
              errorCode: 'bad_request',
            });
            return null;
          }

          recordUpstreamMetric({
            provider: 'hoshika',
            endpoint,
            durationMs,
            status: res.status,
            fromCache: false,
          });

          return data as T;
        } catch (err: any) {
          const durationMs = Date.now() - startTime;
          const structuredErr = classifyUpstreamError({
            provider: 'hoshika',
            endpoint,
            error: err,
            durationMs,
          });

          recordUpstreamMetric({
            provider: 'hoshika',
            endpoint,
            durationMs,
            status: null,
            fromCache: false,
            errorCode: structuredErr.code,
          });

          if (
            (structuredErr.code === 'network_error' ||
              structuredErr.code === 'timeout') &&
            attempt < maxAttempts
          ) {
            await sleep(250 + Math.floor(Math.random() * 150));
            continue;
          }

          return null;
        } finally {
          clearTimeout(timeout);
        }
      }

      return null;
    },
    {
      ttlSeconds: cacheTtlSeconds,
      staleWhileRevalidateSeconds: Math.min(cacheTtlSeconds * 2, 3600),
      shouldCache: (data) => {
        if (!data) return false;
        const isEmptyEpisodesResponse =
          endpoint.includes('/episodes') &&
          Array.isArray((data as any).items) &&
          (data as any).items.length === 0;
        return !isEmptyEpisodesResponse;
      },
      serveStaleOnError: true,
    }
  );
}

export async function searchHoshika(
  query: string,
  limit: number = 20,
  format?: string,
  year?: string | number
): Promise<HoshikaAnimeItem[]> {
  if (!query || !query.trim()) return [];
  const trimmedQuery = query.trim();
  const requestedLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.floor(Number(limit)))
    : 20;
  // Hoshika /api/v1/search strictly requires 1 <= limit <= 20 (values > 20 return 400 Bad Request)
  const searchApiLimit = Math.min(20, requestedLimit);

  const params = new URLSearchParams({
    q: trimmedQuery,
    limit: String(searchApiLimit),
  });
  if (format) params.append('format', format);
  if (year) params.append('year', String(year));

  const data = await fetchFromHoshika<{
    ok: boolean;
    anime?: HoshikaAnimeItem[];
  }>(`/search?${params.toString()}`, 300);
  const searchResults = data?.anime || [];

  if (requestedLimit <= 20 || searchResults.length < 20) {
    return searchResults.slice(0, requestedLimit);
  }

  // When more than 20 results are requested, supplement from /catalog without violating /search limit=20
  const catalogData = await getHoshikaCatalog({
    q: trimmedQuery,
    format,
    year: year ? String(year) : undefined,
  });

  const mergedMap = new Map<number | string, HoshikaAnimeItem>();
  for (const item of searchResults) {
    if (item && item.shortId != null) {
      mergedMap.set(item.shortId, item);
    }
  }
  for (const item of catalogData.items) {
    if (item && item.shortId != null && !mergedMap.has(item.shortId)) {
      mergedMap.set(item.shortId, item);
    }
  }

  return Array.from(mergedMap.values()).slice(0, requestedLimit);
}

export async function getHoshikaAnime(
  shortId: string | number,
  locale: string = 'en'
): Promise<HoshikaAnimeItem | null> {
  const data = await fetchFromHoshika<{ ok: boolean; anime?: any }>(
    `/anime/${shortId}?locale=${locale}`,
    1800
  );
  const anime = data?.anime;
  if (!anime || typeof anime !== 'object') return null;

  const extraSynonyms: string[] = [];
  if (Array.isArray(anime.synonyms)) {
    extraSynonyms.push(
      ...anime.synonyms.filter((s: unknown) => typeof s === 'string')
    );
  }
  if (Array.isArray(anime.alternativeTitles)) {
    extraSynonyms.push(
      ...anime.alternativeTitles.filter((s: unknown) => typeof s === 'string')
    );
  }
  if (Array.isArray(anime.altTitles)) {
    extraSynonyms.push(
      ...anime.altTitles.filter((s: unknown) => typeof s === 'string')
    );
  }

  return {
    ...anime,
    synonyms: Array.from(new Set(extraSynonyms)),
    alternativeTitles: Array.from(new Set(extraSynonyms)),
  };
}

export async function getHoshikaEpisodes(
  shortId: string | number,
  locale: string = 'en',
  after?: number,
  limit: number = 50
): Promise<{
  items: HoshikaEpisodeItem[];
  total: number;
  nextAfter: number | null;
}> {
  const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 50)));
  const params = new URLSearchParams({ locale, limit: String(safeLimit) });
  if (after !== undefined && after > 0) params.append('after', String(after));

  const data = await fetchFromHoshika<{
    ok: boolean;
    items?: HoshikaEpisodeItem[];
    total?: number;
    nextAfter?: number | null;
  }>(`/anime/${shortId}/episodes?${params.toString()}`, 900);

  return {
    items: data?.items || [],
    total: data?.total ?? (data?.items?.length || 0),
    nextAfter: data?.nextAfter ?? null,
  };
}

export async function getAllHoshikaEpisodes(
  shortId: string | number,
  locale: string = 'en',
  maxBatches: number = 25
): Promise<{ items: HoshikaEpisodeItem[]; total: number }> {
  const cacheKey = `hoshika:all_episodes:${shortId}:${locale}:max=${maxBatches}`;

  return appCache.getOrSet(
    cacheKey,
    async () => {
      const allItems: HoshikaEpisodeItem[] = [];
      let nextAfter: number | undefined = undefined;
      let batchCount = 0;
      let reportedTotal = 0;

      while (batchCount < maxBatches) {
        batchCount++;
        const pageResult = await getHoshikaEpisodes(
          shortId,
          locale,
          nextAfter,
          50
        );

        if (pageResult.total > reportedTotal) {
          reportedTotal = pageResult.total;
        }

        if (!pageResult.items || pageResult.items.length === 0) {
          break;
        }

        // Append items without duplicates preserving all metadata
        const existing = new Set(allItems.map((e) => e.number));
        for (const ep of pageResult.items) {
          if (!existing.has(ep.number)) {
            allItems.push(ep);
            existing.add(ep.number);
          }
        }

        // If fewer than 50 items returned or nextAfter is null, we reached the end
        if (pageResult.items.length < 50 || pageResult.nextAfter === null) {
          break;
        }

        const lastItem = pageResult.items[pageResult.items.length - 1];
        nextAfter = lastItem.number;
      }

      return {
        items: allItems,
        total: Math.max(reportedTotal, allItems.length),
      };
    },
    {
      ttlSeconds: 900,
      staleWhileRevalidateSeconds: 1800,
      shouldCache: (res) => Array.isArray(res?.items) && res.items.length > 0,
    }
  );
}

/**
 * Compute the `after` cursor for a target 1-based episode number using 50-episode batches.
 * - Episodes 1..50 -> undefined (Batch 1)
 * - Episodes 51..100 -> 50 (Batch 2)
 * - Episodes 101..150 -> 100 (Batch 3)
 */
export function getTargetEpisodeBatchCursor(
  targetEpisode: number,
  batchSize: number = 50
): number | undefined {
  if (!Number.isFinite(targetEpisode) || targetEpisode <= batchSize) {
    return undefined;
  }
  return Math.floor((targetEpisode - 1) / batchSize) * batchSize;
}

/**
 * Optimized Watch Page episode fetcher:
 * - Never blocks Watch Page rendering by fetching all 250+ episodes sequentially.
 * - When `targetEpisode <= 50`, fetches ONLY Batch 1 (1 request).
 * - When `targetEpisode > 50`, fetches Batch 1 and the target episode's batch in parallel (2 requests).
 * - Additional episode ranges are loaded on demand by EpisodeSection via `lib/episode-store.ts`.
 */
export async function getEpisodesForWatch(
  shortId: string | number,
  targetEpisode: number,
  locale: string = 'en'
): Promise<{ items: HoshikaEpisodeItem[]; total: number }> {
  const targetCursor = getTargetEpisodeBatchCursor(targetEpisode, 50);

  if (targetCursor === undefined) {
    const initialBatch = await getHoshikaEpisodes(shortId, locale, undefined, 50);
    return {
      items: initialBatch.items,
      total: Math.max(initialBatch.total, initialBatch.items.length),
    };
  }

  // Target episode is in a later batch (> 50): fetch Batch 1 and target batch in parallel
  const [initialBatch, targetBatch] = await Promise.all([
    getHoshikaEpisodes(shortId, locale, undefined, 50),
    getHoshikaEpisodes(shortId, locale, targetCursor, 50),
  ]);

  const itemsMap = new Map<number, HoshikaEpisodeItem>();
  for (const ep of initialBatch.items) itemsMap.set(ep.number, ep);
  for (const ep of targetBatch.items) itemsMap.set(ep.number, ep);

  const combinedItems = Array.from(itemsMap.values()).sort(
    (a, b) => a.number - b.number
  );
  const total = Math.max(
    initialBatch.total,
    targetBatch.total,
    combinedItems.length
  );

  return { items: combinedItems, total };
}

export async function getHoshikaHome(locale: string = 'en') {
  const data = await fetchFromHoshika<{
    ok: boolean;
    season?: { season: string; year: number };
    seasonal?: HoshikaAnimeItem[];
    trending?: HoshikaAnimeItem[];
    recentlyAdded?: HoshikaAnimeItem[];
  }>(`/home?locale=${locale}`, 600);

  return {
    season: data?.season || null,
    seasonal: data?.seasonal || [],
    trending: data?.trending || [],
    recentlyAdded: data?.recentlyAdded || [],
  };
}

export async function getHoshikaBrowse(
  sort: 'trending' | 'recent' | 'top' = 'trending',
  type: string = 'anime'
): Promise<HoshikaAnimeItem[]> {
  const ttl = sort === 'recent' ? 240 : 600;
  const data = await fetchFromHoshika<{
    ok: boolean;
    items?: HoshikaAnimeItem[];
  }>(`/browse?type=${type}&sort=${sort}`, ttl);

  return data?.items || [];
}

export async function getHoshikaCatalog(params: {
  q?: string;
  genre?: string | string[];
  format?: string;
  status?: string;
  year?: string | number;
  sort?: string;
  minScore?: number | string;
  page?: number | string;
}): Promise<{
  items: HoshikaAnimeItem[];
  total: number;
  page: number;
  pages: number;
  hasMore: boolean;
}> {
  const normalized = normalizeCatalogQuery(params);
  const cacheKey = buildCatalogCacheKey(normalized);

  return appCache.getOrSet(
    cacheKey,
    async () => {
      const buildUpstreamQuery = (pageNum: number) => {
        const searchParams = new URLSearchParams({ type: 'anime' });
        if (normalized.q) searchParams.append('q', normalized.q);
        if (normalized.genre) searchParams.append('genre', normalized.genre);
        if (normalized.format) searchParams.append('format', normalized.format);
        if (normalized.status) searchParams.append('status', normalized.status);
        if (normalized.year) searchParams.append('year', normalized.year);
        searchParams.append('sort', normalized.upstreamSort);
        if (pageNum > 1) searchParams.append('page', String(pageNum));
        return `/catalog?${searchParams.toString()}`;
      };

      const fetchSinglePage = async (pageNum: number) => {
        return fetchFromHoshika<{
          ok: boolean;
          items?: HoshikaAnimeItem[];
          total?: number;
          page?: number;
          pages?: number;
          hasMore?: boolean;
        }>(buildUpstreamQuery(pageNum), 600);
      };

      const data = await fetchSinglePage(normalized.page);

      if (!data) {
        throw new Error('Failed to fetch catalogue from upstream Hoshika API');
      }

      const rawItems = Array.isArray(data.items) ? data.items : [];
      const total =
        typeof data.total === 'number' ? data.total : rawItems.length;
      const currentPage =
        typeof data.page === 'number' ? data.page : normalized.page;
      const pageSize = 24;
      const computedPages = Math.max(1, Math.ceil(total / pageSize));
      let hasMore =
        typeof data.hasMore === 'boolean'
          ? data.hasMore
          : currentPage < computedPages && rawItems.length >= pageSize;

      let filteredItems = processCatalogItems(rawItems, {
        requestedSort: normalized.requestedSort,
        minScore: normalized.minScore,
      });

      // If client-side filter (like minScore) reduced the page below 12 items while upstream has more pages,
      // fetch up to 2 supplemental pages with controlled pagination so results are not starved.
      let scannedPage = currentPage;
      let extraFetches = 0;
      while (
        normalized.minScore &&
        filteredItems.length < 12 &&
        hasMore &&
        extraFetches < 2
      ) {
        extraFetches++;
        scannedPage++;
        const nextData = await fetchSinglePage(scannedPage);
        if (
          !nextData ||
          !Array.isArray(nextData.items) ||
          nextData.items.length === 0
        ) {
          hasMore = false;
          break;
        }
        const nextFiltered = processCatalogItems(nextData.items, {
          requestedSort: normalized.requestedSort,
          minScore: normalized.minScore,
        });
        filteredItems = deduplicateAnimeList(filteredItems, nextFiltered);
        hasMore =
          typeof nextData.hasMore === 'boolean'
            ? nextData.hasMore
            : scannedPage < computedPages;
      }

      return {
        items: filteredItems,
        total,
        page: scannedPage,
        pages: computedPages,
        hasMore,
      };
    },
    {
      ttlSeconds: 600,
      staleWhileRevalidateSeconds: 1200,
    }
  );
}

export async function getHoshikaSchedule(
  locale: string = 'en'
): Promise<ScheduleItem[]> {
  const data = await fetchFromHoshika<{
    ok: boolean;
    items?: ScheduleItem[];
  }>(`/schedule?locale=${locale}`, 900);

  return data?.items || [];
}

export async function getHoshikaGenres(): Promise<string[]> {
  const data = await fetchFromHoshika<{
    ok: boolean;
    genres?: string[];
  }>('/genres', 86400);

  const baseGenres = data?.genres || [
    'Action',
    'Adventure',
    'Avant Garde',
    'Award Winning',
    'Boys Love',
    'Comedy',
    'Drama',
    'Ecchi',
    'Fantasy',
    'Girls Love',
    'Gourmet',
    'Horror',
    'Mystery',
    'Romance',
    'Sci-Fi',
    'Slice of Life',
    'Sports',
    'Supernatural',
    'Suspense',
    'Thriller',
  ];

  // Include popular Hoshika-supported catalogue themes/demographics so users can filter by Isekai, Mecha, Psychological, etc.
  const extraSupportedThemes = [
    'Isekai',
    'Mecha',
    'Psychological',
    'Historical',
    'Military',
    'Music',
    'School',
    'Shounen',
    'Seinen',
    'Shoujo',
    'Josei',
    'Mahou Shoujo',
    'Martial Arts',
    'Parody',
    'Space',
    'Time Travel',
    'Vampire',
    'Reincarnation',
  ];

  return Array.from(new Set([...baseGenres, ...extraSupportedThemes])).sort(
    (a, b) => a.localeCompare(b)
  );
}

export async function getHoshikaGenreTitles(
  slug: string,
  locale: string = 'en'
): Promise<HoshikaAnimeItem[]> {
  const data = await fetchFromHoshika<{
    ok: boolean;
    items?: HoshikaAnimeItem[];
  }>(`/genre/${encodeURIComponent(slug)}?type=anime&locale=${locale}`, 600);

  return data?.items || [];
}
