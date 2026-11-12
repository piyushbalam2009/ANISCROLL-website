import { HoshikaAnimeItem } from '@/types/anime';

export type ExploreSortOption =
  | 'top'
  | 'score'
  | 'popular'
  | 'trending'
  | 'recent'
  | 'newest'
  | 'title';

export interface ExploreFilterState {
  q?: string;
  genres?: string[];
  format?: string;
  status?: string;
  year?: string;
  sort?: string;
  minScore?: number;
  page?: number;
}

export interface NormalizedCatalogParams {
  q?: string;
  genre?: string;
  format?: string;
  status?: string;
  year?: string;
  upstreamSort: 'score' | 'popular' | 'newest';
  requestedSort: ExploreSortOption;
  minScore?: number;
  page: number;
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
      return { upstreamSort: 'score', requestedSort: raw === 'score' ? 'score' : 'top' };
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
export function parseGenresParam(genreInput?: string | string[] | null): string[] {
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
  sort?: string | null;
  minScore?: string | number | null;
  page?: string | number | null;
}): NormalizedCatalogParams {
  const q = input.q?.trim() || undefined;
  const genres = parseGenresParam(input.genre);
  const genre = genres.length > 0 ? genres.join(',') : undefined;

  const rawFormat = input.format?.trim().toUpperCase();
  const format = rawFormat && VALID_FORMATS.has(rawFormat) ? rawFormat : undefined;

  const rawStatus = input.status?.trim().toUpperCase();
  let status = rawStatus && VALID_STATUSES.has(rawStatus) ? rawStatus : undefined;

  const rawYear = input.year != null ? String(input.year).trim() : '';
  const parsedYear = rawYear ? parseInt(rawYear, 10) : NaN;
  const year =
    Number.isFinite(parsedYear) && parsedYear >= 1950 && parsedYear <= 2030
      ? String(parsedYear)
      : undefined;

  const { upstreamSort, requestedSort } = resolveHoshikaCatalogSort(input.sort);

  // When user selects "Trending" or "Recently Updated" without an explicit status filter,
  // default to RELEASING if sorting by trending/recent so airing shows surface across the catalogue,
  // unless the user explicitly chose another status or year.
  if (!status && !year && !q && requestedSort === 'trending') {
    status = undefined; // keep full catalogue available when filtering by genres/formats
  }

  const rawMinScore = input.minScore != null ? Number(input.minScore) : NaN;
  const minScore =
    Number.isFinite(rawMinScore) && rawMinScore > 0 && rawMinScore <= 100
      ? rawMinScore
      : undefined;

  const rawPage = input.page != null ? parseInt(String(input.page), 10) : 1;
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  return {
    q,
    genre,
    format,
    status,
    year,
    upstreamSort,
    requestedSort,
    minScore,
    page,
  };
}

/**
 * Builds a deterministic cache key for a catalogue query & page.
 */
export function buildCatalogCacheKey(params: NormalizedCatalogParams): string {
  return [
    'catalog:v2',
    `q=${(params.q || '').toLowerCase()}`,
    `genre=${(params.genre || '').toLowerCase()}`,
    `format=${params.format || ''}`,
    `status=${params.status || ''}`,
    `year=${params.year || ''}`,
    `sort=${params.requestedSort}:${params.upstreamSort}`,
    `minScore=${params.minScore ?? ''}`,
    `page=${params.page}`,
  ].join('|');
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
        typeof item.averageScore === 'number' && item.averageScore >= options.minScore!
    );
  }

  if (options.requestedSort === 'title') {
    list.sort((a, b) => {
      const titleA = (a.titleEnglish || a.titleRomaji || a.titleLocalized || '').toLowerCase();
      const titleB = (b.titleEnglish || b.titleRomaji || b.titleLocalized || '').toLowerCase();
      return titleA.localeCompare(titleB);
    });
  } else if (options.requestedSort === 'popular' || options.requestedSort === 'recent' || options.requestedSort === 'newest') {
    // Place items with valid cover images and scores/synopses ahead of unindexed null-score promotional entries within the batch
    list.sort((a, b) => {
      const aHasScore = typeof a.averageScore === 'number' && a.averageScore > 0 ? 1 : 0;
      const bHasScore = typeof b.averageScore === 'number' && b.averageScore > 0 ? 1 : 0;
      if (aHasScore !== bHasScore) return bHasScore - aHasScore;
      return (b.averageScore || 0) - (a.averageScore || 0);
    });
  }

  return list;
}
