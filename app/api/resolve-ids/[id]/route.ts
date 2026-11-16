import { NextRequest, NextResponse } from 'next/server';
import { resolveAnimeIds } from '@/lib/id-mapper';
import { hoshikaErrorToHttpStatus, HoshikaErrorCategory } from '@/lib/hoshika-client';

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
      const errCat = (mapping.errorCategory || 'NOT_FOUND') as HoshikaErrorCategory;
      const status =
        errCat === 'NOT_FOUND' ? 404 : hoshikaErrorToHttpStatus(errCat);
      const headers: Record<string, string> = {
        'Cache-Control': 'no-store, max-age=0',
      };
      if (status === 429 && mapping.retryAfterMs && mapping.retryAfterMs > 0) {
        headers['Retry-After'] = String(
          Math.max(1, Math.ceil(mapping.retryAfterMs / 1000))
        );
      }

      return NextResponse.json(
        {
          ok: false,
          code: errCat,
          error:
            mapping.explanation ||
            (status === 429
              ? 'Upstream catalogue rate limited'
              : 'Anime not found'),
          retryAfterMs: mapping.retryAfterMs,
          data: mapping,
          ...mapping,
        },
        { status, headers }
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
