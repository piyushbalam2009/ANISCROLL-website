import { HoshikaAnimeItem } from '@/types/anime';

export const DEFAULT_PER_PAGE = 30;
export const UPSTREAM_CATALOG_PAGE_SIZE = 24;

export type ExploreSortOption =
  | 'top'
  | 'score'
  | 'popular'
  | 'trending'
  | 'recent'
  | 'newest'
  | 'title';

export type AnimeSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';

export interface ExploreFilterState {
  q?: string;
  genres?: string[];
  format?: string;
  status?: string;
  year?: string;
  season?: string;
  sort?: string;
  minScore?: number;
  page?: number;
  perPage?: number;
}

export interface NormalizedCatalogParams {
  q?: string;
  genre?: string;
  format?: string;
  status?: string;
  year?: string;
  season?: AnimeSeason;
  upstreamSort: 'score' | 'popular' | 'newest';
  requestedSort: ExploreSortOption;
  minScore?: number;
  page: number;
  perPage: number;
}

export interface StandardPaginatedResponse<T = HoshikaAnimeItem> {
  results: T[];
  items: T[];
  currentPage: number;
  page: number;
  perPage: number;
  totalPages: number | null;
  pages: number;
  total: number;
  hasNextPage: boolean;
  hasMore: boolean;
  hasPreviousPage: boolean;
}

const VALID_FORMATS = new Set([
  'TV',
  'TV_SHORT',
  'MOVIE',
  'OVA',
  'ONA',
  'SPECIAL',
  'MUSIC',
]);

const VALID_STATUSES = new Set([
  'FINISHED',
  'RELEASING',
  'NOT_YET_RELEASED',
  'CANCELLED',
  'HIATUS',
]);

const VALID_SEASONS = new Set<AnimeSeason>([
  'WINTER',
  'SPRING',
  'SUMMER',
  'FALL',
]);

/**
 * Sanitizes a raw page parameter into a safe 1-based integer.
 * Invalid, negative, zero, or non-numeric values fall back to 1.
 */
export function sanitizePageNumber(pageInput?: string | number | null): number {
  if (pageInput == null) return 1;
  const parsed =
    typeof pageInput === 'number'
      ? Math.floor(pageInput)
      : parseInt(String(pageInput).trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.min(parsed, 1000);
}

/**
 * Maps UI sort selections to a valid Hoshika `/catalog` sort value (`score` | `popular` | `newest`).
 * Note: Hoshika `/catalog` returns HTTP 400 `{ ok: false, code: 'invalid' }` if `sort=top`,
 * `sort=trending`, `sort=recent`, or `sort=title` is sent directly.
 */
export function resolveHoshikaCatalogSort(sort?: string | null): {
  upstreamSort: 'score' | 'popular' | 'newest';
  requestedSort: ExploreSortOption;
  inferredStatus?: string;
} {
  const raw = (sort || 'top').trim().toLowerCase();

  switch (raw) {
    case 'top':
    case 'score':
    case 'rating':
      return {
        upstreamSort: 'score',
        requestedSort: raw === 'score' ? 'score' : 'top',
      };
    case 'popular':
    case 'popularity':
      return { upstreamSort: 'popular', requestedSort: 'popular' };
    case 'trending':
      // Trending across filtered catalogue: use score-ordered active/high-engagement catalogue
      return { upstreamSort: 'score', requestedSort: 'trending' };
    case 'recent':
    case 'updated':
      return { upstreamSort: 'newest', requestedSort: 'recent' };
    case 'newest':
      return { upstreamSort: 'newest', requestedSort: 'newest' };
    case 'title':
    case 'az':
      return { upstreamSort: 'score', requestedSort: 'title' };
    default:
      return { upstreamSort: 'score', requestedSort: 'top' };
  }
}

/**
 * Parses and normalizes comma-separated or array genre values, removing blanks and duplicates.
 */
export function parseGenresParam(
  genreInput?: string | string[] | null
): string[] {
  if (!genreInput) return [];
  const rawList = Array.isArray(genreInput)
    ? genreInput.flatMap((g) => String(g).split(','))
    : String(genreInput).split(',');

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of rawList) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(trimmed);
    }
  }

  return result;
}

