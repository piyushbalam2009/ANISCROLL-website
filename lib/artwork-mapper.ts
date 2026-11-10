import { HoshikaAnimeItem } from '@/types/anime';
import { AnimeArtworkResult, DEFAULT_LOGO_DISPLAY_SETTINGS } from '@/types/artwork';
import {
  extractAllFanartLogos,
  fetchFanartArtwork,
  selectBestFanartImage,
} from '@/lib/fanart';
import { resolveAnimeLogoSelection } from '@/lib/artwork/logo-selector';
import {
  getCachedFirestoreOverride,
  getCachedResolvedArtwork,
  setCachedFirestoreOverride,
  setCachedResolvedArtwork,
} from '@/lib/artwork/artwork-cache';
import { fetchFirestoreDocumentRest } from '@/lib/firebase-admin';
import { AnimeArtworkFirestoreDoc } from '@/lib/admin/admin-firestore';
import { getHoshikaAnime } from '@/lib/hoshika';

const idMapCache = new Map<
  number,
  { tvdbId: number | null; tmdbId: number | null; backdropUrl: string | null }
>();

/**
 * Curated Hoshika shortId -> TVDB ID fast map for instant resolution of top series
 */
const HOSHIKA_TO_TVDB_FAST_MAP: Record<number, number> = {
  20859: 79481, // Death Note
  21: 81797, // One Piece
  16498: 267440, // Attack on Titan
  11061: 252322, // Hunter x Hunter
  97940: 331753, // Black Clover
  101922: 348545, // Demon Slayer
  113415: 377543, // Jujutsu Kaisen
  151807: 389597, // Solo Leveling
  154587: 424536, // Frieren
  127230: 393409, // Chainsaw Man
  171018: 442531, // Dan Da Dan
  153288: 423043, // Kaiju No. 8
  269: 74796, // Bleach
};

const TITLE_TO_TVDB_FAST_MAP: Array<{ match: RegExp; tvdbId: number }> = [
  { match: /solo leveling/i, tvdbId: 389597 },
  { match: /frieren/i, tvdbId: 424536 },
  { match: /jujutsu kaisen/i, tvdbId: 377543 },
  { match: /one piece/i, tvdbId: 81797 },
  { match: /demon slayer|kimetsu no yaiba/i, tvdbId: 348545 },
  { match: /attack on titan|shingeki no kyojin/i, tvdbId: 267440 },
  { match: /hunter x hunter/i, tvdbId: 252322 },
  { match: /bleach/i, tvdbId: 74796 },
  { match: /chainsaw man/i, tvdbId: 393409 },
  { match: /dan da dan|dandadan/i, tvdbId: 442531 },
  { match: /kaiju no\.?\s*8/i, tvdbId: 423043 },
  { match: /black clover/i, tvdbId: 331753 },
  { match: /death note/i, tvdbId: 79481 },
];

export function toSafeArtworkUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith('https://assets.fanart.tv/') ||
    trimmed.startsWith('https://fanart.tv/') ||
    trimmed.startsWith('https://artworks.thetvdb.com/')
  ) {
    return `/api/image-proxy?url=${encodeURIComponent(trimmed)}`;
  }

  return trimmed;
}

/**
 * Resolves TVDB ID and TMDB ID from an AniList ID using api.ani.zip.
 * IMPORTANT: AniZip is strictly used for ID mapping, NEVER for logos under any circumstances.
 */
