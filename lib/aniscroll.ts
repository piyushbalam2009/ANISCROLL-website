import { appCache } from './cache';
import { AniScrollStreamResponse } from '@/types/streaming';

const ANISCROLL_API_BASE = 'https://api.aniscroll.in/api';

export async function getAniScrollStream(
  anilistId: number,
  episode: number = 1,
  type: 'sub' | 'dub' = 'sub'
): Promise<AniScrollStreamResponse | null> {
  const cacheKey = `stream:megaplay:${anilistId}:${episode}:${type}`;
  const cached = appCache.get<AniScrollStreamResponse>(cacheKey);
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const url = `${ANISCROLL_API_BASE}/watch/megaplay/${anilistId}/${episode}/${type}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AniScroll-Player/1.0',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`AniScroll stream error ${res.status} for ${url}`);
      return null;
    }

    const data: AniScrollStreamResponse = await res.json();
    if (!data || (!data.m3u8 && !data.hlsProxyUrl && !data.embedUrl)) {
      console.warn('AniScroll returned empty streaming streams');
      return null;
    }

    // Cache stream for 30 minutes (streaming tokens usually expire in 1-4 hours)
    appCache.set(cacheKey, data, 1800);
    return data;
  } catch (err: any) {
    console.error('Error fetching AniScroll stream:', err.message || err);
    return null;
  }
}
