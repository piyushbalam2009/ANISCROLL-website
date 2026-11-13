import { NextRequest, NextResponse } from 'next/server';
import {
  fetchAniListCharacters,
  POPULAR_ANIME_AVATAR_SERIES,
} from '@/lib/anilist-characters';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const perPage = Math.min(36, Math.max(6, Number(searchParams.get('perPage')) || 24));
    const search = (searchParams.get('q') || '').trim().slice(0, 100);
    const series = (searchParams.get('series') || '').trim().slice(0, 100);
    const forceRefresh = searchParams.get('refresh') === '1';

    const data = await fetchAniListCharacters({
      page,
      perPage,
      search,
      series,
      forceRefresh,
    });

    return NextResponse.json(
      {
        ok: true,
        ...data,
        seriesOptions: POPULAR_ANIME_AVATAR_SERIES,
      },
      {
        headers: {
          'Cache-Control': forceRefresh
            ? 'no-store'
            : 'public, s-maxage=300, stale-while-revalidate=900',
        },
      }
    );
  } catch (err) {
    console.error('[API /characters] Failed to fetch characters:', err);
    return NextResponse.json(
      {
        ok: false,
        characters: [],
        page: 1,
        perPage: 24,
        hasNextPage: false,
        total: 0,
        error: 'Unable to load anime characters right now.',
      },
      { status: 500 }
    );
  }
}
