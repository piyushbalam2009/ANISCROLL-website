import type {
  AniScrollStreamResponse,
  StreamingProvider,
  ZokoAnimeQuality,
} from '@/types/streaming';
import {
  isValidHttpUrl,
  normalizeAndSortQualities,
  parseQualityHeight,
  selectHlsAudioTrackIndex,
  type AudioMode,
  type HlsAudioTrackLike,
} from '@/lib/zokoanime-stream';

export type DownloadAudioVersion = AudioMode;

export type DownloadStage =
  | 'idle'
  | 'preparing'
  | 'fetching_stream'
  | 'downloading_segments'
  | 'processing_mp4'
  | 'saving'
  | 'completed'
  | 'cancelled'
  | 'error';

export type HlsDownloadErrorCode =
  | 'ABORTED'
  | 'EMBED_ONLY'
  | 'DRM_UNSUPPORTED'
  | 'INVALID_PLAYLIST'
  | 'INVALID_SEGMENT'
  | 'NETWORK_ERROR'
  | 'UNSUPPORTED_FORMAT'
  | 'MEMORY_LIMIT'
  | 'CONVERSION_FAILED';

export class HlsDownloadError extends Error {
  code: HlsDownloadErrorCode;
  recoverable: boolean;

  constructor(
    code: HlsDownloadErrorCode,
    message: string,
    recoverable = code !== 'DRM_UNSUPPORTED' && code !== 'EMBED_ONLY'
  ) {
    super(message);
    this.name = 'HlsDownloadError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

export interface DownloadQualityOption {
  id: string;
  label: string;
  resolution?: string;
  height?: number;
  bandwidth?: number;
  playlistUrl: string;
  audioGroupId?: string;
  audioTracks?: HlsAudioTrackLike[];
  isSinglePlaylistFallback?: boolean;
}

export interface DownloadQualitiesResult {
  options: DownloadQualityOption[];
  audioTracks: HlsAudioTrackLike[];
  unsupportedReason?: 'embed_only' | 'drm_unsupported' | 'unavailable';
  errorMessage?: string;
}

export interface HlsByteRange {
  length: number;
  offset: number;
}

export interface HlsEncryptionKeyInfo {
  method: 'NONE' | 'AES-128';
  uri?: string;
  iv?: string;
}

export interface ParsedHlsVariant {
  bandwidth?: number;
  resolution?: string;
  width?: number;
  height?: number;
  name?: string;
  codecs?: string;
  audioGroupId?: string;
  playlistUrl: string;
}

export interface ParsedHlsSegment {
  index: number;
  url: string;
  duration: number;
  byteRange?: HlsByteRange;
  key?: HlsEncryptionKeyInfo;
}

export interface ParsedHlsMasterPlaylist {
  kind: 'master';
  variants: ParsedHlsVariant[];
  audioTracks: HlsAudioTrackLike[];
}

export interface ParsedHlsMediaPlaylist {
  kind: 'media';
  segments: ParsedHlsSegment[];
  initMapUrl?: string;
  initByteRange?: HlsByteRange;
  isFmp4: boolean;
  totalDurationSeconds: number;
}

export type ParsedHlsPlaylist = ParsedHlsMasterPlaylist | ParsedHlsMediaPlaylist;

export interface DownloadProgressState {
  stage: DownloadStage;
  label: string;
  percent: number | null;
  downloadedBytes: number;
  completedSegments: number;
  totalSegments: number;
  speedBytesPerSec: number;
  estimatedTotalBytes: number | null;
  filename: string | null;
  error: string | null;
}

export interface DownloadHlsParams {
  animeTitle: string;
  episodeNumber: number;
  audioType: DownloadAudioVersion;
  quality: DownloadQualityOption;
  provider?: StreamingProvider;
  signal?: AbortSignal;
  onProgress?: (state: DownloadProgressState) => void;
  fetchFn?: typeof fetch;
}

export interface DownloadHlsResult {
  filename: string;
  byteLength: number;
  mimeType: 'video/mp4';
}

// Conservative upper bound to prevent mobile browser tab OOM during in-memory remuxing (1.25 GiB)
export const MAX_BROWSER_REMUX_BYTES = Math.round(1.25 * 1024 * 1024 * 1024);

function normalizeFetchFn(customFetch?: typeof fetch): typeof fetch {
  if (customFetch && customFetch !== globalThis.fetch) {
    return (input: RequestInfo | URL, init?: RequestInit) => customFetch(input, init);
  }
  return (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init);
}

export function formatEpisodeNumberPad(episodeNumber: number): string {
  const safeNum =
    Number.isFinite(episodeNumber) && episodeNumber > 0
      ? Math.floor(episodeNumber)
      : 1;
  return safeNum < 10 ? `0${safeNum}` : String(safeNum);
}

/**
 * Produces a clean, filesystem-safe MP4 filename following:
 * `Anime-Title-Episode-08-1080p-Dub.mp4`
 */
export function sanitizeDownloadFilename(params: {
  animeTitle?: string | null;
  episodeNumber: number;
  qualityLabel?: string | null;
  audioType: DownloadAudioVersion;
}): string {
  const rawTitle = (params.animeTitle || 'Anime').trim();
  const normalizedTitle = rawTitle
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72)
    .replace(/-$/g, '');

  const safeTitle = normalizedTitle || 'Anime';
  const epPad = formatEpisodeNumberPad(params.episodeNumber);
  const rawQuality = (params.qualityLabel || 'Source').trim();
  const safeQuality =
    rawQuality
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'Source';
  const audioLabel = params.audioType === 'dub' ? 'Dub' : 'Sub';

  return `${safeTitle}-Episode-${epPad}-${safeQuality}-${audioLabel}.mp4`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatTransferSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '';
  if (bytesPerSec < 1024 * 1024) {
    return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  }
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

/**
 * Resolves a playlist/segment URI against its parent M3U8 URL.
 * Preserves `/api/proxy/hls?url=...&ref=...` proxy wrappers when a relative URI appears inside a proxied playlist.
 */
export function resolveHlsUrl(uri: string, baseUrl: string): string {
  const trimmed = uri.trim();
  if (!trimmed) {
    throw new HlsDownloadError('INVALID_PLAYLIST', 'Playlist contains an empty segment URL.');
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }

  try {
    const parsedBase = new URL(baseUrl);
    if (
      parsedBase.pathname.includes('/proxy/hls') &&
      parsedBase.searchParams.has('url')
    ) {
      const innerTarget = parsedBase.searchParams.get('url');
      if (innerTarget) {
        const resolvedInner = new URL(trimmed, innerTarget).toString();
        const rebuilt = new URL(parsedBase.toString());
        rebuilt.searchParams.set('url', resolvedInner);
        return rebuilt.toString();
      }
    }
    return new URL(trimmed, parsedBase).toString();
  } catch {
    return trimmed;
  }
}

/**
 * Parses M3U8 attribute lists (`KEY=VALUE,KEY2="QUOTED,VALUE"`).
 */
export function parseHlsAttributeList(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  let i = 0;
  const len = raw.length;

  while (i < len) {
    while (i < len && (raw[i] === ' ' || raw[i] === ',' || raw[i] === '\t')) {
      i += 1;
    }
    if (i >= len) break;

    const eqIdx = raw.indexOf('=', i);
    if (eqIdx === -1) break;
    const key = raw.slice(i, eqIdx).trim().toUpperCase();
    i = eqIdx + 1;

    let value = '';
    if (i < len && raw[i] === '"') {
      i += 1;
      const start = i;
      while (i < len && raw[i] !== '"') {
        i += 1;
      }
      value = raw.slice(start, i);
      if (i < len && raw[i] === '"') i += 1;
    } else {
      const start = i;
      while (i < len && raw[i] !== ',') {
        i += 1;
      }
      value = raw.slice(start, i).trim();
    }

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

export function looksLikeHtmlOrJsonError(text: string, contentType?: string | null): boolean {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml+xml')) {
    return true;
  }
  const head = text.trimStart().slice(0, 512).toLowerCase();
  if (
    head.startsWith('<!doctype') ||
    head.startsWith('<html') ||
    head.startsWith('<head') ||
    head.startsWith('<body') ||
    head.startsWith('<script') ||
    head.startsWith('{')
  ) {
    return true;
  }
  return false;
}

export function validatePlaylistText(text: string, contentType?: string | null): void {
  if (!text || !text.trim()) {
    throw new HlsDownloadError('INVALID_PLAYLIST', 'Stream playlist response was empty.');
  }
  if (looksLikeHtmlOrJsonError(text, contentType)) {
    throw new HlsDownloadError(
      'INVALID_PLAYLIST',
      'Stream returned an HTML or error page instead of a valid HLS playlist.'
    );
  }
  const firstNonEmpty = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstNonEmpty || !firstNonEmpty.startsWith('#EXTM3U')) {
    throw new HlsDownloadError(
      'INVALID_PLAYLIST',
      'Invalid HLS playlist: missing #EXTM3U header.'
    );
  }
}

export function parseByteRangeAttr(
  raw: string,
  previousEndOffset = 0
): HlsByteRange | undefined {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d+)(?:@(\d+))?$/);
  if (!match) return undefined;
  const length = parseInt(match[1], 10);
  const offset = match[2] !== undefined ? parseInt(match[2], 10) : previousEndOffset;
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(offset) || offset < 0) {
    return undefined;
  }
  return { length, offset };
}

