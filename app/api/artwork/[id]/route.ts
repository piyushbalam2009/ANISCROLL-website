import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaAnime } from '@/lib/hoshika';
import { resolveAnimeArtwork } from '@/lib/artwork-mapper';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const hoshikaId = parseInt(id, 10);

  if (!Number.isFinite(hoshikaId) || hoshikaId <= 0) {
    return NextResponse.json({ error: 'Invalid anime ID' }, { status: 400 });
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
    let title = queryTitle;
    let anilistId = queryAnilistId ? parseInt(queryAnilistId, 10) : null;
    let malId = queryMalId ? parseInt(queryMalId, 10) : null;
    let format = queryFormat;
    let hoshikaBanner = queryBanner;
    let hoshikaCover = queryCover;

    if (!title || (!hoshikaBanner && !hoshikaCover)) {
      const anime = await getHoshikaAnime(hoshikaId, 'en');
      if (anime) {
        title =
          title ||
          anime.titleEnglish ||
          anime.titleRomaji ||
          anime.titleLocalized ||
          null;
        anilistId = anilistId || anime.anilistId || null;
        malId = malId || anime.malId || null;
        format = format || anime.format || null;
        hoshikaBanner = hoshikaBanner || anime.bannerImage || null;
        hoshikaCover = hoshikaCover || anime.coverImage || null;
      }
    }

    const artwork = await resolveAnimeArtwork({
      hoshikaId,
      anilistId,
      malId,
      title,
      format,
      hoshikaBanner,
      hoshikaCover,
      bypassCache,
    });

    return NextResponse.json(artwork, {
      headers: {
        'Cache-Control': bypassCache
          ? 'no-store, max-age=0'
          : 'public, s-maxage=300, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error(`Failed to resolve artwork for ${hoshikaId}:`, error);
    return NextResponse.json(
      {
        hoshikaId,
        backgroundUrl: queryBanner || queryCover || null,
        logoUrl: null,
        characterArtUrl: null,
        posterUrl: queryCover || null,
        source: 'hoshika',
        fetchedAt: Date.now(),
      },
      { status: 200 }
    );
  }
}
