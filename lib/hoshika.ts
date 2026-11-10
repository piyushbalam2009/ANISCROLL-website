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

    appCache.set(cacheKey, data, cacheTtlSeconds);
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
  const params = new URLSearchParams({
    q: query.trim(),
    limit: String(limit),
  });
  if (format) params.append('format', format);
  if (year) params.append('year', String(year));

  const data = await fetchFromHoshika<{ ok: boolean; anime?: HoshikaAnimeItem[] }>(
    `/search?${params.toString()}`,
    120
  );
  return data?.anime || [];
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
  const params = new URLSearchParams({ locale, limit: String(limit) });
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
  genre?: string;
  format?: string;
  status?: string;
  year?: string;
  sort?: string;
  page?: number;
}) {
  const searchParams = new URLSearchParams({ type: 'anime' });
  if (params.q) searchParams.append('q', params.q);
  if (params.genre) searchParams.append('genre', params.genre);
  if (params.format) searchParams.append('format', params.format);
  if (params.status) searchParams.append('status', params.status);
  if (params.year) searchParams.append('year', params.year);
  if (params.sort) searchParams.append('sort', params.sort);
  if (params.page) searchParams.append('page', String(params.page));

  const data = await fetchFromHoshika<{
    ok: boolean;
    items?: HoshikaAnimeItem[];
    total?: number;
    page?: number;
    pages?: number;
  }>(`/catalog?${searchParams.toString()}`, 300);

  return {
    items: data?.items || [],
    total: data?.total ?? (data?.items?.length || 0),
    page: data?.page ?? 1,
    pages: data?.pages ?? 1,
  };
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

  return (
    data?.genres || [
      'Action',
      'Adventure',
      'Award Winning',
      'Comedy',
      'Drama',
      'Fantasy',
      'Horror',
      'Mystery',
      'Romance',
      'Sci-Fi',
      'Slice of Life',
      'Sports',
      'Supernatural',
      'Suspense',
    ]
  );
}

export async function getHoshikaGenreTitles(slug: string, locale: string = 'en'): Promise<HoshikaAnimeItem[]> {
  const data = await fetchFromHoshika<{
    ok: boolean;
    items?: HoshikaAnimeItem[];
  }>(`/genre/${encodeURIComponent(slug)}?type=anime&locale=${locale}`, 600);

  return data?.items || [];
}
