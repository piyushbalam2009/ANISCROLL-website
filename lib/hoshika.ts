import { appCache } from './cache';
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
import {
  executeHoshikaRequest,
  fetchHoshikaCached,
  getHoshikaCooldownRemainingMs,
  getHoshikaCooldownState,
  HOSHIKA_ENDPOINTS,
  HoshikaErrorDetails,
  HoshikaRequestPriority,
  HoshikaResult,
  HoshikaUpstreamError,
  isHoshikaCooldownActive,
  isHoshikaUpstreamError,
  resetHoshikaClientState,
} from './hoshika-client';
import {
  mapHoshikaAnimeItem,
  mapHoshikaAnimeList,
  mapHoshikaEpisodeList,
  mapHoshikaScheduleItem,
  validateHoshikaAnimeDetailPayload,
  validateHoshikaEpisodesPayload,
  validateHoshikaGenresPayload,
  validateHoshikaHomePayload,
  validateHoshikaItemsPayload,
  validateHoshikaSearchPayload,
} from './hoshika-mapper';
import {
  AniListMedia,
  getAniListById,
  getAniListCatalogFallback,
  getAniListPopular,
  getAniListSeasonal,
  getAniListTrending,
  searchAniListWithFallback,
} from './anilist';
import {
  recordEpisodeFailure,
  recordFallbackUsage,
} from './perf-monitor';
import {
  HoshikaAnimeItem,
  HoshikaEpisodeItem,
  IdMappingResult,
  ScheduleItem,
} from '@/types/anime';

export {
  HoshikaUpstreamError,
  isHoshikaUpstreamError,
  isHoshikaCooldownActive,
  getHoshikaCooldownState,
  resetHoshikaClientState,
} from './hoshika-client';

