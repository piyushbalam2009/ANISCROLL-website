import { NextRequest, NextResponse } from 'next/server';
import { getSkipTimes } from '@/lib/aniskip';
import { getAniListById } from '@/lib/anilist';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const malIdStr = searchParams.get('malId');
  const anilistIdStr = searchParams.get('anilistId');
  const episodeStr = searchParams.get('episode') || '1';
  const durationStr = searchParams.get('duration') || '1440';

  const episode = parseInt(episodeStr, 10);
  const duration = parseFloat(durationStr) || 1440;

  if (isNaN(episode) || episode < 1) {
    return NextResponse.json(
      { ok: false, error: 'Invalid episode number', found: false, results: [] },
      { status: 400 }
    );
  }

  let malId = malIdStr ? parseInt(malIdStr, 10) : NaN;
  const anilistId = anilistIdStr ? parseInt(anilistIdStr, 10) : NaN;

  // If malId is not provided or invalid, resolve idMal from AniList using anilistId
  if ((isNaN(malId) || malId <= 0) && !isNaN(anilistId) && anilistId > 0) {
    try {
      const media = await getAniListById(anilistId);
      if (media?.idMal && media.idMal > 0) {
        malId = media.idMal;
      }
    } catch {
      // Ignore resolution error
    }
  }

  if (isNaN(malId) || malId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'Valid malId or anilistId is required', found: false, results: [] },
      { status: 400 }
    );
  }

  try {
    let data = await getSkipTimes(malId, episode, duration);

    // If skip times were not found and anilistId is present and matches malId,
    // the caller passed an AniList ID as malId — resolve the real MAL ID and retry
    if (!data.found && !isNaN(anilistId) && anilistId > 0 && anilistId === malId) {
      try {
        const media = await getAniListById(anilistId);
        if (media?.idMal && media.idMal > 0 && media.idMal !== malId) {
          const malData = await getSkipTimes(media.idMal, episode, duration);
          if (malData.found) {
            data = malData;
          }
        }
      } catch {
        // Ignore resolution error
      }
    }

    return NextResponse.json(
      { ok: true, ...data },
      {
        headers: {
          'Cache-Control': data.found
            ? 'public, s-maxage=86400, stale-while-revalidate=172800'
            : 'public, s-maxage=120, stale-while-revalidate=300',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, found: false, results: [], error: 'Failed to fetch skip times' },
      { status: 500 }
    );
  }
}
