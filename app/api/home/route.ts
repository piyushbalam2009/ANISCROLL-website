import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaHomeDetailed } from '@/lib/hoshika';
import { hoshikaErrorToHttpStatus } from '@/lib/hoshika-client';
import { appCache } from '@/lib/cache';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const locale = searchParams.get('locale') || 'en';
  const forceRefresh = searchParams.get('refresh') === 'true';

  const preState = forceRefresh
    ? 'REFRESH'
    : appCache.getEntryState(`hoshika:/home?locale=${locale}`).status.toUpperCase();

  try {
    const res = await getHoshikaHomeDetailed(locale, forceRefresh);
    if (!res.ok) {
      const status = hoshikaErrorToHttpStatus(res.error.category, res.error.status);
      return NextResponse.json(
        {
          ok: false,
          code: res.error.category,
          retryable: res.error.retryable,
          error: res.error.message,
        },
        {
          status,
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        }
      );
    }

    return NextResponse.json(
      { ok: true, ...res.data },
      {
        headers: {
          'Cache-Control': forceRefresh
            ? 'no-store, max-age=0'
            : 'public, s-maxage=300, stale-while-revalidate=600',
          'X-Cache-Status': preState === 'FRESH' ? 'HIT' : preState,
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, code: 'UPSTREAM_UNAVAILABLE', error: err?.message || 'Failed to fetch home feed' },
      { status: 502, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