function assertSupportedHlsKey(attrs: Record<string, string>): HlsEncryptionKeyInfo | null {
  const method = (attrs.METHOD || '').trim().toUpperCase();
  const keyFormat = (attrs.KEYFORMAT || '').trim().toLowerCase();

  if (!method || method === 'NONE') {
    return { method: 'NONE' };
  }

  if (
    method.includes('SAMPLE-AES') ||
    keyFormat.includes('streamingkeydelivery') ||
    keyFormat.includes('widevine') ||
    keyFormat.includes('playready') ||
    keyFormat.includes('edef8ba9-79d6-4ace-a3c8-27dcd51d21ed') ||
    keyFormat.includes('9a04f079-9840-4286-ab92-e65be0885f95')
  ) {
    throw new HlsDownloadError(
      'DRM_UNSUPPORTED',
      'This stream uses DRM encryption and cannot be downloaded.',
      false
    );
  }

  if (method !== 'AES-128') {
    throw new HlsDownloadError(
      'DRM_UNSUPPORTED',
      `Unsupported stream encryption method (${method}).`,
      false
    );
  }

  return {
    method: 'AES-128',
    uri: attrs.URI,
    iv: attrs.IV,
  };
}

/**
 * Parses either a Master M3U8 playlist (#EXT-X-STREAM-INF / #EXT-X-MEDIA)
 * or a Media M3U8 playlist (#EXTINF segments).
 */
