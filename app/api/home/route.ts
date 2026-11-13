import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaHome } from '@/lib/hoshika';
import { appCache } from '@/lib/cache';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const locale = searchParams.get('locale') || 'en';
  const forceRefresh = searchParams.get('refresh') === 'true';

  const preState = forceRefresh
    ? 'REFRESH'
    : appCache.getEntryState(`hoshika:/home?locale=${locale}`).status.toUpperCase();

  try {
    const data = await getHoshikaHome(locale, forceRefresh);
    return NextResponse.json(
      { ok: true, ...data },
      {
        headers: {
          'Cache-Control': forceRefresh
            ? 'no-store, max-age=0'
            : 'public, s-maxage=120, stale-while-revalidate=300',
          'X-Cache-Status': preState === 'FRESH' ? 'HIT' : preState,
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Failed to fetch home feed' }, { status: 500 });
  }
}
