import { NextRequest, NextResponse } from 'next/server';
import { resolveAnimeIds } from '@/lib/id-mapper';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const hoshikaId = parseInt(id, 10);

  if (!Number.isFinite(hoshikaId) || hoshikaId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'Invalid Hoshika ID' },
      { status: 400 }
    );
  }

  try {
    const mapping = await resolveAnimeIds(hoshikaId);
    if (mapping.status === 'failed' && mapping.title === 'Unknown') {
      return NextResponse.json(
        {
          ok: false,
          error: mapping.explanation || 'Anime not found',
          data: mapping,
          ...mapping,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        data: mapping,
        ...mapping,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    );
  } catch (error) {
    console.error('[API /resolve-ids] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to resolve anime IDs' },
      { status: 502 }
    );
  }
}