export function parseHlsPlaylist(
  text: string,
  baseUrl: string,
  contentType?: string | null
): ParsedHlsPlaylist {
  validatePlaylistText(text, contentType);

  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const audioTracks: HlsAudioTrackLike[] = [];
  const variants: ParsedHlsVariant[] = [];
  const segments: ParsedHlsSegment[] = [];

  let isMaster = false;
  let pendingStreamInf: Record<string, string> | null = null;
  let pendingExtInfDuration: number | null = null;
  let pendingByteRange: HlsByteRange | undefined;
  let lastByteRangeEnd = 0;
  let currentKey: HlsEncryptionKeyInfo | undefined;
  let initMapUrl: string | undefined;
  let initByteRange: HlsByteRange | undefined;
  let isFmp4 = false;

  for (const line of lines) {
    if (!line) continue;

    if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseHlsAttributeList(line.slice('#EXT-X-KEY:'.length));
      const parsedKey = assertSupportedHlsKey(attrs);
      if (parsedKey?.method === 'NONE') {
        currentKey = undefined;
      } else if (parsedKey) {
        if (!parsedKey.uri) {
          throw new HlsDownloadError('DRM_UNSUPPORTED', 'Encrypted stream is missing a key URI.', false);
        }
        currentKey = {
          method: 'AES-128',
          uri: resolveHlsUrl(parsedKey.uri, baseUrl),
          iv: parsedKey.iv,
        };
      }
      continue;
    }

    if (line.startsWith('#EXT-X-SESSION-KEY:')) {
      const attrs = parseHlsAttributeList(line.slice('#EXT-X-SESSION-KEY:'.length));
      assertSupportedHlsKey(attrs);
      continue;
    }

    // Explicitly ignore I-frame playlists so trick-play streams are never picked as video variants
    if (line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
      continue;
    }

    if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = parseHlsAttributeList(line.slice('#EXT-X-MEDIA:'.length));
      if ((attrs.TYPE || '').toUpperCase() === 'AUDIO') {
        const uri = attrs.URI ? resolveHlsUrl(attrs.URI, baseUrl) : null;
        audioTracks.push({
          id: audioTracks.length,
          groupId: attrs['GROUP-ID'] || null,
          name: attrs.NAME || null,
          lang: attrs.LANGUAGE || null,
          default: (attrs.DEFAULT || '').toUpperCase() === 'YES',
          autoselect: (attrs.AUTOSELECT || '').toUpperCase() === 'YES',
          forced: (attrs.FORCED || '').toUpperCase() === 'YES',
          url: uri,
        });
      }
      continue;
    }

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      isMaster = true;
      pendingStreamInf = parseHlsAttributeList(line.slice('#EXT-X-STREAM-INF:'.length));
      continue;
    }

    if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseHlsAttributeList(line.slice('#EXT-X-MAP:'.length));
      if (attrs.URI) {
        initMapUrl = resolveHlsUrl(attrs.URI, baseUrl);
        isFmp4 = true;
        if (attrs.BYTERANGE) {
          initByteRange = parseByteRangeAttr(attrs.BYTERANGE, 0);
        }
      }
      continue;
    }

    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      const parsedRange = parseByteRangeAttr(
        line.slice('#EXT-X-BYTERANGE:'.length),
        lastByteRangeEnd
      );
      if (parsedRange) {
        pendingByteRange = parsedRange;
        lastByteRangeEnd = parsedRange.offset + parsedRange.length;
      }
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const durStr = line.slice('#EXTINF:'.length).split(',')[0].trim();
      const parsedDur = parseFloat(durStr);
      pendingExtInfDuration = Number.isFinite(parsedDur) && parsedDur > 0 ? parsedDur : 0;
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    // Non-comment URI line
    if (pendingStreamInf) {
      const attrs = pendingStreamInf;
      pendingStreamInf = null;

      const resolution = attrs.RESOLUTION;
      let width: number | undefined;
      let height: number | undefined;
      if (resolution) {
        const resMatch = resolution.match(/(\d+)\s*x\s*(\d+)/i);
        if (resMatch) {
          width = parseInt(resMatch[1], 10);
          height = parseInt(resMatch[2], 10);
        }
      }
      if (!height && attrs.NAME) {
        const nameMatch = attrs.NAME.match(/(\d{3,4})\s*p?/i);
        if (nameMatch) height = parseInt(nameMatch[1], 10);
      }
      const bwRaw = attrs.BANDWIDTH ? parseInt(attrs.BANDWIDTH, 10) : undefined;
      const bandwidth = bwRaw && Number.isFinite(bwRaw) ? bwRaw : undefined;

      variants.push({
        bandwidth,
        resolution,
        width: width && Number.isFinite(width) ? width : undefined,
        height: height && Number.isFinite(height) ? height : undefined,
        name: attrs.NAME,
        codecs: attrs.CODECS,
        audioGroupId: attrs.AUDIO,
        playlistUrl: resolveHlsUrl(line, baseUrl),
      });
      continue;
    }

    if (pendingExtInfDuration !== null) {
      const duration = pendingExtInfDuration;
      pendingExtInfDuration = null;
      const segByteRange = pendingByteRange;
      pendingByteRange = undefined;

      segments.push({
        index: segments.length,
        url: resolveHlsUrl(line, baseUrl),
        duration,
        byteRange: segByteRange,
        key: currentKey ? { ...currentKey } : undefined,
      });
    }
  }

  if (isMaster || variants.length > 0) {
    if (variants.length === 0) {
      throw new HlsDownloadError('INVALID_PLAYLIST', 'Master playlist has no playable video variants.');
    }
    return {
      kind: 'master',
      variants,
      audioTracks,
    };
  }

  if (segments.length === 0) {
    throw new HlsDownloadError('INVALID_PLAYLIST', 'HLS media playlist contains no video segments.');
  }

  const totalDurationSeconds = segments.reduce((sum, s) => sum + (s.duration || 0), 0);

  return {
    kind: 'media',
    segments,
    initMapUrl,
    initByteRange,
    isFmp4,
    totalDurationSeconds,
  };
}

