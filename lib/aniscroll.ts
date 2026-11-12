import { appCache } from './cache';
import {
  AniScrollStreamResponse,
  EpisodeStreamAvailability,
} from '@/types/streaming';
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
  timeoutMs: number = 15000
): Promise<FetchZokoResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${ANISCROLL_ZOKOANIME_BASE}/${anilistId}/${episode}/${type}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AniScroll-Player/1.0',
      },
      signal: controller.signal,
    });

    if (res.status === 404 || res.status === 400) {
      return { stream: null, definitiveUnavailable: true };
    }

    if (!res.ok) {
      return { stream: null, definitiveUnavailable: false };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { stream: null, definitiveUnavailable: false };
    }

    const raw = await res.json();
    const validated = validateZokoAnimeResponse(raw, anilistId, episode, type);
    if (validated) {
      return { stream: validated, definitiveUnavailable: false };
    }

    // Valid JSON returned with an error field or no usable streams means this version is definitively unavailable
    return { stream: null, definitiveUnavailable: true };
  } catch {
    return { stream: null, definitiveUnavailable: false };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches and validates the ZokoAnime stream for a specific (anilistId, episode, type).
 * Deduplicates concurrent requests and caches valid stream responses.
 */
export async function getAniScrollStream(
  anilistId: number,
  episode: number = 1,
  type: 'sub' | 'dub' = 'sub'
): Promise<AniScrollStreamResponse | null> {
  if (!Number.isFinite(anilistId) || anilistId <= 0 || !Number.isFinite(episode) || episode <= 0) {
    return null;
  }

  const normalizedType: 'sub' | 'dub' = type === 'dub' ? 'dub' : 'sub';
  const cacheKey = `zokoanime:stream:${anilistId}:${episode}:${normalizedType}`;
  const missCacheKey = `zokoanime:miss:${anilistId}:${episode}:${normalizedType}`;

  const cached = appCache.get<AniScrollStreamResponse>(cacheKey);
  if (cached) return cached;

  const recentMiss = appCache.get<boolean>(missCacheKey);
  if (recentMiss) return null;

  const existingInFlight = inFlightStreamMap.get(cacheKey);
  if (existingInFlight) return existingInFlight;

  const promise = (async (): Promise<AniScrollStreamResponse | null> => {
    try {
      let attemptResult = await fetchZokoAnimeEndpoint(anilistId, episode, normalizedType, 15000);

      // Retry once on transient network/timeout failure
      if (!attemptResult.stream && !attemptResult.definitiveUnavailable) {
        attemptResult = await fetchZokoAnimeEndpoint(anilistId, episode, normalizedType, 15000);
      }

      if (attemptResult.stream) {
        appCache.set(cacheKey, attemptResult.stream, 600);
        return attemptResult.stream;
      }

      if (attemptResult.definitiveUnavailable) {
        appCache.set(missCacheKey, true, 120);
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
  if (!Number.isFinite(anilistId) || anilistId <= 0 || !Number.isFinite(episode) || episode <= 0) {
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
 * Used by anime detail pages and episode listings.
 */
export async function resolveServerAudioAvailability(params: {
  hoshikaId: string | number;
  anilistId?: number | null;
  episodeCount: number;
  episodeNumber?: number;
}): Promise<EpisodeAvailabilityResult> {
  const { hoshikaId, episodeCount, episodeNumber = 1 } = params;

  if (episodeCount <= 0) {
    return createEpisodeAvailability({
      subAvailable: false,
      dubAvailable: false,
      subEpisodeCount: 0,
      dubEpisodeCount: 0,
    });
  }

  let anilistId = params.anilistId ?? null;
  if (!anilistId && hoshikaId) {
    try {
      const idMap = await resolveAnimeIds(String(hoshikaId));
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
      const epAvail = await checkEpisodeStreamAvailability(anilistId!, episodeNumber);
      const result = createEpisodeAvailability({
        subAvailable: epAvail.subAvailable,
        dubAvailable: epAvail.dubAvailable,
        subEpisodeCount: epAvail.subAvailable ? episodeCount : 0,
        dubEpisodeCount: epAvail.dubAvailable ? episodeCount : 0,
      });

      if (epAvail.subAvailable || epAvail.dubAvailable) {
        appCache.set(cacheKey, result, 600);
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
