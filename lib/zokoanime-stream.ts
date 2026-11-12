import {
  AniScrollStreamResponse,
  SubtitlePreference,
  SubtitleTrack,
  ZokoAnimeQuality,
} from '@/types/streaming';

const QUALITY_PRIORITY_ORDER = [1080, 720, 480, 360] as const;

export function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

/**
 * Extracts a numeric vertical resolution height (e.g., 1080, 720, 480, 360) from a ZokoAnimeQuality item.
 */
export function parseQualityHeight(item: Partial<ZokoAnimeQuality> | null | undefined): number {
  if (!item || typeof item !== 'object') return 0;

  if (typeof item.height === 'number' && Number.isFinite(item.height) && item.height > 0) {
    return item.height;
  }

  if (typeof item.quality === 'string') {
    const match = item.quality.match(/(\d{3,4})\s*p?/i);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }

  if (typeof item.resolution === 'string') {
    const resMatch = item.resolution.match(/\d+\s*x\s*(\d+)/i);
    if (resMatch) {
      const parsed = parseInt(resMatch[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }

  return 0;
}

/**
 * Filters out invalid quality entries, preserves exact API hlsProxyUrl values without modification,
 * and sorts qualities from highest to lowest resolution.
 */
export function normalizeAndSortQualities(rawQualities: unknown): ZokoAnimeQuality[] {
  if (!Array.isArray(rawQualities)) return [];

  const valid: ZokoAnimeQuality[] = [];
  const seenUrls = new Set<string>();
  const seenLabels = new Set<string>();

  for (const raw of rawQualities) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const hlsProxyUrl = typeof item.hlsProxyUrl === 'string' ? item.hlsProxyUrl.trim() : '';
    if (!isValidHttpUrl(hlsProxyUrl)) continue;

    const height = parseQualityHeight(item as Partial<ZokoAnimeQuality>);
    const qualityLabel =
      typeof item.quality === 'string' && item.quality.trim()
        ? item.quality.trim()
        : height > 0
        ? `${height}p`
        : 'Auto';

    const labelKey = qualityLabel.toLowerCase();
    if (seenUrls.has(hlsProxyUrl) || seenLabels.has(labelKey)) continue;
    seenUrls.add(hlsProxyUrl);
    seenLabels.add(labelKey);

    valid.push({
      quality: qualityLabel,
      resolution: typeof item.resolution === 'string' ? item.resolution : undefined,
      width: typeof item.width === 'number' && Number.isFinite(item.width) ? item.width : undefined,
      height: height > 0 ? height : undefined,
      bandwidth:
        typeof item.bandwidth === 'number' && Number.isFinite(item.bandwidth)
          ? item.bandwidth
          : undefined,
      hlsProxyUrl,
    });
  }

  valid.sort((a, b) => {
    const heightDiff = parseQualityHeight(b) - parseQualityHeight(a);
    if (heightDiff !== 0) return heightDiff;
    return (b.bandwidth || 0) - (a.bandwidth || 0);
  });

  return valid;
}

/**
 * Selects the initial quality following the strict priority:
 * 1. 1080p
 * 2. 720p
 * 3. 480p
 * 4. 360p
 * 5. Other highest available usable quality
 */
export function selectInitialQuality(qualities: ZokoAnimeQuality[] | undefined | null): ZokoAnimeQuality | null {
  const sorted = normalizeAndSortQualities(qualities);
  if (sorted.length === 0) return null;

  for (const targetHeight of QUALITY_PRIORITY_ORDER) {
    const exact = sorted.find(
      (q) =>
        parseQualityHeight(q) === targetHeight ||
        q.quality.trim().toLowerCase() === `${targetHeight}p`
    );
    if (exact) return exact;
  }

  // Fallback to highest usable quality available (preferring <= 1080p if present, else first sorted)
  const highestAtOrBelow1080 = sorted.find((q) => {
    const h = parseQualityHeight(q);
    return h > 0 && h <= 1080;
  });
  return highestAtOrBelow1080 || sorted[0];
}

/**
 * Selects the next lower fallback quality when a selected quality fails to load.
 * Never returns a quality already in `attemptedUrls` to prevent infinite retry loops.
 */
export function selectNextFallbackQuality(
  qualities: ZokoAnimeQuality[] | undefined | null,
  failedQualityUrl: string,
  attemptedUrls: Set<string>
): ZokoAnimeQuality | null {
  const sorted = normalizeAndSortQualities(qualities);
  if (sorted.length === 0) return null;

  const failedItem = sorted.find((q) => q.hlsProxyUrl === failedQualityUrl);
  const failedHeight = failedItem ? parseQualityHeight(failedItem) : Infinity;

  // Prefer qualities strictly lower than the failed quality, ordered from highest to lowest
  const lowerCandidates = sorted.filter(
    (q) =>
      q.hlsProxyUrl !== failedQualityUrl &&
      !attemptedUrls.has(q.hlsProxyUrl) &&
      parseQualityHeight(q) < failedHeight
  );

  if (lowerCandidates.length > 0) {
    return lowerCandidates[0];
  }

  // If none had a smaller parsed height, try any remaining unattempted quality
  const remaining = sorted.find(
    (q) => q.hlsProxyUrl !== failedQualityUrl && !attemptedUrls.has(q.hlsProxyUrl)
  );
  return remaining || null;
}

/**
 * Normalizes subtitle tracks from the AniScroll ZokoAnime API response.
 * Uses `subtitles[].url` (proxy URL) as preferred source and `subtitles[].src` only as fallback.
 * Preserves labels, language codes, forced labels, and `default` flags.
 */
export function normalizeSubtitleTracks(rawSubtitles: unknown): SubtitleTrack[] {
  if (!Array.isArray(rawSubtitles)) return [];

  const tracks: SubtitleTrack[] = [];
  const seenUrls = new Set<string>();

  for (const raw of rawSubtitles) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;

    const proxyUrl = typeof item.url === 'string' ? item.url.trim() : '';
    const directSrc = typeof item.src === 'string' ? item.src.trim() : '';

    // Priority: subtitles[].url first, fallback to subtitles[].src only when proxy URL is missing
    const effectiveUrl = isValidHttpUrl(proxyUrl)
      ? proxyUrl
      : isValidHttpUrl(directSrc)
      ? directSrc
      : '';

    if (!effectiveUrl || seenUrls.has(effectiveUrl)) continue;
    seenUrls.add(effectiveUrl);

    const lang =
      typeof item.lang === 'string' && item.lang.trim() ? item.lang.trim() : 'en';
    const label =
      typeof item.label === 'string' && item.label.trim()
        ? item.label.trim()
        : lang;

    tracks.push({
      lang,
      label,
      default: Boolean(item.default),
      src: isValidHttpUrl(directSrc) ? directSrc : undefined,
      url: effectiveUrl,
    });
  }

  return tracks;
}

/**
 * Resolves which subtitle track URL to activate for a stream given the user's current SubtitlePreference.
 * - If `preference === 'off'`, ALWAYS returns `'off'` (never reactivates default subtitles).
 * - If `preference` is a specific track URL/label, matches that track by URL or label/lang if available.
 * - If `preference === null` (uninitialized), selects the track with `default: true`, or English, or `'off'`.
 */
export function resolveSubtitleTrackForPreference(
  subtitles: SubtitleTrack[] | undefined | null,
  preference: SubtitlePreference | null
): SubtitlePreference {
  if (preference === 'off') {
    return 'off';
  }

  const tracks = Array.isArray(subtitles) ? subtitles : [];
  if (tracks.length === 0) {
    return 'off';
  }

  if (typeof preference === 'string' && preference !== '') {
    // 1. Exact URL match (e.g. when switching quality within the same episode)
    const exactUrlMatch = tracks.find((t) => t.url === preference);
    if (exactUrlMatch) return exactUrlMatch.url;

    // 2. Match by label or language across episodes
    const normalizedPref = preference.trim().toLowerCase();
    const labelMatch = tracks.find(
      (t) =>
        (t.label && t.label.trim().toLowerCase() === normalizedPref) ||
        t.lang.trim().toLowerCase() === normalizedPref
    );
    if (labelMatch) return labelMatch.url;
  }

  // Uninitialized or previous language not in current episode: choose API default track
  const defaultTrack =
    tracks.find((t) => t.default) ||
    tracks.find(
      (t) =>
        (t.label && t.label.toLowerCase().includes('english') && !t.label.toLowerCase().includes('forced')) ||
        t.lang.toLowerCase() === 'en'
    ) ||
    tracks[0];

  return defaultTrack ? defaultTrack.url : 'off';
}

/**
 * Validates a raw AniScroll ZokoAnime API response.
 * Returns a normalized `AniScrollStreamResponse` if and only if the response is valid,
 * matches the requested episode/version, and has at least one usable playable source.
 */
export function validateZokoAnimeResponse(
  raw: unknown,
  expectedAnilistId?: number,
  expectedEpisode?: number,
  expectedType?: 'sub' | 'dub'
): AniScrollStreamResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // Reject error payloads (even if returned with HTTP 200)
  if (typeof obj.error === 'string' && obj.error.trim() !== '') {
    return null;
  }
  if (obj.ok === false) {
    return null;
  }

  const anilistId = Number(obj.anilistId);
  const episode = Number(obj.episode);
  const rawType = typeof obj.type === 'string' ? obj.type.trim().toLowerCase() : '';
  const type: 'sub' | 'dub' | null =
    rawType === 'sub' ? 'sub' : rawType === 'dub' ? 'dub' : null;

  if (!Number.isFinite(anilistId) || anilistId <= 0) return null;
  if (!Number.isFinite(episode) || episode <= 0) return null;
  if (!type) return null;

  if (expectedAnilistId !== undefined && anilistId !== Number(expectedAnilistId)) {
    return null;
  }
  if (expectedEpisode !== undefined && episode !== Number(expectedEpisode)) {
    return null;
  }
  if (expectedType !== undefined && type !== expectedType) {
    return null;
  }

  const qualities = normalizeAndSortQualities(obj.qualities);
  const subtitles = normalizeSubtitleTracks(obj.subtitles);
  const topLevelHlsProxyUrl =
    typeof obj.hlsProxyUrl === 'string' && isValidHttpUrl(obj.hlsProxyUrl)
      ? obj.hlsProxyUrl.trim()
      : undefined;
  const embedUrl =
    typeof obj.embedUrl === 'string' && isValidHttpUrl(obj.embedUrl)
      ? obj.embedUrl.trim()
      : undefined;
  const iframeOnly = Boolean(obj.iframeOnly);
  const playbackMode =
    typeof obj.playbackMode === 'string' && obj.playbackMode.trim()
      ? obj.playbackMode.trim()
      : iframeOnly
      ? 'embed'
      : 'hls';

  // Check playability:
  // - If iframeOnly or embed mode: requires a valid embedUrl
  // - For HLS playback: requires at least one usable HLS source in qualities[] or top-level hlsProxyUrl
  const hasUsableHls = qualities.length > 0 || Boolean(topLevelHlsProxyUrl);
  if (iframeOnly || playbackMode === 'embed') {
    if (!embedUrl && !hasUsableHls) return null;
  } else {
    if (!hasUsableHls) return null;
  }

  const selectedInitialQuality = selectInitialQuality(qualities);
  const primaryHlsUrl = selectedInitialQuality?.hlsProxyUrl || topLevelHlsProxyUrl;

  return {
    source: typeof obj.source === 'string' ? obj.source : 'zokoanime',
    anilistId,
    malId:
      typeof obj.malId === 'number' && Number.isFinite(obj.malId) ? obj.malId : null,
    title: typeof obj.title === 'string' ? obj.title : undefined,
    episode,
    type,
    embedUrl,
    m3u8: typeof obj.m3u8 === 'string' ? obj.m3u8 : undefined,
    qualities,
    subtitles,
    downloadUrl: typeof obj.downloadUrl === 'string' ? obj.downloadUrl : undefined,
    videoId:
      typeof obj.videoId === 'number' || typeof obj.videoId === 'string'
        ? obj.videoId
        : undefined,
    // Preserve raw skip only for typing completeness; AniSkip is used exclusively for intro/outro skipping
    skip: null,
    playbackMode,
    serverName: typeof obj.serverName === 'string' ? obj.serverName : 'ZokoAnime',
    server: typeof obj.serverName === 'string' ? obj.serverName : 'ZokoAnime',
    availableServers: ['ZokoAnime'],
    hlsProxyUrl: topLevelHlsProxyUrl || primaryHlsUrl,
    iframeOnly,
  };
}

/**
 * Resolves which version ('sub' | 'dub' | null) should be selected for an episode
 * given dynamic Sub/Dub availability and optional user manual selection.
 *
 * Rules:
 * - Both available: default to 'sub', unless user manually selected 'dub'.
 * - Sub only: automatically select 'sub'.
 * - Dub only: automatically select 'dub'.
 * - Neither available: return null (do not initialize playback).
 */
export function selectEpisodeAudioVersion(params: {
  subAvailable: boolean;
  dubAvailable: boolean;
  userSelectedVersion?: 'sub' | 'dub' | null;
}): 'sub' | 'dub' | null {
  const { subAvailable, dubAvailable, userSelectedVersion } = params;

  if (subAvailable && dubAvailable) {
    if (userSelectedVersion === 'dub') return 'dub';
    return 'sub';
  }
  if (subAvailable) return 'sub';
  if (dubAvailable) return 'dub';
  return null;
}
