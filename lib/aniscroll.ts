import { appCache } from './cache';
import {
  classifyUpstreamError,
  recordUpstreamMetric,
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
} from './stream-provider';

const STREAM_TIMEOUT_MS = 8500;

const inFlightStreamMap = new Map<string, Promise<AniScrollStreamResponse | null>>();
const inFlightEpisodeAvailMap = new Map<string, Promise<EpisodeStreamAvailability>>();
const inFlightSeriesAvailMap = new Map<string, Promise<EpisodeAvailabilityResult>>();

interface FetchStreamResult {
  stream: AniScrollStreamResponse | null;
  definitiveUnavailable: boolean;
}

export interface StreamRoutingOptions {
  provider?: StreamingProvider;
  format?: string | null;
  isStandaloneMovie?: boolean;
  hoshikaId?: string | number | null;
}

async function fetchProviderWatchEndpoint(
  provider: StreamingProvider,
  anilistId: number,
  episode: number,
  type: 'sub' | 'dub',
  timeoutMs: number = STREAM_TIMEOUT_MS
): Promise<FetchStreamResult> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = `/${provider}/${anilistId}/${episode}/${type}`;
  const url = buildProviderWatchUrl(provider, anilistId, episode, type);

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AniScroll-Player/1.0',
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    const durationMs = Date.now() - startTime;

    if (res.status === 404 || res.status === 400) {
      recordUpstreamMetric({
        provider,
        endpoint,
        durationMs,
        status: res.status,
        fromCache: false,
      });
      return { stream: null, definitiveUnavailable: true };
    }

    const contentType = res.headers.get('content-type') || '';

    // MegaPlay returns HTTP 502 JSON (`{ error: "MegaPlay failed to resolve a stream ...", source: "megaplay" }`)
    // when a specific audio version (e.g. dub on a sub-only show) or episode is unavailable.
    if (res.status === 502 && contentType.includes('application/json')) {
      try {
        const errPayload = (await res.json()) as Record<string, unknown>;
        const errText =
          typeof errPayload?.error === 'string' ? errPayload.error.toLowerCase() : '';
        if (
          errPayload?.source === 'megaplay' &&
          (errText.includes('failed to resolve') || errText.includes('not found'))
        ) {
          recordUpstreamMetric({
            provider,
            endpoint,
            durationMs,
            status: res.status,
            fromCache: false,
            errorCode: 'not_found',
          });
          return { stream: null, definitiveUnavailable: true };
        }
      } catch {
        // Fall through to transient error handling
      }
    }

    if (!res.ok) {
      const err = classifyUpstreamError({
        provider,
        endpoint,
        status: res.status,
        durationMs,
      });
      recordUpstreamMetric({
        provider,
        endpoint,
        durationMs,
        status: res.status,
        fromCache: false,
        errorCode: err.code,
      });
      return { stream: null, definitiveUnavailable: false };
    }

    if (!contentType.includes('application/json')) {
      recordUpstreamMetric({
        provider,
        endpoint,
        durationMs,
        status: res.status,
        fromCache: false,
        errorCode: 'invalid_json',
      });
      return { stream: null, definitiveUnavailable: false };
    }

    const raw = await res.json();
    const validated = validateProviderStreamResponse(
      raw,
      provider,
      anilistId,
      episode,
      type
    );
    recordUpstreamMetric({
      provider,
      endpoint,
      durationMs,
      status: res.status,
      fromCache: false,
    });

    if (validated) {
      return { stream: validated, definitiveUnavailable: false };
    }

    // Valid JSON returned with an error field or no usable streams means this version is definitively unavailable
    return { stream: null, definitiveUnavailable: true };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const err = classifyUpstreamError({
      provider,
      endpoint,
      error,
      durationMs,
    });
    recordUpstreamMetric({
      provider,
      endpoint,
      durationMs,
      status: null,
      fromCache: false,
      errorCode: err.code,
    });
    return { stream: null, definitiveUnavailable: false };
  } finally {
    clearTimeout(timeout);
  }
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
  if (
    !Number.isFinite(anilistId) ||
    anilistId <= 0 ||
    !Number.isFinite(episode) ||
    episode <= 0
  ) {
    return null;
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

  const cached = appCache.get<AniScrollStreamResponse>(cacheKey);
  if (cached) {
    recordUpstreamMetric({
      provider,
      endpoint: metricEndpoint,
      durationMs: 0,
      status: 200,
      fromCache: true,
    });
    return {
      ...cached,
      provider,
      format: cached.format ?? resolvedFormat,
    };
  }

  const recentMiss = appCache.get<boolean>(missCacheKey);
  if (recentMiss) {
    recordUpstreamMetric({
      provider,
      endpoint: metricEndpoint,
      durationMs: 0,
      status: 404,
      fromCache: true,
    });
    return null;
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

  const promise = (async (): Promise<AniScrollStreamResponse | null> => {
    try {
      let attemptResult = await fetchProviderWatchEndpoint(
        provider,
        anilistId,
        episode,
        normalizedType,
        STREAM_TIMEOUT_MS
      );

      // Retry once on transient network/timeout failure (same provider only — no cross-provider fallback)
      if (!attemptResult.stream && !attemptResult.definitiveUnavailable) {
        await new Promise((r) => setTimeout(r, 250));
        attemptResult = await fetchProviderWatchEndpoint(
          provider,
          anilistId,
          episode,
          normalizedType,
          STREAM_TIMEOUT_MS
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
        return enriched;
      }

      if (attemptResult.definitiveUnavailable) {
        // Short negative cache (45s MegaPlay / 60s ZokoAnime) so retry works smoothly while shielding rapid dub probes
        appCache.set(missCacheKey, true, {
          ttlSeconds: provider === 'megaplay' ? 45 : 60,
          staleWhileRevalidateSeconds: 0,
        });
      }
      return null;
    } finally {
      inFlightStreamMap.delete(cacheKey);
    }
  })();

  inFlightStreamMap.set(cacheKey, promise);
  return promise;
}

/**
 * Dynamically checks both Sub and Dub endpoints in parallel on the selected provider:
 * - Series (`TV`, `TV_SHORT`, `OVA`, `ONA`, `SPECIAL`) -> `https://api.aniscroll.in/api/watch/megaplay/{anilist_id}/{episode}/{sub|dub}`
 * - Movies (`MOVIE`, standalone movie `SPECIAL`, or unknown fallback) -> `https://api.aniscroll.in/api/watch/zokoanime/{anilist_id}/{episode}/{sub|dub}`
 */
export async function checkEpisodeStreamAvailability(
  anilistId: number,
  episode: number = 1,
  userSelectedVersion?: 'sub' | 'dub' | null,
  options?: StreamRoutingOptions
): Promise<EpisodeStreamAvailability> {
  if (
    !Number.isFinite(anilistId) ||
    anilistId <= 0 ||
    !Number.isFinite(episode) ||
    episode <= 0
  ) {
    return {
      anilistId,
      episode,
      provider: options?.provider ?? 'zokoanime',
      format: options?.format ?? null,
      subAvailable: false,
      dubAvailable: false,
      subStream: null,
      dubStream: null,
      defaultVersion: null,
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
    (async (): Promise<EpisodeStreamAvailability> => {
      try {
        const [subStream, dubStream] = await Promise.all([
          getAniScrollStream(anilistId, episode, 'sub', {
            provider,
            format: resolvedFormat,
          }),
          getAniScrollStream(anilistId, episode, 'dub', {
            provider,
            format: resolvedFormat,
          }),
        ]);

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
      const epAvail = await checkEpisodeStreamAvailability(anilistId!, episodeNumber, null, {
        provider,
        format: routed.format !== 'UNKNOWN' ? routed.format : resolvedFormat,
      });
      const result = createEpisodeAvailability({
        subAvailable: epAvail.subAvailable,
        dubAvailable: epAvail.dubAvailable,
        subEpisodeCount: epAvail.subAvailable ? episodeCount : 0,
        dubEpisodeCount: epAvail.dubAvailable ? episodeCount : 0,
      });

      if (epAvail.subAvailable || epAvail.dubAvailable) {
        appCache.set(cacheKey, result, {
          ttlSeconds: 600,
          staleWhileRevalidateSeconds: 1200,
        });
      }
      return result;
    } catch {
      return createEpisodeAvailability({
        subAvailable: false,
        dubAvailable: false,
        subEpisodeCount: 0,
        dubEpisodeCount: 0,
      });
    } finally {
      inFlightSeriesAvailMap.delete(cacheKey);
    }
  })();

  inFlightSeriesAvailMap.set(cacheKey, promise);
  return promise;
}

/**
 * Non-blocking SSR helper for Anime Detail page:
 * - Returns cached Sub/Dub availability immediately (0ms) if already in memory cache.
 * - Otherwise, kicks off `resolveServerAudioAvailability` in the background.
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

  // Trigger background warm-up; client useEpisodeAvailability will join inFlightSeriesAvailMap
  void resolveServerAudioAvailability(params).catch(() => null);
  return null;
}
