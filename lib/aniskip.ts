import { appCache } from './cache';
import { AniSkipResponse } from '@/types/streaming';

const ANISKIP_BASE = 'https://api.aniskip.com/v2/skip-times';

export async function getSkipTimes(
  malId: number,
  episodeNumber: number,
  episodeLengthSeconds: number = 1440
): Promise<AniSkipResponse> {
  const cacheKey = `aniskip:${malId}:${episodeNumber}`;
  const cached = appCache.get<AniSkipResponse>(cacheKey);
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const length = Math.round(episodeLengthSeconds) || 1440;
    const url = `${ANISKIP_BASE}/${malId}/${episodeNumber}?types=op&types=ed&types=mixed-op&types=mixed-ed&types=recap&episodeLength=${length}`;

    let res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    // If AniSkip returned 404 with exact length, try without length constraint (episodeLength=0)
    if (res.status === 404 && length > 0) {
      const fallbackUrl = `${ANISKIP_BASE}/${malId}/${episodeNumber}?types=op&types=ed&types=mixed-op&types=mixed-ed&types=recap&episodeLength=0`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (fallbackRes.ok) {
        res = fallbackRes;
      }
    }

    clearTimeout(timeout);

    if (!res.ok) {
      const fallback: AniSkipResponse = { found: false, results: [] };
      // Only cache negative responses briefly (30s) so transient errors don't lock out skips
      appCache.set(cacheKey, fallback, 30);
      return fallback;
    }

    const data: AniSkipResponse = await res.json();
    if (data.found && Array.isArray(data.results) && data.results.length > 0) {
      appCache.set(cacheKey, data, 86400 * 3); // cache successful skip times for 3 days
    } else {
      appCache.set(cacheKey, { found: false, results: [] }, 60);
    }
    return data;
  } catch (err: any) {
    console.error('Error fetching AniSkip times:', err.message || err);
    return { found: false, results: [] };
  }
}
