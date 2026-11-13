import { HoshikaAnimeItem } from '@/types/anime';
import { AnimeContentFormat, StreamingProvider } from '@/types/streaming';
import { getHoshikaAnime } from './hoshika';
import { getAniListById } from './anilist';
import {
  normalizeAnimeFormat,
  selectStreamingProvider,
} from './stream-provider-core';

export {
  ANISCROLL_API_ORIGIN,
  normalizeAnimeFormat,
  isMovieContent,
  selectStreamingProvider,
  getStreamingProviderDisplayName,
  buildProviderWatchUrl,
} from './stream-provider-core';

export interface ResolvedProviderResult {
  provider: StreamingProvider;
  format: AnimeContentFormat;
  resolvedFrom: 'param' | 'prefetched' | 'hoshika' | 'anilist' | 'fallback';
}

/**
 * Resolves the authoritative streaming provider for an anime on the server.
 * When `format` is missing or unknown, resolves trusted metadata from Hoshika and/or AniList
 * before choosing the provider so movies are never accidentally routed to MegaPlay.
 */
export async function resolveStreamingProviderForAnime(params: {
  format?: string | null;
  isStandaloneMovie?: boolean;
  prefetchedAnime?: HoshikaAnimeItem | null;
  hoshikaId?: string | number | null;
  anilistId?: number | null;
}): Promise<ResolvedProviderResult> {
  const { isStandaloneMovie } = params;

  const paramFormat = normalizeAnimeFormat(params.format);
  if (paramFormat !== 'UNKNOWN') {
    return {
      provider: selectStreamingProvider({ format: paramFormat, isStandaloneMovie }),
      format: paramFormat,
      resolvedFrom: 'param',
    };
  }

  const prefetchedFormat = normalizeAnimeFormat(params.prefetchedAnime?.format);
  if (prefetchedFormat !== 'UNKNOWN') {
    return {
      provider: selectStreamingProvider({ format: prefetchedFormat, isStandaloneMovie }),
      format: prefetchedFormat,
      resolvedFrom: 'prefetched',
    };
  }

  let resolvedAnilistId = params.anilistId ?? params.prefetchedAnime?.anilistId ?? null;

  if (params.hoshikaId !== undefined && params.hoshikaId !== null && String(params.hoshikaId).trim() !== '') {
    try {
      const anime = await getHoshikaAnime(params.hoshikaId, 'en');
      if (anime) {
        const hoshikaFormat = normalizeAnimeFormat(anime.format);
        if (hoshikaFormat !== 'UNKNOWN') {
          return {
            provider: selectStreamingProvider({ format: hoshikaFormat, isStandaloneMovie }),
            format: hoshikaFormat,
            resolvedFrom: 'hoshika',
          };
        }
        if (!resolvedAnilistId && anime.anilistId) {
          resolvedAnilistId = anime.anilistId;
        }
      }
    } catch {
      // Fall through to AniList lookup
    }
  }

  if (resolvedAnilistId && Number.isFinite(resolvedAnilistId) && resolvedAnilistId > 0) {
    try {
      const media = await getAniListById(resolvedAnilistId);
      const anilistFormat = normalizeAnimeFormat(media?.format);
      if (anilistFormat !== 'UNKNOWN') {
        return {
          provider: selectStreamingProvider({ format: anilistFormat, isStandaloneMovie }),
          format: anilistFormat,
          resolvedFrom: 'anilist',
        };
      }
    } catch {
      // Fall through to safe fallback
    }
  }

  // Format remains unknown after metadata lookup -> safe fallback to ZokoAnime
  return {
    provider: selectStreamingProvider({ format: 'UNKNOWN', isStandaloneMovie }),
    format: 'UNKNOWN',
    resolvedFrom: 'fallback',
  };
}
