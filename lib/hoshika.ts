import { appCache } from './cache';
import { HoshikaAnimeItem, HoshikaEpisodeItem, ScheduleItem } from '@/types/anime';

const BASE_URL = 'https://hoshika.app/api/v1';

async function fetchFromHoshika<T>(endpoint: string, cacheTtlSeconds: number = 300): Promise<T | null> {
  const cacheKey = `hoshika:${endpoint}`;
  const cached = appCache.get<T>(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AniScroll/1.0',
      },
      signal: controller.signal,
      next: { revalidate: cacheTtlSeconds },
    });

    if (res.status === 429) {
      console.warn(`Hoshika API rate limit (429) for ${endpoint}`);
      return null;
    }

    if (!res.ok) {
      console.error(`Hoshika API error: ${res.status} for ${endpoint}`);
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return null;
    }

    const data = await res.json();
    if (!data || typeof data !== 'object' || data.ok === false) {
      if (data?.ok === false) {
        console.warn(`Hoshika reported !ok for ${endpoint}:`, data.code);
      }
      return null;
    }

    const isEmptyEpisodesResponse =
      endpoint.includes('/episodes') &&
      Array.isArray((data as any).items) &&
      (data as any).items.length === 0;

    if (!isEmptyEpisodesResponse) {
      appCache.set(cacheKey, data, cacheTtlSeconds);
    }
    return data as T;
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.error(`Failed to fetch from Hoshika (${endpoint}):`, err.message || err);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchHoshika(query: string, limit: number = 20, format?: string, year?: string | number) {
  if (!query || !query.trim()) return [];
  const trimmedQuery = query.trim();
  const requestedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.floor(Number(limit))) : 20;
  // Hoshika /api/v1/search strictly requires 1 <= limit <= 20 (values > 20 return 400 Bad Request)
  const searchApiLimit = Math.min(20, requestedLimit);

  const params = new URLSearchParams({
    q: trimmedQuery,
    limit: String(searchApiLimit),
  });
  if (format) params.append('format', format);
  if (year) params.append('year', String(year));

  const data = await fetchFromHoshika<{ ok: boolean; anime?: HoshikaAnimeItem[] }>(
    `/search?${params.toString()}`,
    120
  );
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

export async function getHoshikaAnime(shortId: string | number, locale: string = 'en'): Promise<HoshikaAnimeItem | null> {
  const data = await fetchFromHoshika<{ ok: boolean; anime?: any }>(
    `/anime/${shortId}?locale=${locale}`,
    600
  );
  const anime = data?.anime;
  if (!anime || typeof anime !== 'object') return null;

  const extraSynonyms: string[] = [];
  if (Array.isArray(anime.synonyms)) {
    extraSynonyms.push(...anime.synonyms.filter((s: unknown) => typeof s === 'string'));
  }
  if (Array.isArray(anime.alternativeTitles)) {
    extraSynonyms.push(...anime.alternativeTitles.filter((s: unknown) => typeof s === 'string'));
  }
  if (Array.isArray(anime.altTitles)) {
    extraSynonyms.push(...anime.altTitles.filter((s: unknown) => typeof s === 'string'));
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
): Promise<{ items: HoshikaEpisodeItem[]; total: number; nextAfter: number | null }> {
  const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 50)));
  const params = new URLSearchParams({ locale, limit: String(safeLimit) });
  if (after !== undefined) params.append('after', String(after));

  const data = await fetchFromHoshika<{
    ok: boolean;
    items?: HoshikaEpisodeItem[];
    total?: number;
    nextAfter?: number | null;
  }>(`/anime/${shortId}/episodes?${params.toString()}`, 300);

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
  const cacheKey = `hoshika:all_episodes:${shortId}:${locale}`;
  const cached = appCache.get<{ items: HoshikaEpisodeItem[]; total: number }>(cacheKey);
  if (cached && cached.items && cached.items.length > 0) {
    return cached;
  }

  const allItems: HoshikaEpisodeItem[] = [];
  let nextAfter: number | undefined = undefined;
  let batchCount = 0;
  let reportedTotal = 0;

  while (batchCount < maxBatches) {
    batchCount++;
    const pageResult = await getHoshikaEpisodes(shortId, locale, nextAfter, 50);

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

    // Use the actual last episode number returned by the previous response for next after parameter
    const lastItem = pageResult.items[pageResult.items.length - 1];
    nextAfter = lastItem.number;
  }

  const result = {
    items: allItems,
    total: Math.max(reportedTotal, allItems.length),
  };

  if (allItems.length > 0) {
    appCache.set(cacheKey, result, 600);
  }

  return result;
}

