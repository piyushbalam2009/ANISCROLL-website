import {
  AniScrollStreamResponse,
  HlsManifestQualityLevel,
  StreamingProvider,
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

    // 2. Match by label or language across episodes (including 'en' <-> 'English')
    const normalizedPref = preference.trim().toLowerCase();
    const labelMatch = tracks.find((t) => {
      const lbl = t.label ? t.label.trim().toLowerCase() : '';
      const lng = t.lang.trim().toLowerCase();
      if (lbl === normalizedPref || lng === normalizedPref) return true;
      if (normalizedPref === 'en' && (lbl === 'english' || lng === 'english')) return true;
      if (normalizedPref === 'english' && (lbl === 'en' || lng === 'en')) return true;
      return false;
    });
    if (labelMatch) return labelMatch.url;
  }

  // Uninitialized or previous language not in current episode: choose API default track
  const defaultTrack =
    tracks.find((t) => t.default) ||
    tracks.find(
      (t) =>
        (t.label && t.label.toLowerCase().includes('english') && !t.label.toLowerCase().includes('forced')) ||
        t.lang.toLowerCase() === 'en' ||
        t.lang.toLowerCase() === 'english'
    ) ||
    tracks[0];

  return defaultTrack ? defaultTrack.url : 'off';
}

/**
 * Validates and normalizes a raw AniScroll streaming provider response
 * (`megaplay` for anime series, `zokoanime` for anime movies).
 *
 * MegaPlay returns a single master HLS proxy URL (`hlsProxyUrl`) with `qualities` absent/empty
 * and `server` / `availableServers` fields.
 * ZokoAnime returns `qualities[]` and/or `hlsProxyUrl` and `serverName`.
 * Both ignore upstream `intro`/`outro` skip markers so AniSkip remains independent.
 */
export function validateProviderStreamResponse(
  raw: unknown,
  provider: StreamingProvider,
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

  // Playability validation:
  // - Embed mode requires embedUrl (or usable HLS fallback)
  // - HLS mode requires either qualities[] (ZokoAnime) or top-level master hlsProxyUrl (MegaPlay / ZokoAnime fallback)
  const hasUsableHls = qualities.length > 0 || Boolean(topLevelHlsProxyUrl);
  if (iframeOnly || playbackMode === 'embed') {
    if (!embedUrl && !hasUsableHls) return null;
  } else {
    if (!hasUsableHls) return null;
  }

  const selectedInitialQuality = selectInitialQuality(qualities);
  const primaryHlsUrl = selectedInitialQuality?.hlsProxyUrl || topLevelHlsProxyUrl;

  const defaultServerLabel = provider === 'megaplay' ? 'MegaPlay Direct' : 'ZokoAnime';
  const resolvedServerName =
    typeof obj.serverName === 'string' && obj.serverName.trim()
      ? obj.serverName.trim()
      : typeof obj.server === 'string' && obj.server.trim()
      ? obj.server.trim()
      : defaultServerLabel;

  const resolvedAvailableServers =
    Array.isArray(obj.availableServers) && obj.availableServers.length > 0
      ? obj.availableServers.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      : [resolvedServerName];

  return {
    source: typeof obj.source === 'string' && obj.source.trim() ? obj.source.trim() : provider,
    provider,
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
    // Always null so AniSkip stays independent of upstream streaming providers
    skip: null,
    playbackMode,
    serverName: resolvedServerName,
    server: resolvedServerName,
    availableServers:
      resolvedAvailableServers.length > 0 ? resolvedAvailableServers : [resolvedServerName],
    hlsProxyUrl: topLevelHlsProxyUrl || primaryHlsUrl,
    iframeOnly,
  };
}

export function validateZokoAnimeResponse(
  raw: unknown,
  expectedAnilistId?: number,
  expectedEpisode?: number,
  expectedType?: 'sub' | 'dub'
): AniScrollStreamResponse | null {
  return validateProviderStreamResponse(
    raw,
    'zokoanime',
    expectedAnilistId,
    expectedEpisode,
    expectedType
  );
}

export function validateMegaPlayResponse(
  raw: unknown,
  expectedAnilistId?: number,
  expectedEpisode?: number,
  expectedType?: 'sub' | 'dub'
): AniScrollStreamResponse | null {
  return validateProviderStreamResponse(
    raw,
    'megaplay',
    expectedAnilistId,
    expectedEpisode,
    expectedType
  );
}

/**
 * Normalizes HLS.js parsed master playlist levels (`hls.levels`) into unique,
 * descending-resolution options while preserving exact `levelIndex` references for `hls.currentLevel`.
 * Used for MegaPlay master HLS playlists (which do not provide separate per-quality API URLs).
 */
