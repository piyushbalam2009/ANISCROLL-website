import { NextRequest, NextResponse } from 'next/server';
import { getSkipTimes } from '@/lib/aniskip';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const malIdStr = searchParams.get('malId');
  const episodeStr = searchParams.get('episode') || '1';
  const durationStr = searchParams.get('duration') || '1440';

  if (!malIdStr) {
    return NextResponse.json({ ok: false, error: 'malId is required', found: false, results: [] }, { status: 400 });
  }

  const malId = parseInt(malIdStr, 10);
  const episode = parseInt(episodeStr, 10);
  const duration = parseFloat(durationStr);

  if (isNaN(malId) || isNaN(episode)) {
    return NextResponse.json({ ok: false, error: 'Invalid malId or episode', found: false, results: [] }, { status: 400 });
  }

  try {
    const data = await getSkipTimes(malId, episode, duration);
    return NextResponse.json({ ok: true, ...data });
  } catch (err: any) {
    return NextResponse.json({ ok: false, found: false, results: [], error: 'Failed to fetch skip times' }, { status: 500 });
  }
}
