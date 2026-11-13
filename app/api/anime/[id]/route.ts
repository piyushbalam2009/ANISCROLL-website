import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaAnime } from '@/lib/hoshika';
import { appCache } from '@/lib/cache';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Anime ID is required' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const locale = searchParams.get('locale') || 'en';
  const forceRefresh = searchParams.get('refresh') === 'true';

  const cacheKey = `hoshika:/anime/${id}?locale=${locale}`;
  const preState = forceRefresh
    ? 'REFRESH'
    : appCache.getEntryState(cacheKey).status.toUpperCase();

  try {
    const anime = await getHoshikaAnime(id, locale, forceRefresh);
    if (!anime) {
      return NextResponse.json({ ok: false, error: 'Anime not found' }, { status: 404 });
    }
    return NextResponse.json(
      { ok: true, anime },
      {
        headers: {
          'Cache-Control': forceRefresh
            ? 'no-store, max-age=0'
            : 'public, s-maxage=180, stale-while-revalidate=600',
          'X-Cache-Status': preState === 'FRESH' ? 'HIT' : preState,
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to retrieve anime details' },
      { status: 500 }
    );
  }
}
