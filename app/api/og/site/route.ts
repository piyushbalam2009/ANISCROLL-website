import { NextResponse } from 'next/server';
import { renderSiteBrandOgJpeg } from '@/lib/og-image-renderer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_OG_HEADERS: Record<string, string> = {
  'Content-Type': 'image/jpeg',
  'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
};

export async function GET() {
  const buffer = await renderSiteBrandOgJpeg();
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      ...SITE_OG_HEADERS,
      'Content-Length': String(buffer.byteLength),
    },
  });
}

export async function HEAD() {
  const buffer = await renderSiteBrandOgJpeg();
  return new NextResponse(null, {
    status: 200,
    headers: {
      ...SITE_OG_HEADERS,
      'Content-Length': String(buffer.byteLength),
    },
  });
}
