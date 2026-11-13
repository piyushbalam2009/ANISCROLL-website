import { NextRequest, NextResponse } from 'next/server';
import { decodeBase64Url } from '@/lib/artwork-mapper';
import { proxyValidatedArtworkUrl } from '@/lib/artwork/proxy-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ encoded: string }> }
) {
  const { encoded } = await params;

  if (!encoded || encoded.length > 4096) {
    return new NextResponse('Missing or invalid encoded parameter', {
      status: 400,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

  const urlParam = decodeBase64Url(encoded);
  if (!urlParam) {
    return new NextResponse('Invalid encoded URL', {
      status: 400,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlParam);
  } catch {
    return new NextResponse('Invalid URL', {
      status: 400,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

  const versionParam = req.nextUrl.searchParams.get('v');
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === 'true';

  return proxyValidatedArtworkUrl(parsedUrl, versionParam, forceRefresh);
}
