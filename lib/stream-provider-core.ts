import { AnimeContentFormat, StreamingProvider } from '@/types/streaming';

export const ANISCROLL_API_ORIGIN = (process.env.ANIVAULT_API_ORIGIN || 'https://anivault-scraper-five.vercel.app').replace(/\/+$/, '');

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
  if (params.isStandaloneMovie === true) return true;
  return false;
}

/**
 * Centralized, deterministic streaming provider router:
 * - Anime movies (`MOVIE`, or explicitly flagged `isStandaloneMovie`) -> `zokoanime`
 * - Anime series (`TV`, `TV_SHORT`, `OVA`, `ONA`, `SPECIAL`) -> `megaplay`
 * - Unknown / missing format -> `zokoanime` (safe default so a movie is never accidentally routed to MegaPlay)
 */
export function selectStreamingProvider(params: {
  format?: string | null;
  isStandaloneMovie?: boolean;
}): StreamingProvider {
  const normalized = normalizeAnimeFormat(params.format);

  if (normalized === 'MOVIE' || params.isStandaloneMovie === true) {
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
 * Builds the upstream AniVault private API watch endpoint. IDs passed to this
 * API are MAL IDs (encoded as `mal-{id}`), not AniList IDs. The server-side
 * client attaches ANIVAULT_API_KEY; this helper only builds the URL.
 */
export function buildProviderWatchUrl(
  provider: StreamingProvider,
  malId: number,
  episode: number,
  type: 'sub' | 'dub'
): string {
  const normalizedType = type === 'dub' ? 'dub' : 'sub';
  const safeMalId = Math.floor(Number(malId));
  const safeEpisode = Math.floor(Number(episode));
  return `${ANISCROLL_API_ORIGIN}/api/watch/${provider}/mal-${safeMalId}/${safeEpisode}/${normalizedType}`;
}
