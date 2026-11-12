import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaAnime } from '@/lib/hoshika';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Anime ID is required' }, { status: 400 });
  }

  try {
    const anime = await getHoshikaAnime(id);
    if (!anime) {
      return NextResponse.json({ ok: false, error: 'Anime not found' }, { status: 404 });
    }
    return NextResponse.json(
      { ok: true, anime },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
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
