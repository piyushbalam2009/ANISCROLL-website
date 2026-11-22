import { appCache } from './cache';
import {
  classifyUpstreamError,
  recordStreamFailure,
  recordUpstreamMetric,
  UpstreamErrorCode,
} from './perf-monitor';
import {
  AniScrollStreamResponse,
  EpisodeStreamAvailability,
  StreamingProvider,
} from '@/types/streaming';
import { HoshikaAnimeItem } from '@/types/anime';
import { resolveAnimeIds } from './id-mapper';
import {
  EpisodeAvailabilityResult,
  createEpisodeAvailability,
} from './episode-store';
import {
  validateProviderStreamResponse,
  selectEpisodeAudioVersion,
} from './zokoanime-stream';
import {
  buildProviderWatchUrl,
  resolveStreamingProviderForAnime,
  selectStreamingProvider,
  normalizeAnimeFormat,
  getStreamingProviderDisplayName,
} from './stream-provider';

const STREAM_TIMEOUT_MS = 6500;
const MAX_STREAM_WALL_MS = 8200;

export interface DetailedStreamOutcome {
  ok: boolean;
  stream: AniScrollStreamResponse | null;
  provider: StreamingProvider;
  format: string | null;
  definitiveUnavailable: boolean;
  errorCode: UpstreamErrorCode | null;
  upstreamStatus: number | null;
  httpStatus: 200 | 400 | 404 | 429 | 502 | 504;
  retryAfterSeconds?: number;
  message: string | null;
  fromCache?: boolean;
}

export interface DetailedEpisodeStreamAvailability extends EpisodeStreamAvailability {
  subOutcome: DetailedStreamOutcome;
  dubOutcome: DetailedStreamOutcome;
}

const inFlightStreamMap = new Map<string, Promise<DetailedStreamOutcome>>();
const inFlightEpisodeAvailMap = new Map<
  string,
  Promise<DetailedEpisodeStreamAvailability>
>();
const inFlightSeriesAvailMap = new Map<string, Promise<EpisodeAvailabilityResult>>();

export interface StreamRoutingOptions {
  provider?: StreamingProvider;
  format?: string | null;
  isStandaloneMovie?: boolean;
  hoshikaId?: string | number | null;
}

function isUnavailableErrorMessage(
  provider: StreamingProvider,
  errorText: string
): boolean {
  const lower = errorText.toLowerCase();
  if (!lower) return false;

  if (
    lower.includes('player configuration was not found') ||
    lower.includes('failed to resolve a stream') ||
    lower.includes('no stream found') ||
    lower.includes('episode not found') ||
    lower.includes('stream not found') ||
    lower.includes('not found') ||
    lower.includes('not available') ||
    lower.includes('unavailable')
  ) {
    return true;
  }

  if (provider === 'megaplay' && lower.includes('failed to resolve')) {
    return true;
  }
  if (provider === 'zokoanime' && lower.includes('player configuration')) {
    return true;
  }

  return false;
}

/**
 * Maps an upstream provider HTTP response or payload error into a structured classification
 * so MegaPlay / ZokoAnime stream unavailability is cleanly separated from timeouts,
 * rate limits, HTTP 5xx outages, and JSON/schema parse failures.
 */
