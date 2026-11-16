import { appCache } from './cache';
import {
  classifyUpstreamError,
  recordUpstreamMetric,
} from './perf-monitor';

const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';
const ANILIST_TIMEOUT_MS = 6500;

export interface AniListMedia {
  id: number;
  idMal?: number | null;
  title: {
    romaji?: string | null;
    english?: string | null;
    native?: string | null;
    userPreferred?: string | null;
  };
  synonyms?: string[];
  format?: string | null;
  status?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  startDate?: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  } | null;
  episodes?: number | null;
  duration?: number | null;
  averageScore?: number | null;
  coverImage?: {
    extraLarge?: string | null;
    large?: string | null;
  };
  bannerImage?: string | null;
  description?: string | null;
  genres?: string[];
}

const VALID_ANILIST_FORMATS = new Set([
  'TV',
  'TV_SHORT',
  'MOVIE',
  'SPECIAL',
  'OVA',
  'ONA',
  'MUSIC',
]);

async function executeAniListGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  operationLabel: string = 'graphql'
): Promise<T | null> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANILIST_TIMEOUT_MS);

  try {
    const res = await fetch(ANILIST_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
      cache: 'no-store',
    });

    const durationMs = Date.now() - startTime;

    if (!res.ok) {
      const err = classifyUpstreamError({
        provider: 'anilist',
        endpoint: operationLabel,
        status: res.status,
        durationMs,
        retryAfterHeader: res.headers.get('Retry-After'),
      });
      recordUpstreamMetric({
        provider: 'anilist',
        endpoint: operationLabel,
        durationMs,
        status: res.status,
        fromCache: false,
        errorCode: err.code,
      });
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      recordUpstreamMetric({
        provider: 'anilist',
        endpoint: operationLabel,
        durationMs,
        status: res.status,
        fromCache: false,
        errorCode: 'invalid_json',
      });
      return null;
    }

    const json = await res.json();
    if (!json || typeof json !== 'object' || json.errors) {
      recordUpstreamMetric({
        provider: 'anilist',
        endpoint: operationLabel,
        durationMs,
        status: res.status,
        fromCache: false,
        errorCode: 'bad_request',
      });
      return null;
    }

    recordUpstreamMetric({
      provider: 'anilist',
      endpoint: operationLabel,
      durationMs,
      status: res.status,
      fromCache: false,
    });

    return (json.data as T) ?? null;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const err = classifyUpstreamError({
      provider: 'anilist',
      endpoint: operationLabel,
      error,
      durationMs,
    });
    recordUpstreamMetric({
      provider: 'anilist',
      endpoint: operationLabel,
      durationMs,
      status: null,
      fromCache: false,
      errorCode: err.code,
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const MEDIA_FIELDS_FRAGMENT = `
  id
  idMal
  title {
    romaji
    english
    native
    userPreferred
  }
  synonyms
  format
  status
  season
  seasonYear
  startDate {
    year
    month
    day
  }
  episodes
  duration
  averageScore
  coverImage {
    extraLarge
    large
  }
  bannerImage
  description(asHtml: false)
  genres
`;

export async function searchAniList(
  searchQuery: string,
  format?: string | null,
  options?: { page?: number; perPage?: number; forceRefresh?: boolean }
): Promise<AniListMedia[]> {
  const trimmedQuery = searchQuery?.trim();
  if (!trimmedQuery) return [];

  const page = Math.max(1, options?.page ?? 1);
  const perPage = Math.min(50, Math.max(5, options?.perPage ?? 25));
  const forceRefresh = Boolean(options?.forceRefresh);
  const normalizedFormat =
    format && VALID_ANILIST_FORMATS.has(format.toUpperCase())
      ? format.toUpperCase()
      : undefined;

  const cacheKey = `anilist:search:v2:${trimmedQuery.toLowerCase()}:${
    normalizedFormat || 'ALL'
  }:p${page}:${perPage}`;

  if (!forceRefresh) {
    const preState = appCache.getEntryState<AniListMedia[]>(cacheKey);
    if ((preState.status === 'fresh' || preState.status === 'stale') && preState.value) {
      recordUpstreamMetric({
        provider: 'anilist',
        endpoint: `search:${trimmedQuery.toLowerCase()}`,
        durationMs: 0,
        status: 200,
        fromCache: true,
        staleRevalidated: preState.status === 'stale',
      });
    }
  }

  return appCache.getOrSet<AniListMedia[]>(
    cacheKey,
    async () => {
      const query = `
        query ($search: String, $format: MediaFormat, $page: Int, $perPage: Int) {
          Page(page: $page, perPage: $perPage) {
            pageInfo {
              hasNextPage
            }
            media(search: $search, type: ANIME, format: $format, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
              ${MEDIA_FIELDS_FRAGMENT}
            }
          }
        }
      `;

      const variables: Record<string, unknown> = {
        search: trimmedQuery,
        page,
        perPage,
      };
      if (normalizedFormat) {
        variables.format = normalizedFormat;
      }

      const data = await executeAniListGraphQL<{
        Page?: {
          pageInfo?: { hasNextPage?: boolean };
          media?: AniListMedia[];
        };
      }>(query, variables, `search:${trimmedQuery.toLowerCase()}`);

      const mediaList = Array.isArray(data?.Page?.media)
        ? data!.Page!.media!
        : [];

      // Warm per-ID cache for every media item returned by search so subsequent getAniListById(id) calls cost 0ms
      for (const item of mediaList) {
        if (item && typeof item.id === 'number' && item.id > 0) {
          appCache.set(`anilist:media:v2:${item.id}`, item, 1800);
        }
      }

      return mediaList;
    },
    {
      ttlSeconds: 1800,
      staleWhileRevalidateSeconds: 3600,
      shouldCache: (list) => Array.isArray(list) && list.length > 0,
      negativeTtlSeconds: 60,
      forceRefresh,
    }
  );
}

/**
 * Searches AniList using a single unrestricted ANIME query first (returning top 25 candidates across all formats),
 * and only issues a format-specific query if the unrestricted search did not include any candidate of the target format.
 * This eliminates redundant back-to-back GraphQL requests while preserving full format fallback coverage.
 */
export async function searchAniListWithFallback(
  searchQuery: string,
  format?: string | null,
  options?: { fetchSecondPage?: boolean; forceRefresh?: boolean }
): Promise<AniListMedia[]> {
  const trimmed = searchQuery?.trim();
  if (!trimmed) return [];

  const byId = new Map<number, AniListMedia>();
  const addAll = (items: AniListMedia[]) => {
    for (const item of items) {
      if (item && typeof item.id === 'number' && !byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }
  };

  // 1. Run unrestricted search first (1 request covers TV, ONA, OVA, MOVIE, SPECIAL)
  const unfilteredResults = await searchAniList(trimmed, undefined, {
    page: 1,
    perPage: 25,
    forceRefresh: options?.forceRefresh,
  });
  addAll(unfilteredResults);

  const normalizedFormat =
    format && VALID_ANILIST_FORMATS.has(format.toUpperCase())
      ? format.toUpperCase()
      : undefined;

  // 2. Only run format-specific search if the unrestricted top-25 had 0 matches of normalizedFormat
  if (
    normalizedFormat &&
    unfilteredResults.length >= 25 &&
    !unfilteredResults.some((m) => m.format?.toUpperCase() === normalizedFormat)
  ) {
    const filteredResults = await searchAniList(trimmed, normalizedFormat, {
      page: 1,
      perPage: 25,
      forceRefresh: options?.forceRefresh,
    });
    addAll(filteredResults);
  }

  if (options?.fetchSecondPage && unfilteredResults.length >= 25) {
    const page2 = await searchAniList(trimmed, undefined, {
      page: 2,
      perPage: 25,
      forceRefresh: options?.forceRefresh,
    });
    addAll(page2);
  }

  return Array.from(byId.values());
}

export async function getAniListById(
  anilistId: number,
  forceRefresh: boolean = false
): Promise<AniListMedia | null> {
  if (!Number.isFinite(anilistId) || anilistId <= 0) return null;

  const cacheKey = `anilist:media:v2:${anilistId}`;
  if (!forceRefresh) {
    const preState = appCache.getEntryState<AniListMedia>(cacheKey);
    if ((preState.status === 'fresh' || preState.status === 'stale') && preState.value) {
      recordUpstreamMetric({
        provider: 'anilist',
        endpoint: `media:${anilistId}`,
        durationMs: 0,
        status: 200,
        fromCache: true,
        staleRevalidated: preState.status === 'stale',
      });
    }
  }

  return appCache.getOrSet<AniListMedia | null>(
    cacheKey,
    async () => {
      const query = `
        query ($id: Int) {
          Media(id: $id, type: ANIME) {
            ${MEDIA_FIELDS_FRAGMENT}
          }
        }
      `;

      const data = await executeAniListGraphQL<{ Media?: AniListMedia }>(
        query,
        { id: anilistId },
        `media:${anilistId}`
      );
      return data?.Media || null;
    },
    {
      ttlSeconds: 1800,
      staleWhileRevalidateSeconds: 3600,
      shouldCache: (media) => media !== null && media !== undefined,
      negativeTtlSeconds: 60,
      forceRefresh,
    }
  );
}

export interface AniListPageResult {
  items: AniListMedia[];
  hasNextPage: boolean;
  total: number;
}

function warmMediaCache(mediaList: AniListMedia[]): void {
  for (const item of mediaList) {
    if (item && typeof item.id === 'number' && item.id > 0) {
      appCache.set(`anilist:media:v2:${item.id}`, item, 1800);
    }
  }
}

export function getCurrentAnimeSeasonAndYear(now: Date = new Date()): {
  season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
  year: number;
} {
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  if (month >= 1 && month <= 3) return { season: 'WINTER', year };
  if (month >= 4 && month <= 6) return { season: 'SPRING', year };
  if (month >= 7 && month <= 9) return { season: 'SUMMER', year };
  return { season: 'FALL', year };
}

export async function getAniListTrending(
  page: number = 1,
  perPage: number = 30,
  forceRefresh: boolean = false
): Promise<AniListPageResult> {
  const safePage = Math.max(1, Math.floor(page || 1));
  const safePerPage = Math.min(50, Math.max(1, Math.floor(perPage || 30)));
  const cacheKey = `anilist:trending:v1:p${safePage}:${safePerPage}`;

  return appCache.getOrSet<AniListPageResult>(
    cacheKey,
    async () => {
      const query = `
        query ($page: Int, $perPage: Int) {
          Page(page: $page, perPage: $perPage) {
            pageInfo {
              total
              hasNextPage
            }
            media(type: ANIME, sort: [TRENDING_DESC, POPULARITY_DESC], isAdult: false) {
              ${MEDIA_FIELDS_FRAGMENT}
            }
          }
        }
      `;
      const data = await executeAniListGraphQL<{
        Page?: {
          pageInfo?: { total?: number; hasNextPage?: boolean };
          media?: AniListMedia[];
        };
      }>(query, { page: safePage, perPage: safePerPage }, `trending:p${safePage}`);

      const items = Array.isArray(data?.Page?.media) ? data!.Page!.media! : [];
      warmMediaCache(items);
      return {
        items,
        hasNextPage: Boolean(data?.Page?.pageInfo?.hasNextPage),
        total:
          typeof data?.Page?.pageInfo?.total === 'number' && data.Page.pageInfo.total > 0
            ? data.Page.pageInfo.total
            : items.length,
      };
    },
    {
      ttlSeconds: 600,
      staleWhileRevalidateSeconds: 1800,
      shouldCache: (res) => Array.isArray(res?.items) && res.items.length > 0,
      serveStaleOnError: true,
      forceRefresh,
    }
  );
}

export async function getAniListPopular(
  page: number = 1,
  perPage: number = 30,
  forceRefresh: boolean = false
): Promise<AniListPageResult> {
  const safePage = Math.max(1, Math.floor(page || 1));
  const safePerPage = Math.min(50, Math.max(1, Math.floor(perPage || 30)));
  const cacheKey = `anilist:popular:v1:p${safePage}:${safePerPage}`;

  return appCache.getOrSet<AniListPageResult>(
    cacheKey,
    async () => {
      const query = `
        query ($page: Int, $perPage: Int) {
          Page(page: $page, perPage: $perPage) {
            pageInfo {
              total
              hasNextPage
            }
            media(type: ANIME, sort: [POPULARITY_DESC, SCORE_DESC], isAdult: false) {
              ${MEDIA_FIELDS_FRAGMENT}
            }
          }
        }
      `;
      const data = await executeAniListGraphQL<{
        Page?: {
          pageInfo?: { total?: number; hasNextPage?: boolean };
          media?: AniListMedia[];
        };
      }>(query, { page: safePage, perPage: safePerPage }, `popular:p${safePage}`);

      const items = Array.isArray(data?.Page?.media) ? data!.Page!.media! : [];
      warmMediaCache(items);
      return {
        items,
        hasNextPage: Boolean(data?.Page?.pageInfo?.hasNextPage),
        total:
          typeof data?.Page?.pageInfo?.total === 'number' && data.Page.pageInfo.total > 0
            ? data.Page.pageInfo.total
            : items.length,
      };
    },
    {
      ttlSeconds: 900,
      staleWhileRevalidateSeconds: 3600,
      shouldCache: (res) => Array.isArray(res?.items) && res.items.length > 0,
      serveStaleOnError: true,
      forceRefresh,
    }
  );
}

export async function getAniListSeasonal(params?: {
  season?: string;
  year?: number;
  page?: number;
  perPage?: number;
  forceRefresh?: boolean;
}): Promise<AniListPageResult & { season: string; year: number }> {
  const current = getCurrentAnimeSeasonAndYear();
  const validSeasons = new Set(['WINTER', 'SPRING', 'SUMMER', 'FALL']);
  const rawSeason = params?.season?.trim().toUpperCase() || '';
  const season = validSeasons.has(rawSeason) ? rawSeason : current.season;
  const year =
    typeof params?.year === 'number' && Number.isFinite(params.year) && params.year >= 1960
      ? Math.floor(params.year)
      : current.year;
  const safePage = Math.max(1, Math.floor(params?.page || 1));
  const safePerPage = Math.min(50, Math.max(1, Math.floor(params?.perPage || 30)));
  const forceRefresh = Boolean(params?.forceRefresh);
  const cacheKey = `anilist:seasonal:v1:${season}:${year}:p${safePage}:${safePerPage}`;

  return appCache.getOrSet(
    cacheKey,
    async () => {
      const query = `
        query ($season: MediaSeason, $seasonYear: Int, $page: Int, $perPage: Int) {
          Page(page: $page, perPage: $perPage) {
            pageInfo {
              total
              hasNextPage
            }
            media(
              type: ANIME
              season: $season
              seasonYear: $seasonYear
              sort: [POPULARITY_DESC, SCORE_DESC]
              isAdult: false
            ) {
              ${MEDIA_FIELDS_FRAGMENT}
            }
          }
        }
      `;
      const data = await executeAniListGraphQL<{
        Page?: {
          pageInfo?: { total?: number; hasNextPage?: boolean };
          media?: AniListMedia[];
        };
      }>(
        query,
        {
          season,
          seasonYear: year,
          page: safePage,
          perPage: safePerPage,
        },
        `seasonal:${season}:${year}:p${safePage}`
      );

      const items = Array.isArray(data?.Page?.media) ? data!.Page!.media! : [];
      warmMediaCache(items);
      return {
        items,
        season,
        year,
        hasNextPage: Boolean(data?.Page?.pageInfo?.hasNextPage),
        total:
          typeof data?.Page?.pageInfo?.total === 'number' && data.Page.pageInfo.total > 0
            ? data.Page.pageInfo.total
            : items.length,
      };
    },
    {
      ttlSeconds: 900,
      staleWhileRevalidateSeconds: 3600,
      shouldCache: (res) => Array.isArray(res?.items) && res.items.length > 0,
      serveStaleOnError: true,
      forceRefresh,
    }
  );
}

export async function getAniListCatalogFallback(params: {
  q?: string;
  genre?: string;
  format?: string;
  status?: string;
  year?: string | number;
  season?: string;
  sort?: string;
  page?: number;
  perPage?: number;
  forceRefresh?: boolean;
}): Promise<AniListPageResult> {
  const safePage = Math.max(1, Math.floor(params.page || 1));
  const safePerPage = Math.min(50, Math.max(1, Math.floor(params.perPage || 30)));
  const q = params.q?.trim() || undefined;
  const rawFormat = params.format?.trim().toUpperCase() || '';
  const format = VALID_ANILIST_FORMATS.has(rawFormat) ? rawFormat : undefined;
  const validStatuses = new Set([
    'FINISHED',
    'RELEASING',
    'NOT_YET_RELEASED',
    'CANCELLED',
    'HIATUS',
  ]);
  const rawStatus = params.status?.trim().toUpperCase() || '';
  const status = validStatuses.has(rawStatus) ? rawStatus : undefined;
  const validSeasons = new Set(['WINTER', 'SPRING', 'SUMMER', 'FALL']);
  const rawSeason = params.season?.trim().toUpperCase() || '';
  const season = validSeasons.has(rawSeason) ? rawSeason : undefined;
  const parsedYear = Number(params.year);
  const seasonYear =
    Number.isFinite(parsedYear) && parsedYear >= 1960 && parsedYear <= 2100
      ? Math.floor(parsedYear)
      : undefined;
  const genres = params.genre
    ? params.genre
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean)
    : undefined;

  const sortLower = (params.sort || 'popularity').toLowerCase();
  const sortList =
    sortLower === 'trending'
      ? ['TRENDING_DESC', 'POPULARITY_DESC']
      : sortLower === 'score' || sortLower === 'top'
      ? ['SCORE_DESC', 'POPULARITY_DESC']
      : sortLower === 'newest' || sortLower === 'recent'
      ? ['START_DATE_DESC', 'POPULARITY_DESC']
      : ['POPULARITY_DESC', 'SCORE_DESC'];

  const cacheKey = `anilist:catalog:v1:q=${q || ''}:g=${(genres || []).join(',')}:f=${
    format || ''
  }:st=${status || ''}:s=${season || ''}:y=${seasonYear || ''}:sort=${sortList[0]}:p${safePage}:${safePerPage}`;

  return appCache.getOrSet<AniListPageResult>(
    cacheKey,
    async () => {
      const query = `
        query (
          $page: Int
          $perPage: Int
          $search: String
          $format: MediaFormat
          $status: MediaStatus
          $season: MediaSeason
          $seasonYear: Int
          $genreIn: [String]
          $sort: [MediaSort]
        ) {
          Page(page: $page, perPage: $perPage) {
            pageInfo {
              total
              hasNextPage
            }
            media(
              type: ANIME
              isAdult: false
              search: $search
              format: $format
              status: $status
              season: $season
              seasonYear: $seasonYear
              genre_in: $genreIn
              sort: $sort
            ) {
              ${MEDIA_FIELDS_FRAGMENT}
            }
          }
        }
      `;
      const variables: Record<string, unknown> = {
        page: safePage,
        perPage: safePerPage,
        sort: sortList,
      };
      if (q) variables.search = q;
      if (format) variables.format = format;
      if (status) variables.status = status;
      if (season) variables.season = season;
      if (seasonYear) variables.seasonYear = seasonYear;
      if (genres && genres.length > 0) variables.genreIn = genres;

      const data = await executeAniListGraphQL<{
        Page?: {
          pageInfo?: { total?: number; hasNextPage?: boolean };
          media?: AniListMedia[];
        };
      }>(query, variables, `catalog:p${safePage}`);

      const items = Array.isArray(data?.Page?.media) ? data!.Page!.media! : [];
      warmMediaCache(items);
      return {
        items,
        hasNextPage: Boolean(data?.Page?.pageInfo?.hasNextPage),
        total:
          typeof data?.Page?.pageInfo?.total === 'number' && data.Page.pageInfo.total > 0
            ? data.Page.pageInfo.total
            : items.length,
      };
    },
    {
      ttlSeconds: 600,
      staleWhileRevalidateSeconds: 1800,
      shouldCache: (res) => Array.isArray(res?.items) && res.items.length > 0,
      serveStaleOnError: true,
      forceRefresh: Boolean(params.forceRefresh),
    }
  );
}

