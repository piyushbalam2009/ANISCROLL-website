import { NextRequest, NextResponse } from 'next/server';
import {
  ALLOWED_ARTWORK_PROXY_HOSTS,
  encodeBase64Url,
} from '@/lib/artwork-mapper';

export const revalidate = 604800;

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
  return NextResponse.redirect(redirectUrl, 307);
}
