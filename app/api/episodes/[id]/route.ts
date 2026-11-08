import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaEpisodes } from '@/lib/hoshika';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const locale = searchParams.get('locale') || 'en';
  const after = searchParams.get('after') ? parseInt(searchParams.get('after')!, 10) : undefined;
  const limit = parseInt(searchParams.get('limit') || '100', 10);

  if (!id) {
    return NextResponse.json({ ok: false, error: 'Anime ID is required' }, { status: 400 });
  }

  try {
    const result = await getHoshikaEpisodes(id, locale, after, limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to retrieve anime episodes', items: [], total: 0 },
      { status: 500 }
    );
  }
}