/**
 * Normalizes parsed master playlist variants into descending resolution download options.
 */
export function buildQualityOptionsFromMaster(
  master: ParsedHlsMasterPlaylist
): DownloadQualityOption[] {
  const candidates: DownloadQualityOption[] = master.variants.map((variant, idx) => {
    const inferredHeight =
      variant.height ||
      parseQualityHeight({
        quality: variant.name,
        resolution: variant.resolution,
      });
    const cleanHeight = inferredHeight > 0 ? inferredHeight : undefined;
    const label = cleanHeight
      ? `${cleanHeight}p`
      : variant.name?.trim() || `Stream ${idx + 1}`;

    return {
      id: `${label}-${variant.bandwidth || idx}`,
      label,
      resolution:
        variant.resolution ||
        (variant.width && cleanHeight ? `${variant.width}x${cleanHeight}` : undefined),
      height: cleanHeight,
      bandwidth: variant.bandwidth,
      playlistUrl: variant.playlistUrl,
      audioGroupId: variant.audioGroupId,
      audioTracks: master.audioTracks,
    };
  });

  // Deduplicate identical labels (keep highest bandwidth)
  const byLabel = new Map<string, DownloadQualityOption>();
  for (const option of candidates) {
    const key = option.label.toLowerCase();
    const existing = byLabel.get(key);
    if (!existing || (option.bandwidth || 0) > (existing.bandwidth || 0)) {
      byLabel.set(key, option);
    }
  }

  return Array.from(byLabel.values()).sort((a, b) => {
    const hDiff = (b.height || 0) - (a.height || 0);
    if (hDiff !== 0) return hDiff;
    return (b.bandwidth || 0) - (a.bandwidth || 0);
  });
}

export function pickAudioPlaylistForVariant(params: {
  audioTracks: HlsAudioTrackLike[] | undefined;
  audioGroupId?: string;
  audioType: DownloadAudioVersion;
}): HlsAudioTrackLike | null {
  const allTracks = Array.isArray(params.audioTracks) ? params.audioTracks : [];
  if (allTracks.length === 0) return null;

  const groupTracks = params.audioGroupId
    ? allTracks.filter((t) => !t.groupId || t.groupId === params.audioGroupId)
    : allTracks;

  const tracksWithUrls = groupTracks.filter((t) => typeof t.url === 'string' && t.url.trim() !== '');
  if (tracksWithUrls.length === 0) return null;

  if (tracksWithUrls.length === 1) {
    return tracksWithUrls[0];
  }

  const matchedIdx = selectHlsAudioTrackIndex(tracksWithUrls, params.audioType);
  if (matchedIdx >= 0 && tracksWithUrls[matchedIdx]) {
    return tracksWithUrls[matchedIdx];
  }

  return (
    tracksWithUrls.find((t) => t.default || t.autoselect) ||
    tracksWithUrls[0] ||
    null
  );
}

/**
 * Inspects a stream response (and its master playlist if needed) and returns
 * only real available download qualities without fabricating nonexistent options.
 */
export async function resolveDownloadQualitiesFromStream(
  stream: AniScrollStreamResponse | null | undefined,
  options?: {
    signal?: AbortSignal;
    fetchFn?: typeof fetch;
  }
): Promise<DownloadQualitiesResult> {
  if (!stream) {
    return {
      options: [],
      audioTracks: [],
      unsupportedReason: 'unavailable',
      errorMessage: 'No stream is available for the selected audio version.',
    };
  }

  const discreteQualities: ZokoAnimeQuality[] = normalizeAndSortQualities(stream.qualities);
  const topLevelHlsUrl =
    typeof stream.hlsProxyUrl === 'string' && isValidHttpUrl(stream.hlsProxyUrl)
      ? stream.hlsProxyUrl.trim()
      : '';

  const isEmbedOnly =
    (stream.iframeOnly || stream.playbackMode === 'embed') &&
    discreteQualities.length === 0 &&
    !topLevelHlsUrl;

  if (isEmbedOnly) {
    return {
      options: [],
      audioTracks: [],
      unsupportedReason: 'embed_only',
      errorMessage:
        'This episode uses an external iframe embed with no downloadable HLS stream.',
    };
  }

  if (discreteQualities.length > 0) {
    return {
      options: discreteQualities.map((q) => {
        const height = parseQualityHeight(q);
        return {
          id: `${q.quality}-${q.hlsProxyUrl}`,
          label: q.quality,
          resolution: q.resolution,
          height: height > 0 ? height : undefined,
          bandwidth: q.bandwidth,
          playlistUrl: q.hlsProxyUrl,
        };
      }),
      audioTracks: [],
    };
  }

  if (!topLevelHlsUrl) {
    return {
      options: [],
      audioTracks: [],
      unsupportedReason: 'unavailable',
      errorMessage: 'No HLS playlist URL was returned for this audio version.',
    };
  }

  const fetchImpl = normalizeFetchFn(options?.fetchFn);
  let response: Response;
  try {
    response = await fetchImpl(topLevelHlsUrl, {
      signal: options?.signal,
      cache: 'no-store',
    });
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw err;
    }
    throw new HlsDownloadError(
      'NETWORK_ERROR',
      'Failed to fetch the HLS playlist. Please check your connection and retry.'
    );
  }

  if (!response.ok) {
    throw new HlsDownloadError(
      'INVALID_PLAYLIST',
      `Failed to load HLS playlist (HTTP ${response.status}).`
    );
  }

  const contentType = response.headers.get('content-type');
  const text = await response.text();
  const parsed = parseHlsPlaylist(text, topLevelHlsUrl, contentType);

  if (parsed.kind === 'master') {
    return {
      options: buildQualityOptionsFromMaster(parsed),
      audioTracks: parsed.audioTracks,
    };
  }

  // Direct single-quality media playlist (no fabricated extra qualities)
  return {
    options: [
      {
        id: `single-${topLevelHlsUrl}`,
        label: 'Original',
        playlistUrl: topLevelHlsUrl,
        isSinglePlaylistFallback: true,
      },
    ],
    audioTracks: [],
  };
}

