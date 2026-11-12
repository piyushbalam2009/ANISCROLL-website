import { appCache } from './cache';
import {
  classifyUpstreamError,
  recordUpstreamMetric,
} from './perf-monitor';
import {
  AniScrollStreamResponse,
  EpisodeStreamAvailability,
} from '@/types/streaming';
import { HoshikaAnimeItem } from '@/types/anime';
import { resolveAnimeIds } from './id-mapper';
import {
  EpisodeAvailabilityResult,
  createEpisodeAvailability,
} from './episode-store';
import {
  validateZokoAnimeResponse,
  selectEpisodeAudioVersion,
} from './zokoanime-stream';

const ANISCROLL_ZOKOANIME_BASE = 'https://api.aniscroll.in/api/watch/zokoanime';
const ZOKO_TIMEOUT_MS = 7500;

const inFlightStreamMap = new Map<string, Promise<AniScrollStreamResponse | null>>();
const inFlightEpisodeAvailMap = new Map<string, Promise<EpisodeStreamAvailability>>();
const inFlightSeriesAvailMap = new Map<string, Promise<EpisodeAvailabilityResult>>();

interface FetchZokoResult {
  stream: AniScrollStreamResponse | null;
  definitiveUnavailable: boolean;
}

async function fetchZokoAnimeEndpoint(
  anilistId: number,
  episode: number,
  type: 'sub' | 'dub',
  timeoutMs: number = ZOKO_TIMEOUT_MS
): Promise<FetchZokoResult> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = `/${anilistId}/${episode}/${type}`;
  const url = `${ANISCROLL_ZOKOANIME_BASE}${endpoint}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AniScroll-Player/1.0',
      },
      signal: controller.signal,
    });

    const durationMs = Date.now() - startTime;

    if (res.status === 404 || res.status === 400) {
      recordUpstreamMetric({
        provider: 'zokoanime',
        endpoint,
        durationMs,
        status: res.status,
        fromCache: false,
      });
      return { stream: null, definitiveUnavailable: true };
    }

    if (!res.ok) {
      const err = classifyUpstreamError({
        provider: 'zokoanime',
        endpoint,
        status: res.status,
        durationMs,
      });
      recordUpstreamMetric({
        provider: 'zokoanime',
        endpoint,
        durationMs,
        status: res.status,
        fromCache: false,
        errorCode: err.code,
      });
      return { stream: null, definitiveUnavailable: false };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      recordUpstreamMetric({
        provider: 'zokoanime',
        endpoint,
        durationMs,
        status: res.status,
        fromCache: false,
        errorCode: 'invalid_json',
      });
      return { stream: null, definitiveUnavailable: false };
    }

    const raw = await res.json();
    const validated = validateZokoAnimeResponse(raw, anilistId, episode, type);
    recordUpstreamMetric({
      provider: 'zokoanime',
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
      provider: 'zokoanime',
      endpoint,
      error,
      durationMs,
    });
    recordUpstreamMetric({
      provider: 'zokoanime',
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
 * Fetches and validates the ZokoAnime stream for a specific (anilistId, episode, type).
 * Deduplicates concurrent requests and caches valid stream responses for 5 minutes (300s).
 */
export async function getAniScrollStream(
  anilistId: number,
  episode: number = 1,
  type: 'sub' | 'dub' = 'sub'
): Promise<AniScrollStreamResponse | null> {
  if (
    !Number.isFinite(anilistId) ||
    anilistId <= 0 ||
    !Number.isFinite(episode) ||
    episode <= 0
  ) {
    return null;
  }

  const normalizedType: 'sub' | 'dub' = type === 'dub' ? 'dub' : 'sub';
  const cacheKey = `zokoanime:stream:${anilistId}:${episode}:${normalizedType}`;
  const missCacheKey = `zokoanime:miss:${anilistId}:${episode}:${normalizedType}`;

  const cached = appCache.get<AniScrollStreamResponse>(cacheKey);
  if (cached) {
    recordUpstreamMetric({
      provider: 'zokoanime',
      endpoint: `/${anilistId}/${episode}/${normalizedType}`,
      durationMs: 0,
      status: 200,
      fromCache: true,
    });
    return cached;
  }

  const recentMiss = appCache.get<boolean>(missCacheKey);
  if (recentMiss) {
    recordUpstreamMetric({
      provider: 'zokoanime',
      endpoint: `/${anilistId}/${episode}/${normalizedType}`,
      durationMs: 0,
      status: 404,
      fromCache: true,
    });
    return null;
  }

  const existingInFlight = inFlightStreamMap.get(cacheKey);
  if (existingInFlight) {
    recordUpstreamMetric({
      provider: 'zokoanime',
      endpoint: `/${anilistId}/${episode}/${normalizedType}`,
      durationMs: 0,
      status: 200,
      fromCache: false,
      deduplicated: true,
    });
    return existingInFlight;
  }

  const promise = (async (): Promise<AniScrollStreamResponse | null> => {
    try {
      let attemptResult = await fetchZokoAnimeEndpoint(
        anilistId,
        episode,
        normalizedType,
        ZOKO_TIMEOUT_MS
      );

      // Retry once on transient network/timeout failure
      if (!attemptResult.stream && !attemptResult.definitiveUnavailable) {
        await new Promise((r) => setTimeout(r, 250));
        attemptResult = await fetchZokoAnimeEndpoint(
          anilistId,
          episode,
          normalizedType,
          ZOKO_TIMEOUT_MS
        );
      }

      if (attemptResult.stream) {
        // Cache playable streams for 5 minutes (300s) so signed stream tokens remain fresh
        appCache.set(cacheKey, attemptResult.stream, {
          ttlSeconds: 300,
          staleWhileRevalidateSeconds: 180,
        });
        return attemptResult.stream;
      }

      if (attemptResult.definitiveUnavailable) {
        appCache.set(missCacheKey, true, {
          ttlSeconds: 90,
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
 * Dynamically checks both Sub and Dub endpoints in parallel for a specific episode:
 * - GET https://api.aniscroll.in/api/watch/zokoanime/{anilist_id}/{episode}/sub
 * - GET https://api.aniscroll.in/api/watch/zokoanime/{anilist_id}/{episode}/dub
 */
export async function checkEpisodeStreamAvailability(
  anilistId: number,
  episode: number = 1,
  userSelectedVersion?: 'sub' | 'dub' | null
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
      subAvailable: false,
      dubAvailable: false,
      subStream: null,
      dubStream: null,
      defaultVersion: null,
    };
  }

  const availKey = `zokoanime:ep_avail:${anilistId}:${episode}`;
  const existing = inFlightEpisodeAvailMap.get(availKey);

  const basePromise =
    existing ||
    (async (): Promise<EpisodeStreamAvailability> => {
      try {
        const [subStream, dubStream] = await Promise.all([
          getAniScrollStream(anilistId, episode, 'sub'),
          getAniScrollStream(anilistId, episode, 'dub'),
        ]);

        const subAvailable = Boolean(subStream);
        const dubAvailable = Boolean(dubStream);

        return {
          anilistId,
          episode,
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
    defaultVersion: selectEpisodeAudioVersion({
      subAvailable: resolved.subAvailable,
      dubAvailable: resolved.dubAvailable,
      userSelectedVersion,
    }),
  };
}

/**
 * Resolves Sub and Dub availability for an anime series (checking Episode 1 via ZokoAnime).
 * Accepts optional `prefetchedAnime` to avoid re-fetching Hoshika metadata when resolving AniList IDs.
 */
export async function resolveServerAudioAvailability(params: {
  hoshikaId: string | number;
  anilistId?: number | null;
  episodeCount: number;
  episodeNumber?: number;
  prefetchedAnime?: HoshikaAnimeItem | null;
}): Promise<EpisodeAvailabilityResult> {
  const { hoshikaId, episodeCount, episodeNumber = 1, prefetchedAnime } = params;

  if (episodeCount <= 0) {
    return createEpisodeAvailability({
      subAvailable: false,
      dubAvailable: false,
      subEpisodeCount: 0,
      dubEpisodeCount: 0,
    });
  }

  let anilistId = params.anilistId ?? prefetchedAnime?.anilistId ?? null;
  if (!anilistId && hoshikaId) {
    try {
      const idMap = await resolveAnimeIds(String(hoshikaId), prefetchedAnime);
      anilistId = idMap?.anilistId ?? null;
    } catch {
      anilistId = null;
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

  const cacheKey = `zokoanime:series_avail:${anilistId}:${episodeNumber}:${episodeCount}`;
  const cached = appCache.get<EpisodeAvailabilityResult>(cacheKey);
  if (cached) return cached;

  const existing = inFlightSeriesAvailMap.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<EpisodeAvailabilityResult> => {
    try {
      const epAvail = await checkEpisodeStreamAvailability(
        anilistId!,
        episodeNumber
      );
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
 * - Otherwise, kicks off `resolveServerAudioAvailability` in the background (warming `inFlightSeriesAvailMap`
 *   and `appCache`) and returns `null` so the Anime Detail page HTML renders without waiting 4s for ZokoAnime.
 */
export function getCachedOrWarmServerAudioAvailability(params: {
  hoshikaId: string | number;
  anilistId?: number | null;
  episodeCount: number;
  episodeNumber?: number;
  prefetchedAnime?: HoshikaAnimeItem | null;
}): EpisodeAvailabilityResult | null {
  const { episodeCount, episodeNumber = 1, prefetchedAnime } = params;
  if (episodeCount <= 0) return null;

  const anilistId = params.anilistId ?? prefetchedAnime?.anilistId ?? null;
  if (anilistId) {
    const cacheKey = `zokoanime:series_avail:${anilistId}:${episodeNumber}:${episodeCount}`;
    const cached = appCache.get<EpisodeAvailabilityResult>(cacheKey);
    if (cached) return cached;
  }

  // Trigger background warm-up; client useEpisodeAvailability will join inFlightSeriesAvailMap
  void resolveServerAudioAvailability(params).catch(() => null);
  return null;
}