/**
 * Normalizes Explore filter state into clean, deterministic parameters for Hoshika `/catalog`.
 */
export function normalizeCatalogQuery(input: {
  q?: string | null;
  genre?: string | string[] | null;
  format?: string | null;
  status?: string | null;
  year?: string | number | null;
  season?: string | null;
  sort?: string | null;
  minScore?: string | number | null;
  page?: string | number | null;
  perPage?: string | number | null;
}): NormalizedCatalogParams {
  const q = input.q?.trim() || undefined;
  const genres = parseGenresParam(input.genre);
  const genre = genres.length > 0 ? genres.join(',') : undefined;

  const rawFormat = input.format?.trim().toUpperCase();
  const format =
    rawFormat && VALID_FORMATS.has(rawFormat) ? rawFormat : undefined;

  const rawStatus = input.status?.trim().toUpperCase();
  const status =
    rawStatus && VALID_STATUSES.has(rawStatus) ? rawStatus : undefined;

  const rawYear = input.year != null ? String(input.year).trim() : '';
  const parsedYear = rawYear ? parseInt(rawYear, 10) : NaN;
  const year =
    Number.isFinite(parsedYear) && parsedYear >= 1950 && parsedYear <= 2030
      ? String(parsedYear)
      : undefined;

  const rawSeason = input.season?.trim().toUpperCase() as
    | AnimeSeason
    | undefined;
  const season =
    rawSeason && VALID_SEASONS.has(rawSeason) ? rawSeason : undefined;

  const { upstreamSort, requestedSort } = resolveHoshikaCatalogSort(input.sort);

  const rawMinScore = input.minScore != null ? Number(input.minScore) : NaN;
  const minScore =
    Number.isFinite(rawMinScore) && rawMinScore > 0 && rawMinScore <= 100
      ? rawMinScore
      : undefined;

  const page = sanitizePageNumber(input.page);
  const rawPerPage =
    input.perPage != null ? parseInt(String(input.perPage), 10) : DEFAULT_PER_PAGE;
  const perPage =
    Number.isFinite(rawPerPage) && rawPerPage >= 1 && rawPerPage <= 60
      ? rawPerPage
      : DEFAULT_PER_PAGE;

  return {
    q,
    genre,
    format,
    status,
    year,
    season,
    upstreamSort,
    requestedSort,
    minScore,
    page,
    perPage,
  };
}

/**
 * Builds a deterministic cache key for a catalogue query & page.
 */
export function buildCatalogCacheKey(params: NormalizedCatalogParams): string {
  return [
    'catalog:v3',
    `q=${(params.q || '').toLowerCase()}`,
    `genre=${(params.genre || '').toLowerCase()}`,
    `format=${params.format || ''}`,
    `status=${params.status || ''}`,
    `year=${params.year || ''}`,
    `season=${params.season || ''}`,
    `sort=${params.requestedSort}:${params.upstreamSort}`,
    `minScore=${params.minScore ?? ''}`,
    `page=${params.page}`,
    `perPage=${params.perPage}`,
  ].join('|');
}

/**
 * Computes which upstream 24-item Hoshika `/catalog` pages are needed to assemble
 * an exact 30-item logical page (`perPage = 30`) without duplicates or gaps.
 *
 * Example (`perPage = 30`, `upstreamPageSize = 24`):
 * - Page 1 (items 0..29)  -> upstream pages [1, 2], localOffset = 0
 * - Page 2 (items 30..59) -> upstream pages [2, 3], localOffset = 6
 * - Page 3 (items 60..89) -> upstream pages [3, 4], localOffset = 12
 * - Page 4 (items 90..119)-> upstream pages [4, 5], localOffset = 18
 * - Page 5 (items 120..149)-> upstream pages [6, 7], localOffset = 0
 */