export function looksLikeHtmlBinary(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) return true;
  const sampleLen = Math.min(256, bytes.byteLength);
  let text = '';
  for (let i = 0; i < sampleLen; i += 1) {
    text += String.fromCharCode(bytes[i]);
  }
  const head = text.trimStart().toLowerCase();
  return (
    head.startsWith('<!doctype') ||
    head.startsWith('<html') ||
    head.startsWith('<head') ||
    head.startsWith('<body') ||
    head.startsWith('{"error"')
  );
}

export function detectSegmentContainer(
  firstChunk: Uint8Array,
  hasInitMap: boolean
): 'mpegts' | 'fmp4' | 'aac' {
  if (hasInitMap) return 'fmp4';
  if (firstChunk.byteLength >= 8) {
    const boxType = String.fromCharCode(
      firstChunk[4],
      firstChunk[5],
      firstChunk[6],
      firstChunk[7]
    );
    if (boxType === 'ftyp' || boxType === 'styp' || boxType === 'moof' || boxType === 'sidx') {
      return 'fmp4';
    }
  }
  // Check for MPEG-TS sync byte 0x47 (allowing optional leading ID3/padding in first 564 bytes)
  const scanLimit = Math.min(firstChunk.byteLength, 564);
  for (let i = 0; i < scanLimit; i += 1) {
    if (firstChunk[i] === 0x47) {
      if (i + 188 >= firstChunk.byteLength || firstChunk[i + 188] === 0x47) {
        return 'mpegts';
      }
    }
  }
  // Raw ADTS AAC or ID3-tagged AAC
  if (
    firstChunk.byteLength >= 3 &&
    ((firstChunk[0] === 0x49 && firstChunk[1] === 0x44 && firstChunk[2] === 0x33) ||
      (firstChunk[0] === 0xff && (firstChunk[1] & 0xf0) === 0xf0))
  ) {
    return 'aac';
  }
  return 'mpegts';
}

/**
 * Verifies that converted bytes start with a valid ISO-BMFF `ftyp` header box.
 */
export function hasValidMp4Signature(bytes: Uint8Array): boolean {
  if (!bytes || bytes.byteLength < 32) return false;
  return (
    bytes[4] === 0x66 && // f
    bytes[5] === 0x74 && // t
    bytes[6] === 0x79 && // y
    bytes[7] === 0x70    // p
  );
}

export function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.byteLength;
  }
  if (totalLength > MAX_BROWSER_REMUX_BYTES) {
    throw new HlsDownloadError(
      'MEMORY_LIMIT',
      `Download size (${formatBytes(totalLength)}) exceeds browser in-memory conversion limits. Choose a lower quality (e.g. 720p or 480p).`
    );
  }
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function buildAesIvBytes(segmentIndex: number, ivHex?: string): Uint8Array<ArrayBuffer> {
  const ivBuffer = new ArrayBuffer(16);
  const iv = new Uint8Array(ivBuffer);
  if (ivHex) {
    const clean = ivHex.trim().replace(/^0x/i, '').padStart(32, '0').slice(-32);
    for (let i = 0; i < 16; i += 1) {
      iv[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
    }
    return iv;
  }
  const view = new DataView(ivBuffer);
  view.setUint32(12, segmentIndex >>> 0, false);
  return iv;
}

async function fetchBinaryWithRetry(
  url: string,
  options: {
    byteRange?: HlsByteRange;
    signal?: AbortSignal;
    fetchFn: typeof fetch;
    maxRetries?: number;
  }
): Promise<Uint8Array> {
  const retries = options.maxRetries ?? 2;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) {
      throw new HlsDownloadError('ABORTED', 'Download cancelled.');
    }

    try {
      const headers: Record<string, string> = {};
      if (options.byteRange) {
        const start = options.byteRange.offset;
        const end = options.byteRange.offset + options.byteRange.length - 1;
        headers.Range = `bytes=${start}-${end}`;
      }

      const fetchImpl = normalizeFetchFn(options.fetchFn);
      const res = await fetchImpl(url, {
        headers,
        signal: options.signal,
        cache: 'no-store',
      });

      if (!res.ok) {
        throw new HlsDownloadError(
          'NETWORK_ERROR',
          `Segment download failed (HTTP ${res.status}).`
        );
      }

      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html') && !url.toLowerCase().includes('.html')) {
        // Note: MegaPlay deliberately masks MPEG-TS segments with .html extensions,
        // so only reject HTML if the actual body starts with HTML markup.
      }

      const buffer = await res.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (bytes.byteLength === 0 || looksLikeHtmlBinary(bytes)) {
        throw new HlsDownloadError(
          'INVALID_SEGMENT',
          'Stream returned an HTML page or empty segment instead of video data.'
        );
      }
      return bytes;
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError' || options.signal?.aborted) {
        throw new HlsDownloadError('ABORTED', 'Download cancelled.');
      }
      if (err instanceof HlsDownloadError && err.code === 'INVALID_SEGMENT') {
        throw err;
      }
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
      }
    }
  }

  if (lastErr instanceof HlsDownloadError) {
    throw lastErr;
  }
  throw new HlsDownloadError(
    'NETWORK_ERROR',
    lastErr instanceof Error ? lastErr.message : 'Network failure while downloading segments.'
  );
}

