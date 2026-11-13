import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaCatalog } from '@/lib/hoshika';
import { appCache } from '@/lib/cache';
import {
  DEFAULT_PER_PAGE,
  sanitizePageNumber,
  normalizeCatalogQuery,
  buildCatalogCacheKey,
} from '@/lib/explore-catalog';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || undefined;
  const genreParams = searchParams.getAll('genre');
  const genre = genreParams.length > 0 ? genreParams.join(',') : undefined;
  const format = searchParams.get('format') || undefined;
  const status = searchParams.get('status') || undefined;
  const year = searchParams.get('year') || undefined;
  const season = searchParams.get('season') || undefined;
  const sort = searchParams.get('sort') || 'top';
  const minScore = searchParams.get('minScore') || undefined;
  const page = sanitizePageNumber(searchParams.get('page'));
  const perPage = DEFAULT_PER_PAGE;
  const forceRefresh = searchParams.get('refresh') === 'true';

  const catalogParams = {
    q,
    genre,
    format,
    status,
    year,
    season,
    sort,
    minScore,
    page,
    perPage,
  };
  const cacheKey = buildCatalogCacheKey(normalizeCatalogQuery(catalogParams));
  const preState = forceRefresh
    ? 'REFRESH'
    : appCache.getEntryState(cacheKey).status.toUpperCase();

  try {
    const data = await getHoshikaCatalog(catalogParams, forceRefresh);
    return NextResponse.json(
      { ok: true, ...data },
      {
        headers: {
          'Cache-Control': forceRefresh
            ? 'no-store, max-age=0'
            : 'public, s-maxage=180, stale-while-revalidate=600',
          'X-Cache-Status': preState === 'FRESH' ? 'HIT' : preState,
        },
      }
    );
  } catch (err: any) {
    console.error('[API /catalog] Error:', err?.message || err);
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || 'Failed to load catalogue from upstream server.',
        results: [],
        items: [],
        currentPage: page,
        page,
        perPage,
        totalPages: null,
        pages: 1,
        total: 0,
        hasNextPage: false,
        hasMore: false,
        hasPreviousPage: page > 1,
      },
      { status: 500 }
    );
  }
}
