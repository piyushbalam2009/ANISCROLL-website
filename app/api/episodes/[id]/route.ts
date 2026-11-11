import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaAnime, getHoshikaEpisodes, getAllHoshikaEpisodes } from '@/lib/hoshika';
import { resolveAnimeIds } from '@/lib/id-mapper';
import { getAniListById } from '@/lib/anilist';
import { resolveServerAudioAvailability } from '@/lib/aniscroll';
import { AudioLanguage } from '@/lib/episode-store';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const trimmedId = (id || '').trim();

  if (!trimmedId || !/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid Anime ID', items: [], total: 0 },
      {
        status: 400,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
      }
    );
  }

  const { searchParams } = new URL(req.url);
  const locale = searchParams.get('locale') || 'en';
  const langParam = searchParams.get('lang');
  const requestedLanguage: AudioLanguage | null =
    langParam === 'dub' ? 'dub' : langParam === 'sub' ? 'sub' : null;
  const checkAvailability =
    searchParams.get('checkAvailability') === 'true' || requestedLanguage !== null;
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
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50));

  try {
    if (all) {
      const [result, idMap] = await Promise.all([
        getAllHoshikaEpisodes(trimmedId, locale),
        checkAvailability ? resolveAnimeIds(trimmedId).catch(() => null) : Promise.resolve(null),
      ]);

      const episodeCount = result.total || result.items.length;
      const availability = checkAvailability
        ? await resolveServerAudioAvailability({
            hoshikaId: trimmedId,
            anilistId: idMap?.anilistId ?? null,
            episodeCount,
          })
        : undefined;

      const filteredItems =
        requestedLanguage && availability && !availability[requestedLanguage].available
          ? []
          : requestedLanguage === 'dub' &&
            availability?.dub.available &&
            availability.dub.episodeCount > 0
          ? result.items.filter((ep) => ep.number <= availability.dub.episodeCount)
          : result.items;

      const hasValidEpisodes = filteredItems.length > 0;
      return NextResponse.json(
        {
          ok: true,
          items: filteredItems,
          total: hasValidEpisodes
            ? requestedLanguage === 'dub' && availability?.dub.episodeCount
              ? Math.min(result.total, availability.dub.episodeCount)
              : result.total
            : 0,
          nextAfter: null,
          availability,
        },
        {
          headers: {
            'Cache-Control': hasValidEpisodes
              ? 'public, s-maxage=300, stale-while-revalidate=600'
              : 'no-store, no-cache, must-revalidate',
          },
        }
      );
    }

    const [result, anime] = await Promise.all([
      getHoshikaEpisodes(trimmedId, locale, after, limit),
      includeAnime ? getHoshikaAnime(trimmedId, locale) : Promise.resolve(null),
    ]);

    let anilistCover: string | null = null;
    let anilistBanner: string | null = null;
    let resolvedAnilistId: number | null = anime?.anilistId ?? null;

    if (
      (includeAnime && (!anime?.coverImage || !anime?.bannerImage || !resolvedAnilistId)) ||
      (checkAvailability && !resolvedAnilistId)
    ) {
      try {
        const idMap = await resolveAnimeIds(trimmedId);
        resolvedAnilistId = idMap?.anilistId ?? null;
        if (includeAnime && resolvedAnilistId && (!anime?.coverImage || !anime?.bannerImage)) {
          const media = await getAniListById(resolvedAnilistId);
          anilistCover = media?.coverImage?.extraLarge || media?.coverImage?.large || null;
          anilistBanner = media?.bannerImage || null;
        }
      } catch {
        // Optional AniList fallback
      }
    }

    const episodeCount = result.total || result.items.length;
    const availability = checkAvailability
      ? await resolveServerAudioAvailability({
          hoshikaId: trimmedId,
          anilistId: resolvedAnilistId,
          episodeCount,
        })
      : undefined;

    const filteredItems =
      requestedLanguage && availability && !availability[requestedLanguage].available
        ? []
        : requestedLanguage === 'dub' &&
          availability?.dub.available &&
          availability.dub.episodeCount > 0
        ? result.items.filter((ep) => ep.number <= availability.dub.episodeCount)
        : result.items;

    const matchedEpisode =
      targetEpisode !== undefined
        ? filteredItems.find((ep) => ep.number === targetEpisode) || null
        : null;

    const hasValidEpisodes = filteredItems.length > 0;

    return NextResponse.json(
      {
        ok: true,
        items: filteredItems,
        total: hasValidEpisodes ? result.total : 0,
        nextAfter: hasValidEpisodes ? result.nextAfter : null,
        availability,
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
      },
      {
        headers: {
          'Cache-Control': hasValidEpisodes
            ? 'public, s-maxage=300, stale-while-revalidate=600'
            : 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to retrieve anime episodes', items: [], total: 0 },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
      }
    );
  }
}
