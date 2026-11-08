import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaHome } from '@/lib/hoshika';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const locale = searchParams.get('locale') || 'en';

  try {
    const data = await getHoshikaHome(locale);
    return NextResponse.json({ ok: true, ...data });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Failed to fetch home feed' }, { status: 500 });
  }
}
