import { HoshikaAnimeItem, HoshikaEpisodeItem } from '@/types/anime';
import { AnimeArtworkResult } from '@/types/artwork';
import { EpisodeAvailabilityResult } from './episode-store';
import { isMovieContent, normalizeAnimeFormat } from './stream-provider-core';

export interface AnimeFormatClassificationInput {
  format?: string | null;
  isStandaloneMovie?: boolean | null;
  standaloneMovie?: boolean | null;
}

/**
 * Determines whether the anime detail page should hide the Episodes section
 * and skip all episode/availability API requests.
 *
 * Uses strict format metadata from Hoshika/AniList (`isMovieContent`),
 * never guessing from title keywords or episode count alone:
 * - MOVIE -> true (hide episodes)
 * - SPECIAL with explicit standalone movie flag -> true (hide episodes)
 * - TV, TV_SHORT, OVA, ONA, episodic SPECIAL, UNKNOWN/missing -> false (keep episodes)
 */
export function shouldHideEpisodesSection(
  anime: AnimeFormatClassificationInput | null | undefined
): boolean {
  if (!anime) return false;
  const standalone =
    anime.isStandaloneMovie === true || anime.standaloneMovie === true;
  return isMovieContent({
    format: anime.format ?? null,
    isStandaloneMovie: standalone,
  });
}

export function shouldShowEpisodesSection(
  anime: AnimeFormatClassificationInput | null | undefined
): boolean {
  return !shouldHideEpisodesSection(anime);
}

export interface AnimeDetailDataResult {
  anime: HoshikaAnimeItem | null;
  isMovie: boolean;
  showEpisodesSection: boolean;
  normalizedFormat: ReturnType<typeof normalizeAnimeFormat>;
  episodes: HoshikaEpisodeItem[];
  totalEpisodes: number;
  initialAvailability: EpisodeAvailabilityResult | null;
  artwork: AnimeArtworkResult | null;
}

export interface AnimeDetailDataDeps {
  getAnime: (id: string) => Promise<HoshikaAnimeItem | null>;
  getEpisodes: (
    id: string
  ) => Promise<{ items: HoshikaEpisodeItem[]; total: number; nextAfter: number | null }>;
  resolveArtwork: (
    animeId: string | number,
    anime: HoshikaAnimeItem
  ) => Promise<AnimeArtworkResult | null>;
  getCachedAvailability: (params: {
    hoshikaId: string | number;
    anilistId?: number | null;
    episodeCount: number;
    prefetchedAnime?: HoshikaAnimeItem | null;
    format?: string | null;
    isStandaloneMovie?: boolean;
  }) => EpisodeAvailabilityResult | null;
}

/**
 * Loads anime detail page data while skipping Hoshika episode lookups and
 * audio availability checks whenever the anime is classified as a movie.
 */
export async function loadAnimeDetailData(
  id: string,
  deps: AnimeDetailDataDeps
): Promise<AnimeDetailDataResult> {
  const anime = await deps.getAnime(id);

  if (!anime) {
    return {
      anime: null,
      isMovie: false,
      showEpisodesSection: false,
      normalizedFormat: 'UNKNOWN',
      episodes: [],
      totalEpisodes: 0,
      initialAvailability: null,
      artwork: null,
    };
  }

  const normalizedFormat = normalizeAnimeFormat(anime.format);
  const isMovie = shouldHideEpisodesSection(anime);
  const targetId = anime.shortId || id;

  if (isMovie) {
    const artwork = await deps.resolveArtwork(targetId, anime);
    return {
      anime,
      isMovie: true,
      showEpisodesSection: false,
      normalizedFormat,
      episodes: [],
      totalEpisodes: 0,
      initialAvailability: null,
      artwork,
    };
  }

  const [episodeData, artwork] = await Promise.all([
    deps.getEpisodes(id),
    deps.resolveArtwork(targetId, anime),
  ]);

  const totalEpisodeCount =
    episodeData.total || anime.episodes || episodeData.items.length || 0;

  const initialAvailability =
    episodeData.items.length > 0 || totalEpisodeCount > 0
      ? deps.getCachedAvailability({
          hoshikaId: targetId,
          anilistId: anime.anilistId ?? null,
          episodeCount: totalEpisodeCount,
          prefetchedAnime: anime,
          format: anime.format ?? null,
          isStandaloneMovie:
            anime.isStandaloneMovie === true || anime.standaloneMovie === true,
        })
      : null;

  return {
    anime,
    isMovie: false,
    showEpisodesSection: true,
    normalizedFormat,
    episodes: episodeData.items,
    totalEpisodes: anime.episodes || episodeData.total || episodeData.items.length || 0,
    initialAvailability,
    artwork,
  };
}