const FALLBACK_BASE_GENRES = [
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

const EXTRA_SUPPORTED_THEMES = [
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

function normalizePositiveShortId(rawId: string | number): string | null {
  const trimmed = String(rawId ?? '').trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  return String(num);
}

function cacheHoshikaSummaries(items: Array<HoshikaAnimeItem | null | undefined>): void {
  for (const item of items) {
    if (!item || !item.shortId) continue;
    const summaryKey = `hoshika:summary:${item.shortId}`;
    const existing = appCache.getEntryState<HoshikaAnimeItem>(summaryKey).value;
    // Preserve richer existing fields (e.g. synopsis/anilistId) while updating fresh titles/images
    const merged: HoshikaAnimeItem = existing
      ? {
          ...existing,
          ...item,
          synopsis: item.synopsis || existing.synopsis || null,
          anilistId: item.anilistId || existing.anilistId || null,
          malId: item.malId || existing.malId || null,
          bannerImage: item.bannerImage || existing.bannerImage || null,
          coverImage: item.coverImage || existing.coverImage || null,
        }
      : item;
    appCache.set(summaryKey, merged, {
      ttlSeconds: 86400,
      staleWhileRevalidateSeconds: 86400,
    });
  }
}

export function getCachedHoshikaSummary(
  shortId: string | number
): HoshikaAnimeItem | null {
  const cleanId = normalizePositiveShortId(shortId);
  if (!cleanId) return null;
  const state = appCache.getEntryState<HoshikaAnimeItem>(`hoshika:summary:${cleanId}`);
  return state.value || null;
}

function getHoshikaCacheErrorPolicy() {
  return {
    shouldSuppressBackgroundRefresh: () => isHoshikaCooldownActive(),
    negativeRefreshCooldownMs: 15_000,
    getRefreshCooldownMs: (err: unknown) => {
      if (isHoshikaUpstreamError(err) && err.category === 'RATE_LIMITED') {
        return {
          cooldownMs: Math.max(
            15_000,
            getHoshikaCooldownRemainingMs(),
            err.retryAfterMs ?? 0
          ),
          errorCode: 'RATE_LIMITED',
        };
      }
      return { cooldownMs: 15_000 };
    },
  };
}

/**
 * Low-level backwards-compatible Hoshika fetcher returning `T | null`.
 * Powered by the centralized `fetchHoshikaCached` client with strict validation,
 * Cloudflare/HTML detection, IPv4 fallback, and stale-on-error fallback.
 */
export async function fetchFromHoshika<T>(
  endpoint: string,
  cacheTtlSeconds: number = 300,
  forceRefresh: boolean = false,
  priority: HoshikaRequestPriority = 'foreground'
): Promise<T | null> {
  const res = await fetchHoshikaCached<T>({
    endpoint,
    cacheTtlSeconds,
    forceRefresh,
    priority,
    shouldCache: (data) => {
      if (!data) return false;
      const isEmptyEpisodesResponse =
        endpoint.includes('/episodes') &&
        Array.isArray((data as any).items) &&
        (data as any).items.length === 0;
      return !isEmptyEpisodesResponse;
    },
  });
  return res.ok ? res.data : null;
}

export async function fetchFromHoshikaDetailed<T>(
  endpoint: string,
  options: {
    cacheTtlSeconds?: number;
    staleWhileRevalidateSeconds?: number;
    forceRefresh?: boolean;
    validator?: (raw: unknown) => string | null;
    mapper?: (raw: unknown) => T;
    shouldCache?: (value: T) => boolean;
  } = {}
): Promise<HoshikaResult<T>> {
  return fetchHoshikaCached<T>({
    endpoint,
    cacheTtlSeconds: options.cacheTtlSeconds ?? 300,
    staleWhileRevalidateSeconds: options.staleWhileRevalidateSeconds,
    forceRefresh: options.forceRefresh,
    validator: options.validator,
    mapper: options.mapper,
    shouldCache: options.shouldCache,
  });
}

export interface HoshikaSearchDetailedResult {
  ok: boolean;
  items: HoshikaAnimeItem[];
  fromCache: boolean;
  error?: HoshikaErrorDetails;
}

export async function searchHoshikaDetailed(
  query: string,
  limit: number = 20,
  format?: string,
  year?: string | number
): Promise<HoshikaSearchDetailedResult> {
  if (!query || !query.trim()) {
    return { ok: true, items: [], fromCache: false };
  }
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

  const endpoint = HOSHIKA_ENDPOINTS.search(params);
  const res = await fetchHoshikaCached<HoshikaAnimeItem[]>({
    endpoint,
    cacheKey: `hoshika:${endpoint}`,
    cacheTtlSeconds: 360,
    staleWhileRevalidateSeconds: 720,
    validator: validateHoshikaSearchPayload,
    mapper: (raw) => {
      const items = mapHoshikaAnimeList((raw as any).anime);
      cacheHoshikaSummaries(items);
      return items;
    },
  });

  if (!res.ok) {
    try {
      const anilistItems = await searchAniListWithFallback(trimmedQuery, format);
      const parsedYear = year ? Number(year) : null;
      const filteredMedia =
        parsedYear && Number.isFinite(parsedYear)
          ? anilistItems.filter(
              (m) =>
                (m.seasonYear || m.startDate?.year) === parsedYear
            )
          : anilistItems;
      if (filteredMedia.length > 0) {
        recordFallbackUsage('anilist');
        const mappedFallback = mapAniListMediaListToHoshikaItems(
          filteredMedia.slice(0, requestedLimit)
        );
        return {
          ok: true,
          items: mappedFallback,
          fromCache: false,
        };
      }
    } catch {
      // Fall through to original Hoshika error when AniList also fails
    }
    return { ok: false, items: [], fromCache: false, error: res.error };
  }

  const searchResults = res.data;
  if (requestedLimit <= 20 || searchResults.length < 20) {
    return {
      ok: true,
      items: searchResults.slice(0, requestedLimit),
      fromCache: res.fromCache,
    };
  }

  try {
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

    return {
      ok: true,
      items: Array.from(mergedMap.values()).slice(0, requestedLimit),
      fromCache: res.fromCache,
    };
  } catch {
    return {
      ok: true,
      items: searchResults.slice(0, requestedLimit),
      fromCache: res.fromCache,
    };
  }
}

export async function searchHoshika(
  query: string,
  limit: number = 20,
  format?: string,
  year?: string | number
): Promise<HoshikaAnimeItem[]> {
  const res = await searchHoshikaDetailed(query, limit, format, year);
  return res.items;
}

export async function getHoshikaAnimeDetailed(
  shortId: string | number,
  locale: string = 'en',
  forceRefresh: boolean = false
): Promise<HoshikaResult<HoshikaAnimeItem>> {
  const cleanId = normalizePositiveShortId(shortId);
  if (!cleanId) {
    return {
      ok: false,
      fromCache: false,
      error: {
        category: 'HTTP_ERROR',
        status: 400,
        endpoint: `/anime/${String(shortId)}`,
        message: 'Invalid Hoshika shortId (must be a positive integer)',
        retryable: false,
        durationMs: 0,
      },
    };
  }

  const safeLocale = (locale || 'en').trim() || 'en';
  const endpoint = HOSHIKA_ENDPOINTS.animeDetail(cleanId, safeLocale);
  const cacheKey = `hoshika:/anime/${cleanId}?locale=${safeLocale}`;

  return fetchHoshikaCached<HoshikaAnimeItem>({
    endpoint,
    cacheKey,
    cacheTtlSeconds: 900,
    staleWhileRevalidateSeconds: 1800,
    forceRefresh,
    validator: validateHoshikaAnimeDetailPayload,
    mapper: (raw) => {
      const mapped = mapHoshikaAnimeItem((raw as any).anime);
      if (!mapped) {
        throw new HoshikaUpstreamError({
          category: 'INVALID_RESPONSE',
          status: 200,
          endpoint,
          message: 'Hoshika anime detail record could not be normalized',
          retryable: false,
          durationMs: 0,
        });
      }
      cacheHoshikaSummaries([mapped]);
      return mapped;
    },
  });
}

export async function getHoshikaAnime(
  shortId: string | number,
  locale: string = 'en',
  forceRefresh: boolean = false
): Promise<HoshikaAnimeItem | null> {
  const res = await getHoshikaAnimeDetailed(shortId, locale, forceRefresh);
  return res.ok ? res.data : null;
}

export interface ResolveAnimeDetailOutcome {
  ok: boolean;
  status: 'found' | 'not_found' | 'invalid_id' | 'upstream_error';
  anime: HoshikaAnimeItem | null;
  canonicalShortId: number | null;
  idSource: 'hoshika' | 'anilist_cross_mapped' | 'anilist_fallback' | null;
  error?: HoshikaErrorDetails;
}

export function mapAniListMediaToFallbackAnime(
  shortId: number,
  media: AniListMedia,
  summary?: HoshikaAnimeItem | null
): HoshikaAnimeItem {
  const cleanSynopsis =
    typeof media.description === 'string' && media.description.trim()
      ? media.description.replace(/<[^>]+>/g, '').trim()
      : summary?.synopsis || null;

  return {
    ...(summary || {}),
    id: summary?.id || String(shortId),
    shortId,
    slug: summary?.slug || String(shortId),
    titleRomaji: media.title?.romaji || summary?.titleRomaji || null,
    titleEnglish:
      media.title?.english ||
      summary?.titleEnglish ||
      media.title?.userPreferred ||
      null,
    titleJapanese: media.title?.native || summary?.titleJapanese || null,
    titleLocalized:
      media.title?.userPreferred ||
      media.title?.english ||
      media.title?.romaji ||
      summary?.titleLocalized ||
      null,
    synonyms: Array.isArray(media.synonyms) && media.synonyms.length > 0
      ? media.synonyms
      : summary?.synonyms,
    synopsis: cleanSynopsis,
    coverImage:
      media.coverImage?.extraLarge ||
      media.coverImage?.large ||
      summary?.coverImage ||
      null,
    bannerImage: media.bannerImage || summary?.bannerImage || null,
    format: media.format || summary?.format || null,
    status: media.status || summary?.status || null,
    season: media.season || summary?.season || null,
    seasonYear: media.seasonYear || media.startDate?.year || summary?.seasonYear || null,
    episodes: media.episodes ?? summary?.episodes ?? null,
    episodeDuration: media.duration ?? summary?.episodeDuration ?? null,
    averageScore: media.averageScore ?? summary?.averageScore ?? null,
    genres:
      Array.isArray(media.genres) && media.genres.length > 0
        ? media.genres.map((name) => ({
            name,
            slug: name.toLowerCase().replace(/[\s_]+/g, '-'),
          }))
        : summary?.genres,
    studios:
      Array.isArray((media as any).studios?.nodes) &&
      (media as any).studios.nodes.length > 0
        ? (media as any).studios.nodes
            .map((s: any) => (typeof s?.name === 'string' ? s.name.trim() : ''))
            .filter(Boolean)
        : summary?.studios,
    anilistId: media.id || summary?.anilistId || null,
    malId: media.idMal || summary?.malId || null,
  };
}

export function mapAniListMediaListToHoshikaItems(
  mediaList: AniListMedia[]
): HoshikaAnimeItem[] {
  const items: HoshikaAnimeItem[] = [];
  for (const media of mediaList) {
    if (!media || typeof media.id !== 'number' || media.id <= 0) continue;
    const summary = getCachedHoshikaSummary(media.id);
    const shortId = summary?.shortId || media.id;
    items.push(mapAniListMediaToFallbackAnime(shortId, media, summary));
  }
  cacheHoshikaSummaries(items);
  return items;
}

/**
 * Builds partial anime metadata from verified cached summary / ID-map / AniList GraphQL
 * when Hoshika upstream is rate-limited (`429`) or experiencing temporary outage.
 */
export async function getAniListFallbackForAnime(params: {
  shortId: string | number;
  anilistId?: number | null;
  forceRefresh?: boolean;
}): Promise<HoshikaAnimeItem | null> {
  const cleanId = normalizePositiveShortId(params.shortId);
  if (!cleanId) return null;
  const numericShortId = Number(cleanId);

  const summary = getCachedHoshikaSummary(cleanId);
  const cachedIdMap = appCache.getEntryState<IdMappingResult>(`id-map:v4:${cleanId}`).value;
  const targetAnilistId =
    params.anilistId ||
    summary?.anilistId ||
    cachedIdMap?.aniListId ||
    cachedIdMap?.anilistId ||
    null;

  if (targetAnilistId && targetAnilistId > 0) {
    try {
      const media = await getAniListById(targetAnilistId, params.forceRefresh);
      if (media) {
        return mapAniListMediaToFallbackAnime(numericShortId, media, summary);
      }
    } catch {
      // fall through to title/summary fallback
    }
  }

  const lookupTitle =
    summary?.titleEnglish ||
    summary?.titleRomaji ||
    summary?.titleLocalized ||
    cachedIdMap?.matchedTitle ||
    cachedIdMap?.title ||
    null;

  if (lookupTitle && lookupTitle !== 'Unknown') {
    try {
      const candidates = await searchAniListWithFallback(
        lookupTitle,
        summary?.format || cachedIdMap?.format || undefined
      );
      if (candidates.length > 0) {
        return mapAniListMediaToFallbackAnime(
          numericShortId,
          candidates[0],
          summary
        );
      }
    } catch {
      // ignore AniList lookup errors; fall back to summary below if present
    }
  }

  return summary;
}

function normalizeTitleForExactCrossLookup(value?: string | null): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/['"`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves an anime detail page/API request by ID cleanly:
 * 1. Validates positive integer ID cleanly (never sends garbage to Hoshika 400).
 * 2. Calls Hoshika `/api/v1/anime/{shortId}` as primary authoritative source.
 * 3. On `RATE_LIMITED` / transient upstream error:
 *    - Never fakes a 404 or guesses unrelated IDs.
 *    - If verified summary or AniList ID link exists for this `shortId`, serves partial fallback metadata cleanly.
 *    - Otherwise returns `status: 'upstream_error'` (with `429`/`503` semantics).
 * 4. ONLY when Hoshika explicitly returns `NOT_FOUND` (HTTP 404), attempts a verified
 *    AniList -> Hoshika title cross-lookup in case an external AniList ID URL was shared.
 */
export async function resolveAnimeDetailById(
  rawId: string | number,
  locale: string = 'en',
  forceRefresh: boolean = false
): Promise<ResolveAnimeDetailOutcome> {
  const cleanId = normalizePositiveShortId(rawId);
  if (!cleanId) {
    return {
      ok: false,
      status: 'invalid_id',
      anime: null,
      canonicalShortId: null,
      idSource: null,
      error: {
        category: 'HTTP_ERROR',
        status: 400,
        endpoint: `/api/v1/anime/${String(rawId)}`,
        message: 'Invalid anime ID',
        retryable: false,
        durationMs: 0,
      },
    };
  }

  const primary = await getHoshikaAnimeDetailed(cleanId, locale, forceRefresh);
  if (primary.ok) {
    return {
      ok: true,
      status: 'found',
      anime: primary.data,
      canonicalShortId: primary.data.shortId,
      idSource: 'hoshika',
    };
  }

  if (primary.error.category !== 'NOT_FOUND') {
    if (
      primary.error.category === 'RATE_LIMITED' ||
      primary.error.category === 'UPSTREAM_UNAVAILABLE' ||
      primary.error.category === 'TIMEOUT'
    ) {
      const fallbackAnime = await getAniListFallbackForAnime({
        shortId: cleanId,
        forceRefresh: false,
      });
      if (fallbackAnime) {
        recordFallbackUsage('anilist');
        return {
          ok: true,
          status: 'found',
          anime: fallbackAnime,
          canonicalShortId: Number(cleanId),
          idSource: 'anilist_fallback',
          error: primary.error,
        };
      }
    }

    return {
      ok: false,
      status: 'upstream_error',
      anime: null,
      canonicalShortId: null,
      idSource: null,
      error: primary.error,
    };
  }

  // Hoshika explicitly returned 404 for this integer ID. Check once whether this ID is an AniList ID.
  try {
    const media = await getAniListById(Number(cleanId), forceRefresh);
    if (!media) {
      return {
        ok: false,
        status: 'not_found',
        anime: null,
        canonicalShortId: null,
        idSource: null,
        error: primary.error,
      };
    }

    const candidateTitles = [
      media.title.english,
      media.title.romaji,
      media.title.userPreferred,
    ].filter((t): t is string => Boolean(t && t.trim().length >= 2));

    const expectedFormat = media.format?.toUpperCase() || null;
    const expectedYear = media.seasonYear || media.startDate?.year || null;

    for (const qTitle of candidateTitles) {
      const searchRes = await searchHoshikaDetailed(qTitle, 10);
      if (!searchRes.ok || searchRes.items.length === 0) continue;

      const normTargetTitles = new Set(
        candidateTitles.map((t) => normalizeTitleForExactCrossLookup(t)).filter(Boolean)
      );

      const matched = searchRes.items.find((item) => {
        const itemTitles = [
          item.titleEnglish,
          item.titleRomaji,
          item.titleLocalized,
        ]
          .map((t) => normalizeTitleForExactCrossLookup(t))
          .filter(Boolean);

        const titleMatches = itemTitles.some((t) => normTargetTitles.has(t));
        if (!titleMatches) return false;

        if (
          expectedFormat &&
          item.format &&
          expectedFormat === 'MOVIE' &&
          item.format.toUpperCase() !== 'MOVIE'
        ) {
          return false;
        }
        if (
          expectedYear &&
          item.seasonYear &&
          Math.abs(expectedYear - item.seasonYear) > 1
        ) {
          return false;
        }
        return true;
      });

      if (matched) {
        const mappedDetail = await getHoshikaAnimeDetailed(
          matched.shortId,
          locale,
          forceRefresh
        );
        if (mappedDetail.ok) {
          return {
            ok: true,
            status: 'found',
            anime: mappedDetail.data,
            canonicalShortId: mappedDetail.data.shortId,
            idSource: 'anilist_cross_mapped',
          };
        }
      }
    }
  } catch {
    // Non-fatal fallback; preserve original Hoshika 404
  }

  return {
    ok: false,
    status: 'not_found',
    anime: null,
    canonicalShortId: null,
    idSource: null,
    error: primary.error,
  };
}

export interface HoshikaEpisodesPageResult {
  items: HoshikaEpisodeItem[];
  total: number;
  nextAfter: number | null;
}

export async function getHoshikaEpisodesDetailed(
  shortId: string | number,
  locale: string = 'en',
  after?: number,
  limit: number = 50,
  forceRefresh: boolean = false
): Promise<HoshikaResult<HoshikaEpisodesPageResult>> {
  const cleanId = normalizePositiveShortId(shortId);
  if (!cleanId) {
    return {
      ok: false,
      fromCache: false,
      error: {
        category: 'HTTP_ERROR',
        status: 400,
        endpoint: `/anime/${String(shortId)}/episodes`,
        message: 'Invalid Hoshika shortId for episodes request',
        retryable: false,
        durationMs: 0,
      },
    };
  }

  const safeLocale = (locale || 'en').trim() || 'en';
  const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 50)));
  const epParams = new URLSearchParams({
    locale: safeLocale,
    limit: String(safeLimit),
  });
  if (after !== undefined && after > 0) {
    epParams.append('after', String(Math.floor(after)));
  }

  const endpoint = HOSHIKA_ENDPOINTS.animeEpisodes(cleanId, {
    locale: safeLocale,
    limit: safeLimit,
    after,
  });
  const cacheKey = `hoshika:/anime/${cleanId}/episodes?${epParams.toString()}`;

  const res = await fetchHoshikaCached<HoshikaEpisodesPageResult>({
    endpoint,
    cacheKey,
    cacheTtlSeconds: 900,
    staleWhileRevalidateSeconds: 1800,
    forceRefresh,
    validator: validateHoshikaEpisodesPayload,
    shouldCache: (r) => Array.isArray(r.items) && r.items.length > 0,
    mapper: (raw) => {
      const obj = raw as Record<string, any>;
      const items = mapHoshikaEpisodeList(obj.items);
      const total =
        typeof obj.total === 'number' && Number.isFinite(obj.total)
          ? obj.total
          : items.length;
      const nextAfter =
        typeof obj.nextAfter === 'number' && Number.isFinite(obj.nextAfter)
          ? obj.nextAfter
          : null;
      return { items, total, nextAfter };
    },
  });
  if (!res.ok) {
    recordEpisodeFailure();
  }
  return res;
}

