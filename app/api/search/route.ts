import { NextRequest, NextResponse } from 'next/server';
import { searchHoshika } from '@/lib/hoshika';

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
    const results = await searchHoshika(q, limit, format, year);
    return NextResponse.json(
      { ok: true, results },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to search anime', results: [] },
      { status: 500 }
    );
  }
}