export function normalizeHlsMasterLevels(
  rawLevels: ReadonlyArray<{
    height?: number;
    width?: number;
    bitrate?: number;
    name?: string;
  }> | null | undefined
): HlsManifestQualityLevel[] {
  if (!Array.isArray(rawLevels) || rawLevels.length === 0) return [];

  const candidates: HlsManifestQualityLevel[] = [];

  rawLevels.forEach((lvl, idx) => {
    if (!lvl || typeof lvl !== 'object') return;
    let height =
      typeof lvl.height === 'number' && Number.isFinite(lvl.height) && lvl.height > 0
        ? Math.round(lvl.height)
        : 0;
    const width =
      typeof lvl.width === 'number' && Number.isFinite(lvl.width) && lvl.width > 0
        ? Math.round(lvl.width)
        : undefined;
    const bandwidth =
      typeof lvl.bitrate === 'number' && Number.isFinite(lvl.bitrate) && lvl.bitrate > 0
        ? Math.round(lvl.bitrate)
        : undefined;

    if (height === 0 && typeof lvl.name === 'string') {
      const m = lvl.name.match(/(\d{3,4})\s*p?/i);
      if (m) {
        const parsed = parseInt(m[1], 10);
        if (Number.isFinite(parsed) && parsed > 0) height = parsed;
      }
    }

    if (height <= 0) return;

    const label = `${height}p`;
    const resolution = width && height ? `${width}x${height}` : undefined;
    candidates.push({
      levelIndex: idx,
      label,
      height,
      width,
      resolution,
      bandwidth,
    });
  });

  if (candidates.length === 0) return [];

  // Deduplicate identical heights (keep highest bitrate variant for each resolution)
  const byHeight = new Map<number, HlsManifestQualityLevel>();
  for (const item of candidates) {
    const existing = byHeight.get(item.height);
    if (!existing || (item.bandwidth || 0) > (existing.bandwidth || 0)) {
      byHeight.set(item.height, item);
    }
  }

  return Array.from(byHeight.values()).sort((a, b) => {
    const diff = b.height - a.height;
    if (diff !== 0) return diff;
    return (b.bandwidth || 0) - (a.bandwidth || 0);
  });
}

/**
 * Selects the preferred initial HLS.js level index from parsed master playlist levels:
 * 1. Exact 1080p if present
 * 2. Exact 720p, 480p, 360p in priority order
 * 3. Highest usable resolution <= 1080p
 * 4. Highest available resolution, or `-1` (Auto) if none detected
 */
export function selectInitialHlsLevelIndex(
  levels: ReadonlyArray<HlsManifestQualityLevel> | null | undefined
): number {
  if (!Array.isArray(levels) || levels.length === 0) return -1;

  for (const targetHeight of QUALITY_PRIORITY_ORDER) {
    const match = levels.find((l) => l.height === targetHeight);
    if (match) return match.levelIndex;
  }

  const sorted = [...levels].sort((a, b) => b.height - a.height);
  const highestAtOrBelow1080 = sorted.find((l) => l.height > 0 && l.height <= 1080);
  return highestAtOrBelow1080 ? highestAtOrBelow1080.levelIndex : sorted[0].levelIndex;
}

export type AudioMode = 'sub' | 'dub';

/**
 * Resolves the effective audio preference while keeping manual session selection
 * logically separate from the persistent Default Audio Mode setting.
 *
 * Priority:
 * 1. Explicit manual selection (`manualSelection`: 'sub' | 'dub')
 * 2. Persistent Default Audio Mode (`defaultAudio`: 'sub' | 'dub')
 * 3. Fallback default ('sub')
 */
export function resolveEffectiveAudioPreference(params: {
  manualSelection?: AudioMode | null;
  defaultAudio?: AudioMode | null;
}): AudioMode {
  if (params.manualSelection === 'dub' || params.manualSelection === 'sub') {
    return params.manualSelection;
  }
  if (params.defaultAudio === 'dub' || params.defaultAudio === 'sub') {
    return params.defaultAudio;
  }
  return 'sub';
}

/**
 * Resolves which version ('sub' | 'dub' | null) should be selected for an episode
 * given dynamic Sub/Dub availability, optional manual user selection, and Default Audio Mode setting.
 *
 * Rules:
 * - Neither available: return null (do not initialize playback).
 * - Preferred = 'dub' (manual override OR defaultAudio === 'dub'):
 *   - Select 'dub' if available; otherwise fall back to 'sub' if available.
 * - Preferred = 'sub' (manual override OR defaultAudio === 'sub'):
 *   - Select 'sub' if available; otherwise fall back to 'dub' if available.
 */
export function selectEpisodeAudioVersion(params: {
  subAvailable: boolean;
  dubAvailable: boolean;
  userSelectedVersion?: AudioMode | null;
  defaultAudio?: AudioMode | null;
}): AudioMode | null {
  const { subAvailable, dubAvailable, userSelectedVersion, defaultAudio } = params;

  if (!subAvailable && !dubAvailable) {
    return null;
  }

  const preferred = resolveEffectiveAudioPreference({
    manualSelection: userSelectedVersion,
    defaultAudio,
  });

  if (preferred === 'dub') {
    return dubAvailable ? 'dub' : subAvailable ? 'sub' : null;
  }

  return subAvailable ? 'sub' : dubAvailable ? 'dub' : null;
}