export function computeUpstreamWindowForPage(
  page: number,
  perPage: number = DEFAULT_PER_PAGE,
  upstreamPageSize: number = UPSTREAM_CATALOG_PAGE_SIZE
): {
  currentPage: number;
  perPage: number;
  startIndex: number;
  endIndex: number;
  firstUpstreamPage: number;
  lastUpstreamPage: number;
  upstreamPages: number[];
  localOffset: number;
} {
  const currentPage = sanitizePageNumber(page);
  const safePerPage = Math.max(1, Math.floor(perPage || DEFAULT_PER_PAGE));
  const safeUpstreamSize = Math.max(1, Math.floor(upstreamPageSize || UPSTREAM_CATALOG_PAGE_SIZE));

  const startIndex = (currentPage - 1) * safePerPage;
  const endIndex = currentPage * safePerPage;

  const firstUpstreamPage = Math.floor(startIndex / safeUpstreamSize) + 1;
  const lastUpstreamPage = Math.floor((endIndex - 1) / safeUpstreamSize) + 1;

  const upstreamPages: number[] = [];
  for (let p = firstUpstreamPage; p <= lastUpstreamPage; p++) {
    upstreamPages.push(p);
  }

  const localOffset = startIndex - (firstUpstreamPage - 1) * safeUpstreamSize;

  return {
    currentPage,
    perPage: safePerPage,
    startIndex,
    endIndex,
    firstUpstreamPage,
    lastUpstreamPage,
    upstreamPages,
    localOffset,
  };
}

/**
 * Builds the standardized pagination response object with both the requested
 * fields (`results`, `currentPage`, `perPage`, `totalPages`, `hasNextPage`, `hasPreviousPage`)
 * and backward-compatible fields (`items`, `page`, `pages`, `total`, `hasMore`).
 */
export function buildPaginatedResponse<T = HoshikaAnimeItem>(input: {
  results: T[];
  currentPage: number;
  perPage?: number;
  totalItems?: number | null;
  hasNextPageFallback?: boolean;
}): StandardPaginatedResponse<T> {
  const currentPage = sanitizePageNumber(input.currentPage);
  const perPage = input.perPage || DEFAULT_PER_PAGE;
  const results = Array.isArray(input.results) ? input.results : [];

  const hasKnownTotal =
    typeof input.totalItems === 'number' &&
    Number.isFinite(input.totalItems) &&
    input.totalItems >= 0;

  const total = hasKnownTotal ? Math.max(input.totalItems!, results.length) : results.length;
  const computedTotalPages = hasKnownTotal
    ? Math.max(1, Math.ceil(total / perPage))
    : null;

  const hasNextPage =
    computedTotalPages !== null
      ? currentPage < computedTotalPages && results.length > 0
      : Boolean(input.hasNextPageFallback) && results.length >= perPage;

  const hasPreviousPage = currentPage > 1;

  return {
    results,
    items: results,
    currentPage,
    page: currentPage,
    perPage,
    totalPages: computedTotalPages,
    pages: computedTotalPages ?? (hasNextPage ? currentPage + 1 : currentPage),
    total,
    hasNextPage,
    hasMore: hasNextPage,
    hasPreviousPage,
  };
}

/**
 * Generates the numbered page sequence and `'ellipsis'` markers for pagination UI.
 * Example for currentPage=1, totalPages=20: [1, 2, 3, 4, 5, 'ellipsis', 20]
 * Example for currentPage=10, totalPages=20: [1, 'ellipsis', 9, 10, 11, 'ellipsis', 20]
 */