export async function getEpisodesForWatch(
  shortId: string | number,
  targetEpisode: number,
  locale: string = 'en'
): Promise<{ items: HoshikaEpisodeItem[]; total: number }> {
  // If target episode is within 250, getAllHoshikaEpisodes fetches sequentially and caches all
  if (targetEpisode <= 250) {
    const batches = Math.max(3, Math.ceil(targetEpisode / 50) + 1);
    return getAllHoshikaEpisodes(shortId, locale, batches);
  }

  // For ultra-long series where targetEpisode > 250, fetch initial batch and target batch
  const [initialBatch, targetBatch] = await Promise.all([
    getHoshikaEpisodes(shortId, locale, undefined, 50),
    getHoshikaEpisodes(
      shortId,
      locale,
      Math.floor((targetEpisode - 1) / 50) * 50,
      50
    ),
  ]);

  const itemsMap = new Map<number, HoshikaEpisodeItem>();
  for (const ep of initialBatch.items) itemsMap.set(ep.number, ep);
  for (const ep of targetBatch.items) itemsMap.set(ep.number, ep);

  const combinedItems = Array.from(itemsMap.values()).sort((a, b) => a.number - b.number);
  const total = Math.max(initialBatch.total, targetBatch.total, combinedItems.length);

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

export async function getHoshikaBrowse(sort: 'trending' | 'recent' | 'top' = 'trending', type: string = 'anime') {
  const data = await fetchFromHoshika<{
    ok: boolean;
    items?: HoshikaAnimeItem[];
  }>(`/browse?type=${type}&sort=${sort}`, 600);

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
  const {
    normalizeCatalogQuery,
    buildCatalogCacheKey,
    deduplicateAnimeList,
    processCatalogItems,
  } = await import('./explore-catalog');

  const normalized = normalizeCatalogQuery(params);
  const cacheKey = buildCatalogCacheKey(normalized);
  const cached = appCache.get<{
    items: HoshikaAnimeItem[];
    total: number;
    page: number;
    pages: number;
    hasMore: boolean;
  }>(cacheKey);

  if (cached) {
    return cached;
  }

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
    }>(buildUpstreamQuery(pageNum), 300);
  };

  // Fetch requested page
  const data = await fetchSinglePage(normalized.page);

  if (!data) {
    throw new Error('Failed to fetch catalogue from upstream Hoshika API');
  }

  let rawItems = Array.isArray(data.items) ? data.items : [];
  const total = typeof data.total === 'number' ? data.total : rawItems.length;
  const currentPage = typeof data.page === 'number' ? data.page : normalized.page;
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
    if (!nextData || !Array.isArray(nextData.items) || nextData.items.length === 0) {
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

  const result = {
    items: filteredItems,
    total,
    page: scannedPage,
    pages: computedPages,
    hasMore,
  };

  appCache.set(cacheKey, result, 300);
  return result;
}

export async function getHoshikaSchedule(locale: string = 'en'): Promise<ScheduleItem[]> {
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

  return Array.from(new Set([...baseGenres, ...extraSupportedThemes])).sort((a, b) =>
    a.localeCompare(b)
  );
}

export async function getHoshikaGenreTitles(slug: string, locale: string = 'en'): Promise<HoshikaAnimeItem[]> {
  const data = await fetchFromHoshika<{
    ok: boolean;
    items?: HoshikaAnimeItem[];
  }>(`/genre/${encodeURIComponent(slug)}?type=anime&locale=${locale}`, 600);

  return data?.items || [];
}
