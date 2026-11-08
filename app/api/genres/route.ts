import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaGenres, getHoshikaGenreTitles } from '@/lib/hoshika';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const genreSlug = searchParams.get('slug');

  try {
    if (genreSlug) {
      const items = await getHoshikaGenreTitles(genreSlug);
      return NextResponse.json({ ok: true, items });
    }
    const genres = await getHoshikaGenres();
    return NextResponse.json({ ok: true, genres });
  } catch (err: any) {
    return NextResponse.json({ ok: false, genres: [], items: [] }, { status: 500 });
  }
}
