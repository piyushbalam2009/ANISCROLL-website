import { NextRequest, NextResponse } from 'next/server';
import { searchHoshikaDetailed } from '@/lib/hoshika';
import { hoshikaErrorToHttpStatus } from '@/lib/hoshika-client';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || '';
  const rawLimit = parseInt(searchParams.get('limit') || '20', 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, rawLimit)) : 20;
  const format = searchParams.get('format') || undefined;
  const year = searchParams.get('year') || undefined;

  if (!q.trim()) {
    return NextResponse.json({ ok: true, results: [] });
  }

  try {
    const res = await searchHoshikaDetailed(q, limit, format, year);
    if (!res.ok && res.error) {
      const status = hoshikaErrorToHttpStatus(res.error.category, res.error.status);
      return NextResponse.json(
        {
          ok: false,
          code: res.error.category,
          retryable: res.error.retryable,
          error: res.error.message,
          results: [],
        },
        {
          status,
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        }
      );
    }

    return NextResponse.json(
      { ok: true, results: res.items },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=360, stale-while-revalidate=720',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        code: 'UPSTREAM_UNAVAILABLE',
        error: err?.message || 'Failed to search anime',
        results: [],
      },
      {
        status: 502,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  }
}
