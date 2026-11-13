import { NextRequest, NextResponse } from 'next/server';
import { ALLOWED_ARTWORK_PROXY_HOSTS } from '@/lib/artwork-mapper';
import { proxyValidatedArtworkUrl } from '@/lib/artwork/proxy-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get('url');
  if (!rawUrl || rawUrl.length > 4096) {
    return new NextResponse('Missing or invalid url parameter', {
      status: 400,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return new NextResponse('Invalid URL', {
      status: 400,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

  if (
    parsedUrl.protocol !== 'https:' ||
    !ALLOWED_ARTWORK_PROXY_HOSTS.has(parsedUrl.hostname.toLowerCase())
  ) {
    return new NextResponse('Forbidden host or protocol', {
      status: 403,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

  const v = req.nextUrl.searchParams.get('v');
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === 'true';

  return proxyValidatedArtworkUrl(parsedUrl, v, forceRefresh);
}
