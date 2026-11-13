import { NextRequest, NextResponse } from 'next/server';
import {
  ALLOWED_ARTWORK_PROXY_HOSTS,
  encodeBase64Url,
} from '@/lib/artwork-mapper';

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

  const encoded = encodeBase64Url(parsedUrl.toString());
  const redirectUrl = new URL(`/api/artwork-image/${encoded}`, req.url);
  const v = req.nextUrl.searchParams.get('v');
  const refresh = req.nextUrl.searchParams.get('refresh');
  if (v) redirectUrl.searchParams.set('v', v);
  if (refresh) redirectUrl.searchParams.set('refresh', refresh);

  const response = NextResponse.redirect(redirectUrl, 307);
  response.headers.set(
    'Cache-Control',
    refresh === 'true' ? 'no-store, max-age=0' : 'public, max-age=1800, s-maxage=3600'
  );
  return response;
}
