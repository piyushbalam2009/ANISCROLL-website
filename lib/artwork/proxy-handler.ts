import { NextResponse } from 'next/server';
import http2 from 'node:http2';
import { ALLOWED_ARTWORK_PROXY_HOSTS } from '@/lib/artwork-mapper';

// Bounded below Vercel Hobby 10s FUNCTION_INVOCATION_TIMEOUT (max ~8.2s worst case)
const HTTP2_TIMEOUT_MS = 4000;
const HTTP1_TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 3;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB cap
const PROXY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes in-memory buffer cache
const MAX_PROXY_CACHE_ENTRIES = 80;

interface CachedImageBuffer {
  contentType: string;
  buffer: Buffer;
  expiresAt: number;
}

const proxyImageCache = new Map<string, CachedImageBuffer>();

function getCachedProxyImage(cacheKey: string): CachedImageBuffer | null {
  const entry = proxyImageCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    proxyImageCache.delete(cacheKey);
    return null;
  }
  proxyImageCache.delete(cacheKey);
  proxyImageCache.set(cacheKey, entry);
  return entry;
}

function setCachedProxyImage(
  cacheKey: string,
  contentType: string,
  buffer: Buffer
): void {
  if (buffer.byteLength > 2.5 * 1024 * 1024) return;
  if (proxyImageCache.has(cacheKey)) {
    proxyImageCache.delete(cacheKey);
  } else if (proxyImageCache.size >= MAX_PROXY_CACHE_ENTRIES) {
    const oldestKey = proxyImageCache.keys().next().value;
    if (oldestKey !== undefined) {
      proxyImageCache.delete(oldestKey);
    }
  }
  proxyImageCache.set(cacheKey, {
    contentType,
    buffer,
    expiresAt: Date.now() + PROXY_CACHE_TTL_MS,
  });
}

/**
 * Inspects binary magic bytes so valid images served as application/octet-stream
 * succeed while HTML/JSON/XML/SVG error pages are strictly rejected.
 */
export function detectImageContentTypeFromBuffer(
  buffer: Buffer,
  declaredContentType?: string | null
): string | null {
  if (!buffer || buffer.byteLength < 8) return null;

  const declared = (declaredContentType || '')
    .toLowerCase()
    .split(';')[0]
    .trim();

  // Strictly block SVG/XML/HTML/JSON text payloads
  const headText = buffer
    .subarray(0, Math.min(256, buffer.byteLength))
    .toString('utf8')
    .trimStart()
    .toLowerCase();

  if (
    headText.startsWith('<!doctype') ||
    headText.startsWith('<html') ||
    headText.startsWith('<svg') ||
    headText.startsWith('<?xml') ||
    headText.startsWith('{') ||
    headText.startsWith('[')
  ) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: GIF87a / GIF89a
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }

  // WebP: RIFF....WEBP
  if (
    buffer.byteLength >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  // AVIF / HEIF: ....ftypavif or ....ftypavis
  if (
    buffer.byteLength >= 12 &&
    buffer.subarray(4, 8).toString('ascii') === 'ftyp' &&
    ['avif', 'avis', 'heic', 'mif1'].includes(
      buffer.subarray(8, 12).toString('ascii')
    )
  ) {
    return 'image/avif';
  }

  if (
    declared.startsWith('image/') &&
    declared !== 'image/svg+xml'
  ) {
    return declared;
  }

  return null;
}

const TRUSTED_REDIRECT_SUFFIXES = [
  '.fanart.tv',
  '.thetvdb.com',
  '.hoshika.app',
  '.anilist.co',
  '.tmdb.org',
  '.supabase.co',
  '.supabase.in',
  '.cloudfront.net',
  '.fastly.net',
];

function isPrivateOrLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower === '0.0.0.0' ||
    lower.startsWith('10.') ||
    lower.startsWith('192.168.') ||
    lower.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)
  );
}

/**
 * Validates HTTP redirect destinations during proxy fetch to block SSRF while supporting CDN edge redirects.
 */
export function isSafeProxyRedirectTarget(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (isPrivateOrLocalHostname(host)) return false;
    if (ALLOWED_ARTWORK_PROXY_HOSTS.has(host)) return true;
    return TRUSTED_REDIRECT_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}

export function getUpstreamReferer(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host.includes('fanart.tv')) return 'https://fanart.tv/';
  if (host.includes('thetvdb.com')) return 'https://thetvdb.com/';
  if (host.includes('anilist.co')) return 'https://anilist.co/';
  if (host.includes('tmdb.org')) return 'https://www.themoviedb.org/';
  return 'https://hoshika.app/';
}

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
        'X-Proxy-Cache': 'ERROR',
      },
    }
  );
}

interface UpstreamFetchResult {
  status: number;
  contentType: string;
  buffer: Buffer;
}

