import { NextRequest, NextResponse } from 'next/server';
import { resolveAnimeDetailById } from '@/lib/hoshika';
import { hoshikaErrorToHttpStatus } from '@/lib/hoshika-client';
import { resolveAnimeArtwork } from '@/lib/artwork-mapper';
import {
  getCachedArtwork,
  getCachedArtworkOverride,
  invalidateCachedArtwork,
} from '@/lib/artwork/artwork-cache';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const hoshikaId = parseInt(id, 10);

  if (!Number.isFinite(hoshikaId) || hoshikaId <= 0) {
    return NextResponse.json({ ok: false, error: 'Invalid anime ID' }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const queryTitle = searchParams.get('title');
  const queryAnilistId = searchParams.get('anilistId');
  const queryMalId = searchParams.get('malId');
  const queryFormat = searchParams.get('format');
  const queryBanner = searchParams.get('banner');
  const queryCover = searchParams.get('cover');
  const bypassCache = searchParams.get('refresh') === 'true';

  try {
    if (bypassCache) {
      invalidateCachedArtwork(hoshikaId);
    }

    const hadFreshCache =
      !bypassCache &&
      getCachedArtworkOverride(hoshikaId) !== undefined &&
      getCachedArtwork(hoshikaId) !== null;

    let title = queryTitle;
    let titleRomaji: string | null = null;
    let anilistId = queryAnilistId ? parseInt(queryAnilistId, 10) : null;
    let malId = queryMalId ? parseInt(queryMalId, 10) : null;
    let tvdbId: number | null = null;
    let tmdbId: number | null = null;
    let format = queryFormat;
    let hoshikaBanner = queryBanner;
    let hoshikaCover = queryCover;

    let fetchedAnime = null;

    if (!title || (!hoshikaBanner && !hoshikaCover) || !anilistId || bypassCache) {
      const outcome = await resolveAnimeDetailById(hoshikaId, 'en', bypassCache);
      const anime = outcome.anime;
      fetchedAnime = anime;
      const override = getCachedArtworkOverride(hoshikaId);

      if (!anime && !override && !queryTitle && !queryBanner && !queryCover) {
        if (outcome.status === 'upstream_error' && outcome.error) {
          const httpStatus = hoshikaErrorToHttpStatus(
            outcome.error.category,
            outcome.error.status
          );
          const headers: Record<string, string> = {
            'Cache-Control': 'no-store, max-age=0',
          };
          if (httpStatus === 429 && outcome.error.retryAfterMs) {
            headers['Retry-After'] = String(
              Math.max(1, Math.ceil(outcome.error.retryAfterMs / 1000))
            );
          }
          return NextResponse.json(
            {
              ok: false,
              code: outcome.error.category,
              error: outcome.error.message,
              retryAfterMs: outcome.error.retryAfterMs,
            },
            { status: httpStatus, headers }
          );
        }

        return NextResponse.json(
          { ok: false, error: 'Anime not found' },
          { status: 404 }
        );
      }

      if (anime) {
        title =
          title ||
          anime.titleEnglish ||
          anime.titleRomaji ||
          anime.titleLocalized ||
          null;
        titleRomaji = anime.titleRomaji || null;
        anilistId = anilistId || anime.anilistId || null;
        malId = malId || anime.malId || null;
        tvdbId = anime.thetvdbId ? Number(anime.thetvdbId) : null;
        tmdbId = anime.themoviedbId ? Number(anime.themoviedbId) : null;
        format = format || anime.format || null;
        hoshikaBanner = hoshikaBanner || anime.bannerImage || null;
        hoshikaCover = hoshikaCover || anime.coverImage || null;
      }
    }

    const artwork = await resolveAnimeArtwork(
      {
        hoshikaId,
        anilistId,
        malId,
        tvdbId,
        tmdbId,
        title,
        titleRomaji,
        format,
        hoshikaBanner,
        hoshikaCover,
        bypassCache,
      },
      fetchedAnime
    );

    const cacheStatus = bypassCache ? 'REFRESH' : hadFreshCache ? 'HIT' : 'MISS';

    return NextResponse.json(artwork, {
      status: 200,
      headers: {
        'Cache-Control': bypassCache
          ? 'no-store, max-age=0'
          : 'public, s-maxage=180, stale-while-revalidate=600',
        'X-Cache-Status': cacheStatus,
        'X-Artwork-Source': `${artwork.source}:${artwork.backgroundSource}:${artwork.logoSource}`,
      },
    });
  } catch (error) {
    console.error(`Failed to resolve artwork for ${hoshikaId}:`, error);
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to resolve anime artwork',
        hoshikaId,
      },
      { status: 502 }
    );
  }
}