export async function getHoshikaEpisodes(
  shortId: string | number,
  locale: string = 'en',
  after?: number,
  limit: number = 50,
  forceRefresh: boolean = false
): Promise<HoshikaEpisodesPageResult> {
  const res = await getHoshikaEpisodesDetailed(
    shortId,
    locale,
    after,
    limit,
    forceRefresh
  );
  if (!res.ok) {
    return { items: [], total: 0, nextAfter: null };
  }
  return res.data;
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
        const pageRes = await getHoshikaEpisodesDetailed(
          shortId,
          locale,
          nextAfter,
          50,
          forceRefresh
        );

        if (!pageRes.ok) {
          if (batchCount === 1) {
            throw new HoshikaUpstreamError(pageRes.error);
          }
          break;
        }

        const pageResult = pageRes.data;
        if (pageResult.total > reportedTotal) {
          reportedTotal = pageResult.total;
        }

        if (!pageResult.items || pageResult.items.length === 0) {
          break;
        }

        const existing = new Set(allItems.map((e) => e.number));
        for (const ep of pageResult.items) {
          if (!existing.has(ep.number)) {
            allItems.push(ep);
            existing.add(ep.number);
          }
        }

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
      serveStaleOnError: true,
      forceRefresh,
      ...getHoshikaCacheErrorPolicy(),
    }
  );
}

