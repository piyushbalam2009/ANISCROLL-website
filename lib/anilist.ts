import { appCache } from './cache';

const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';
const ANILIST_TIMEOUT_MS = 8000;

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
  variables: Record<string, unknown>
): Promise<T | null> {
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

    if (res.status === 429) {
      console.warn('[AniList] Rate limit (429) encountered');
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return null;
    }

    const json = await res.json();
    if (!json || typeof json !== 'object' || json.errors) {
      return null;
    }

    return (json.data as T) ?? null;
  } catch (error) {
    if ((error as Error)?.name !== 'AbortError') {
      console.error('[AniList] GraphQL request error:', error);
    }
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

  const cacheKey = `anilist:search:v2:${trimmedQuery.toLowerCase()}:${normalizedFormat || 'ALL'}:p${page}:${perPage}`;
  const cached = appCache.get<AniListMedia[]>(cacheKey);
  if (cached) return cached;

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
  }>(query, variables);

  const mediaList = Array.isArray(data?.Page?.media) ? data!.Page!.media! : [];
  if (mediaList.length > 0) {
    // Store in memory cache for 12 hours (never in Firebase/Firestore)
    appCache.set(cacheKey, mediaList, 12 * 3600);
  }
  return mediaList;
}

/**
 * Searches AniList with optional format filter, and automatically retries
 * without format restrictions if the format-filtered search returns few/no results.
 * Also supports fetching page 2 when needed and deduplicates by AniList ID.
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

  const normalizedFormat =
    format && VALID_ANILIST_FORMATS.has(format.toUpperCase())
      ? format.toUpperCase()
      : undefined;

  if (normalizedFormat) {
    const filteredResults = await searchAniList(trimmed, normalizedFormat, {
      page: 1,
      perPage: 25,
    });
    addAll(filteredResults);
  }

  // Always run an unrestricted ANIME search if format wasn't set OR if format-restricted
  // search returned fewer than 5 candidates (since Hoshika TV vs AniList ONA/OVA often differ, e.g. Overgeared)
  if (!normalizedFormat || byId.size < 5) {
    const unfilteredResults = await searchAniList(trimmed, undefined, {
      page: 1,
      perPage: 25,
    });
    addAll(unfilteredResults);

    if (options?.fetchSecondPage && unfilteredResults.length >= 25) {
      const page2 = await searchAniList(trimmed, undefined, {
        page: 2,
        perPage: 25,
      });
      addAll(page2);
    }
  }

  return Array.from(byId.values());
}

export async function getAniListById(anilistId: number): Promise<AniListMedia | null> {
  if (!Number.isFinite(anilistId) || anilistId <= 0) return null;

  const cacheKey = `anilist:media:v2:${anilistId}`;
  const cached = appCache.get<AniListMedia>(cacheKey);
  if (cached) return cached;

  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FIELDS_FRAGMENT}
      }
    }
  `;

  const data = await executeAniListGraphQL<{ Media?: AniListMedia }>(query, {
    id: anilistId,
  });
  const media = data?.Media || null;
  if (media) {
    appCache.set(cacheKey, media, 24 * 3600);
  }
  return media;
}
