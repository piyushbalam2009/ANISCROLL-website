import { NextRequest, NextResponse } from 'next/server';
import { resolveAnimeDetailById } from '@/lib/hoshika';
import { hoshikaErrorToHttpStatus } from '@/lib/hoshika-client';
import { appCache } from '@/lib/cache';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_ID', error: 'Anime ID is required' },
      { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  const { searchParams } = new URL(req.url);
  const locale = searchParams.get('locale') || 'en';
  const forceRefresh = searchParams.get('refresh') === 'true';

  const cacheKey = `hoshika:/anime/${id}?locale=${locale}`;
  const preState = forceRefresh
    ? 'REFRESH'
    : appCache.getEntryState(cacheKey).status.toUpperCase();

  try {
    const outcome = await resolveAnimeDetailById(id, locale, forceRefresh);

    if (outcome.status === 'invalid_id') {
      return NextResponse.json(
        { ok: false, code: 'INVALID_ID', error: 'Anime ID must be a positive integer' },
        { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    if (outcome.status === 'not_found') {
      return NextResponse.json(
        { ok: false, code: 'NOT_FOUND', error: 'Anime not found' },
        { status: 404, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    if (outcome.status === 'upstream_error' || !outcome.anime) {
      const category = outcome.error?.category || 'UPSTREAM_UNAVAILABLE';
      const httpStatus = hoshikaErrorToHttpStatus(category, outcome.error?.status);
      const headers: Record<string, string> = { 'Cache-Control': 'no-store, max-age=0' };
      if (httpStatus === 429 && outcome.error?.retryAfterMs) {
        headers['Retry-After'] = String(
          Math.max(1, Math.ceil(outcome.error.retryAfterMs / 1000))
        );
      }
      return NextResponse.json(
        {
          ok: false,
          code: category,
          retryable: Boolean(outcome.error?.retryable),
          retryAfterMs: outcome.error?.retryAfterMs,
          error: outcome.error?.message || 'Upstream anime metadata service temporarily unavailable',
        },
        {
          status: httpStatus,
          headers,
        }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        anime: outcome.anime,
        canonicalShortId: outcome.canonicalShortId,
        idSource: outcome.idSource,
      },
      {
        headers: {
          'Cache-Control': forceRefresh
            ? 'no-store, max-age=0'
            : 'public, s-maxage=300, stale-while-revalidate=900',
          'X-Cache-Status': preState === 'FRESH' ? 'HIT' : preState,
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        code: 'UPSTREAM_UNAVAILABLE',
        error: err?.message || 'Failed to retrieve anime details',
      },
      {
        status: 502,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  }
}
