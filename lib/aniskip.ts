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
    const timeout = setTimeout(() => controller.abort(), 6000);

    const length = Math.round(episodeLengthSeconds) || 1440;
    const url = `${ANISKIP_BASE}/${malId}/${episodeNumber}?types=op&types=ed&types=mixed-op&types=mixed-ed&types=recap&episodeLength=${length}`;

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const fallback: AniSkipResponse = { found: false, results: [] };
      appCache.set(cacheKey, fallback, 1800);
      return fallback;
    }

    const data: AniSkipResponse = await res.json();
    appCache.set(cacheKey, data, 86400 * 3); // cache skip times for 3 days
    return data;
  } catch (err: any) {
    console.error('Error fetching AniSkip times:', err.message || err);
    return { found: false, results: [] };
  }
}
