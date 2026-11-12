import { appCache } from './cache';
import {
  classifyUpstreamError,
  recordUpstreamMetric,
} from './perf-monitor';
import { AniSkipResponse } from '@/types/streaming';

const ANISKIP_BASE = 'https://api.aniskip.com/v2/skip-times';
const ANISKIP_TIMEOUT_MS = 6500;

/**
 * Fetches intro/outro skip timestamps from AniSkip v2 API with:
 * - In-flight request deduplication (concurrent calls for same malId + episode share 1 request)
 * - 24-hour cache + SWR for found timestamps, 120s negative cache for missing episodes
 * - Smart episodeLength handling to avoid unnecessary sequential 404 retries
 */
export async function getSkipTimes(
  malId: number,
  episodeNumber: number,
  episodeLengthSeconds: number = 1440
): Promise<AniSkipResponse> {
  if (!Number.isFinite(malId) || malId <= 0 || !Number.isFinite(episodeNumber) || episodeNumber <= 0) {
    return { found: false, results: [] };
  }

  const cacheKey = `aniskip:${malId}:${episodeNumber}`;
  const preState = appCache.getEntryState<AniSkipResponse>(cacheKey);
  if (preState.status !== 'miss' && preState.value) {
    recordUpstreamMetric({
      provider: 'aniskip',
      endpoint: `/${malId}/${episodeNumber}`,
      durationMs: 0,
      status: 200,
      fromCache: true,
      staleRevalidated: preState.status === 'stale',
    });
  }

  return appCache.getOrSet<AniSkipResponse>(
    cacheKey,
    async () => {
      const startTime = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ANISKIP_TIMEOUT_MS);
      const endpoint = `/${malId}/${episodeNumber}`;

      try {
        const roundedLength = Math.round(episodeLengthSeconds) || 0;
        // When default 1440 is passed before video duration is known, query with episodeLength=0 first
        // so AniSkip returns all skip intervals for the episode in 1 single HTTP call without 404ing on duration mismatch.
        const initialQueryLength = roundedLength === 1440 ? 0 : roundedLength;

        const url = `${ANISKIP_BASE}/${malId}/${episodeNumber}?types=op&types=ed&types=mixed-op&types=mixed-ed&types=recap&episodeLength=${initialQueryLength}`;

        let res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });

        // If a specific duration was passed and returned 404, retry once with episodeLength=0
        if (res.status === 404 && initialQueryLength > 0) {
          const fallbackUrl = `${ANISKIP_BASE}/${malId}/${episodeNumber}?types=op&types=ed&types=mixed-op&types=mixed-ed&types=recap&episodeLength=0`;
          const fallbackRes = await fetch(fallbackUrl, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          });
          if (fallbackRes.ok) {
            res = fallbackRes;
          }
        }

        const durationMs = Date.now() - startTime;

        if (!res.ok) {
          recordUpstreamMetric({
            provider: 'aniskip',
            endpoint,
            durationMs,
            status: res.status,
            fromCache: false,
            errorCode: res.status === 404 ? undefined : 'server_error',
          });
          return { found: false, results: [] };
        }

        const data: AniSkipResponse = await res.json();
        recordUpstreamMetric({
          provider: 'aniskip',
          endpoint,
          durationMs,
          status: res.status,
          fromCache: false,
        });

        if (data && data.found && Array.isArray(data.results) && data.results.length > 0) {
          return data;
        }
        return { found: false, results: [] };
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        const classified = classifyUpstreamError({
          provider: 'aniskip',
          endpoint,
          error: err,
          durationMs,
        });
        recordUpstreamMetric({
          provider: 'aniskip',
          endpoint,
          durationMs,
          status: null,
          fromCache: false,
          errorCode: classified.code,
        });
        return { found: false, results: [] };
      } finally {
        clearTimeout(timeout);
      }
    },
    {
      ttlSeconds: 86400, // 24 hours for valid skip times
      staleWhileRevalidateSeconds: 86400 * 2,
      shouldCache: (val) => Boolean(val?.found && Array.isArray(val.results) && val.results.length > 0),
      negativeTtlSeconds: 120, // 2 minutes for episodes without skip times yet
    }
  );
}