async function fetchViaHttp1(
  targetUrl: string,
  redirectDepth = 0
): Promise<UpstreamFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP1_TIMEOUT_MS);

  try {
    const parsed = new URL(targetUrl);
    const res = await fetch(targetUrl, {
      redirect: 'manual',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/png,image/*,*/*;q=0.8',
        Referer: getUpstreamReferer(parsed.hostname),
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    if (
      (res.status === 301 ||
        res.status === 302 ||
        res.status === 307 ||
        res.status === 308) &&
      redirectDepth < MAX_REDIRECTS
    ) {
      const location = res.headers.get('location');
      if (location) {
        const nextUrl = new URL(location, parsed).toString();
        if (isSafeProxyRedirectTarget(nextUrl)) {
          clearTimeout(timeout);
          return fetchViaHttp1(nextUrl, redirectDepth + 1);
        }
      }
      return { status: 403, contentType: '', buffer: Buffer.alloc(0) };
    }

    const contentType = res.headers.get('content-type') || '';
    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_IMAGE_BYTES) {
      throw new Error('Image exceeds maximum allowed size');
    }

    if (!res.ok) {
      return {
        status: res.status,
        contentType,
        buffer: Buffer.alloc(0),
      };
    }

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('Image exceeds maximum allowed size');
    }

    return {
      status: res.status,
      contentType,
      buffer: Buffer.from(arrayBuf),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function fetchViaHttp2Single(
  targetUrl: string
): Promise<UpstreamFetchResult & { location?: string }> {
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
    }, HTTP2_TIMEOUT_MS);

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
    let location: string | undefined;
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    req.on('response', (headers) => {
      status = Number(headers[':status'] || 200);
      if (headers['content-type']) {
        contentType = String(headers['content-type']);
      }
      if (headers['location']) {
        location = String(headers['location']);
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
          location,
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

async function fetchViaHttp2(
  targetUrl: string,
  redirectDepth = 0
): Promise<UpstreamFetchResult> {
  const res = await fetchViaHttp2Single(targetUrl);
  if (
    (res.status === 301 ||
      res.status === 302 ||
      res.status === 307 ||
      res.status === 308) &&
    res.location &&
    redirectDepth < MAX_REDIRECTS
  ) {
    const nextUrl = new URL(res.location, targetUrl).toString();
    if (isSafeProxyRedirectTarget(nextUrl)) {
      return fetchViaHttp2(nextUrl, redirectDepth + 1);
    }
    return { status: 403, contentType: '', buffer: Buffer.alloc(0) };
  }
  return {
    status: res.status,
    contentType: res.contentType,
    buffer: res.buffer,
  };
}

export async function proxyValidatedArtworkUrl(
  parsedUrl: URL,
  versionParam: string | null,
  forceRefresh: boolean
): Promise<NextResponse> {
  if (
    parsedUrl.protocol !== 'https:' ||
    !ALLOWED_ARTWORK_PROXY_HOSTS.has(parsedUrl.hostname.toLowerCase())
  ) {
    return new NextResponse('Forbidden host or protocol', {
      status: 403,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

  const targetUrlStr = parsedUrl.toString();
  const hasVersionToken = Boolean(versionParam && versionParam !== '0');
  const cacheKey = `${targetUrlStr}::v=${versionParam || '0'}`;
  const successCacheControl = forceRefresh
    ? 'no-store, max-age=0'
    : hasVersionToken
      ? 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800'
      : 'public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400';

  if (forceRefresh) {
    for (const key of Array.from(proxyImageCache.keys())) {
      if (key.startsWith(`${targetUrlStr}::`)) {
        proxyImageCache.delete(key);
      }
    }
  } else {
    const cached = getCachedProxyImage(cacheKey);
    if (cached) {
      return new NextResponse(new Uint8Array(cached.buffer), {
        status: 200,
        headers: {
          'Content-Type': cached.contentType,
          'Cache-Control': successCacheControl,
          'X-Content-Type-Options': 'nosniff',
          'X-Proxy-Cache': 'HIT',
        },
      });
    }
  }

  try {
    let result: UpstreamFetchResult;
    try {
      result = await fetchViaHttp2(targetUrlStr);
      if (
        result.status < 200 ||
        result.status >= 300 ||
        result.buffer.length === 0
      ) {
        result = await fetchViaHttp1(targetUrlStr);
      }
    } catch {
      result = await fetchViaHttp1(targetUrlStr);
    }

    if (result.status !== 200 || result.buffer.length === 0) {
      return createUpstreamErrorResponse(
        result.status || 404,
        'Upstream artwork returned non-200 or empty payload'
      );
    }

    const detectedType = detectImageContentTypeFromBuffer(
      result.buffer,
      result.contentType
    );
    if (!detectedType) {
      return createUpstreamErrorResponse(
        502,
        `Invalid upstream image payload: ${result.contentType || 'unknown'}`
      );
    }

    setCachedProxyImage(cacheKey, detectedType, result.buffer);

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': detectedType,
        'Cache-Control': successCacheControl,
        'X-Content-Type-Options': 'nosniff',
        'X-Proxy-Cache': forceRefresh ? 'REFRESH' : 'MISS',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err || '');
    if (msg.includes('exceeds')) {
      return new NextResponse('Artwork image exceeds size limit', {
        status: 413,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      });
    }
    return createUpstreamErrorResponse(502, 'Failed to fetch upstream artwork');
  }
}
