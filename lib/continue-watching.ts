import { WatchHistoryEntry } from '@/types/streaming';
import { normalizeCandidateImageUrl } from './image-url';

/**
 * Checks whether an episode title is missing, placeholder, or generic (e.g., "Episode 1", "EP 1").
 */
export function isGenericEpisodeTitle(
  title?: string | null,
  episodeNumber?: number,
  animeTitle?: string | null
): boolean {
  if (!title || typeof title !== 'string') return true;
  const trimmed = title.trim();
  if (!trimmed) return true;

  const lower = trimmed.toLowerCase();
  if (lower === 'undefined' || lower === 'null' || lower === 'n/a' || lower === 'tba') {
    return true;
  }

  // Generic patterns: "Episode 1", "EP 1", "Ep. 01", "Episode #1"
  if (/^ep(?:isode)?\.?\s*#?\d+$/i.test(trimmed)) {
    return true;
  }

  if (episodeNumber && lower === `episode ${episodeNumber}`) {
    return true;
  }

  // Do not confuse anime title with episode title
  if (animeTitle && animeTitle.trim() && lower === animeTitle.trim().toLowerCase()) {
    return true;
  }

  return false;
}

/**
 * Sanitizes an image URL and rejects invalid, empty, or dead legacy Fanart.tv URLs.
 */
export function sanitizeArtworkUrl(url?: string | null): string | undefined {
  return normalizeCandidateImageUrl(url) ?? undefined;
}

/**
 * Resolves the display-ready anime title for a Continue Watching or Watch History entry.
 */
export function resolveDisplayAnimeTitle(entry: Partial<WatchHistoryEntry>): string {
  const candidates = [entry.animeTitle, entry.title];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed && trimmed !== 'undefined' && trimmed !== 'null') {
        return trimmed;
      }
    }
  }
  return 'Unknown Anime';
}

/**
 * Resolves the display-ready episode title for a Continue Watching or Watch History entry.
 * Falls back to `Episode {number}` if unavailable or if it matches the anime title.
 */
export function resolveDisplayEpisodeTitle(entry: Partial<WatchHistoryEntry>): string {
  const epNum = Math.max(1, Number(entry.episodeNumber || 1));
  const animeTitle = resolveDisplayAnimeTitle(entry);
  const rawEpTitle = entry.episodeTitle?.trim();

  if (
    rawEpTitle &&
    !isGenericEpisodeTitle(rawEpTitle, epNum, animeTitle)
  ) {
    return rawEpTitle;
  }

  return `Episode ${epNum}`;
}

/**
 * Calculates integer watch progress percentage [0..100] from currentTime and duration.
 */
export function calculateWatchProgress(
  currentTime?: number | null,
  duration?: number | null,
  fallbackProgress?: number | null
): number {
  const time = typeof currentTime === 'number' && Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  const dur = typeof duration === 'number' && Number.isFinite(duration) ? duration : 0;

  if (dur > 0 && time > 0) {
    return Math.min(100, Math.max(1, Math.round((time / dur) * 100)));
  }

  if (typeof fallbackProgress === 'number' && Number.isFinite(fallbackProgress) && fallbackProgress > 0) {
    return Math.min(100, Math.max(0, Math.round(fallbackProgress)));
  }

  return 0;
}

/**
 * Returns ordered, deduplicated thumbnail candidates for Continue Watching cards:
 * 1. Actual episode thumbnail / still image (`episodeThumbnail`)
 * 2. Anime cover image (`animeCover` / `coverImage`)
 * 3. Anime banner image (`bannerImage`)
 */
export function getContinueWatchingThumbnailCandidates(
  entry: Partial<WatchHistoryEntry>
): string[] {
  const rawList = [
    entry.episodeThumbnail,
    entry.animeCover,
    entry.coverImage,
    entry.bannerImage,
  ];

  const seen = new Set<string>();
  const valid: string[] = [];

  for (const item of rawList) {
    const clean = sanitizeArtworkUrl(item);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      valid.push(clean);
    }
  }

  return valid;
}

/**
 * Returns the primary thumbnail URL for a Continue Watching card, or null if none is available.
 */
export function resolveContinueWatchingThumbnail(
  entry: Partial<WatchHistoryEntry>
): string | null {
  const candidates = getContinueWatchingThumbnailCandidates(entry);
  return candidates[0] ?? null;
}

/**
 * Checks whether a watch history entry is missing episode thumbnail, real episode title, or cover image
 * and should be enriched from the episode metadata API.
 */
export function needsMetadataEnrichment(entry: Partial<WatchHistoryEntry>): boolean {
  const hasEpisodeThumb = Boolean(sanitizeArtworkUrl(entry.episodeThumbnail));
  const hasRealEpTitle = !isGenericEpisodeTitle(
    entry.episodeTitle,
    entry.episodeNumber,
    entry.animeTitle || entry.title
  );
  const hasCover = Boolean(sanitizeArtworkUrl(entry.animeCover || entry.coverImage));

  return !hasEpisodeThumb || !hasRealEpTitle || !hasCover;
}

/**
 * Merges incoming playback or metadata updates with an existing WatchHistoryEntry
 * without overwriting valid metadata (episodeTitle, episodeThumbnail, coverImage,
 * bannerImage, anilistId, playback position) with null, undefined, or generic values.
 */