export function classifyProviderResponseFailure(params: {
  provider: StreamingProvider;
  status: number;
  contentType: string;
  payload?: Record<string, unknown> | null;
  retryAfterHeader?: string | null;
  episode: number;
  type: 'sub' | 'dub';
}): {
  definitiveUnavailable: boolean;
  errorCode: UpstreamErrorCode;
  httpStatus: 400 | 404 | 429 | 502;
  retryable: boolean;
  retryAfterSeconds?: number;
  message: string;
} {
  const {
    provider,
    status,
    contentType,
    payload,
    retryAfterHeader,
    episode,
    type,
  } = params;
  const providerLabel = getStreamingProviderDisplayName(provider);
  const typeLabel = type.toUpperCase();

  let retryAfterSeconds: number | undefined;
  if (retryAfterHeader) {
    const parsed = Number(retryAfterHeader.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      retryAfterSeconds = Math.min(Math.ceil(parsed), 60);
    }
  }

  if (status === 404 || status === 400) {
    const msg =
      typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `${providerLabel} ${typeLabel} stream is unavailable for Episode ${episode}.`;
    return {
      definitiveUnavailable: true,
      errorCode: 'not_found',
      httpStatus: 404,
      retryable: false,
      message: msg,
    };
  }

  if (status === 429) {
    return {
      definitiveUnavailable: false,
      errorCode: 'rate_limit',
      httpStatus: 429,
      retryable: false,
      retryAfterSeconds,
      message: `${providerLabel} streaming API rate limit reached. Please wait a moment and retry.`,
    };
  }

  const rawErrorText =
    typeof payload?.error === 'string'
      ? payload.error.trim()
      : typeof payload?.message === 'string'
      ? payload.message.trim()
      : '';
  const payloadSource =
    typeof payload?.source === 'string' ? payload.source.trim().toLowerCase() : '';

  // Both MegaPlay and ZokoAnime return HTTP 502 JSON when a specific episode/audio variant
  // does not exist (e.g. `{ source: "megaplay", error: "MegaPlay failed to resolve a stream..." }`
  // or `{ source: "zokoanime", error: "ZokoAnime player configuration was not found" }`).
  if (
    contentType.includes('application/json') &&
    rawErrorText &&
    (payloadSource === '' || payloadSource === provider) &&
    isUnavailableErrorMessage(provider, rawErrorText)
  ) {
    return {
      definitiveUnavailable: true,
      errorCode: 'not_found',
      httpStatus: 404,
      retryable: false,
      message: rawErrorText,
    };
  }

  if (status >= 500) {
    return {
      definitiveUnavailable: false,
      errorCode: 'server_error',
      httpStatus: 502,
      retryable: true,
      message: rawErrorText
        ? `${providerLabel} upstream error (HTTP ${status}): ${rawErrorText}`
        : `${providerLabel} upstream server returned HTTP ${status}.`,
    };
  }

  if (!contentType.includes('application/json')) {
    return {
      definitiveUnavailable: false,
      errorCode: 'invalid_json',
      httpStatus: 502,
      retryable: true,
      message: `${providerLabel} returned unexpected non-JSON content (HTTP ${status}).`,
    };
  }

  return {
    definitiveUnavailable: false,
    errorCode: 'parse_error',
    httpStatus: 502,
    retryable: false,
    message: rawErrorText
      ? `${providerLabel} returned an unusable stream response: ${rawErrorText}`
      : `${providerLabel} returned an incomplete or unplayable stream payload.`,
  };
}

export function mapErrorCodeToHttpStatus(
  code: UpstreamErrorCode | null
): 400 | 404 | 429 | 502 | 504 {
  switch (code) {
    case 'not_found':
      return 404;
    case 'bad_request':
      return 400;
    case 'rate_limit':
      return 429;
    case 'timeout':
      return 504;
    case 'server_error':
    case 'invalid_json':
    case 'parse_error':
    case 'network_error':
    case 'unknown_error':
    default:
      return 502;
  }
}

