import { appCache } from './cache';
import { getHoshikaAnime } from './hoshika';
import { resolveAnimeIds } from './id-mapper';
import {
  fetchFanartTvByTvdb,
  fetchFanartMovieByTmdb,
  pickBestFanartImage,
} from './fanart';
import { HoshikaAnimeItem } from '@/types/anime';
import {
  AnimeArtworkResult,
  ArtworkBackgroundSource,
  ArtworkLogoSource,
  FanartTvResponse,
} from '@/types/artwork';

interface AniZipImage {
  coverType: string;
  url: string;
}

interface AniZipResponse {
  images?: AniZipImage[];
  mappings?: {
    thetvdb_id?: number | string | null;
    themoviedb_id?: number | string | null;
    mal_id?: number | null;
    anilist_id?: number | null;
  };
}

interface AniZipArtworkResult {
  tvdbId: number | null;
  tmdbId: number | null;
  fanartUrl: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  posterUrl: string | null;
}

/**
 * Fetch cross-database IDs (TVDB, TMDB, MAL) and verified artwork using AniZip for an AniList ID.
 */
async function fetchAniZipMappings(
  anilistId: number
): Promise<AniZipArtworkResult> {
  const cacheKey = `anizip:${anilistId}`;
  const cached = appCache.get<AniZipArtworkResult>(cacheKey);
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`https://api.ani.zip/mappings?anilist_id=${anilistId}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AniScroll/1.0',
      },
      signal: controller.signal,
      next: { revalidate: 86400 * 7 },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        tvdbId: null,
        tmdbId: null,
        fanartUrl: null,
        logoUrl: null,
        bannerUrl: null,
        posterUrl: null,
      };
    }

    const data: AniZipResponse = await res.json();
    const tvdbRaw = data.mappings?.thetvdb_id;
    const tmdbRaw = data.mappings?.themoviedb_id;

    const tvdbId = tvdbRaw ? parseInt(String(tvdbRaw), 10) || null : null;
    const tmdbId = tmdbRaw ? parseInt(String(tmdbRaw), 10) || null : null;

    const images = data.images || [];
    const fanartImage = images.find((i) => i.coverType?.toLowerCase() === 'fanart');
    const clearlogoImage = images.find((i) => i.coverType?.toLowerCase() === 'clearlogo');
    const bannerImage = images.find((i) => i.coverType?.toLowerCase() === 'banner');
    const posterImage = images.find((i) => i.coverType?.toLowerCase() === 'poster');

    const result: AniZipArtworkResult = {
      tvdbId,
      tmdbId,
      fanartUrl: fanartImage?.url || null,
      logoUrl: clearlogoImage?.url || null,
      bannerUrl: bannerImage?.url || null,
      posterUrl: posterImage?.url || null,
    };

    appCache.set(cacheKey, result, 86400 * 7);
    return result;
  } catch (err: any) {
    console.warn(`Failed to fetch AniZip for AniList ${anilistId}:`, err.message || err);
    return {
      tvdbId: null,
      tmdbId: null,
      fanartUrl: null,
      logoUrl: null,
      bannerUrl: null,
      posterUrl: null,
    };
  }
}

/**
 * Main artwork resolver.
 * Maps Hoshika anime -> AniList -> AniZip (TVDB/TMDB) -> Fanart.tv,
 * applying the strict artwork priority and fallback hierarchy.
 */
export async function resolveAnimeArtwork(
  hoshikaId: string | number,
  hoshikaAnimeItem?: HoshikaAnimeItem | null
): Promise<AnimeArtworkResult> {
  const cacheKey = `artwork-resolved:${hoshikaId}`;
  const cached = appCache.get<AnimeArtworkResult>(cacheKey);
  if (cached) return cached;

  // 1. Retrieve Hoshika metadata
  const anime = hoshikaAnimeItem || (await getHoshikaAnime(hoshikaId, 'en'));
  const title =
    anime?.titleEnglish ||
    anime?.titleRomaji ||
    anime?.titleLocalized ||
    'Featured Anime';

  let anilistId: number | null = null;
  let tvdbId: number | null = null;
  let tmdbId: number | null = null;
  let fanartData: FanartTvResponse | null = null;
  let externalIds: AniZipArtworkResult | null = null;

  try {
    // 2. Resolve AniList ID
    const mapping = await resolveAnimeIds(hoshikaId);
    if (mapping && mapping.anilistId) {
      anilistId = mapping.anilistId;

      // 3. Resolve TVDB and TMDB IDs & artwork from AniZip
      externalIds = await fetchAniZipMappings(anilistId);
      tvdbId = externalIds.tvdbId;
      tmdbId = externalIds.tmdbId;

      // 4. Fetch Fanart.tv artwork
      const isMovie = anime?.format?.toUpperCase() === 'MOVIE';
      if (tvdbId) {
        fanartData = await fetchFanartTvByTvdb(tvdbId);
      } else if (tmdbId && isMovie) {
        fanartData = await fetchFanartMovieByTmdb(tmdbId);
      }
    }
  } catch (err: any) {
    console.warn(`Error resolving artwork for anime ${hoshikaId}:`, err.message || err);
  }

  // 5. Select Background Artwork according to Priority Hierarchy:
  // 1. Fanart.tv showbackground
  // 2. Fanart.tv show4kbackground
  // 3. AniZip Fanart background
  // 4. Hoshika bannerImage
  // 5. Hoshika coverImage
  // 6. Fallback
  let backgroundUrl: string | null = null;
  let backgroundSource: ArtworkBackgroundSource = 'fallback';

  const showbg = pickBestFanartImage(fanartData?.showbackground);
  const show4kbg = pickBestFanartImage(fanartData?.show4kbackground);

  if (showbg?.url) {
    backgroundUrl = showbg.url;
    backgroundSource = 'fanart_showbackground';
  } else if (show4kbg?.url) {
    backgroundUrl = show4kbg.url;
    backgroundSource = 'fanart_show4kbackground';
  } else if (externalIds?.fanartUrl) {
    backgroundUrl = externalIds.fanartUrl;
    backgroundSource = 'fanart_showbackground';
  } else if (anime?.bannerImage) {
    backgroundUrl = anime.bannerImage;
    backgroundSource = 'hoshika_banner';
  } else if (anime?.coverImage) {
    backgroundUrl = anime.coverImage;
    backgroundSource = 'hoshika_cover';
  }

  // 6. Select Anime Logo according to Priority Hierarchy:
  // 1. Fanart.tv hdtvlogo (transparent PNG)
  // 2. Fanart.tv clearlogo (transparent PNG)
  // 3. AniZip clearlogo (transparent PNG)
  // 4. Hoshika title typography
  let logoUrl: string | null = null;
  let logoSource: ArtworkLogoSource = 'typography';

  const hdtvlogo = pickBestFanartImage(fanartData?.hdtvlogo);
  const clearlogo = pickBestFanartImage(fanartData?.clearlogo);

  if (hdtvlogo?.url) {
    logoUrl = hdtvlogo.url;
    logoSource = 'fanart_hdtvlogo';
  } else if (clearlogo?.url) {
    logoUrl = clearlogo.url;
    logoSource = 'fanart_clearlogo';
  } else if (externalIds?.logoUrl) {
    logoUrl = externalIds.logoUrl;
    logoSource = 'fanart_clearlogo';
  }

  // TV Banner
  const banner = pickBestFanartImage(fanartData?.tvbanner);
  const bannerUrl = banner?.url || null;

  function formatArtworkUrl(url?: string | null): string | null {
    if (!url) return null;
    if (url.startsWith('https://artworks.thetvdb.com')) {
      return `/api/artwork-image/${Buffer.from(url).toString('base64url')}`;
    }
    return url;
  }

  const result: AnimeArtworkResult = {
    hoshikaId,
    anilistId,
    tvdbId,
    tmdbId,
    title,
    backgroundUrl: formatArtworkUrl(backgroundUrl),
    backgroundSource,
    logoUrl: formatArtworkUrl(logoUrl),
    logoSource,
    characterArtUrl: null, // Disabled: No character cutouts allowed
    bannerUrl: formatArtworkUrl(bannerUrl),
    cachedAt: Date.now(),
  };

  // Cache resolved artwork for 7 days
  appCache.set(cacheKey, result, 86400 * 7);
  return result;
}