/**
 * Compute the `after` cursor for a target 1-based episode number using 50-episode batches.
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
 * Fetches Batch 1 and (when targetEpisode > 50) target batch in parallel.
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

  const [initialBatch, targetBatch] = await Promise.all([
    getHoshikaEpisodes(shortId, locale, undefined, 50, forceRefresh),
    getHoshikaEpisodes(shortId, locale, targetCursor, 50, forceRefresh),
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

export interface HoshikaHomeData {
  season: { season: string; year: number } | null;
  seasonal: HoshikaAnimeItem[];
  trending: HoshikaAnimeItem[];
  recentlyAdded: HoshikaAnimeItem[];
}

export async function getHoshikaHomeDetailed(
  locale: string = 'en',
  forceRefresh: boolean = false
): Promise<HoshikaResult<HoshikaHomeData>> {
  const safeLocale = (locale || 'en').trim() || 'en';
  const endpoint = HOSHIKA_ENDPOINTS.home(safeLocale);
  const cacheKey = `hoshika:/home?locale=${safeLocale}`;

  const res = await fetchHoshikaCached<HoshikaHomeData>({
    endpoint,
    cacheKey,
    cacheTtlSeconds: 300,
    staleWhileRevalidateSeconds: 600,
    forceRefresh,
    validator: validateHoshikaHomePayload,
    mapper: (raw) => {
      const obj = raw as Record<string, any>;
      const seasonal = mapHoshikaAnimeList(obj.seasonal);
      const trending = mapHoshikaAnimeList(obj.trending);
      const recentlyAdded = mapHoshikaAnimeList(obj.recentlyAdded);
      cacheHoshikaSummaries([...seasonal, ...trending, ...recentlyAdded]);
      return {
        season:
          obj.season && typeof obj.season === 'object' ? obj.season : null,
        seasonal,
        trending,
        recentlyAdded,
      };
    },
  });

  if (res.ok) {
    return res;
  }

  // Fallback to AniList for Trending + Seasonal when Hoshika /home is rate-limited or unavailable.
  // Never fabricate recentlyAdded dates or episodes from AniList.
  try {
    const [trendingPage, seasonalPage] = await Promise.all([
      getAniListTrending(1, 20).catch(() => null),
      getAniListSeasonal({ page: 1, perPage: 20 }).catch(() => null),
    ]);
    const trendingItems = trendingPage?.items
      ? mapAniListMediaListToHoshikaItems(trendingPage.items)
      : [];
    const seasonalItems = seasonalPage?.items
      ? mapAniListMediaListToHoshikaItems(seasonalPage.items)
      : [];

    if (trendingItems.length > 0 || seasonalItems.length > 0) {
      recordFallbackUsage('anilist');
      return {
        ok: true,
        fromCache: false,
        data: {
          season: seasonalPage
            ? { season: seasonalPage.season, year: seasonalPage.year }
            : null,
          seasonal: seasonalItems,
          trending: trendingItems,
          recentlyAdded: [],
        },
      };
    }
  } catch {
    // Fall through to original error
  }

  return res;
}

export async function getHoshikaHome(
  locale: string = 'en',
  forceRefresh: boolean = false
): Promise<HoshikaHomeData> {
  const res = await getHoshikaHomeDetailed(locale, forceRefresh);
  if (!res.ok) {
    return {
      season: null,
      seasonal: [],
      trending: [],
      recentlyAdded: [],
    };
  }
  return res.data;
}

export async function getHoshikaBrowseDetailed(
  sort: 'trending' | 'recent' | 'top' = 'trending',
  type: string = 'anime',
  forceRefresh: boolean = false,
  locale: string = 'en'
): Promise<HoshikaResult<HoshikaAnimeItem[]>> {
  const ttl = sort === 'top' ? 600 : 300;
  const endpoint = HOSHIKA_ENDPOINTS.browse({ sort, type, locale });
  const res = await fetchHoshikaCached<HoshikaAnimeItem[]>({
    endpoint,
    cacheKey: `hoshika:${endpoint}`,
    cacheTtlSeconds: ttl,
    staleWhileRevalidateSeconds: ttl * 2,
    forceRefresh,
    validator: validateHoshikaItemsPayload,
    shouldCache: (items) => Array.isArray(items) && items.length > 0,
    mapper: (raw) => {
      const items = mapHoshikaAnimeList((raw as any).items);
      cacheHoshikaSummaries(items);
      return items;
    },
  });

  if (res.ok) {
    return res;
  }

  // AniList fallback for 'trending' and 'top' ('popular'). Never invent 'recent' episode update timestamps.
  if (sort === 'trending' || sort === 'top') {
    try {
      const fallbackPage =
        sort === 'trending'
          ? await getAniListTrending(1, 30)
          : await getAniListPopular(1, 30);
      if (fallbackPage.items.length > 0) {
        recordFallbackUsage('anilist');
        return {
          ok: true,
          fromCache: false,
          data: mapAniListMediaListToHoshikaItems(fallbackPage.items),
        };
      }
    } catch {
      // Fall through to original Hoshika error
    }
  }

  return res;
}

export async function getHoshikaBrowse(
  sort: 'trending' | 'recent' | 'top' = 'trending',
  type: string = 'anime',
  forceRefresh: boolean = false,
  locale: string = 'en'
): Promise<HoshikaAnimeItem[]> {
  const res = await getHoshikaBrowseDetailed(sort, type, forceRefresh, locale);
  return res.ok ? res.data : [];
}

/**
 * Paginated catalogue fetcher returning 30 items per logical page (`perPage = 30`).
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
    locale?: string;
  },
  forceRefresh: boolean = false
): Promise<StandardPaginatedResponse<HoshikaAnimeItem>> {
  const normalized = normalizeCatalogQuery(params);
  const safeLocale = (params.locale || 'en').trim() || 'en';
  const cacheKey = `${buildCatalogCacheKey(normalized)}:locale=${safeLocale}`;

  return appCache.getOrSet(
    cacheKey,
    async () => {
      const windowInfo = computeUpstreamWindowForPage(
        normalized.page,
        normalized.perPage,
        UPSTREAM_CATALOG_PAGE_SIZE
      );

      const buildUpstreamQuery = (upstreamPageNum: number) => {
        const searchParams = new URLSearchParams({
          type: 'anime',
          locale: safeLocale,
        });
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
        return HOSHIKA_ENDPOINTS.catalog(searchParams);
      };

      const fetchSingleUpstreamPage = async (upstreamPageNum: number) => {
        const ep = buildUpstreamQuery(upstreamPageNum);
        return fetchHoshikaCached<{
          items: HoshikaAnimeItem[];
          total?: number;
          hasMore?: boolean;
        }>({
          endpoint: ep,
          cacheKey: `hoshika:${ep}`,
          cacheTtlSeconds: 600,
          staleWhileRevalidateSeconds: 1200,
          forceRefresh,
          validator: validateHoshikaItemsPayload,
          mapper: (raw) => {
            const obj = raw as Record<string, any>;
            const items = mapHoshikaAnimeList(obj.items);
            cacheHoshikaSummaries(items);
            return {
              items,
              total: typeof obj.total === 'number' ? obj.total : undefined,
              hasMore:
                typeof obj.hasMore === 'boolean' ? obj.hasMore : undefined,
            };
          },
        });
      };

      const upstreamResponses: Array<
        Awaited<ReturnType<typeof fetchSingleUpstreamPage>>
      > = [];
      for (const upPage of windowInfo.upstreamPages) {
        if (isHoshikaCooldownActive() && upstreamResponses.length > 0) {
          break;
        }
        const r = await fetchSingleUpstreamPage(upPage);
        upstreamResponses.push(r);
        if (!r.ok && r.error.category === 'RATE_LIMITED') {
          break;
        }
      }

      const firstResponse = upstreamResponses[0];
      if (!firstResponse || !firstResponse.ok) {
        try {
          const fallbackPage = await getAniListCatalogFallback({
            q: normalized.q,
            genre: normalized.genre,
            format: normalized.format,
            status: normalized.status,
            year: normalized.year,
            season: normalized.season,
            sort: normalized.requestedSort,
            page: windowInfo.currentPage,
            perPage: windowInfo.perPage,
          });
          if (fallbackPage.items.length > 0) {
            recordFallbackUsage('anilist');
            const mappedItems = mapAniListMediaListToHoshikaItems(fallbackPage.items);
            const filtered = processCatalogItems(mappedItems, {
              requestedSort: normalized.requestedSort,
              minScore: normalized.minScore,
            });
            return buildPaginatedResponse({
              results: filtered,
              currentPage: windowInfo.currentPage,
              perPage: windowInfo.perPage,
              totalItems: Math.max(fallbackPage.total, filtered.length),
              hasNextPageFallback: fallbackPage.hasNextPage,
            });
          }
        } catch {
          // Fall through to original Hoshika error when AniList also fails
        }
        if (firstResponse && !firstResponse.ok) {
          throw new HoshikaUpstreamError(firstResponse.error);
        }
        throw new Error('Failed to fetch catalogue from upstream Hoshika API');
      }

      const reportedTotal =
        typeof firstResponse.data.total === 'number'
          ? firstResponse.data.total
          : 0;
      const maxUpstreamPage =
        reportedTotal > 0
          ? Math.max(1, Math.ceil(reportedTotal / UPSTREAM_CATALOG_PAGE_SIZE))
          : Infinity;

      const combinedRawItems: HoshikaAnimeItem[] = [];
      let lastValidUpstreamHasMore = false;

      for (let i = 0; i < windowInfo.upstreamPages.length; i++) {
        const upPageNum = windowInfo.upstreamPages[i];
        const resp = upstreamResponses[i];
        if (!resp || !resp.ok || upPageNum > maxUpstreamPage) {
          continue;
        }
        combinedRawItems.push(...resp.data.items);
        lastValidUpstreamHasMore = Boolean(resp.data.hasMore);
      }

      if (reportedTotal > 0 && windowInfo.startIndex >= reportedTotal) {
        return buildPaginatedResponse({
          results: [],
          currentPage: windowInfo.currentPage,
          perPage: windowInfo.perPage,
          totalItems: reportedTotal,
          hasNextPageFallback: false,
        });
      }

      const slicedWindow = combinedRawItems.slice(
        windowInfo.localOffset,
        windowInfo.localOffset + windowInfo.perPage
      );

      const dedupedWindow = deduplicateAnimeList([], slicedWindow);

      let pageResults = processCatalogItems(dedupedWindow, {
        requestedSort: normalized.requestedSort,
        minScore: normalized.minScore,
      });

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
        const nextRes = await fetchSingleUpstreamPage(scannedUpstreamPage);
        if (!nextRes.ok || nextRes.data.items.length === 0) {
          lastValidUpstreamHasMore = false;
          break;
        }
        const nextFiltered = processCatalogItems(nextRes.data.items, {
          requestedSort: normalized.requestedSort,
          minScore: normalized.minScore,
        });
        pageResults = deduplicateAnimeList(pageResults, nextFiltered).slice(
          0,
          windowInfo.perPage
        );
        lastValidUpstreamHasMore = Boolean(nextRes.data.hasMore);
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
      ttlSeconds: 600,
      staleWhileRevalidateSeconds: 1200,
      serveStaleOnError: true,
      forceRefresh,
      ...getHoshikaCacheErrorPolicy(),
    }
  );
}

/**
 * Paginated fetcher for Trending, Popular, and Recent pages (`perPage = 30`).
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

  const ttl = category === 'popular' ? 600 : 300;

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

      const defaultTotalItems = category === 'trending' ? 330 : 1000;

      const browseRes = await getHoshikaBrowseDetailed(
        browseSort,
        'anime',
        forceRefresh,
        'en'
      );
      if (!browseRes.ok) {
        if (category === 'trending' || category === 'popular') {
          const fallbackPage =
            category === 'trending'
              ? await getAniListTrending(currentPage, perPage).catch(() => null)
              : await getAniListPopular(currentPage, perPage).catch(() => null);
          if (fallbackPage && fallbackPage.items.length > 0) {
            recordFallbackUsage('anilist');
            const mapped = mapAniListMediaListToHoshikaItems(fallbackPage.items);
            return buildPaginatedResponse({
              results: mapped.slice(0, perPage),
              currentPage,
              perPage,
              totalItems: Math.max(fallbackPage.total, mapped.length),
              hasNextPageFallback: fallbackPage.hasNextPage,
            });
          }
        }
        throw new HoshikaUpstreamError(browseRes.error);
      }
      const browseItems = browseRes.data;
      if (browseItems.length === 0) {
        throw new HoshikaUpstreamError({
          category: 'INVALID_RESPONSE',
          status: 200,
          endpoint: `/browse?type=anime&sort=${browseSort}`,
          message: `Empty ${category} response from upstream Hoshika API`,
          retryable: true,
          durationMs: 0,
        });
      }

      const uniqueBrowse = deduplicateAnimeList([], browseItems);

      if (currentPage <= 2 && perPage === 30) {
        const startIdx = (currentPage - 1) * 30;
        const slice = uniqueBrowse.slice(startIdx, startIdx + 30);

        if (slice.length < 30) {
          const catPage1 = await fetchFromHoshika<{
            ok: boolean;
            items?: HoshikaAnimeItem[];
            total?: number;
          }>(`/catalog?${catalogQueryBase}`, ttl, forceRefresh);
          const merged = deduplicateAnimeList(
            uniqueBrowse,
            mapHoshikaAnimeList(catPage1?.items || [])
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

      const targetEndIndex = currentPage * perPage;
      const targetStartIndex = (currentPage - 1) * perPage;

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

          accumulated = deduplicateAnimeList(
            accumulated,
            mapHoshikaAnimeList(catData.items)
          );

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
      const responses: Array<{
        ok: boolean;
        items?: HoshikaAnimeItem[];
        total?: number;
        hasMore?: boolean;
      } | null> = [];
      for (const p of pagesToFetch) {
        if (isHoshikaCooldownActive() && responses.length > 0) {
          break;
        }
        const r = await fetchFromHoshika<{
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
        );
        responses.push(r);
        if (!r || isHoshikaCooldownActive()) {
          break;
        }
      }

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
          const mappedList = mapHoshikaAnimeList(r.items);
          cacheHoshikaSummaries(mappedList);
          rawCombined.push(...mappedList);
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
      serveStaleOnError: true,
      forceRefresh,
      ...getHoshikaCacheErrorPolicy(),
    }
  );
}

export async function getHoshikaScheduleDetailed(
  locale: string = 'en',
  forceRefresh: boolean = false
): Promise<HoshikaResult<ScheduleItem[]>> {
  const safeLocale = (locale || 'en').trim() || 'en';
  const endpoint = HOSHIKA_ENDPOINTS.schedule(safeLocale);
  return fetchHoshikaCached<ScheduleItem[]>({
    endpoint,
    cacheKey: `hoshika:/schedule?locale=${safeLocale}`,
    cacheTtlSeconds: 900,
    staleWhileRevalidateSeconds: 1800,
    forceRefresh,
    validator: validateHoshikaItemsPayload,
    mapper: (raw) => {
      const items = (raw as any).items;
      if (!Array.isArray(items)) return [];
      const mapped = items
        .map((item) => mapHoshikaScheduleItem(item))
        .filter((x): x is ScheduleItem => x !== null);
      cacheHoshikaSummaries(mapped);
      return mapped;
    },
  });
}

export async function getHoshikaSchedule(
  locale: string = 'en'
): Promise<ScheduleItem[]> {
  const res = await getHoshikaScheduleDetailed(locale);
  return res.ok ? res.data : [];
}

export async function getHoshikaGenresDetailed(
  forceRefresh: boolean = false
): Promise<HoshikaResult<string[]>> {
  const endpoint = HOSHIKA_ENDPOINTS.genres();
  return fetchHoshikaCached<string[]>({
    endpoint,
    cacheKey: 'hoshika:/genres',
    cacheTtlSeconds: 86400,
    staleWhileRevalidateSeconds: 86400,
    forceRefresh,
    validator: validateHoshikaGenresPayload,
    mapper: (raw) => {
      const base = Array.isArray((raw as any).genres)
        ? ((raw as any).genres as string[]).filter(
            (g) => typeof g === 'string' && g.trim().length > 0
          )
        : FALLBACK_BASE_GENRES;
      return Array.from(new Set([...base, ...EXTRA_SUPPORTED_THEMES])).sort((a, b) =>
        a.localeCompare(b)
      );
    },
  });
}

export async function getHoshikaGenres(): Promise<string[]> {
  const res = await getHoshikaGenresDetailed();
  if (res.ok) return res.data;
  return Array.from(
    new Set([...FALLBACK_BASE_GENRES, ...EXTRA_SUPPORTED_THEMES])
  ).sort((a, b) => a.localeCompare(b));
}

export async function getHoshikaGenreTitlesDetailed(
  slug: string,
  locale: string = 'en',
  forceRefresh: boolean = false
): Promise<HoshikaResult<HoshikaAnimeItem[]>> {
  const safeSlug = String(slug || '').trim().toLowerCase();
  const safeLocale = (locale || 'en').trim() || 'en';
  const endpoint = HOSHIKA_ENDPOINTS.genreTitles(safeSlug, safeLocale);
  return fetchHoshikaCached<HoshikaAnimeItem[]>({
    endpoint,
    cacheKey: `hoshika:/genre/${encodeURIComponent(safeSlug)}?type=anime&locale=${safeLocale}`,
    cacheTtlSeconds: 600,
    staleWhileRevalidateSeconds: 1200,
    forceRefresh,
    validator: validateHoshikaItemsPayload,
    mapper: (raw) => {
      const mapped = mapHoshikaAnimeList((raw as any).items);
      cacheHoshikaSummaries(mapped);
      return mapped;
    },
  });
}

export async function getHoshikaGenreTitles(
  slug: string,
  locale: string = 'en'
): Promise<HoshikaAnimeItem[]> {
  const res = await getHoshikaGenreTitlesDetailed(slug, locale);
  return res.ok ? res.data : [];
}

/**
 * Health probe helper using the centralized Hoshika client.
 * Respects active 429 cooldown instead of hammering Hoshika while rate-limited.
 */
