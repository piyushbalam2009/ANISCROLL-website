import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaAnime, getHoshikaEpisodes, getAllHoshikaEpisodes } from '@/lib/hoshika';
import { resolveAnimeIds } from '@/lib/id-mapper';
import { getAniListById } from '@/lib/anilist';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const locale = searchParams.get('locale') || 'en';
  const all = searchParams.get('all') === 'true';
  const includeAnime = searchParams.get('includeAnime') === 'true';
  const episodeParam = searchParams.get('episode');
  const targetEpisode =
    episodeParam !== null && episodeParam !== '' ? parseInt(episodeParam, 10) : undefined;
  const afterParam = searchParams.get('after');
  const after =
    afterParam !== null && afterParam !== ''
      ? parseInt(afterParam, 10)
      : targetEpisode && targetEpisode > 50
      ? Math.floor((targetEpisode - 1) / 50) * 50
      : undefined;
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  if (!id) {
    return NextResponse.json({ ok: false, error: 'Anime ID is required' }, { status: 400 });
  }

  try {
    if (all) {
      const result = await getAllHoshikaEpisodes(id, locale);
      return NextResponse.json({ ok: true, ...result, nextAfter: null });
    }

    const [result, anime] = await Promise.all([
      getHoshikaEpisodes(id, locale, after, limit),
      includeAnime ? getHoshikaAnime(id, locale) : Promise.resolve(null),
    ]);

    const matchedEpisode =
      targetEpisode !== undefined
        ? result.items.find((ep) => ep.number === targetEpisode) || null
        : null;

    let anilistCover: string | null = null;
    let anilistBanner: string | null = null;
    let resolvedAnilistId: number | null = anime?.anilistId ?? null;

    if (includeAnime && (!anime?.coverImage || !anime?.bannerImage || !resolvedAnilistId)) {
      try {
        const idMap = await resolveAnimeIds(id);
        resolvedAnilistId = idMap?.anilistId ?? null;
        if (resolvedAnilistId && (!anime?.coverImage || !anime?.bannerImage)) {
          const media = await getAniListById(resolvedAnilistId);
          anilistCover = media?.coverImage?.extraLarge || media?.coverImage?.large || null;
          anilistBanner = media?.bannerImage || null;
        }
      } catch {
        // Optional AniList fallback
      }
    }

    return NextResponse.json({
      ok: true,
      ...result,
      episode: matchedEpisode,
      anime: anime
        ? {
            shortId: anime.shortId,
            anilistId: resolvedAnilistId,
            titleEnglish: anime.titleEnglish,
            titleRomaji: anime.titleRomaji,
            titleLocalized: anime.titleLocalized,
            coverImage: anime.coverImage || anilistCover || null,
            bannerImage: anime.bannerImage || anilistBanner || null,
          }
        : null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to retrieve anime episodes', items: [], total: 0 },
      { status: 500 }
    );
  }
}