export async function resolveExternalIdsFromAnilist(anilistId?: number | null): Promise<{
  tvdbId: number | null;
  tmdbId: number | null;
  backdropUrl: string | null;
}> {
  if (!anilistId) {
    return { tvdbId: null, tmdbId: null, backdropUrl: null };
  }

  const cached = idMapCache.get(anilistId);
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.ani.zip/mappings?anilist_id=${anilistId}`, {
      next: { revalidate: 86400 },
      headers: { Accept: 'application/json' },
    });

    if (res.ok) {
      const data = await res.json();
      const rawTvdb = data?.mappings?.thetvdb_id;
      const rawTmdb = data?.mappings?.themoviedb_id;
      const tvdbId = rawTvdb ? Number(rawTvdb) : null;
      const tmdbId = rawTmdb ? Number(rawTmdb) : null;

      let backdropUrl: string | null = null;
      if (Array.isArray(data?.images)) {
        const fanartImg = data.images.find(
          (img: { coverType?: string; url?: string }) =>
            img.coverType === 'Fanart' && img.url
        );
        backdropUrl = fanartImg?.url || null;
      }

      const result = {
        tvdbId: Number.isFinite(tvdbId) ? tvdbId : null,
        tmdbId: Number.isFinite(tmdbId) ? tmdbId : null,
        backdropUrl,
      };
      idMapCache.set(anilistId, result);
      return result;
    }
  } catch {
    // Graceful fallback
  }

  return { tvdbId: null, tmdbId: null, backdropUrl: null };
}

async function resolveAnilistMetadata(params: {
  anilistId?: number | null;
  malId?: number | null;
  title?: string | null;
}): Promise<{ anilistId: number | null; bannerImage: string | null }> {
  const { anilistId, malId, title } = params;
  if (!anilistId && !malId && !title) {
    return { anilistId: null, bannerImage: null };
  }

  const query = `
    query ($id: Int, $idMal: Int, $search: String) {
      Media(id: $id, idMal: $idMal, search: $search, type: ANIME) {
        id
        bannerImage
      }
    }
  `;

  try {
    const variables: Record<string, unknown> = {};
    if (anilistId) variables.id = anilistId;
    else if (malId) variables.idMal = malId;
    else if (title) variables.search = title;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

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
    clearTimeout(timer);

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
    // Graceful fallback
  }

  return { anilistId: anilistId || null, bannerImage: null };
}

async function getServerAnimeArtworkOverride(
  hoshikaId: number,
  bypassCache = false
): Promise<AnimeArtworkFirestoreDoc | null> {
  if (!bypassCache) {
    const cached = getCachedFirestoreOverride(hoshikaId);
    if (cached.hit) {
      return cached.doc;
    }
  }

  const rawDoc = await fetchFirestoreDocumentRest('animeArtwork', String(hoshikaId));
  const parsed =
    rawDoc && typeof rawDoc.hoshikaId === 'number'
      ? (rawDoc as unknown as AnimeArtworkFirestoreDoc)
      : null;

  setCachedFirestoreOverride(hoshikaId, parsed);
  return parsed;
}

export interface ResolveAnimeArtworkParams {
  hoshikaId: number;
  anilistId?: number | null;
  malId?: number | null;
  tvdbId?: number | null;
  tmdbId?: number | null;
  title?: string | null;
  format?: string | null;
  hoshikaBanner?: string | null;
  hoshikaCover?: string | null;
  bypassCache?: boolean;
}

/**
 * Supports both call signatures:
 * 1. resolveAnimeArtwork(idOrShortId, optionalHoshikaAnimeItem)
 * 2. resolveAnimeArtwork({ hoshikaId, anilistId, title, ... })
 */
export async function resolveAnimeArtwork(
  idOrParams: number | string | ResolveAnimeArtworkParams,
  optionalAnime?: HoshikaAnimeItem | null
): Promise<AnimeArtworkResult> {
  let params: ResolveAnimeArtworkParams;

  if (typeof idOrParams === 'object' && idOrParams !== null) {
    params = idOrParams;
  } else {
    const numericId = Number(idOrParams) || 0;
    let animeItem = optionalAnime;
    if (!animeItem && numericId > 0 && numericId !== 99999) {
      animeItem = await getHoshikaAnime(numericId, 'en').catch(() => null);
    }

    params = {
      hoshikaId: numericId,
      anilistId: animeItem?.anilistId || null,
      malId: animeItem?.malId || null,
      tvdbId: animeItem?.thetvdbId ? Number(animeItem.thetvdbId) : null,
      tmdbId: animeItem?.themoviedbId ? Number(animeItem.themoviedbId) : null,
      title:
        animeItem?.titleEnglish ||
        animeItem?.titleRomaji ||
        animeItem?.titleLocalized ||
        null,
      format: animeItem?.format || null,
      hoshikaBanner: animeItem?.bannerImage || null,
      hoshikaCover: animeItem?.coverImage || null,
    };
  }

  const {
    hoshikaId,
    anilistId: initialAnilistId,
    malId,
    tvdbId: initialTvdbId,
    tmdbId: initialTmdbId,
    title,
    format,
    hoshikaBanner,
    hoshikaCover,
    bypassCache = false,
  } = params;

  if (!bypassCache) {
    const cached = getCachedResolvedArtwork(hoshikaId);
    if (cached) {
      return cached;
    }
  }

  let anilistId = initialAnilistId || null;
  let anilistBanner: string | null = null;
  let tvdbId = initialTvdbId || HOSHIKA_TO_TVDB_FAST_MAP[hoshikaId] || null;
  let tmdbId = initialTmdbId || null;

  if (!tvdbId && title) {
    for (const entry of TITLE_TO_TVDB_FAST_MAP) {
      if (entry.match.test(title)) {
        tvdbId = entry.tvdbId;
        break;
      }
    }
  }

  // Only query AniList if we don't already have a TVDB ID or banner
  if (!tvdbId && (!anilistId || !hoshikaBanner) && hoshikaId !== 99999) {
    const anilistMeta = await resolveAnilistMetadata({ anilistId, malId, title });
    if (!anilistId && anilistMeta.anilistId) {
      anilistId = anilistMeta.anilistId;
    }
    anilistBanner = anilistMeta.bannerImage;
  }

  let externalIds: {
    tvdbId: number | null;
    tmdbId: number | null;
    backdropUrl: string | null;
  } | null = null;

  if (!tvdbId && !tmdbId && anilistId) {
    externalIds = await resolveExternalIdsFromAnilist(anilistId);
    tvdbId = externalIds.tvdbId;
    tmdbId = externalIds.tmdbId;
  }

  const isMovie = format === 'MOVIE';

  const fanartData = await fetchFanartArtwork({
    tvdbId,
    tmdbId,
    isMovie,
  });

  const fanartBackground =
    selectBestFanartImage(fanartData?.showbackground) ||
    selectBestFanartImage(fanartData?.moviebackground) ||
    selectBestFanartImage(fanartData?.tvthumb) ||
    selectBestFanartImage(fanartData?.moviethumb) ||
    externalIds?.backdropUrl ||
    null;

  const fanartPoster =
    selectBestFanartImage(fanartData?.tvposter) ||
    selectBestFanartImage(fanartData?.movieposter) ||
    null;

  const safeFanartBg = toSafeArtworkUrl(fanartBackground);
  const backgroundUrl =
    safeFanartBg || hoshikaBanner || anilistBanner || hoshikaCover || null;

  const backgroundSource: AnimeArtworkResult['backgroundSource'] = safeFanartBg
    ? 'fanart'
    : anilistBanner && backgroundUrl === anilistBanner
    ? 'anilist_banner'
    : hoshikaBanner && backgroundUrl === hoshikaBanner
    ? 'hoshika_banner'
    : hoshikaCover
    ? 'hoshika_cover'
    : 'none';

  // Character art cutouts must remain strictly null
  const characterArtUrl = null;
  const posterUrl = hoshikaCover || toSafeArtworkUrl(fanartPoster) || null;

  if (isMovie) {
    const movieLogo =
      selectBestFanartImage(fanartData?.hdmovielogo) ||
      selectBestFanartImage(fanartData?.movielogo) ||
      selectBestFanartImage(fanartData?.hdtvlogo) ||
      selectBestFanartImage(fanartData?.clearlogo) ||
      null;
    const safeMovieLogo = toSafeArtworkUrl(movieLogo);

    const movieResult: AnimeArtworkResult = {
      hoshikaId,
      title: title || `Anime #${hoshikaId}`,
      anilistId,
      malId: malId || null,
      tvdbId,
      tmdbId,
      backgroundUrl,
      backgroundSource,
      logoUrl: safeMovieLogo,
      logoSource: safeMovieLogo ? 'fanart_hdtvlogo' : 'typography',
      characterArtUrl: null,
      posterUrl,
      source: fanartBackground || safeMovieLogo ? 'fanart' : anilistBanner ? 'anilist' : 'hoshika',
      fetchedAt: Date.now(),
    };
    setCachedResolvedArtwork(hoshikaId, movieResult);
    return movieResult;
  }

  // Extract ALL Fanart.tv hdtvlogo & clearlogo options
  const allFanartLogos = extractAllFanartLogos(
    fanartData,
    (rawUrl) => toSafeArtworkUrl(rawUrl) || rawUrl,
    true
  );

  const firestoreOverride =
    hoshikaId === 99999
      ? null
      : await getServerAnimeArtworkOverride(hoshikaId, bypassCache);

  const mergedLogosMap = new Map<string, (typeof allFanartLogos)[number]>();
  for (const l of allFanartLogos) {
    mergedLogosMap.set(`${l.category}:${l.url}`, l);
  }
  if (Array.isArray(firestoreOverride?.availableLogos)) {
    for (const savedLogo of firestoreOverride.availableLogos) {
      if (savedLogo && savedLogo.url) {
        const key = `${savedLogo.category}:${savedLogo.url}`;
        if (!mergedLogosMap.has(key)) {
          mergedLogosMap.set(key, {
            ...savedLogo,
            proxyUrl: toSafeArtworkUrl(savedLogo.url) || savedLogo.url,
          });
        }
      }
    }
  }

  const selection = resolveAnimeLogoSelection({
    availableLogos: Array.from(mergedLogosMap.values()),
    customLogos: firestoreOverride?.customLogos || [],
    hiddenLogoIds: firestoreOverride?.hiddenLogoIds || [],
    selectionMode: firestoreOverride?.selectionMode || 'auto',
    manualLogoUrl: firestoreOverride?.selectedLogoUrl || null,
    manualLogoSource: firestoreOverride?.selectedLogoSource,
    manualLogoLanguage: firestoreOverride?.selectedLogoLanguage,
    logoDisplay: firestoreOverride?.logoDisplay || DEFAULT_LOGO_DISPLAY_SETTINGS,
    preferEnglish: true,
  });

  const finalLogoUrl =
    selection.selectedLogoSource === 'custom_upload'
      ? selection.logoUrl
      : toSafeArtworkUrl(selection.logoUrl);

  const logoSource: AnimeArtworkResult['logoSource'] =
    !finalLogoUrl || selection.selectedLogoSource === 'typography_fallback'
      ? 'typography'
      : selection.selectedLogoSource;

  const source: AnimeArtworkResult['source'] =
    selection.selectionMode === 'manual' || selection.selectedLogoSource === 'custom_upload'
      ? 'custom_override'
      : fanartBackground || finalLogoUrl
      ? 'fanart'
      : anilistBanner
      ? 'anilist'
      : 'hoshika';

  const result: AnimeArtworkResult = {
    hoshikaId,
    title: firestoreOverride?.title || title || `Anime #${hoshikaId}`,
    anilistId,
    malId: malId || null,
    tvdbId,
    tmdbId,
    backgroundUrl: firestoreOverride?.backgroundUrl || backgroundUrl,
    backgroundSource,
    logoUrl: finalLogoUrl,
    logoSource,
    characterArtUrl: null,
    posterUrl: firestoreOverride?.posterUrl || posterUrl,
    source,
    fetchedAt: Date.now(),
    availableLogos: selection.availableLogos,
    customLogos: selection.customLogos,
    hiddenLogoIds: selection.hiddenLogoIds,
    selectionMode: selection.selectionMode,
    selectedLogoSource: selection.selectedLogoSource,
    selectedLogoLanguage: selection.selectedLogoLanguage,
    logoDisplay: selection.logoDisplay,
    logoStatus: selection.logoStatus,
    hasEnglishLogo: selection.hasEnglishLogo,
    hasJapaneseLogo: selection.hasJapaneseLogo,
    reviewed: Boolean(firestoreOverride?.reviewed),
  };

  setCachedResolvedArtwork(hoshikaId, result);
  return result;
}
