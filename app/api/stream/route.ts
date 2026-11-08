import { NextRequest, NextResponse } from 'next/server';
import { getAniScrollStream } from '@/lib/aniscroll';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const anilistIdStr = searchParams.get('anilistId');
  const episodeStr = searchParams.get('episode') || '1';
  const type = (searchParams.get('type') === 'dub' ? 'dub' : 'sub') as 'sub' | 'dub';

  if (!anilistIdStr) {
    return NextResponse.json(
      { ok: false, error: 'anilistId is required' },
      { status: 400 }
    );
  }

  const anilistId = parseInt(anilistIdStr, 10);
  const episode = parseInt(episodeStr, 10);

  if (isNaN(anilistId) || isNaN(episode)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid anilistId or episode number' },
      { status: 400 }
    );
  }

  try {
    const stream = await getAniScrollStream(anilistId, episode, type);
    if (!stream) {
      return NextResponse.json(
        { ok: false, error: 'Streaming source currently unavailable for this episode' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, stream });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to retrieve stream' },
      { status: 500 }
    );
  }
}
