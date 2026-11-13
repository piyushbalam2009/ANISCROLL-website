import { appCache } from './cache';
import {
  classifyUpstreamError,
  recordUpstreamMetric,
} from './perf-monitor';
import {
  DEFAULT_PER_PAGE,
  UPSTREAM_CATALOG_PAGE_SIZE,
  StandardPaginatedResponse,
  normalizeCatalogQuery,
  buildCatalogCacheKey,
  computeUpstreamWindowForPage,
  buildPaginatedResponse,
  sanitizePageNumber,
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
  cacheTtlSeconds: number = 300,
  forceRefresh: boolean = false
): Promise<T | null> {
  const cacheKey = `hoshika:${endpoint}`;

  // Fast path check for telemetry before entering getOrSet
  if (!forceRefresh) {
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
          // Use cache: 'no-store' on the underlying fetch because appCache manages
          // TTL, Stale-While-Revalidate, and invalidation in memory. This prevents
          // Next.js Data Cache from returning stale data when appCache expires or refreshes.
          const res = await fetch(`${BASE_URL}${endpoint}`, {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'AniScroll/1.0',
            },
            signal: controller.signal,
            cache: 'no-store',
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
      staleWhileRevalidateSeconds: Math.min(cacheTtlSeconds * 2, 1800),
      shouldCache: (data) => {
        if (!data) return false;
        const isEmptyEpisodesResponse =
          endpoint.includes('/episodes') &&
          Array.isArray((data as any).items) &&
          (data as any).items.length === 0;
        return !isEmptyEpisodesResponse;
      },
      serveStaleOnError: true,
      forceRefresh,
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
  }>(`/search?${params.toString()}`, 180);
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
  locale: string = 'en',
  forceRefresh: boolean = false
): Promise<HoshikaAnimeItem | null> {
  const data = await fetchFromHoshika<{ ok: boolean; anime?: any }>(
    `/anime/${shortId}?locale=${locale}`,
    300,
    forceRefresh
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
  limit: number = 50,
  forceRefresh: boolean = false
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
  }>(`/anime/${shortId}/episodes?${params.toString()}`, 180, forceRefresh);

  return {
    items: data?.items || [],
    total: data?.total ?? (data?.items?.length || 0),
    nextAfter: data?.nextAfter ?? null,
  };
}

export async function getAllHoshikaEpisodes(
  shortId: string | number,
  locale: string = 'en',
  maxBatches: number = 25,
  forceRefresh: boolean = false
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
          50,
          forceRefresh
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
      ttlSeconds: 180,
      staleWhileRevalidateSeconds: 360,
      shouldCache: (res) => Array.isArray(res?.items) && res.items.length > 0,
      forceRefresh,
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
  locale: string = 'en',
  forceRefresh: boolean = false
): Promise<{ items: HoshikaEpisodeItem[]; total: number }> {
  const targetCursor = getTargetEpisodeBatchCursor(targetEpisode, 50);

  if (targetCursor === undefined) {
    const initialBatch = await getHoshikaEpisodes(
      shortId,
      locale,
      undefined,
      50,
      forceRefresh
    );
    return {
      items: initialBatch.items,
      total: Math.max(initialBatch.total, initialBatch.items.length),
    };
  }

  // Target episode is in a later batch (> 50): fetch Batch 1 and target batch in parallel
  const [initialBatch, targetBatch] = await Promise.all([
    getHoshikaEpisodes(shortId, locale, undefined, 50, forceRefresh),
    getHoshikaEpisodes(shortId, locale, targetCursor, 50, forceRefresh),
  ]);

  const itemsMap = new Map<number, HoshikaAnimeItem | HoshikaEpisodeItem>() as Map<number, HoshikaEpisodeItem>;
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

export async function getHoshikaHome(
  locale: string = 'en',
  forceRefresh: boolean = false
) {
  const data = await fetchFromHoshika<{
    ok: boolean;
    season?: { season: string; year: number };
    seasonal?: HoshikaAnimeItem[];
    trending?: HoshikaAnimeItem[];
    recentlyAdded?: HoshikaAnimeItem[];
  }>(`/home?locale=${locale}`, 180, forceRefresh);

  return {
    season: data?.season || null,
    seasonal: data?.seasonal || [],
    trending: data?.trending || [],
    recentlyAdded: data?.recentlyAdded || [],
  };
}

export async function getHoshikaBrowse(
  sort: 'trending' | 'recent' | 'top' = 'trending',
  type: string = 'anime',
  forceRefresh: boolean = false
): Promise<HoshikaAnimeItem[]> {
  const ttl = sort === 'recent' ? 180 : 300;
  const data = await fetchFromHoshika<{
    ok: boolean;
    items?: HoshikaAnimeItem[];
  }>(`/browse?type=${type}&sort=${sort}`, ttl, forceRefresh);

  return data?.items || [];
}

/**
 * Paginated catalogue fetcher returning exactly 30 items per logical page (`perPage = 30`).
 *
 * Since upstream Hoshika `/catalog` uses a fixed 24-item page size, this function computes
 * the exact upstream page window via `computeUpstreamWindowForPage(page, 30, 24)` (at most 2
 * upstream pages, fetched in parallel and cached individually in `appCache`), slices the exact
 * 30-item window `[localOffset, localOffset + 30]`, and returns the standardized pagination payload.
 */
export async function getHoshikaCatalog(
  params: {
    q?: string;
    genre?: string | string[];
    format?: string;
    status?: string;
    year?: string | number;
    season?: string;
    sort?: string;
    minScore?: number | string;
    page?: number | string;
    perPage?: number | string;
  },
  forceRefresh: boolean = false
): Promise<StandardPaginatedResponse<HoshikaAnimeItem>> {
  const normalized = normalizeCatalogQuery(params);
  const cacheKey = buildCatalogCacheKey(normalized);

  return appCache.getOrSet(
    cacheKey,
    async () => {
      const windowInfo = computeUpstreamWindowForPage(
        normalized.page,
        normalized.perPage,
        UPSTREAM_CATALOG_PAGE_SIZE
      );

      const buildUpstreamQuery = (upstreamPageNum: number) => {
        const searchParams = new URLSearchParams({ type: 'anime' });
        if (normalized.q) searchParams.append('q', normalized.q);
        if (normalized.genre) searchParams.append('genre', normalized.genre);
        if (normalized.format) searchParams.append('format', normalized.format);
        if (normalized.status) searchParams.append('status', normalized.status);
        if (normalized.year) searchParams.append('year', normalized.year);
        if (normalized.season) searchParams.append('season', normalized.season);
        searchParams.append('sort', normalized.upstreamSort);
        if (upstreamPageNum > 1) {
          searchParams.append('page', String(upstreamPageNum));
        }
        return `/catalog?${searchParams.toString()}`;
      };

      const fetchSingleUpstreamPage = async (upstreamPageNum: number) => {
        return fetchFromHoshika<{
          ok: boolean;
          items?: HoshikaAnimeItem[];
          total?: number;
          page?: number;
          pages?: number;
          hasMore?: boolean;
        }>(buildUpstreamQuery(upstreamPageNum), 300, forceRefresh);
      };

      // Fetch the required upstream pages (typically 2 pages of 24 items) in parallel
      const upstreamResponses = await Promise.all(
        windowInfo.upstreamPages.map((p) => fetchSingleUpstreamPage(p))
      );

      const firstResponse = upstreamResponses[0];
      if (!firstResponse) {
        throw new Error('Failed to fetch catalogue from upstream Hoshika API');
      }

      const reportedTotal =
        typeof firstResponse.total === 'number' ? firstResponse.total : 0;
      const maxUpstreamPage =
        reportedTotal > 0
          ? Math.max(1, Math.ceil(reportedTotal / UPSTREAM_CATALOG_PAGE_SIZE))
          : Infinity;

      // Only include items from upstream pages that are within the valid upstream page count
      const combinedRawItems: HoshikaAnimeItem[] = [];
      let lastValidUpstreamHasMore = false;

      for (let i = 0; i < windowInfo.upstreamPages.length; i++) {
        const upPageNum = windowInfo.upstreamPages[i];
        const resp = upstreamResponses[i];
        if (!resp || upPageNum > maxUpstreamPage) {
          continue;
        }
        const pageItems = Array.isArray(resp.items) ? resp.items : [];
        combinedRawItems.push(...pageItems);
        lastValidUpstreamHasMore = Boolean(resp.hasMore);
      }

      // If the requested logical page starts beyond the total available items, return an empty page cleanly
      if (reportedTotal > 0 && windowInfo.startIndex >= reportedTotal) {
        return buildPaginatedResponse({
          results: [],
          currentPage: windowInfo.currentPage,
          perPage: windowInfo.perPage,
          totalItems: reportedTotal,
          hasNextPageFallback: false,
        });
      }

      // Slice exact 30-item window for this logical page
      const slicedWindow = combinedRawItems.slice(
        windowInfo.localOffset,
        windowInfo.localOffset + windowInfo.perPage
      );

      const dedupedWindow = deduplicateAnimeList([], slicedWindow);

      let pageResults = processCatalogItems(dedupedWindow, {
        requestedSort: normalized.requestedSort,
        minScore: normalized.minScore,
      });

      // Optional top-up if client-side minScore filtering reduced the page size
      let scannedUpstreamPage = windowInfo.lastUpstreamPage;
      let extraFetches = 0;
      while (
        normalized.minScore &&
        pageResults.length < windowInfo.perPage &&
        lastValidUpstreamHasMore &&
        scannedUpstreamPage < maxUpstreamPage &&
        extraFetches < 2
      ) {
        extraFetches++;
        scannedUpstreamPage++;
        const nextData = await fetchSingleUpstreamPage(scannedUpstreamPage);
        if (
          !nextData ||
          !Array.isArray(nextData.items) ||
          nextData.items.length === 0
        ) {
          lastValidUpstreamHasMore = false;
          break;
        }
        const nextFiltered = processCatalogItems(nextData.items, {
          requestedSort: normalized.requestedSort,
          minScore: normalized.minScore,
        });
        pageResults = deduplicateAnimeList(pageResults, nextFiltered).slice(
          0,
          windowInfo.perPage
        );
        lastValidUpstreamHasMore = Boolean(nextData.hasMore);
      }

      const effectiveTotal =
        reportedTotal > 0 ? reportedTotal : pageResults.length;

      return buildPaginatedResponse({
        results: pageResults,
        currentPage: windowInfo.currentPage,
        perPage: windowInfo.perPage,
        totalItems: effectiveTotal,
        hasNextPageFallback: lastValidUpstreamHasMore,
      });
    },
    {
      ttlSeconds: 300,
      staleWhileRevalidateSeconds: 600,
      forceRefresh,
    }
  );
}

/**
 * Paginated fetcher for Trending, Popular, and Recent pages (`perPage = 30`).
 *
 * Strategy:
 * - Hoshika `/browse?type=anime&sort=trending|top|recent` returns 60 curated items:
 *   - Page 1 (`page = 1`): Items 1–30 from `/browse`.
 *   - Page 2 (`page = 2`): Items 31–60 from `/browse`.
 * - Page 3+ (`page >= 3`): Seamlessly continues with the matching Hoshika `/catalog` feed:
 *   - `popular` -> `/catalog?type=anime&sort=score`
 *   - `recent`  -> `/catalog?type=anime&sort=newest`
 *   - `trending`-> `/catalog?type=anime&status=RELEASING&sort=score`
 *   All items already shown in `/browse` (Pages 1–2) are deduplicated by `shortId` so no anime
 *   repeats across pages.
 */
export async function getHoshikaBrowsePaginated(
  category: 'trending' | 'popular' | 'recent',
  pageInput: number | string = 1,
  perPageInput: number = DEFAULT_PER_PAGE,
  forceRefresh: boolean = false
): Promise<StandardPaginatedResponse<HoshikaAnimeItem>> {
  const currentPage = sanitizePageNumber(pageInput);
  const perPage = Math.max(1, Math.floor(perPageInput || DEFAULT_PER_PAGE));
  const cacheKey = `browse:paginated:v1:${category}:page=${currentPage}:perPage=${perPage}`;

  const ttl = category === 'recent' ? 180 : 300;

  return appCache.getOrSet(
    cacheKey,
    async () => {
      const browseSort: 'trending' | 'top' | 'recent' =
        category === 'popular' ? 'top' : category;

      const catalogQueryBase =
        category === 'trending'
          ? 'type=anime&status=RELEASING&sort=score'
          : category === 'popular'
            ? 'type=anime&sort=score'
            : 'type=anime&sort=newest';

      // Default total items per category based on upstream catalogue size
      const defaultTotalItems = category === 'trending' ? 330 : 1000;

      // Fast path for Pages 1 and 2 (served directly from the 60-item /browse response)
      const browseItems = await getHoshikaBrowse(browseSort, 'anime', forceRefresh);
      if (!browseItems || browseItems.length === 0) {
        throw new Error(`Failed to fetch ${category} anime from upstream API`);
      }

      const uniqueBrowse = deduplicateAnimeList([], browseItems);

      if (currentPage <= 2 && perPage === 30) {
        const startIdx = (currentPage - 1) * 30;
        const slice = uniqueBrowse.slice(startIdx, startIdx + 30);

        // If /browse returned fewer than 60 items on page 2, top up from catalog page 1
        if (slice.length < 30) {
          const catPage1 = await fetchFromHoshika<{
            ok: boolean;
            items?: HoshikaAnimeItem[];
            total?: number;
          }>(`/catalog?${catalogQueryBase}`, ttl, forceRefresh);
          const merged = deduplicateAnimeList(
            uniqueBrowse,
            catPage1?.items || []
          );
          const toppedUp = merged.slice(startIdx, startIdx + 30);
          const totalItems = catPage1?.total
            ? Math.max(catPage1.total, merged.length)
            : defaultTotalItems;
          return buildPaginatedResponse({
            results: toppedUp,
            currentPage,
            perPage,
            totalItems,
          });
        }

        return buildPaginatedResponse({
          results: slice,
          currentPage,
          perPage,
          totalItems: defaultTotalItems,
        });
      }

      // Page 3+: Extend unique items from /catalog while excluding the 60 /browse items
      const targetEndIndex = currentPage * perPage;
      const targetStartIndex = (currentPage - 1) * perPage;

      // For pages 3..8, build the exact deduplicated prefix from /browse + sequential /catalog pages
      // so there is zero overlap between Pages 1, 2, 3, ..., 8.
      if (currentPage <= 8) {
        let accumulated = [...uniqueBrowse];
        let upstreamPage = 1;
        let reportedCatalogTotal = defaultTotalItems;
        const maxScanPages = 14;

        while (
          accumulated.length < targetEndIndex &&
          upstreamPage <= maxScanPages
        ) {
          const endpoint =
            upstreamPage === 1
              ? `/catalog?${catalogQueryBase}`
              : `/catalog?${catalogQueryBase}&page=${upstreamPage}`;
          const catData = await fetchFromHoshika<{
            ok: boolean;
            items?: HoshikaAnimeItem[];
            total?: number;
            hasMore?: boolean;
          }>(endpoint, ttl, forceRefresh);

          if (!catData || !Array.isArray(catData.items) || catData.items.length === 0) {
            break;
          }

          if (typeof catData.total === 'number' && catData.total > 0) {
            reportedCatalogTotal = Math.max(catData.total, uniqueBrowse.length);
          }

          accumulated = deduplicateAnimeList(accumulated, catData.items);

          if (catData.hasMore === false) {
            break;
          }
          upstreamPage++;
        }

        const pageSlice = accumulated.slice(targetStartIndex, targetEndIndex);
        return buildPaginatedResponse({
          results: pageSlice,
          currentPage,
          perPage,
          totalItems: reportedCatalogTotal,
        });
      }

      // For deep pages (page >= 9), jump directly to the corresponding /catalog window
      // and filter out any IDs from the initial 60 /browse items.
      const browseShortIds = new Set(
        uniqueBrowse
          .map((item) => (item.shortId != null ? String(item.shortId) : null))
          .filter(Boolean)
      );

      const windowInfo = computeUpstreamWindowForPage(
        currentPage,
        perPage,
        UPSTREAM_CATALOG_PAGE_SIZE
      );

      const pagesToFetch = [
        ...windowInfo.upstreamPages,
        windowInfo.lastUpstreamPage + 1,
      ];
      const responses = await Promise.all(
        pagesToFetch.map((p) =>
          fetchFromHoshika<{
            ok: boolean;
            items?: HoshikaAnimeItem[];
            total?: number;
            hasMore?: boolean;
          }>(
            p === 1
              ? `/catalog?${catalogQueryBase}`
              : `/catalog?${catalogQueryBase}&page=${p}`,
            ttl,
            forceRefresh
          )
        )
      );

      const firstResp = responses[0];
      const reportedTotal =
        typeof firstResp?.total === 'number' && firstResp.total > 0
          ? firstResp.total
          : defaultTotalItems;

      if (windowInfo.startIndex >= reportedTotal) {
        return buildPaginatedResponse({
          results: [],
          currentPage,
          perPage,
          totalItems: reportedTotal,
          hasNextPageFallback: false,
        });
      }

      const rawCombined: HoshikaAnimeItem[] = [];
      for (const r of responses) {
        if (r && Array.isArray(r.items)) {
          rawCombined.push(...r.items);
        }
      }

      const sliced = rawCombined.slice(windowInfo.localOffset);
      const filtered = deduplicateAnimeList([], sliced).filter(
        (item) =>
          item.shortId == null || !browseShortIds.has(String(item.shortId))
      );

      return buildPaginatedResponse({
        results: filtered.slice(0, perPage),
        currentPage,
        perPage,
        totalItems: reportedTotal,
      });
    },
    {
      ttlSeconds: ttl,
      staleWhileRevalidateSeconds: ttl * 2,
      forceRefresh,
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

/**
 * Safely invalidates cached Hoshika anime metadata, episode lists, ID mappings,
 * and optionally home/catalog feeds when an anime is updated or force-refreshed.
 */
export function invalidateHoshikaCacheForAnime(
  shortId?: number | string,
  includeCatalogAndHome: boolean = true
): number {
  let count = 0;
  if (shortId !== undefined && shortId !== null && String(shortId).trim() !== '') {
    const idStr = String(shortId).trim();
    count += appCache.invalidateByPrefix(`hoshika:/anime/${idStr}`);
    count += appCache.invalidateByPrefix(`hoshika:all_episodes:${idStr}:`);
    count += appCache.invalidateByPrefix(`id-map:v3:${idStr}`);
  }
  if (includeCatalogAndHome) {
    count += appCache.invalidateByPrefix('hoshika:/home');
    count += appCache.invalidateByPrefix('hoshika:/browse');
    count += appCache.invalidateByPrefix('hoshika:/catalog');
    count += appCache.invalidateByPrefix('catalog:');
    count += appCache.invalidateByPrefix('browse:paginated:');
  }
  return count;
}