async function fetchProviderWatchEndpoint(
  provider: StreamingProvider,
  anilistId: number,
  episode: number,
  type: 'sub' | 'dub',
  timeoutMs: number = STREAM_TIMEOUT_MS
): Promise<DetailedStreamOutcome & { retryable: boolean }> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = `/api/watch/${provider}/mal-${anilistId}/${episode}/${type}`;
  const mapping = await resolveAnimeIds(String(anilistId)).catch(() => null);
  const malId = Number(mapping?.malId);
  if (!Number.isSafeInteger(malId) || malId <= 0) {
    clearTimeout(timeout);
    return {
      ok: false, stream: null, provider, format: null, definitiveUnavailable: true,
      errorCode: 'bad_request', upstreamStatus: null, httpStatus: 400,
      message: 'A valid MAL ID is required by the AniVault streaming API.', retryable: false,
    };
  }
  const url = buildProviderWatchUrl(provider, malId, episode, type);
  const providerLabel = getStreamingProviderDisplayName(provider);
  const apiKey = process.env.ANIVAULT_API_KEY?.trim();

  try {
    if (!apiKey) {
      return {
        ok: false, stream: null, provider, format: null,
        definitiveUnavailable: false, errorCode: 'network_error',
        upstreamStatus: null, httpStatus: 502,
        message: 'ANIVAULT_API_KEY is not configured on the AniScroll server.',
        retryable: false,
      };
    }

    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AniScroll-Player/1.0',
        'x-anivault-api-key': apiKey,
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    const durationMs = Date.now() - startTime;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const retryAfterHeader = res.headers.get('retry-after');
    let parsedJson: Record<string, unknown> | null = null;
    let jsonParseFailed = false;

    if (contentType.includes('application/json')) {
      try { parsedJson = (await res.json()) as Record<string, unknown>; }
      catch { jsonParseFailed = true; }
    } else if (res.ok) {
      recordUpstreamMetric({ provider, endpoint, durationMs, status: res.status, fromCache: false, errorCode: 'invalid_json' });
      return {
        ok: false, stream: null, provider, format: null, definitiveUnavailable: false,
        errorCode: 'invalid_json', upstreamStatus: res.status, httpStatus: 502,
        message: `${providerLabel} returned non-JSON response (${contentType || 'unknown'}).`, retryable: true,
      };
    }

    if (jsonParseFailed) {
      recordUpstreamMetric({ provider, endpoint, durationMs, status: res.status, fromCache: false, errorCode: 'invalid_json' });
      return {
        ok: false, stream: null, provider, format: null, definitiveUnavailable: false,
        errorCode: 'invalid_json', upstreamStatus: res.status, httpStatus: 502,
        message: `${providerLabel} returned malformed JSON (HTTP ${res.status}).`,
        retryable: res.status >= 500,
      };
    }

    if (!res.ok) {
      const classified = classifyProviderResponseFailure({
        provider, status: res.status, contentType, payload: parsedJson,
        retryAfterHeader, episode, type,
      });
      recordUpstreamMetric({ provider, endpoint, durationMs, status: res.status, fromCache: false, errorCode: classified.errorCode });
      return {
        ok: false, stream: null, provider, format: null,
        definitiveUnavailable: classified.definitiveUnavailable,
        errorCode: classified.errorCode, upstreamStatus: res.status,
        httpStatus: classified.httpStatus, retryAfterSeconds: classified.retryAfterSeconds,
        message: classified.message, retryable: classified.retryable,
      };
    }

    // AniVault watch responses are source-specific and may carry proxied HLS,
    // subtitle, iframe, audio-track and quality fields. Normalize identifiers
    // to AniScroll's established stream response shape without rewriting proxy URLs.
    const payload = parsedJson as any;
    const streamPayload = payload?.stream && typeof payload.stream === 'object' ? payload.stream : payload;
    const hlsProxyUrl = typeof streamPayload?.hlsProxyUrl === 'string'
      ? streamPayload.hlsProxyUrl
      : typeof streamPayload?.m3u8 === 'string' && streamPayload.m3u8.includes('/api/proxy/hls')
        ? streamPayload.m3u8
        : undefined;
    const validated = streamPayload && (
      !!hlsProxyUrl ||
      (typeof streamPayload.embedUrl === 'string' && streamPayload.embedUrl.length > 0)
    ) ? ({
      ...streamPayload,
      source: String(streamPayload.source || provider),
      provider,
      anilistId,
      malId: anilistId,
      episode: Number(streamPayload.episode ?? episode),
      type: streamPayload.type === 'dub' ? 'dub' : type,
      hlsProxyUrl,
      m3u8: typeof streamPayload.m3u8 === 'string' ? streamPayload.m3u8 : hlsProxyUrl,
      subtitles: Array.isArray(streamPayload.subtitles)
        ? streamPayload.subtitles.map((track: any) => ({
            ...track,
            url: String(track.url || track.src || ''),
            src: String(track.src || track.url || ''),
            lang: String(track.lang || track.label || 'Unknown'),
            default: Boolean(track.default),
          })).filter((track: any) => track.url)
        : [],
      qualities: Array.isArray(streamPayload.qualities) ? streamPayload.qualities : [],
      playbackMode: streamPayload.playbackMode || (hlsProxyUrl ? 'hls' : 'iframe'),
      server: streamPayload.server || streamPayload.serverName || provider,
      serverName: streamPayload.serverName || streamPayload.server || provider,
    }) as AniScrollStreamResponse : null;

    if (validated) {
      recordUpstreamMetric({ provider, endpoint, durationMs, status: res.status, fromCache: false });
      return {
        ok: true, stream: validated, provider, format: null,
        definitiveUnavailable: false, errorCode: null, upstreamStatus: res.status,
        httpStatus: 200, message: null, retryable: false,
      };
    }

    const classified = classifyProviderResponseFailure({
      provider, status: res.status, contentType, payload: parsedJson,
      retryAfterHeader, episode, type,
    });
    recordUpstreamMetric({ provider, endpoint, durationMs, status: res.status, fromCache: false, errorCode: classified.errorCode });
    return {
      ok: false, stream: null, provider, format: null,
      definitiveUnavailable: classified.definitiveUnavailable,
      errorCode: classified.errorCode, upstreamStatus: res.status,
      httpStatus: classified.httpStatus, message: classified.message, retryable: false,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const err = classifyUpstreamError({ provider, endpoint, error, durationMs });
    recordUpstreamMetric({ provider, endpoint, durationMs, status: null, fromCache: false, errorCode: err.code });
    return {
      ok: false, stream: null, provider, format: null,
      definitiveUnavailable: false, errorCode: err.code,
      upstreamStatus: null, httpStatus: mapErrorCodeToHttpStatus(err.code),
      message: err.code === 'timeout'
        ? `${providerLabel} timed out while resolving Episode ${episode} (${type.toUpperCase()}).`
        : `${providerLabel} connection error while resolving Episode ${episode} (${type.toUpperCase()}).`,
      retryable: err.retryable,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches and validates a stream for `(anilistId, episode, type)` using the content-appropriate
 * provider (`megaplay` for series, `zokoanime` for movies), returning structured outcome details.
 */
export async function getAniScrollStreamDetailed(
  anilistId: number,
  episode: number = 1,
  type: 'sub' | 'dub' = 'sub',
  options?: StreamRoutingOptions
): Promise<DetailedStreamOutcome> {
  if (
    !Number.isFinite(anilistId) ||
    anilistId <= 0 ||
    !Number.isFinite(episode) ||
    episode <= 0
  ) {
    return {
      ok: false,
      stream: null,
      provider: options?.provider ?? 'zokoanime',
      format: options?.format ?? null,
      definitiveUnavailable: true,
      errorCode: 'bad_request',
      upstreamStatus: null,
      httpStatus: 400,
      message: 'Invalid anilistId or episode number.',
    };
  }

  let provider: StreamingProvider;
  let resolvedFormat: string | null = options?.format ?? null;

  if (options?.provider) {
    provider = options.provider;
  } else {
    const routed = await resolveStreamingProviderForAnime({
      format: options?.format,
      isStandaloneMovie: options?.isStandaloneMovie,
      hoshikaId: options?.hoshikaId,
      anilistId,
    });
    provider = routed.provider;
    resolvedFormat = routed.format !== 'UNKNOWN' ? routed.format : resolvedFormat;
  }

  const normalizedType: 'sub' | 'dub' = type === 'dub' ? 'dub' : 'sub';
  const cacheKey = `${provider}:stream:${anilistId}:${episode}:${normalizedType}`;
  const missCacheKey = `${provider}:miss:${anilistId}:${episode}:${normalizedType}`;
  const metricEndpoint = `/${provider}/${anilistId}/${episode}/${normalizedType}`;
  const providerLabel = getStreamingProviderDisplayName(provider);

  const cached = appCache.get<AniScrollStreamResponse>(cacheKey);
  if (
    cached &&
    cached.type === normalizedType &&
    Number(cached.anilistId) === Number(anilistId) &&
    Number(cached.episode) === Number(episode)
  ) {
    recordUpstreamMetric({
      provider,
      endpoint: metricEndpoint,
      durationMs: 0,
      status: 200,
      fromCache: true,
    });
    const stream: AniScrollStreamResponse = {
      ...cached,
      provider,
      format: cached.format ?? resolvedFormat,
    };
    return {
      ok: true,
      stream,
      provider,
      format: resolvedFormat,
      definitiveUnavailable: false,
      errorCode: null,
      upstreamStatus: 200,
      httpStatus: 200,
      message: null,
      fromCache: true,
    };
  }
  if (cached) {
    appCache.delete(cacheKey);
  }

  const recentMiss = appCache.get<{ reason?: string } | boolean>(missCacheKey);
  if (recentMiss) {
    recordUpstreamMetric({
      provider,
      endpoint: metricEndpoint,
      durationMs: 0,
      status: 404,
      fromCache: true,
    });
    return {
      ok: false,
      stream: null,
      provider,
      format: resolvedFormat,
      definitiveUnavailable: true,
      errorCode: 'not_found',
      upstreamStatus: 404,
      httpStatus: 404,
      message:
        typeof recentMiss === 'object' && recentMiss?.reason
          ? recentMiss.reason
          : `${providerLabel} ${normalizedType.toUpperCase()} stream is unavailable for Episode ${episode}.`,
      fromCache: true,
    };
  }

  const existingInFlight = inFlightStreamMap.get(cacheKey);
  if (existingInFlight) {
    recordUpstreamMetric({
      provider,
      endpoint: metricEndpoint,
      durationMs: 0,
      status: 200,
      fromCache: false,
      deduplicated: true,
    });
    return existingInFlight;
  }

  const promise = (async (): Promise<DetailedStreamOutcome> => {
    const overallStart = Date.now();
    try {
      let attemptResult = await fetchProviderWatchEndpoint(
        provider,
        anilistId,
        episode,
        normalizedType,
        STREAM_TIMEOUT_MS
      );

      // Bounded single retry only on transient errors when wall-clock budget remains safe for Vercel
      const elapsedMs = Date.now() - overallStart;
      const remainingBudgetMs = MAX_STREAM_WALL_MS - elapsedMs - 250;
      if (
        !attemptResult.stream &&
        !attemptResult.definitiveUnavailable &&
        attemptResult.retryable &&
        remainingBudgetMs >= 3000
      ) {
        await new Promise((r) => setTimeout(r, 250));
        attemptResult = await fetchProviderWatchEndpoint(
          provider,
          anilistId,
          episode,
          normalizedType,
          Math.min(STREAM_TIMEOUT_MS, remainingBudgetMs)
        );
      }

      if (attemptResult.stream) {
        const enriched: AniScrollStreamResponse = {
          ...attemptResult.stream,
          provider,
          format: resolvedFormat,
        };
        // Cache playable streams for 5 minutes (300s) so signed stream tokens remain fresh
        appCache.set(cacheKey, enriched, {
          ttlSeconds: 300,
          staleWhileRevalidateSeconds: 180,
        });
        return {
          ok: true,
          stream: enriched,
          provider,
          format: resolvedFormat,
          definitiveUnavailable: false,
          errorCode: null,
          upstreamStatus: attemptResult.upstreamStatus,
          httpStatus: 200,
          message: null,
        };
      }

      if (attemptResult.definitiveUnavailable) {
        // Negative-cache definitive unavailability only (45s MegaPlay / 60s ZokoAnime)
        // Transient timeouts, rate limits, and 5xx outages are NEVER negative-cached.
        appCache.set(
          missCacheKey,
          { reason: attemptResult.message || undefined },
          {
            ttlSeconds: provider === 'megaplay' ? 45 : 60,
            staleWhileRevalidateSeconds: 0,
          }
        );
      } else {
        recordStreamFailure();
      }

      return {
        ...attemptResult,
        provider,
        format: resolvedFormat,
      };
    } finally {
      inFlightStreamMap.delete(cacheKey);
    }
  })();

  inFlightStreamMap.set(cacheKey, promise);
  return promise;
}

/**
 * Fetches and validates a stream for `(anilistId, episode, type)` using the content-appropriate
 * provider (`megaplay` for series, `zokoanime` for movies).
 * Never silently falls back across providers.
 */
export async function getAniScrollStream(
  anilistId: number,
  episode: number = 1,
  type: 'sub' | 'dub' = 'sub',
  options?: StreamRoutingOptions
): Promise<AniScrollStreamResponse | null> {
  const outcome = await getAniScrollStreamDetailed(
    anilistId,
    episode,
    type,
    options
  );
  return outcome.stream;
}

/**
 * Checks both Sub and Dub endpoints in parallel on the selected provider and preserves
 * detailed per-version outcome telemetry for accurate HTTP error reporting.
 */
export async function checkEpisodeStreamAvailabilityDetailed(
  anilistId: number,
  episode: number = 1,
  userSelectedVersion?: 'sub' | 'dub' | null,
  options?: StreamRoutingOptions
): Promise<DetailedEpisodeStreamAvailability> {
  if (
    !Number.isFinite(anilistId) ||
    anilistId <= 0 ||
    !Number.isFinite(episode) ||
    episode <= 0
  ) {
    const provider = options?.provider ?? 'zokoanime';
    const invalidOutcome: DetailedStreamOutcome = {
      ok: false,
      stream: null,
      provider,
      format: options?.format ?? null,
      definitiveUnavailable: true,
      errorCode: 'bad_request',
      upstreamStatus: null,
      httpStatus: 400,
      message: 'Invalid anilistId or episode number.',
    };
    return {
      anilistId,
      episode,
      provider,
      format: options?.format ?? null,
      subAvailable: false,
      dubAvailable: false,
      subStream: null,
      dubStream: null,
      defaultVersion: null,
      subOutcome: invalidOutcome,
      dubOutcome: invalidOutcome,
    };
  }

  let provider: StreamingProvider;
  let resolvedFormat: string | null = options?.format ?? null;

  if (options?.provider) {
    provider = options.provider;
  } else {
    const routed = await resolveStreamingProviderForAnime({
      format: options?.format,
      isStandaloneMovie: options?.isStandaloneMovie,
      hoshikaId: options?.hoshikaId,
      anilistId,
    });
    provider = routed.provider;
    resolvedFormat = routed.format !== 'UNKNOWN' ? routed.format : resolvedFormat;
  }

  const availKey = `${provider}:ep_avail:${anilistId}:${episode}`;
  const existing = inFlightEpisodeAvailMap.get(availKey);

  const basePromise =
    existing ||
    (async (): Promise<DetailedEpisodeStreamAvailability> => {
      try {
        const [subOutcome, dubOutcome] = await Promise.all([
          getAniScrollStreamDetailed(anilistId, episode, 'sub', {
            provider,
            format: resolvedFormat,
            hoshikaId: options?.hoshikaId,
          }),
          getAniScrollStreamDetailed(anilistId, episode, 'dub', {
            provider,
            format: resolvedFormat,
            hoshikaId: options?.hoshikaId,
          }),
        ]);

        const subStream =
          subOutcome.stream && subOutcome.stream.type === 'sub'
            ? subOutcome.stream
            : null;
        const dubStream =
          dubOutcome.stream && dubOutcome.stream.type === 'dub'
            ? dubOutcome.stream
            : null;
        const subAvailable = Boolean(subStream);
        const dubAvailable = Boolean(dubStream);

        return {
          anilistId,
          episode,
          provider,
          format: resolvedFormat,
          subAvailable,
          dubAvailable,
          subStream,
          dubStream,
          defaultVersion: selectEpisodeAudioVersion({
            subAvailable,
            dubAvailable,
            userSelectedVersion: null,
          }),
          subOutcome,
          dubOutcome,
        };
      } finally {
        inFlightEpisodeAvailMap.delete(availKey);
      }
    })();

  if (!existing) {
    inFlightEpisodeAvailMap.set(availKey, basePromise);
  }

  const resolved = await basePromise;
  return {
    ...resolved,
    provider,
    format: resolved.format ?? resolvedFormat,
    defaultVersion: selectEpisodeAudioVersion({
      subAvailable: resolved.subAvailable,
      dubAvailable: resolved.dubAvailable,
      userSelectedVersion,
    }),
  };
}

/**
 * Dynamically checks both Sub and Dub endpoints in parallel on the selected provider:
 * - Series (`TV`, `TV_SHORT`, `OVA`, `ONA`, `SPECIAL`) -> `https://ANIVAULT_API_ORIGIN/api/watch/megaplay/mal-{mal_id}/{episode}/{sub|dub}`
 * - Movies (`MOVIE`, standalone movie `SPECIAL`, or unknown fallback) -> `https://ANIVAULT_API_ORIGIN/api/watch/zokoanime/mal-{mal_id}/{episode}/{sub|dub}`
 */
export async function checkEpisodeStreamAvailability(
  anilistId: number,
  episode: number = 1,
  userSelectedVersion?: 'sub' | 'dub' | null,
  options?: StreamRoutingOptions
): Promise<EpisodeStreamAvailability> {
  return checkEpisodeStreamAvailabilityDetailed(
    anilistId,
    episode,
    userSelectedVersion,
    options
  );
}

/**
 * Resolves Sub and Dub availability for an anime series/movie using the routed provider.
 * Accepts optional `prefetchedAnime` and `format` to avoid redundant metadata lookups.
 */
export async function resolveServerAudioAvailability(params: {
  hoshikaId: string | number;
  anilistId?: number | null;
  episodeCount: number;
  episodeNumber?: number;
  prefetchedAnime?: HoshikaAnimeItem | null;
  format?: string | null;
  isStandaloneMovie?: boolean;
}): Promise<EpisodeAvailabilityResult> {
  const {
    hoshikaId,
    episodeCount,
    episodeNumber = 1,
    prefetchedAnime,
    format,
    isStandaloneMovie,
  } = params;

  if (episodeCount <= 0) {
    return createEpisodeAvailability({
      subAvailable: false,
      dubAvailable: false,
      subEpisodeCount: 0,
      dubEpisodeCount: 0,
    });
  }

  let anilistId = params.anilistId ?? prefetchedAnime?.anilistId ?? null;
  let resolvedFormat = format ?? prefetchedAnime?.format ?? null;

  if ((!anilistId || normalizeAnimeFormat(resolvedFormat) === 'UNKNOWN') && hoshikaId) {
    try {
      const idMap = await resolveAnimeIds(String(hoshikaId), prefetchedAnime);
      if (!anilistId) {
        anilistId = idMap?.anilistId ?? null;
      }
      if (normalizeAnimeFormat(resolvedFormat) === 'UNKNOWN' && idMap?.format) {
        resolvedFormat = idMap.format;
      }
    } catch {
      anilistId = anilistId ?? null;
    }
  }

  if (!anilistId) {
    return createEpisodeAvailability({
      subAvailable: false,
      dubAvailable: false,
      subEpisodeCount: 0,
      dubEpisodeCount: 0,
    });
  }

  const routed = await resolveStreamingProviderForAnime({
    format: resolvedFormat,
    isStandaloneMovie,
    prefetchedAnime,
    hoshikaId,
    anilistId,
  });
  const provider = routed.provider;

  const cacheKey = `${provider}:series_avail:${anilistId}:${episodeNumber}:${episodeCount}`;
  const cached = appCache.get<EpisodeAvailabilityResult>(cacheKey);
  if (cached) return cached;

  const existing = inFlightSeriesAvailMap.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<EpisodeAvailabilityResult> => {
    try {
      const epAvail = await checkEpisodeStreamAvailabilityDetailed(
        anilistId!,
        episodeNumber,
        null,
        {
          provider,
          format: routed.format !== 'UNKNOWN' ? routed.format : resolvedFormat,
        }
      );

      const subTransientFailure =
        !epAvail.subAvailable && !epAvail.subOutcome.definitiveUnavailable;
      const dubTransientFailure =
        !epAvail.dubAvailable && !epAvail.dubOutcome.definitiveUnavailable;

      const result = createEpisodeAvailability({
        subAvailable: epAvail.subAvailable,
        dubAvailable: epAvail.dubAvailable,
        subEpisodeCount: epAvail.subAvailable ? episodeCount : 0,
        dubEpisodeCount: epAvail.dubAvailable ? episodeCount : 0,
      });

      if (subTransientFailure) {
        result.sub.status = 'error';
      }
      if (dubTransientFailure) {
        result.dub.status = 'error';
      }

      // Cache when at least one track is playable OR both tracks were definitively answered
      if (
        epAvail.subAvailable ||
        epAvail.dubAvailable ||
        (!subTransientFailure && !dubTransientFailure)
      ) {
        appCache.set(cacheKey, result, {
          ttlSeconds: epAvail.subAvailable || epAvail.dubAvailable ? 600 : 60,
          staleWhileRevalidateSeconds:
            epAvail.subAvailable || epAvail.dubAvailable ? 1200 : 0,
        });
      }
      return result;
    } catch {
      return {
        sub: { available: false, status: 'error', episodeCount: 0 },
        dub: { available: false, status: 'error', episodeCount: 0 },
        defaultLanguage: null,
      };
    } finally {
      inFlightSeriesAvailMap.delete(cacheKey);
    }
  })();

  inFlightSeriesAvailMap.set(cacheKey, promise);
  return promise;
}

/**
 * Synchronous cache-only SSR helper for Anime Detail page.
 *
 * Returns cached Sub/Dub availability immediately (0ms) if already warm in memory,
 * and intentionally avoids firing unawaited background fetches during SSR/RSC prefetch
 * (which get frozen mid-flight on Vercel Serverless and cause false timeout logs).
 * When `null` is returned, client `useEpisodeAvailability` fetches on mount.
 */
export function getCachedOrWarmServerAudioAvailability(params: {
  hoshikaId: string | number;
  anilistId?: number | null;
  episodeCount: number;
  episodeNumber?: number;
  prefetchedAnime?: HoshikaAnimeItem | null;
  format?: string | null;
  isStandaloneMovie?: boolean;
}): EpisodeAvailabilityResult | null {
  const {
    episodeCount,
    episodeNumber = 1,
    prefetchedAnime,
    format,
    isStandaloneMovie,
  } = params;
  if (episodeCount <= 0) return null;

  const anilistId = params.anilistId ?? prefetchedAnime?.anilistId ?? null;
  const rawFormat = format ?? prefetchedAnime?.format ?? null;
  if (anilistId && normalizeAnimeFormat(rawFormat) !== 'UNKNOWN') {
    const provider = selectStreamingProvider({ format: rawFormat, isStandaloneMovie });
    const cacheKey = `${provider}:series_avail:${anilistId}:${episodeNumber}:${episodeCount}`;
    const cached = appCache.get<EpisodeAvailabilityResult>(cacheKey);
    if (cached) return cached;
  }

  return null;
}
