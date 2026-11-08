import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaSchedule } from '@/lib/hoshika';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const locale = searchParams.get('locale') || 'en';

  try {
    const items = await getHoshikaSchedule(locale);
    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    return NextResponse.json({ ok: false, items: [], error: 'Failed to fetch schedule' }, { status: 500 });
  }
}
