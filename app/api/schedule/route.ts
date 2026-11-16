import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaScheduleDetailed } from '@/lib/hoshika';
import { hoshikaErrorToHttpStatus } from '@/lib/hoshika-client';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const locale = searchParams.get('locale') || 'en';

  try {
    const res = await getHoshikaScheduleDetailed(locale);
    if (!res.ok) {
      const status = hoshikaErrorToHttpStatus(res.error.category, res.error.status);
      return NextResponse.json(
        {
          ok: false,
          code: res.error.category,
          items: [],
          error: res.error.message,
        },
        { status, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    return NextResponse.json(
      { ok: true, items: res.data },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, items: [], error: err?.message || 'Failed to fetch schedule' },
      { status: 502, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
