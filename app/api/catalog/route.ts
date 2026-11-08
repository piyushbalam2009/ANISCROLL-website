import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaCatalog, getHoshikaBrowse } from '@/lib/hoshika';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || undefined;
  const genre = searchParams.get('genre') || undefined;
  const format = searchParams.get('format') || undefined;
  const status = searchParams.get('status') || undefined;
  const year = searchParams.get('year') || undefined;
  const sort = searchParams.get('sort') || undefined;
  const page = parseInt(searchParams.get('page') || '1', 10);

  // If sort is trending, recent, or top without other filters, we can also query browse
  if (!q && !genre && !format && !status && !year && (sort === 'trending' || sort === 'recent' || sort === 'top')) {
    try {
      const items = await getHoshikaBrowse(sort);
      return NextResponse.json({ ok: true, items, total: items.length, page: 1, pages: 1 });
    } catch {
      // fall through to catalog
    }
  }

  try {
    const data = await getHoshikaCatalog({ q, genre, format, status, year, sort, page });
    return NextResponse.json({ ok: true, ...data });
  } catch (err: any) {
    return NextResponse.json({ ok: false, items: [], total: 0, page: 1, pages: 1 }, { status: 500 });
  }
}