export function mergeWatchHistoryEntry(
  incoming: Partial<WatchHistoryEntry> & { hoshikaId: number; episodeNumber: number },
  existing?: Partial<WatchHistoryEntry> | null,
  options?: { metadataOnly?: boolean }
): WatchHistoryEntry {
  const hoshikaId = Number(incoming.hoshikaId);
  const episodeNumber = Math.max(1, Number(incoming.episodeNumber || existing?.episodeNumber || 1));

  // Anime Title (never overwrite valid title with empty/Unknown)
  const incomingTitle = (incoming.animeTitle || incoming.title || '').trim();
  const existingTitle = (existing?.animeTitle || existing?.title || '').trim();
  const resolvedAnimeTitle =
    incomingTitle && incomingTitle !== 'Unknown Anime' && incomingTitle !== 'Anime'
      ? incomingTitle
      : existingTitle || incomingTitle || 'Unknown Anime';

  // Episode Title (prefer real non-generic episode title over "Episode X")
  let resolvedEpisodeTitle: string;
  if (!isGenericEpisodeTitle(incoming.episodeTitle, episodeNumber, resolvedAnimeTitle)) {
    resolvedEpisodeTitle = incoming.episodeTitle!.trim();
  } else if (!isGenericEpisodeTitle(existing?.episodeTitle, episodeNumber, resolvedAnimeTitle)) {
    resolvedEpisodeTitle = existing!.episodeTitle!.trim();
  } else {
    resolvedEpisodeTitle = `Episode ${episodeNumber}`;
  }

  // Thumbnails & Artwork (never overwrite valid URL with null/undefined)
  const resolvedEpisodeThumbnail =
    sanitizeArtworkUrl(incoming.episodeThumbnail) ||
    sanitizeArtworkUrl(existing?.episodeThumbnail);

  const resolvedCover =
    sanitizeArtworkUrl(incoming.animeCover) ||
    sanitizeArtworkUrl(incoming.coverImage) ||
    sanitizeArtworkUrl(existing?.animeCover) ||
    sanitizeArtworkUrl(existing?.coverImage);

  const resolvedBanner =
    sanitizeArtworkUrl(incoming.bannerImage) ||
    sanitizeArtworkUrl(existing?.bannerImage);

  // External IDs (preserved in local state/storage)
  const resolvedAnilistId =
    typeof incoming.anilistId === 'number' && incoming.anilistId > 0
      ? incoming.anilistId
      : typeof existing?.anilistId === 'number' && existing.anilistId > 0
      ? existing.anilistId
      : null;

  const resolvedMalId =
    typeof incoming.malId === 'number' && incoming.malId > 0
      ? incoming.malId
      : typeof existing?.malId === 'number' && existing.malId > 0
      ? existing.malId
      : null;

  // Playback Position & Duration
  let currentTime: number;
  if (options?.metadataOnly) {
    currentTime =
      typeof existing?.currentTime === 'number' && existing.currentTime >= 0
        ? existing.currentTime
        : typeof incoming.currentTime === 'number' && incoming.currentTime >= 0
        ? incoming.currentTime
        : 0;
  } else if (typeof incoming.currentTime === 'number' && incoming.currentTime > 0) {
    currentTime = incoming.currentTime;
  } else if (typeof existing?.currentTime === 'number' && existing.currentTime > 0) {
    currentTime = existing.currentTime;
  } else {
    currentTime = 0;
  }

  let duration: number;
  if (typeof incoming.duration === 'number' && incoming.duration > 0) {
    duration = incoming.duration;
  } else if (typeof existing?.duration === 'number' && existing.duration > 0) {
    duration = existing.duration;
  } else {
    duration = 0;
  }

  const progress = calculateWatchProgress(
    currentTime,
    duration,
    incoming.progress ?? existing?.progress
  );

  const audioType: 'sub' | 'dub' =
    incoming.audioType === 'dub' || incoming.audioType === 'sub'
      ? incoming.audioType
      : existing?.audioType === 'dub' || existing?.audioType === 'sub'
      ? existing.audioType
      : 'sub';

  const timestamp = options?.metadataOnly
    ? typeof existing?.timestamp === 'number' && existing.timestamp > 0
      ? existing.timestamp
      : Date.now()
    : typeof incoming.timestamp === 'number' && incoming.timestamp > 0
    ? incoming.timestamp
    : Date.now();

  const lastWatched =
    typeof incoming.lastWatched === 'string' && incoming.lastWatched
      ? incoming.lastWatched
      : new Date(timestamp).toISOString();

  const completed =
    incoming.completed ??
    (duration > 0 ? currentTime / duration >= 0.95 : existing?.completed ?? false);

  return {
    hoshikaId,
    anilistId: resolvedAnilistId,
    malId: resolvedMalId,
    title: resolvedAnimeTitle,
    animeTitle: resolvedAnimeTitle,
    coverImage: resolvedCover,
    animeCover: resolvedCover,
    bannerImage: resolvedBanner,
    episodeNumber,
    episodeTitle: resolvedEpisodeTitle,
    episodeThumbnail: resolvedEpisodeThumbnail,
    currentTime,
    duration,
    progress,
    audioType,
    timestamp,
    lastWatched,
    completed,
  };
}
