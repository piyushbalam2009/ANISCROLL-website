import { AnimeContentFormat, StreamingProvider } from '@/types/streaming';

export const ANISCROLL_API_ORIGIN = 'https://api.aniscroll.in';

const SERIES_FORMATS = new Set<AnimeContentFormat>([
  'TV',
  'TV_SHORT',
  'OVA',
  'ONA',
  'SPECIAL',
]);

/**
 * Normalizes raw format strings from Hoshika or AniList metadata into canonical AnimeContentFormat values.
 * Does NOT infer format from title keywords or episode count.
 */
export function normalizeAnimeFormat(
  rawFormat: string | null | undefined
): AnimeContentFormat {
  if (typeof rawFormat !== 'string') return 'UNKNOWN';
  const normalized = rawFormat.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!normalized) return 'UNKNOWN';

  if (normalized === 'TV' || normalized === 'TV_SERIES' || normalized === 'SERIES') {
    return 'TV';
  }
  if (normalized === 'TV_SHORT') {
    return 'TV_SHORT';
  }
  if (normalized === 'MOVIE' || normalized === 'FILM' || normalized === 'THEATRICAL') {
    return 'MOVIE';
  }
  if (normalized === 'OVA') return 'OVA';
  if (normalized === 'ONA') return 'ONA';
  if (normalized === 'SPECIAL' || normalized === 'TV_SPECIAL') return 'SPECIAL';
  if (normalized === 'MUSIC') return 'MUSIC';

  return 'UNKNOWN';
}

/**
 * Determines whether an anime item represents movie content based strictly on its metadata format
 * (plus an optional explicit standalone-movie marker for SPECIAL entries).
 */
export function isMovieContent(params: {
  format?: string | null;
  isStandaloneMovie?: boolean;
}): boolean {
  const normalized = normalizeAnimeFormat(params.format);
  if (normalized === 'MOVIE') return true;
  if (normalized === 'SPECIAL' && params.isStandaloneMovie === true) return true;
  return false;
}

/**
 * Centralized, deterministic streaming provider router:
 * - Anime movies (`MOVIE`, or `SPECIAL` explicitly flagged as standalone movie) -> `zokoanime`
 * - Anime series (`TV`, `TV_SHORT`, `OVA`, `ONA`, `SPECIAL`) -> `megaplay`
 * - Unknown / missing format -> `zokoanime` (safe default so a movie is never accidentally routed to MegaPlay)
 */
export function selectStreamingProvider(params: {
  format?: string | null;
  isStandaloneMovie?: boolean;
}): StreamingProvider {
  const normalized = normalizeAnimeFormat(params.format);

  if (normalized === 'MOVIE') {
    return 'zokoanime';
  }

  if (normalized === 'SPECIAL' && params.isStandaloneMovie === true) {
    return 'zokoanime';
  }

  if (SERIES_FORMATS.has(normalized)) {
    return 'megaplay';
  }

  // Safe fallback for UNKNOWN / MUSIC / missing format: keep on ZokoAnime rather than risking MegaPlay for a movie.
  return 'zokoanime';
}

export function getStreamingProviderDisplayName(
  provider: StreamingProvider
): 'MegaPlay' | 'ZokoAnime' {
  return provider === 'megaplay' ? 'MegaPlay' : 'ZokoAnime';
}

/**
 * Builds the upstream AniScroll provider watch endpoint:
 * - MegaPlay:  https://api.aniscroll.in/api/watch/megaplay/{anilist_id}/{episode}/{sub|dub}
 * - ZokoAnime: https://api.aniscroll.in/api/watch/zokoanime/{anilist_id}/{episode}/{sub|dub}
 */
export function buildProviderWatchUrl(
  provider: StreamingProvider,
  anilistId: number,
  episode: number,
  type: 'sub' | 'dub'
): string {
  const normalizedType = type === 'dub' ? 'dub' : 'sub';
  const safeAnilistId = Math.floor(Number(anilistId));
  const safeEpisode = Math.floor(Number(episode));
  return `${ANISCROLL_API_ORIGIN}/api/watch/${provider}/${safeAnilistId}/${safeEpisode}/${normalizedType}`;
}