async function decryptSegmentIfNeeded(
  segmentBytes: Uint8Array,
  segment: ParsedHlsSegment,
  keyCache: Map<string, CryptoKey>,
  fetchFn: typeof fetch,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (!segment.key || segment.key.method !== 'AES-128' || !segment.key.uri) {
    return segmentBytes;
  }

  const keyUri = segment.key.uri;
  let cryptoKey = keyCache.get(keyUri);
  if (!cryptoKey) {
    const rawKeyBytes = await fetchBinaryWithRetry(keyUri, { fetchFn, signal, maxRetries: 1 });
    if (rawKeyBytes.byteLength !== 16) {
      throw new HlsDownloadError('DRM_UNSUPPORTED', 'Invalid AES-128 decryption key length.', false);
    }
    const normalizedKeyBuffer = new ArrayBuffer(16);
    new Uint8Array(normalizedKeyBuffer).set(rawKeyBytes);
    cryptoKey = await globalThis.crypto.subtle.importKey(
      'raw',
      normalizedKeyBuffer,
      { name: 'AES-CBC' },
      false,
      ['decrypt']
    );
    keyCache.set(keyUri, cryptoKey);
  }

  const iv = buildAesIvBytes(segment.index, segment.key.iv);
  const cipherBuffer = new ArrayBuffer(segmentBytes.byteLength);
  new Uint8Array(cipherBuffer).set(segmentBytes);
  const plainBuffer = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-CBC', iv },
    cryptoKey,
    cipherBuffer
  );
  return new Uint8Array(plainBuffer);
}

async function resolveMediaPlaylistRecursive(
  playlistUrl: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
  depth = 0
): Promise<{ media: ParsedHlsMediaPlaylist; effectiveUrl: string }> {
  if (depth > 3) {
    throw new HlsDownloadError('INVALID_PLAYLIST', 'Nested HLS playlist redirect depth exceeded.');
  }

  const safeFetch = normalizeFetchFn(fetchFn);
  const res = await safeFetch(playlistUrl, { signal, cache: 'no-store' });
  if (!res.ok) {
    throw new HlsDownloadError(
      'INVALID_PLAYLIST',
      `Failed to fetch HLS playlist (HTTP ${res.status}).`
    );
  }
  const contentType = res.headers.get('content-type');
  const text = await res.text();
  const parsed = parseHlsPlaylist(text, playlistUrl, contentType);

  if (parsed.kind === 'media') {
    return { media: parsed, effectiveUrl: playlistUrl };
  }

  // If a quality option still pointed to a nested master playlist, pick highest variant
  const options = buildQualityOptionsFromMaster(parsed);
  if (options.length === 0) {
    throw new HlsDownloadError('INVALID_PLAYLIST', 'No playable streams found in playlist.');
  }
  return resolveMediaPlaylistRecursive(options[0].playlistUrl, fetchFn, signal, depth + 1);
}

async function downloadTrackChunks(params: {
  media: ParsedHlsMediaPlaylist;
  fetchFn: typeof fetch;
  signal?: AbortSignal;
  concurrency?: number;
  keyCache: Map<string, CryptoKey>;
  onSegmentComplete: (bytesAdded: number) => void;
}): Promise<{ buffer: Uint8Array; container: 'mpegts' | 'fmp4' | 'aac' }> {
  const { media, fetchFn, signal, keyCache, onSegmentComplete } = params;
  const concurrency = params.concurrency ?? 4;

  const chunks: Uint8Array[] = [];
  if (media.initMapUrl) {
    const initBytes = await fetchBinaryWithRetry(media.initMapUrl, {
      byteRange: media.initByteRange,
      fetchFn,
      signal,
    });
    chunks.push(initBytes);
    onSegmentComplete(initBytes.byteLength);
  }

  const segmentResults: Uint8Array[] = new Array(media.segments.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      if (signal?.aborted) {
        throw new HlsDownloadError('ABORTED', 'Download cancelled.');
      }
      const idx = cursor;
      cursor += 1;
      if (idx >= media.segments.length) break;

      const segment = media.segments[idx];
      const rawBytes = await fetchBinaryWithRetry(segment.url, {
        byteRange: segment.byteRange,
        fetchFn,
        signal,
      });
      const decrypted = await decryptSegmentIfNeeded(
        rawBytes,
        segment,
        keyCache,
        fetchFn,
        signal
      );
      segmentResults[idx] = decrypted;
      onSegmentComplete(decrypted.byteLength);
    }
  }

  const workerCount = Math.min(concurrency, media.segments.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  for (const seg of segmentResults) {
    chunks.push(seg);
  }

  const container = detectSegmentContainer(chunks[0], media.isFmp4);
  const merged = concatUint8Arrays(chunks);
  return { buffer: merged, container };
}