export async function probeHoshikaHealth(): Promise<HoshikaResult<unknown>> {
  if (isHoshikaCooldownActive()) {
    const cooldown = getHoshikaCooldownState();
    return {
      ok: false,
      fromCache: false,
      error: {
        category: 'RATE_LIMITED',
        status: 429,
        endpoint: '/api/v1/home?locale=en',
        message: `Hoshika cooldown active (${Math.ceil(
          cooldown.remainingMs / 1000
        )}s remaining)`,
        retryable: true,
        retryAfterMs: cooldown.remainingMs,
        cooldownUntil: cooldown.cooldownUntil ?? undefined,
        durationMs: 0,
      },
    };
  }

  return executeHoshikaRequest({
    endpoint: HOSHIKA_ENDPOINTS.home('en'),
    maxAttempts: 1,
    timeoutMs: 6500,
    validator: validateHoshikaHomePayload,
  });
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
  if (
    shortId !== undefined &&
    shortId !== null &&
    String(shortId).trim() !== ''
  ) {
    const idStr = String(shortId).trim();
    count += appCache.invalidateByPrefix(`hoshika:/anime/${idStr}`);
    count += appCache.invalidateByPrefix(`hoshika:all_episodes:${idStr}:`);
    count += appCache.invalidateByPrefix(`id-map:v3:${idStr}`);
    count += appCache.invalidateByPrefix(`id-map:v4:${idStr}`);
  }
  if (includeCatalogAndHome) {
    count += appCache.invalidateByPrefix('hoshika:/home');
    count += appCache.invalidateByPrefix('hoshika:/browse');
    count += appCache.invalidateByPrefix('hoshika:/catalog');
    count += appCache.invalidateByPrefix('hoshika:/search');
    count += appCache.invalidateByPrefix('hoshika:/genre');
    count += appCache.invalidateByPrefix('hoshika:/schedule');
    count += appCache.invalidateByPrefix('catalog:');
    count += appCache.invalidateByPrefix('browse:paginated:');
  }
  return count;
}