export function generatePaginationRange(
  currentPage: number,
  totalPages: number | null,
  hasNextPage: boolean = false
): Array<number | 'ellipsis'> {
  const safeCurrent = sanitizePageNumber(currentPage);
  const effectiveTotal =
    typeof totalPages === 'number' && totalPages >= 1
      ? Math.max(totalPages, safeCurrent)
      : hasNextPage
        ? safeCurrent + 1
        : safeCurrent;

  if (effectiveTotal <= 7) {
    return Array.from({ length: effectiveTotal }, (_, i) => i + 1);
  }

  if (safeCurrent <= 4) {
    return [1, 2, 3, 4, 5, 'ellipsis', effectiveTotal];
  }

  if (safeCurrent >= effectiveTotal - 3) {
    return [
      1,
      'ellipsis',
      effectiveTotal - 4,
      effectiveTotal - 3,
      effectiveTotal - 2,
      effectiveTotal - 1,
      effectiveTotal,
    ];
  }

  return [
    1,
    'ellipsis',
    safeCurrent - 1,
    safeCurrent,
    safeCurrent + 1,
    'ellipsis',
    effectiveTotal,
  ];
}

/**
 * Deduplicates anime items by `shortId` (and `id` / `anilistId` fallback),
 * preserving existing order and merging new items cleanly across pagination batches.
 */
export function deduplicateAnimeList(
  existing: HoshikaAnimeItem[],
  incoming: HoshikaAnimeItem[]
): HoshikaAnimeItem[] {
  const seenShortIds = new Set<number | string>();
  const seenIds = new Set<string>();
  const result: HoshikaAnimeItem[] = [];

  const addItem = (item: HoshikaAnimeItem) => {
    if (!item || typeof item !== 'object') return;
    const shortKey = item.shortId != null ? String(item.shortId) : null;
    const idKey = item.id ? String(item.id) : null;

    if (shortKey && seenShortIds.has(shortKey)) return;
    if (idKey && seenIds.has(idKey)) return;

    if (shortKey) seenShortIds.add(shortKey);
    if (idKey) seenIds.add(idKey);
    result.push(item);
  };

  for (const item of existing) addItem(item);
  for (const item of incoming) addItem(item);

  return result;
}

/**
 * Applies optional client-side post-filters (such as minScore) or post-sorting (such as alphabetical title sort
 * or cleaning unranked null-score entries when sorting by popularity) to a catalogue batch.
 */
export function processCatalogItems(
  items: HoshikaAnimeItem[],
  options: {
    requestedSort?: ExploreSortOption;
    minScore?: number;
  }
): HoshikaAnimeItem[] {
  let list = Array.isArray(items) ? [...items] : [];

  if (options.minScore != null && options.minScore > 0) {
    list = list.filter(
      (item) =>
        typeof item.averageScore === 'number' &&
        item.averageScore >= options.minScore!
    );
  }

  if (options.requestedSort === 'title') {
    list.sort((a, b) => {
      const titleA = (
        a.titleEnglish ||
        a.titleRomaji ||
        a.titleLocalized ||
        ''
      ).toLowerCase();
      const titleB = (
        b.titleEnglish ||
        b.titleRomaji ||
        b.titleLocalized ||
        ''
      ).toLowerCase();
      return titleA.localeCompare(titleB);
    });
  } else if (
    options.requestedSort === 'popular' ||
    options.requestedSort === 'recent' ||
    options.requestedSort === 'newest'
  ) {
    // Place items with valid cover images and scores/synopses ahead of unindexed null-score promotional entries within the batch
    list.sort((a, b) => {
      const aHasScore =
        typeof a.averageScore === 'number' && a.averageScore > 0 ? 1 : 0;
      const bHasScore =
        typeof b.averageScore === 'number' && b.averageScore > 0 ? 1 : 0;
      if (aHasScore !== bHasScore) return bHasScore - aHasScore;
      return (b.averageScore || 0) - (a.averageScore || 0);
    });
  }

  return list;
}
