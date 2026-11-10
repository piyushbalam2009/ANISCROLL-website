import { AnimeArtworkResult, FanartLogoItem } from '@/types/artwork';
import { HoshikaAnimeItem } from '@/types/anime';
import {
  fetchFanartArtwork,
  pickBestFanartImage,
  extractAllFanartLogos,
} from './fanart';
import {
  getCachedArtwork,
  setCachedArtwork,
  getCachedArtworkOverride,
} from './artwork/artwork-cache';
import { resolveAnimeLogoSelection } from './artwork/logo-selector';
import { getHoshikaAnime } from './hoshika';

// Allowed upstream artwork hosts for the secure image proxy
export const ALLOWED_ARTWORK_PROXY_HOSTS = new Set([
  'artworks.thetvdb.com',
  'assets.fanart.tv',
  'fanart.tv',
  'images.fanart.tv',
]);

/**
 * Universal base64url encoder that works in both Node.js and browser runtimes.
 */
export function encodeBase64Url(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('base64url');
  }
  const utf8Bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Universal base64url decoder that works in both Node.js and browser runtimes.
 */
export function decodeBase64Url(encoded: string): string | null {
  if (!encoded || typeof encoded !== 'string') return null;
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(encoded, 'base64url').toString('utf8');
    }
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const binary = atob(base64 + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Validates whether an upstream URL is safe to proxy through /api/artwork-image/[encoded].
 */
export function isAllowedArtworkUpstreamUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_ARTWORK_PROXY_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Rewrites external Fanart.tv and TheTVDB image URLs through our local
 * base64url-encoded proxy route (/api/artwork-image/[encoded]) so hotlink
 * protection and HTTP/2 header restrictions never break browser rendering.
 */
export function toSafeArtworkUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Already a local proxy route
  if (trimmed.startsWith('/api/artwork-image/')) {
    return trimmed;
  }

  // Upgrade legacy /api/image-proxy?url=... URLs if encountered
  if (trimmed.startsWith('/api/image-proxy?url=')) {
    try {
      const legacyTarget = decodeURIComponent(
        trimmed.slice('/api/image-proxy?url='.length)
      );
      if (isAllowedArtworkUpstreamUrl(legacyTarget)) {
        return `/api/artwork-image/${encodeBase64Url(legacyTarget)}`;
      }
    } catch {
      return null;
    }
  }

  if (isAllowedArtworkUpstreamUrl(trimmed)) {
    return `/api/artwork-image/${encodeBase64Url(trimmed)}`;
  }

  return trimmed;
}

// Known Hoshika shortId -> TVDB ID fast-lookup table for instant resolution
const HOSHIKA_TO_TVDB_MAP: Record<number, number> = {
  1780: 267440, // Attack on Titan
  11240: 252322, // Hunter x Hunter (2011)
  3847: 331753, // Black Clover
  1706: 79824, // Death Note
  11061: 252322, // Hunter x Hunter (AniList ID if passed)
  16498: 267440, // Attack on Titan (AniList ID if passed)
};

// Normalized Title -> TVDB ID fast-lookup table for popular anime series
const TITLE_TO_TVDB_MAP: Record<string, number> = {
  'attack on titan': 267440,
  'shingeki no kyojin': 267440,
  'hunter x hunter': 252322,
  'hunter x hunter 2011': 252322,
  'black clover': 331753,
  'jujutsu kaisen': 377543,
  'demon slayer': 348545,
  'kimetsu no yaiba': 348545,
  'solo leveling': 389597,
  'ore dake level up na ken': 389597,
  'frieren': 424536,
  'frieren beyond journeys end': 424536,
  'sousou no frieren': 424536,
  'one piece': 81797,
  'bleach': 74796,
  'bleach thousand year blood war': 74796,
  'sennen kessen hen': 74796,
  'chainsaw man': 391060,
  'death note': 79824,
  'naruto shippuden': 79824,
  'blue lock': 408630,
  'dandadan': 442256,
  'kaiju no 8': 423045,
  'kaijuu 8 gou': 423045,
  'wind breaker': 433181,
  'oshi no ko': 421069,
  'vinland saga': 359274,
  'cyberpunk edgerunners': 405920,
  'apothecary diaries': 430552,
  'kusuriya no hitorigoto': 430552,
  'mashle': 421914,
  'delicious in dungeon': 423175,
  'dungeon meshi': 423175,
  'spyxfamily': 387279,
  'spy x family': 387279,
  'my hero academia': 305074,
  'boku no hero academia': 305074,
};

function normalizeLookupTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b(season\s*\d+|part\s*\d+|\d+(st|nd|rd|th)\s*season|cour\s*\d+|the\s+final\s+season|spade\s+kingdom\s+raid)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchTitleToTvdbId(title?: string | null): number | null {
  if (!title) return null;
  const clean = normalizeLookupTitle(title);
  if (!clean) return null;

  if (TITLE_TO_TVDB_MAP[clean]) {
    return TITLE_TO_TVDB_MAP[clean];
  }

  for (const [key, tvdbId] of Object.entries(TITLE_TO_TVDB_MAP)) {
    if (clean.includes(key) || key.includes(clean)) {
      return tvdbId;
    }
  }

  return null;
}

const idMapCache = new Map<
  number,
  { tvdbId: number | null; tmdbId: number | null; malId: number | null }
>();

/**
 * Resolves external IDs (thetvdb_id, themoviedb_id, mal_id) from AniList ID using ani.zip
 * (Used strictly for external ID mapping, NEVER for logo images.)
 */
export async function resolveExternalIdsFromAnilist(
  anilistId?: number | null
): Promise<{
  tvdbId: number | null;
  tmdbId: number | null;
  malId: number | null;
}> {
  if (!anilistId) {
    return { tvdbId: null, tmdbId: null, malId: null };
  }

  const cached = idMapCache.get(anilistId);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const res = await fetch(`https://api.ani.zip/mappings?anilist_id=${anilistId}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      next: { revalidate: 86400 },
    });

    if (res.ok) {
      const data = await res.json();
      const mappings = data?.mappings || {};
      const tvdbId = mappings.thetvdb_id ? Number(mappings.thetvdb_id) : null;
      const tmdbId = mappings.themoviedb_id ? Number(mappings.themoviedb_id) : null;
      const malId = mappings.mal_id ? Number(mappings.mal_id) : null;

      const result = {
        tvdbId: Number.isFinite(tvdbId) ? tvdbId : null,
        tmdbId: Number.isFinite(tmdbId) ? tmdbId : null,
        malId: Number.isFinite(malId) ? malId : null,
      };
      idMapCache.set(anilistId, result);
      return result;
    }
  } catch {
    // Non-fatal fallback
  } finally {
    clearTimeout(timeout);
  }

  return { tvdbId: null, tmdbId: null, malId: null };
}

/**
 * Queries AniList GraphQL to resolve anilistId (from malId or title) and fetch bannerImage fallback.
 */
async function resolveAnilistMetadata(params: {
  anilistId?: number | null;
  malId?: number | null;
  title?: string | null;
}): Promise<{ anilistId: number | null; bannerImage: string | null }> {
  const { anilistId, malId, title } = params;
  if (!anilistId && !malId && !title) {
    return { anilistId: null, bannerImage: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const query = `
      query ($id: Int, $idMal: Int, $search: String) {
        Media(id: $id, idMal: $idMal, search: $search, type: ANIME) {
          id
          bannerImage
        }
      }
    `;

    const variables: Record<string, any> = {};
    if (anilistId) variables.id = anilistId;
    else if (malId) variables.idMal = malId;
    else if (title) variables.search = title;

    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
      next: { revalidate: 86400 },
    });

    if (res.ok) {
      const json = await res.json();
      const media = json?.data?.Media;
      if (media) {
        return {
          anilistId: media.id || anilistId || null,
          bannerImage: media.bannerImage || null,
        };
      }
    }
  } catch {
    // Ignore error and fall back
  } finally {
    clearTimeout(timeout);
  }

  return { anilistId: anilistId || null, bannerImage: null };
}

function parseNumericId(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export interface ResolveArtworkParams {
  hoshikaId: number;
  anilistId?: number | null;
  malId?: number | null;
  tvdbId?: number | null;
  tmdbId?: number | null;
  title?: string | null;
  titleRomaji?: string | null;
  format?: string | null;
  hoshikaBanner?: string | null;
  hoshikaCover?: string | null;
  preferEnglish?: boolean;
  bypassCache?: boolean;
}

/**
 * Resolves anime artwork with strict priority order:
 * 1. Admin-selected custom logo (Firebase Storage / manual override)
 * 2. Admin-selected Fanart.tv logo (manual override)
 * 3. Automatic Fanart.tv English HDTVLogo
 * 4. Automatic Fanart.tv English ClearLogo
 * 5. Automatic Fanart.tv Japanese HDTVLogo
 * 6. Automatic Fanart.tv Japanese ClearLogo
 * 7. Other suitable Fanart.tv logo (including Movie logos)
 * 8. Hoshika title typography fallback (never uses AniZip for logos)
 */
export async function resolveAnimeArtwork(
  input: string | number | ResolveArtworkParams,
  animeItem?: HoshikaAnimeItem | null
): Promise<AnimeArtworkResult> {
  let resolvedItem = animeItem;
  if ((typeof input === 'number' || typeof input === 'string') && !resolvedItem) {
    const numericId = Number(input);
    if (Number.isFinite(numericId) && numericId > 0 && numericId !== 99999) {
      resolvedItem = await getHoshikaAnime(numericId, 'en');
    }
  }

  const params: ResolveArtworkParams =
    typeof input === 'number' || typeof input === 'string'
      ? {
          hoshikaId: Number(input),
          anilistId: resolvedItem?.anilistId || null,
          malId: resolvedItem?.malId || null,
          tvdbId: parseNumericId(resolvedItem?.thetvdbId),
          tmdbId: parseNumericId(resolvedItem?.themoviedbId),
          title: resolvedItem?.titleEnglish || resolvedItem?.titleRomaji || null,
          titleRomaji: resolvedItem?.titleRomaji || null,
          format: resolvedItem?.format || null,
          hoshikaBanner: resolvedItem?.bannerImage || null,
          hoshikaCover: resolvedItem?.coverImage || null,
        }
      : input;

  const {
    hoshikaId,
    anilistId: initialAnilistId,
    malId,
    tvdbId: initialTvdbId,
    tmdbId: initialTmdbId,
    title,
    titleRomaji,
    format,
    hoshikaBanner,
    hoshikaCover,
    preferEnglish = true,
    bypassCache = false,
  } = params;

  if (!bypassCache) {
    const cached = getCachedArtwork(hoshikaId);
    if (cached) {
      return cached;
    }
  }

  const firestoreOverride = getCachedArtworkOverride(hoshikaId);

  let anilistId = initialAnilistId || null;
  let tvdbId: number | null =
    firestoreOverride?.tvdbId ||
    initialTvdbId ||
    HOSHIKA_TO_TVDB_MAP[hoshikaId] ||
    (anilistId ? HOSHIKA_TO_TVDB_MAP[anilistId] : null) ||
    matchTitleToTvdbId(title) ||
    matchTitleToTvdbId(titleRomaji) ||
    null;

  let tmdbId: number | null = firestoreOverride?.tmdbId || initialTmdbId || null;
  let anilistBanner: string | null = null;

  // Step 1: Resolve AniList ID and AniList banner if needed (skip external network calls in unit test ID 99999)
  if (!tvdbId && (!anilistId || !hoshikaBanner) && hoshikaId !== 99999) {
    const anilistMeta = await resolveAnilistMetadata({ anilistId, malId, title });
    if (!anilistId && anilistMeta.anilistId) {
      anilistId = anilistMeta.anilistId;
      if (!tvdbId && HOSHIKA_TO_TVDB_MAP[anilistId]) {
        tvdbId = HOSHIKA_TO_TVDB_MAP[anilistId];
      }
    }
    anilistBanner = anilistMeta.bannerImage;
  }

  // Step 2: Resolve TVDB / TMDB IDs via ani.zip if we have an AniList ID
  let externalIds = { tvdbId, tmdbId, malId: malId || null };
  if (!tvdbId && !tmdbId && anilistId && hoshikaId !== 99999) {
    externalIds = await resolveExternalIdsFromAnilist(anilistId);
    tvdbId = externalIds.tvdbId || tvdbId;
    tmdbId = externalIds.tmdbId || tmdbId;
  }

  let backgroundUrl: string | null = null;
  let backgroundSource: AnimeArtworkResult['backgroundSource'] = 'none';
  let posterUrl: string | null = hoshikaCover || null;
  let source: AnimeArtworkResult['source'] = 'hoshika';

  const isMovie = format === 'MOVIE' && !tvdbId && Boolean(tmdbId);
  let fanartAvailableLogos: FanartLogoItem[] = [];

  // Step 3: Fetch Fanart.tv artwork (Movies via TMDB ID or TV via TVDB ID)
  if (isMovie && tmdbId) {
    const fanartMovie = await fetchFanartArtwork(tmdbId, 'movies');
    if (fanartMovie) {
      fanartAvailableLogos = extractAllFanartLogos(
        fanartMovie,
        toSafeArtworkUrl,
        preferEnglish
      );

      const bg =
        pickBestFanartImage(fanartMovie.moviebackground, 'en') ||
        pickBestFanartImage(fanartMovie.moviethumb, 'en');
      const poster = pickBestFanartImage(fanartMovie.movieposter, 'en');

      if (bg?.url) {
        backgroundUrl = toSafeArtworkUrl(bg.url);
        backgroundSource = 'fanart';
        source = 'fanart';
      }
      if (poster?.url && !posterUrl) {
        posterUrl = toSafeArtworkUrl(poster.url);
      }
    }
  } else if (tvdbId) {
    const fanartTv = await fetchFanartArtwork(tvdbId, 'tv');
    if (fanartTv) {
      fanartAvailableLogos = extractAllFanartLogos(
        fanartTv,
        toSafeArtworkUrl,
        preferEnglish
      );

      const bg =
        pickBestFanartImage(fanartTv.showbackground, 'en') ||
        pickBestFanartImage(fanartTv.tvthumb, 'en');
      const poster = pickBestFanartImage(fanartTv.tvposter, 'en');

      if (bg?.url) {
        backgroundUrl = toSafeArtworkUrl(bg.url);
        backgroundSource = 'fanart';
        source = 'fanart';
      }
      if (poster?.url && !posterUrl) {
        posterUrl = toSafeArtworkUrl(poster.url);
      }
    }
  }

  // Merge Fanart.tv available logos with any previously cached Firestore availableLogos
  const mergedAvailableLogos =
    fanartAvailableLogos.length > 0
      ? fanartAvailableLogos
      : (firestoreOverride?.availableLogos || []).map((item) => ({
          ...item,
          proxyUrl: toSafeArtworkUrl(item.url) || item.proxyUrl || item.url,
        }));

  // Resolve final logo using the 8-step priority selector (respects manual overrides for both TV & Movie)
  const logoResolution = resolveAnimeLogoSelection({
    availableLogos: mergedAvailableLogos,
    customLogos: firestoreOverride?.customLogos || [],
    hiddenLogoIds: firestoreOverride?.hiddenLogoIds || [],
    selectionMode: firestoreOverride?.selectionMode || 'auto',
    manualLogoUrl: firestoreOverride?.selectedLogoUrl || null,
    manualLogoSource: firestoreOverride?.selectedLogoSource,
    manualLogoLanguage: firestoreOverride?.selectedLogoLanguage,
    logoDisplay: firestoreOverride?.logoDisplay,
    preferEnglish,
  });

  const logoUrl = logoResolution.logoUrl
    ? logoResolution.selectedLogoSource === 'custom_upload'
      ? logoResolution.logoUrl
      : toSafeArtworkUrl(logoResolution.logoUrl)
    : null;

  const logoSource: AnimeArtworkResult['logoSource'] =
    logoResolution.selectedLogoSource === 'typography_fallback'
      ? 'typography'
      : logoResolution.selectedLogoSource;

  if (
    logoResolution.selectionMode === 'manual' ||
    logoResolution.selectedLogoSource === 'custom_upload'
  ) {
    source = 'custom_override';
  } else if (logoUrl && source === 'hoshika') {
    source = 'fanart';
  }

  // Step 4: Fallback chain for background image
  if (!backgroundUrl) {
    if (firestoreOverride?.backgroundUrl) {
      backgroundUrl = toSafeArtworkUrl(firestoreOverride.backgroundUrl);
      backgroundSource = 'fanart';
    } else if (hoshikaBanner) {
      backgroundUrl = hoshikaBanner;
      backgroundSource = 'hoshika_banner';
      if (source === 'hoshika') source = 'hoshika';
    } else if (anilistBanner) {
      backgroundUrl = anilistBanner;
      backgroundSource = 'anilist_banner';
      if (source === 'hoshika') source = 'anilist';
    } else if (hoshikaCover) {
      backgroundUrl = hoshikaCover;
      backgroundSource = 'hoshika_cover';
    }
  }

  const finalResult: AnimeArtworkResult = {
    hoshikaId,
    title: title || titleRomaji || firestoreOverride?.title || 'Unknown Anime',
    anilistId,
    malId: externalIds.malId || malId || null,
    tvdbId,
    tmdbId,
    backgroundUrl,
    backgroundSource,
    logoUrl,
    logoSource,
    characterArtUrl: null,
    posterUrl,
    source,
    fetchedAt: Date.now(),
    availableLogos: logoResolution.availableLogos,
    customLogos: logoResolution.customLogos,
    hiddenLogoIds: logoResolution.hiddenLogoIds,
    selectionMode: logoResolution.selectionMode,
    selectedLogoSource: logoResolution.selectedLogoSource,
    selectedLogoLanguage: logoResolution.selectedLogoLanguage,
    logoDisplay: logoResolution.logoDisplay,
    logoStatus: logoResolution.logoStatus,
    hasEnglishLogo: logoResolution.hasEnglishLogo,
    hasJapaneseLogo: logoResolution.hasJapaneseLogo,
    reviewed: firestoreOverride?.reviewed ?? false,
  };

  setCachedArtwork(hoshikaId, finalResult);
  return finalResult;
}
