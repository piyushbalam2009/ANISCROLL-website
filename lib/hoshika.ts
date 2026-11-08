import { appCache } from './cache';
import { HoshikaAnimeItem, HoshikaEpisodeItem, ScheduleItem } from '@/types/anime';

const BASE_URL = 'https://hoshika.app/api/v1';

async function fetchFromHoshika<T>(endpoint: string, cacheTtlSeconds: number = 300): Promise<T | null> {
  const cacheKey = `hoshika:${endpoint}`;
  const cached = appCache.get<T>(cacheKey);
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${BASE_URL}${endpoint}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AniScroll/1.0',
      },
      signal: controller.signal,
      next: { revalidate: cacheTtlSeconds },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`Hoshika API error: ${res.status} for ${endpoint}`);
      return null;
    }

    const data = await res.json();
    if (data.ok === false) {
      console.warn(`Hoshika reported !ok for ${endpoint}:`, data.code);
      return null;
    }

    appCache.set(cacheKey, data, cacheTtlSeconds);
    return data as T;
  } catch (err: any) {
    console.error(`Failed to fetch from Hoshika (${endpoint}):`, err.message || err);
    return null;
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
  const data = await fetchFromHoshika<{ ok: boolean; anime?: HoshikaAnimeItem }>(
    `/anime/${shortId}?locale=${locale}`,
    600
  );
  return data?.anime || null;
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
