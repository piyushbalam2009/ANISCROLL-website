import { appCache } from './cache';
import { AniScrollStreamResponse } from '@/types/streaming';
import { resolveAnimeIds } from './id-mapper';
import {
  EpisodeAvailabilityResult,
  createEpisodeAvailability,
} from './episode-store';

const ANISCROLL_API_BASE = 'https://api.aniscroll.in/api';

const inFlightAvailabilityMap = new Map<string, Promise<EpisodeAvailabilityResult>>();

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number = 4000): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AniScroll-Player/1.0',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAniScrollStream(
  anilistId: number,
  episode: number = 1,
  type: 'sub' | 'dub' = 'sub'
): Promise<AniScrollStreamResponse | null> {
  const cacheKey = `stream:megaplay:${anilistId}:${episode}:${type}`;
  const cached = appCache.get<AniScrollStreamResponse>(cacheKey);
  if (cached) return cached;

  const sources = ['megaplay', 'zokoanime', 'anikoto'] as const;

  for (const source of sources) {
    try {
      const url = `${ANISCROLL_API_BASE}/watch/${source}/${anilistId}/${episode}/${type}`;
      const data = await fetchJsonWithTimeout<AniScrollStreamResponse>(url, 7000);
      if (data && (data.m3u8 || data.hlsProxyUrl || data.embedUrl)) {
        appCache.set(cacheKey, data, 1800);
        return data;
      }
    } catch (err: any) {
      console.error(`Error fetching AniScroll stream (${source}):`, err?.message || err);
    }
  }

  return null;
}

/**
 * Resolves actual Sub and Dub availability for an anime using streaming provider checks.
 * Caches resolved availability on the server for 30 minutes and deduplicates concurrent checks.
 */
export async function resolveServerAudioAvailability(params: {
  hoshikaId: string | number;
  anilistId?: number | null;
  episodeCount: number;
}): Promise<EpisodeAvailabilityResult> {
  const { hoshikaId, episodeCount } = params;

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

  const cacheKey = `availability:audio:${anilistId || hoshikaId}:${episodeCount}`;
  const cached = appCache.get<EpisodeAvailabilityResult>(cacheKey);
  if (cached) return cached;

  if (!anilistId) {
    const fallback = createEpisodeAvailability({
      subAvailable: episodeCount > 0,
      dubAvailable: false,
      subEpisodeCount: episodeCount,
      dubEpisodeCount: 0,
    });
    return fallback;
  }

  const existing = inFlightAvailabilityMap.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<EpisodeAvailabilityResult> => {
    try {
      const [megaSub, megaDub, desidubEps] = await Promise.all([
        fetchJsonWithTimeout<any>(`${ANISCROLL_API_BASE}/watch/megaplay/${anilistId}/1/sub`, 6000),
        fetchJsonWithTimeout<any>(`${ANISCROLL_API_BASE}/watch/megaplay/${anilistId}/1/dub`, 6000),
        fetchJsonWithTimeout<any>(
          `${ANISCROLL_API_BASE}/episodes?anilistId=${anilistId}&source=desidub`,
          6000
        ),
      ]);

      const megaSubOk = Boolean(megaSub && (megaSub.m3u8 || megaSub.hlsProxyUrl || megaSub.embedUrl));
      const megaDubOk = Boolean(megaDub && (megaDub.m3u8 || megaDub.hlsProxyUrl || megaDub.embedUrl));
      const desidubCount =
        typeof desidubEps?.count === 'number' && desidubEps.count > 0
          ? desidubEps.count
          : Array.isArray(desidubEps?.episodes)
          ? desidubEps.episodes.length
          : 0;
      const desidubOk = desidubCount > 0;

      let anikotoSubOk = false;
      let anikotoDubOk = false;
      let anikotoSubLen = 0;
      let anikotoDubLen = 0;

      if (!megaSubOk && !megaDubOk && !desidubOk) {
        const [anikotoSub, anikotoDub] = await Promise.all([
          fetchJsonWithTimeout<any>(
            `${ANISCROLL_API_BASE}/servers?anilistId=${anilistId}&ep=1&type=sub&source=anikoto`,
            5000
          ),
          fetchJsonWithTimeout<any>(
            `${ANISCROLL_API_BASE}/servers?anilistId=${anilistId}&ep=1&type=dub&source=anikoto`,
            5000
          ),
        ]);
        anikotoSubLen = Array.isArray(anikotoSub?.servers) ? anikotoSub.servers.length : 0;
        anikotoDubLen = Array.isArray(anikotoDub?.servers) ? anikotoDub.servers.length : 0;
        anikotoSubOk = anikotoSubLen > 0;
        anikotoDubOk = anikotoDubLen > 0;
      }

      let subAvailable = false;
      let dubAvailable = false;
      let dubEpisodeCount = episodeCount;
      let probeResolved = true;

      if (megaSubOk) {
        subAvailable = true;
        // MegaPlay accurately distinguishes sub-only vs dubbed anime; DesiDub confirms dubbed episode counts
        dubAvailable = megaDubOk || desidubOk;
        if (desidubCount > 0) {
          dubEpisodeCount = Math.min(episodeCount, desidubCount);
        }
      } else if (megaDubOk) {
        subAvailable = anikotoSubOk;
        dubAvailable = true;
      } else if (anikotoSubOk || anikotoDubOk || desidubOk) {
        subAvailable = anikotoSubOk || episodeCount > 0;
        dubAvailable = desidubOk || (anikotoDubOk && anikotoSubLen === anikotoDubLen);
        if (desidubCount > 0) {
          dubEpisodeCount = Math.min(episodeCount, desidubCount);
        }
      } else {
        // Fallback when external stream probes time out: Hoshika episodes exist as sub
        subAvailable = episodeCount > 0;
        dubAvailable = false;
        probeResolved = false;
      }

      const result = createEpisodeAvailability({
        subAvailable,
        dubAvailable,
        subEpisodeCount: subAvailable ? episodeCount : 0,
        dubEpisodeCount: dubAvailable ? dubEpisodeCount : 0,
      });

      if (probeResolved) {
        appCache.set(cacheKey, result, 1800);
      }
      return result;
    } catch {
      return createEpisodeAvailability({
        subAvailable: episodeCount > 0,
        dubAvailable: false,
        subEpisodeCount: episodeCount,
        dubEpisodeCount: 0,
      });
    } finally {
      inFlightAvailabilityMap.delete(cacheKey);
    }
  })();

  inFlightAvailabilityMap.set(cacheKey, promise);
  return promise;
}
