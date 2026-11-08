import { NextRequest, NextResponse } from 'next/server';
import { resolveAnimeIds } from '@/lib/id-mapper';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Anime ID is required' }, { status: 400 });
  }

  try {
    const result = await resolveAnimeIds(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to resolve IDs', mappingStatus: 'failed' },
      { status: 500 }
    );
  }
}
