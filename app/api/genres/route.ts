import { NextRequest, NextResponse } from 'next/server';
import {
  getHoshikaGenres,
  getHoshikaGenresDetailed,
  getHoshikaGenreTitlesDetailed,
} from '@/lib/hoshika';
import { hoshikaErrorToHttpStatus } from '@/lib/hoshika-client';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const genreSlug = searchParams.get('slug');
  const locale = searchParams.get('locale') || 'en';

  try {
    if (genreSlug) {
      const res = await getHoshikaGenreTitlesDetailed(genreSlug, locale);
      if (!res.ok) {
        const status = hoshikaErrorToHttpStatus(res.error.category, res.error.status);
        return NextResponse.json(
          {
            ok: false,
            code: res.error.category,
            error: res.error.message,
            items: [],
          },
          { status, headers: { 'Cache-Control': 'no-store, max-age=0' } }
        );
      }
      return NextResponse.json(
        { ok: true, items: res.data },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
          },
        }
      );
    }

    const res = await getHoshikaGenresDetailed();
    const genres = res.ok ? res.data : await getHoshikaGenres();
    return NextResponse.json(
      { ok: true, genres },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, genres: [], items: [], error: err?.message || 'Failed to fetch genres' },
      { status: 502, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
