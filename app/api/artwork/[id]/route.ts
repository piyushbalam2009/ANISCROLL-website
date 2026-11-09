import { NextRequest, NextResponse } from 'next/server';
import { resolveAnimeArtwork } from '@/lib/artwork-mapper';

export const revalidate = 86400; // 24 hours

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'Anime ID is required' },
        { status: 400 }
      );
    }

    const artwork = await resolveAnimeArtwork(id);

    return NextResponse.json(
      { ok: true, artwork },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200',
        },
      }
    );
  } catch (error: any) {
    console.error('Error in /api/artwork/[id]:', error);
    return NextResponse.json(
      { ok: false, error: error.message || 'Failed to resolve artwork' },
      { status: 500 }
    );
  }
}