function triggerBrowserMp4Save(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();

  setTimeout(() => {
    try {
      document.body.removeChild(anchor);
    } catch {
      // ignore
    }
    URL.revokeObjectURL(blobUrl);
  }, 15_000);
}

/**
 * End-to-end client-side HLS proxy -> MP4 converter & download trigger.
 * Lazy-loads `@ffmpeg/ffmpeg` ONLY when called so initial page load has zero WASM overhead.
 */
export async function downloadHlsToMp4(
  params: DownloadHlsParams
): Promise<DownloadHlsResult> {
  const fetchFn = normalizeFetchFn(params.fetchFn);
  const signal = params.signal;
  const emit = (state: DownloadProgressState) => {
    params.onProgress?.(state);
  };

  const filename = sanitizeDownloadFilename({
    animeTitle: params.animeTitle,
    episodeNumber: params.episodeNumber,
    qualityLabel: params.quality.label,
    audioType: params.audioType,
  });

  emit({
    stage: 'preparing',
    label: 'Preparing download...',
    percent: null,
    downloadedBytes: 0,
    completedSegments: 0,
    totalSegments: 0,
    speedBytesPerSec: 0,
    estimatedTotalBytes: null,
    filename,
    error: null,
  });

  if (signal?.aborted) {
    throw new HlsDownloadError('ABORTED', 'Download cancelled.');
  }

  emit({
    stage: 'fetching_stream',
    label: 'Retrieving stream playlist...',
    percent: null,
    downloadedBytes: 0,
    completedSegments: 0,
    totalSegments: 0,
    speedBytesPerSec: 0,
    estimatedTotalBytes: null,
    filename,
    error: null,
  });

  const { media: videoMedia } = await resolveMediaPlaylistRecursive(
    params.quality.playlistUrl,
    fetchFn,
    signal
  );

  // If the master playlist declares separate audio tracks (#EXT-X-MEDIA:TYPE=AUDIO),
  // match the requested audio version (Japanese for Sub, English for Dub).
  const matchedAudioTrack = pickAudioPlaylistForVariant({
    audioTracks: params.quality.audioTracks,
    audioGroupId: params.quality.audioGroupId,
    audioType: params.audioType,
  });

  let audioMedia: ParsedHlsMediaPlaylist | null = null;
  if (matchedAudioTrack?.url) {
    try {
      const resolvedAudio = await resolveMediaPlaylistRecursive(
        matchedAudioTrack.url,
        fetchFn,
        signal
      );
      audioMedia = resolvedAudio.media;
    } catch (err) {
      if (err instanceof HlsDownloadError && err.code === 'ABORTED') throw err;
      // Only fall back to video-only if audio URL wasn't strictly required
      throw err;
    }
  }

  const totalSegments =
    videoMedia.segments.length +
    (videoMedia.initMapUrl ? 1 : 0) +
    (audioMedia ? audioMedia.segments.length + (audioMedia.initMapUrl ? 1 : 0) : 0);

  const estimatedTotalBytes =
    params.quality.bandwidth && videoMedia.totalDurationSeconds > 0
      ? Math.round((params.quality.bandwidth * videoMedia.totalDurationSeconds) / 8)
      : null;

  if (estimatedTotalBytes && estimatedTotalBytes > MAX_BROWSER_REMUX_BYTES) {
    throw new HlsDownloadError(
      'MEMORY_LIMIT',
      `Estimated stream size (${formatBytes(estimatedTotalBytes)}) exceeds browser conversion limits. Try a lower quality such as 720p or 480p.`
    );
  }

  let completedSegments = 0;
  let downloadedBytes = 0;
  const startedAtMs = Date.now();
  const keyCache = new Map<string, CryptoKey>();

  const handleSegmentDone = (bytesAdded: number) => {
    completedSegments += 1;
    downloadedBytes += bytesAdded;
    const elapsedSec = Math.max(0.25, (Date.now() - startedAtMs) / 1000);
    const speedBytesPerSec = downloadedBytes / elapsedSec;
    const percent =
      totalSegments > 0
        ? Math.min(89, Math.round((completedSegments / totalSegments) * 89))
        : null;

    emit({
      stage: 'downloading_segments',
      label: `Downloading video (${completedSegments}/${totalSegments})...`,
      percent,
      downloadedBytes,
      completedSegments,
      totalSegments,
      speedBytesPerSec,
      estimatedTotalBytes,
      filename,
      error: null,
    });
  };

  let videoData: { buffer: Uint8Array; container: 'mpegts' | 'fmp4' | 'aac' } | null =
    null;
  let audioData: { buffer: Uint8Array; container: 'mpegts' | 'fmp4' | 'aac' } | null =
    null;

  videoData = await downloadTrackChunks({
    media: videoMedia,
    fetchFn,
    signal,
    keyCache,
    onSegmentComplete: handleSegmentDone,
  });

  if (audioMedia) {
    audioData = await downloadTrackChunks({
      media: audioMedia,
      fetchFn,
      signal,
      keyCache,
      onSegmentComplete: handleSegmentDone,
    });
  }

  if (signal?.aborted) {
    videoData = null;
    audioData = null;
    throw new HlsDownloadError('ABORTED', 'Download cancelled.');
  }

  emit({
    stage: 'processing_mp4',
    label: 'Processing MP4 video...',
    percent: 90,
    downloadedBytes,
    completedSegments,
    totalSegments,
    speedBytesPerSec: 0,
    estimatedTotalBytes: downloadedBytes,
    filename,
    error: null,
  });

  // Strictly lazy-load @ffmpeg/ffmpeg ONLY when converting
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  const ffmpegLogs: string[] = [];
  let ffmpegAborted = false;

  const abortListener = () => {
    ffmpegAborted = true;
    try {
      ffmpeg.terminate();
    } catch {
      // ignore
    }
  };
  signal?.addEventListener('abort', abortListener, { once: true });

  ffmpeg.on('log', ({ message }) => {
    if (message) {
      ffmpegLogs.push(message);
      if (ffmpegLogs.length > 25) ffmpegLogs.shift();
    }
  });

  ffmpeg.on('progress', ({ progress }) => {
    if (ffmpegAborted) return;
    const clamped = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    const pct = 90 + Math.round(clamped * 9);
    emit({
      stage: 'processing_mp4',
      label: 'Processing MP4 video...',
      percent: Math.min(99, pct),
      downloadedBytes,
      completedSegments,
      totalSegments,
      speedBytesPerSec: 0,
      estimatedTotalBytes: downloadedBytes,
      filename,
      error: null,
    });
  });

  const videoExt = videoData.container === 'fmp4' ? 'mp4' : 'ts';
  const videoInputName = `input_v.${videoExt}`;
  const audioExt = audioData
    ? audioData.container === 'fmp4'
      ? 'mp4'
      : audioData.container === 'aac'
      ? 'aac'
      : 'ts'
    : '';
  const audioInputName = audioData ? `input_a.${audioExt}` : '';
  const outputName = 'output.mp4';

  try {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : '';

    await ffmpeg.load({
      classWorkerURL: `${origin}/ffmpeg/worker.js`,
      coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
      wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
    });

    if (signal?.aborted) {
      throw new HlsDownloadError('ABORTED', 'Download cancelled.');
    }

    await ffmpeg.writeFile(videoInputName, videoData.buffer);
    // Release main-thread reference now that buffer was transferred to the worker
    videoData = null;

    const ffmpegArgs: string[] = [];
    if (videoExt === 'ts') {
      ffmpegArgs.push('-fflags', '+genpts');
    }
    ffmpegArgs.push('-i', videoInputName);

    if (audioData && audioInputName) {
      await ffmpeg.writeFile(audioInputName, audioData.buffer);
      audioData = null;
      ffmpegArgs.push('-i', audioInputName);
      ffmpegArgs.push(
        '-c',
        'copy',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-dn',
        '-sn',
        '-movflags',
        '+faststart',
        outputName
      );
    } else {
      ffmpegArgs.push(
        '-c',
        'copy',
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-dn',
        '-sn',
        '-movflags',
        '+faststart',
        outputName
      );
    }

    const exitCode = await ffmpeg.exec(ffmpegArgs, -1, { signal });
    if (exitCode !== 0) {
      const tailLog = ffmpegLogs.slice(-5).join(' | ');
      throw new HlsDownloadError(
        'CONVERSION_FAILED',
        `MP4 conversion failed (${tailLog || `FFmpeg exit code ${exitCode}`}).`
      );
    }

    const rawOut = await ffmpeg.readFile(outputName);
    const outBytes =
      rawOut instanceof Uint8Array
        ? rawOut
        : new TextEncoder().encode(String(rawOut));

    if (!hasValidMp4Signature(outBytes) || outBytes.byteLength < 1024) {
      throw new HlsDownloadError(
        'CONVERSION_FAILED',
        'Converted output was not a valid playable MP4 file.'
      );
    }

    emit({
      stage: 'saving',
      label: 'Saving MP4 to device...',
      percent: 99,
      downloadedBytes,
      completedSegments,
      totalSegments,
      speedBytesPerSec: 0,
      estimatedTotalBytes: outBytes.byteLength,
      filename,
      error: null,
    });

    const exactSlice = new Uint8Array(outBytes.byteLength);
    exactSlice.set(outBytes);
    const mp4Blob = new Blob([exactSlice], { type: 'video/mp4' });
    triggerBrowserMp4Save(mp4Blob, filename);

    emit({
      stage: 'completed',
      label: 'Download complete',
      percent: 100,
      downloadedBytes: outBytes.byteLength,
      completedSegments,
      totalSegments,
      speedBytesPerSec: 0,
      estimatedTotalBytes: outBytes.byteLength,
      filename,
      error: null,
    });

    return {
      filename,
      byteLength: outBytes.byteLength,
      mimeType: 'video/mp4',
    };
  } catch (err: unknown) {
    if (
      signal?.aborted ||
      ffmpegAborted ||
      (err as { name?: string })?.name === 'AbortError' ||
      (err instanceof HlsDownloadError && err.code === 'ABORTED')
    ) {
      throw new HlsDownloadError('ABORTED', 'Download cancelled.');
    }
    if (err instanceof HlsDownloadError) {
      throw err;
    }
    const detail =
      typeof err === 'string' && err.trim()
        ? err.trim()
        : err instanceof Error
        ? err.message
        : 'Failed to convert HLS stream to MP4.';
    throw new HlsDownloadError('CONVERSION_FAILED', detail);
  } finally {
    signal?.removeEventListener('abort', abortListener);
    videoData = null;
    audioData = null;
    try {
      await ffmpeg.deleteFile(videoInputName).catch(() => {});
      if (audioInputName) await ffmpeg.deleteFile(audioInputName).catch(() => {});
      await ffmpeg.deleteFile(outputName).catch(() => {});
    } catch {
      // ignore MEMFS cleanup errors
    }
    try {
      ffmpeg.terminate();
    } catch {
      // ignore worker termination errors
    }
  }
}
