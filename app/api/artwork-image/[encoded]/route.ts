import { NextRequest, NextResponse } from 'next/server';
import http2 from 'node:http2';
import {
  ALLOWED_ARTWORK_PROXY_HOSTS,
  decodeBase64Url,
} from '@/lib/artwork-mapper';

export const revalidate = 604800; // 7 days
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB cap

function createUpstreamErrorResponse(status: number, reason: string): NextResponse {
  const httpStatus = status === 404 ? 404 : status === 403 ? 404 : 502;
  return NextResponse.json(
    { ok: false, error: reason, upstreamStatus: status },
    {
      status: httpStatus,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Artwork-Error': reason,
      },
    }
  );
}

function getUpstreamReferer(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host.includes('fanart.tv')) return 'https://fanart.tv/';
  if (host.includes('thetvdb.com')) return 'https://thetvdb.com/';
  if (host.includes('anilist.co')) return 'https://anilist.co/';
  return 'https://hoshika.app/';
}

function fetchViaHttp1(
  targetUrl: string
): Promise<{ status: number; contentType: string; buffer: Buffer }> {
  return new Promise(async (resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const parsed = new URL(targetUrl);
      const res = await fetch(targetUrl, {
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/png,image/*,*/*;q=0.8',
          Referer: getUpstreamReferer(parsed.hostname),
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_IMAGE_BYTES) {
        reject(new Error('Image exceeds maximum allowed size'));
        return;
      }

      if (!res.ok) {
        resolve({
          status: res.status,
          contentType,
          buffer: Buffer.alloc(0),
        });
        return;
      }

      const arrayBuf = await res.arrayBuffer();
      if (arrayBuf.byteLength > MAX_IMAGE_BYTES) {
        reject(new Error('Image exceeds maximum allowed size'));
        return;
      }

      resolve({
        status: res.status,
        contentType,
        buffer: Buffer.from(arrayBuf),
      });
    } catch (err) {
      reject(err);
    } finally {
      clearTimeout(timeout);
    }
  });
}

function fetchViaHttp2(
  targetUrl: string
): Promise<{ status: number; contentType: string; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    let settled = false;

    const client = http2.connect(parsed.origin);
    const cleanup = () => {
      try {
        if (!client.closed && !client.destroyed) {
          client.close();
        }
      } catch {
        // Ignore close errors
      }
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Upstream HTTP/2 request timed out'));
      }
    }, UPSTREAM_TIMEOUT_MS);

    client.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(err);
      }
    });

    const req = client.request({
      ':method': 'GET',
      ':path': parsed.pathname + parsed.search,
      ':scheme': 'https',
      ':authority': parsed.host,
      referer: getUpstreamReferer(parsed.hostname),
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    });

    let status = 200;
    let contentType = '';
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    req.on('response', (headers) => {
      status = Number(headers[':status'] || 200);
      if (headers['content-type']) {
        contentType = String(headers['content-type']);
      }
      const lenHeader = Number(headers['content-length'] || 0);
      if (lenHeader > MAX_IMAGE_BYTES && !settled) {
        settled = true;
        clearTimeout(timer);
        req.close();
        cleanup();
        reject(new Error('Upstream image exceeds size limit'));
      }
    });

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      const buf = Buffer.from(chunk);
      totalBytes += buf.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) {
        settled = true;
        clearTimeout(timer);
        req.close();
        cleanup();
        reject(new Error('Upstream image exceeds size limit'));
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve({
          status,
          contentType,
          buffer: Buffer.concat(chunks),
        });
      }
    });

    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(err);
      }
    });

    req.end();
  });
}

async function proxyValidatedArtworkUrl(parsedUrl: URL): Promise<NextResponse> {
  if (
    parsedUrl.protocol !== 'https:' ||
    !ALLOWED_ARTWORK_PROXY_HOSTS.has(parsedUrl.hostname.toLowerCase())
  ) {
    return new NextResponse('Forbidden host or protocol', {
      status: 403,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

  try {
    let result: { status: number; contentType: string; buffer: Buffer };
    try {
      result = await fetchViaHttp2(parsedUrl.toString());
      if (result.status < 200 || result.status >= 300 || result.buffer.length === 0) {
        result = await fetchViaHttp1(parsedUrl.toString());
      }
    } catch {
      result = await fetchViaHttp1(parsedUrl.toString());
    }

    if (result.status !== 200 || result.buffer.length === 0) {
      return createUpstreamErrorResponse(
        result.status || 404,
        'Upstream artwork returned non-200 or empty payload'
      );
    }

    const normalizedType = result.contentType.toLowerCase().split(';')[0].trim();
    if (!normalizedType.startsWith('image/')) {
      return createUpstreamErrorResponse(
        502,
        `Invalid upstream content-type: ${normalizedType || 'unknown'}`
      );
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': normalizedType,
        'Cache-Control':
          'public, max-age=604800, stale-while-revalidate=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('exceeds')) {
      return new NextResponse('Artwork image exceeds size limit', {
        status: 413,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      });
    }
    return createUpstreamErrorResponse(502, 'Failed to fetch upstream artwork');
  }
}

export async function GET(
  _req: NextRequest,
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

  return proxyValidatedArtworkUrl(parsedUrl);
}