export interface HlsAudioTrackLike {
  id?: number;
  name?: string | null;
  label?: string | null;
  lang?: string | null;
  language?: string | null;
  default?: boolean;
  autoselect?: boolean;
  forced?: boolean;
  groupId?: string | null;
  url?: string | null;
}

function isDescriptiveAudioTrack(name: string, lang: string): boolean {
  return /\b(?:descriptive|description|commentary|audio\s*description|ad)\b/i.test(name) || lang === 'commentary';
}

/**
 * Selects the matching audio track index from a multi-audio HLS playlist
 * (`hls.audioTracks` or native `AudioTrackList`) for the requested audio version ('sub' | 'dub').
 *
 * Returns `-1` when the stream has `<= 1` audio track (single-audio playlist) or no match is needed.
 */
export function selectHlsAudioTrackIndex(
  tracks: ReadonlyArray<HlsAudioTrackLike> | null | undefined,
  audioMode: AudioMode
): number {
  if (!Array.isArray(tracks) || tracks.length <= 1) {
    return -1;
  }

  const normalized = tracks.map((track, idx) => {
    const lang = (track.lang ?? track.language ?? '').trim().toLowerCase();
    const name = (track.name ?? track.label ?? '').trim().toLowerCase();
    const url = (track.url ?? '').trim().toLowerCase();
    return {
      idx,
      track,
      lang,
      name,
      url,
      isDescriptive: isDescriptiveAudioTrack(name, lang),
    };
  });

  if (audioMode === 'dub') {
    const isEnglishLang = (lang: string) => /^(?:en|eng)(?:[-_]|$)/i.test(lang);
    const isEnglishName = (name: string) => /\b(?:english|eng|dub|dubbed)\b/i.test(name);
    const isEnglishUrl = (url: string) => /\/audio\/en(?:\/|$)|[._-]eng?(?:[._/-]|$)/i.test(url);

    // Priority 1: Non-descriptive English track matching lang code (prefer autoselect/default)
    const langMatches = normalized.filter((t) => !t.isDescriptive && isEnglishLang(t.lang));
    if (langMatches.length > 0) {
      const preferred = langMatches.find((t) => t.track.autoselect || t.track.default) || langMatches[0];
      return preferred.idx;
    }

    // Priority 2: Non-descriptive track matching English/Dub name
    const nameMatches = normalized.filter((t) => !t.isDescriptive && isEnglishName(t.name));
    if (nameMatches.length > 0) {
      const preferred = nameMatches.find((t) => t.track.autoselect || t.track.default) || nameMatches[0];
      return preferred.idx;
    }

    // Priority 3: Track URL explicitly pointing to /audio/en
    const urlMatches = normalized.filter((t) => !t.isDescriptive && isEnglishUrl(t.url));
    if (urlMatches.length > 0) {
      return urlMatches[0].idx;
    }

    // Priority 4: Any English track as last resort
    const anyEn = normalized.find(
      (t) => isEnglishLang(t.lang) || isEnglishName(t.name) || isEnglishUrl(t.url)
    );
    return anyEn ? anyEn.idx : -1;
  }

  // audioMode === 'sub'
  const isJapaneseLang = (lang: string) => /^(?:ja|jp|jpn)(?:[-_]|$)/i.test(lang);
  const isJapaneseName = (name: string) => /\b(?:japanese|jpn|nihongo|original|sub|subbed)\b/i.test(name);
  const isJapaneseUrl = (url: string) => /\/audio\/ja(?:\/|$)|[._-]jpn?(?:[._/-]|$)/i.test(url);

  const jaLangMatch = normalized.find((t) => !t.isDescriptive && isJapaneseLang(t.lang));
  if (jaLangMatch) return jaLangMatch.idx;

  const jaNameMatch = normalized.find((t) => !t.isDescriptive && isJapaneseName(t.name));
  if (jaNameMatch) return jaNameMatch.idx;

  const jaUrlMatch = normalized.find((t) => !t.isDescriptive && isJapaneseUrl(t.url));
  if (jaUrlMatch) return jaUrlMatch.idx;

  // Fallback for SUB: default track if it isn't explicitly English
  const nonEnglishDefault = normalized.find(
    (t) => t.track.default && !/^(?:en|eng)(?:[-_]|$)/i.test(t.lang)
  );
  return nonEnglishDefault ? nonEnglishDefault.idx : -1;
}

/**
 * Redacts query parameters/tokens from stream URLs for safe diagnostic logging.
 */
export function sanitizeStreamUrlForDiagnostic(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const innerUrlParam = parsed.searchParams.get('url');
    if (innerUrlParam) {
      try {
        const inner = new URL(innerUrlParam);
        return `${parsed.origin}${parsed.pathname}?target=${inner.origin}${inner.pathname}`;
      } catch {
        return `${parsed.origin}${parsed.pathname}?target=redacted`;
      }
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return trimmed.split('?')[0] || null;
  }
}

