import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaBrowsePaginated } from '@/lib/hoshika';
import { appCache } from '@/lib/cache';
import { DEFAULT_PER_PAGE, sanitizePageNumber } from '@/lib/explore-catalog';

const VALID_CATEGORIES = new Set(['trending', 'popular', 'recent']);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawCategory = (searchParams.get('category') || 'trending')
    .trim()
    .toLowerCase();
  const category = VALID_CATEGORIES.has(rawCategory)
    ? (rawCategory as 'trending' | 'popular' | 'recent')
    : 'trending';

  const page = sanitizePageNumber(searchParams.get('page'));
  const perPage = DEFAULT_PER_PAGE;
  const forceRefresh = searchParams.get('refresh') === 'true';

  const cacheKey = `browse:paginated:v1:${category}:page=${page}:perPage=${perPage}`;
  const preState = forceRefresh
    ? 'REFRESH'
    : appCache.getEntryState(cacheKey).status.toUpperCase();

  try {
    const data = await getHoshikaBrowsePaginated(
      category,
      page,
      perPage,
      forceRefresh
    );
    const maxAge = category === 'recent' ? 120 : 180;
    return NextResponse.json(
      { ok: true, category, ...data },
      {
        headers: {
          'Cache-Control': forceRefresh
            ? 'no-store, max-age=0'
            : `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 3}`,
          'X-Cache-Status': preState === 'FRESH' ? 'HIT' : preState,
        },
      }
    );
  } catch (err: any) {
    console.error(`[API /browse?category=${category}] Error:`, err?.message || err);
    return NextResponse.json(
      {
        ok: false,
        category,
        error:
          err?.message ||
          `Failed to load ${category} anime from upstream server.`,
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
