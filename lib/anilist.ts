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
`;

export async function searchAniList(
  searchQuery: string,
  format?: string | null,
  options?: { page?: number; perPage?: number }
): Promise<AniListMedia[]> {
  const trimmedQuery = searchQuery?.trim();
  if (!trimmedQuery) return [];

  const page = Math.max(1, options?.page ?? 1);
  const perPage = Math.min(50, Math.max(5, options?.perPage ?? 25));
  const normalizedFormat =
    format && VALID_ANILIST_FORMATS.has(format.toUpperCase())
      ? format.toUpperCase()
      : undefined;

  const cacheKey = `anilist:search:v2:${trimmedQuery.toLowerCase()}:${
    normalizedFormat || 'ALL'
  }:p${page}:${perPage}`;

  const preState = appCache.getEntryState<AniListMedia[]>(cacheKey);
  if (preState.status !== 'miss' && preState.value) {
    recordUpstreamMetric({
      provider: 'anilist',
      endpoint: `search:${trimmedQuery.toLowerCase()}`,
      durationMs: 0,
      status: 200,
      fromCache: true,
      staleRevalidated: preState.status === 'stale',
    });
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
          appCache.set(`anilist:media:v2:${item.id}`, item, 24 * 3600);
        }
      }

      return mediaList;
    },
    {
      ttlSeconds: 12 * 3600,
      staleWhileRevalidateSeconds: 24 * 3600,
      shouldCache: (list) => Array.isArray(list) && list.length > 0,
      negativeTtlSeconds: 120,
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
  options?: { fetchSecondPage?: boolean }
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
    });
    addAll(filteredResults);
  }

  if (options?.fetchSecondPage && unfilteredResults.length >= 25) {
    const page2 = await searchAniList(trimmed, undefined, {
      page: 2,
      perPage: 25,
    });
    addAll(page2);
  }

  return Array.from(byId.values());
}

export async function getAniListById(
  anilistId: number
): Promise<AniListMedia | null> {
  if (!Number.isFinite(anilistId) || anilistId <= 0) return null;

  const cacheKey = `anilist:media:v2:${anilistId}`;
  const preState = appCache.getEntryState<AniListMedia>(cacheKey);
  if (preState.status !== 'miss' && preState.value) {
    recordUpstreamMetric({
      provider: 'anilist',
      endpoint: `media:${anilistId}`,
      durationMs: 0,
      status: 200,
      fromCache: true,
      staleRevalidated: preState.status === 'stale',
    });
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
      ttlSeconds: 24 * 3600,
      staleWhileRevalidateSeconds: 48 * 3600,
      shouldCache: (media) => media !== null && media !== undefined,
      negativeTtlSeconds: 180,
    }
  );
}
