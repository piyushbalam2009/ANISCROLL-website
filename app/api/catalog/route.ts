import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaCatalog } from '@/lib/hoshika';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || undefined;
  const genreParams = searchParams.getAll('genre');
  const genre = genreParams.length > 0 ? genreParams.join(',') : undefined;
  const format = searchParams.get('format') || undefined;
  const status = searchParams.get('status') || undefined;
  const year = searchParams.get('year') || undefined;
  const sort = searchParams.get('sort') || 'top';
  const minScore = searchParams.get('minScore') || undefined;
  const page = parseInt(searchParams.get('page') || '1', 10) || 1;

  try {
    const data = await getHoshikaCatalog({
      q,
      genre,
      format,
      status,
      year,
      sort,
      minScore,
      page,
    });
    return NextResponse.json(
      { ok: true, ...data },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
        },
      }
    );
  } catch (err: any) {
    console.error('[API /catalog] Error:', err?.message || err);
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || 'Failed to load catalogue from upstream server.',
        items: [],
        total: 0,
        page: 1,
        pages: 1,
        hasMore: false,
      },
      { status: 500 }
    );
  }
}
