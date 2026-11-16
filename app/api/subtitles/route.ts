import { NextRequest, NextResponse } from 'next/server';
import {
  fetchSafeExternalText,
  UnsafeExternalUrlError,
} from '@/lib/security/ssrf';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_REQUEST', error: 'Missing url parameter' },
      { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  try {
    const result = await fetchSafeExternalText(url, {
      timeoutMs: 6000,
      maxBytes: 5 * 1024 * 1024,
      maxRedirects: 3,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/vtt, text/plain, */*',
      },
    });

    if (result.status < 200 || result.status >= 300) {
      return NextResponse.json(
        {
          ok: false,
          code: result.status === 404 ? 'NOT_FOUND' : 'UPSTREAM_UNAVAILABLE',
          error: `Remote subtitle fetch failed with status ${result.status}`,
        },
        {
          status: result.status === 404 ? 404 : 502,
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        }
      );
    }

    return new NextResponse(result.text, {
      status: 200,
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err: unknown) {
    if (err instanceof UnsafeExternalUrlError) {
      return NextResponse.json(
        {
          ok: false,
          code:
            err.code === 'UPSTREAM_TIMEOUT'
              ? 'UPSTREAM_TIMEOUT'
              : 'INVALID_REQUEST',
          error: err.message,
        },
        {
          status: err.httpStatus,
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: 'UPSTREAM_UNAVAILABLE',
        error: 'Failed to fetch subtitle from remote server',
      },
      { status: 502, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
