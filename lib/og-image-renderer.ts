import fs from 'node:fs';
import path from 'node:path';
import http2 from 'node:http2';
import sharp from 'sharp';

type OverlayOptions = Parameters<ReturnType<typeof sharp>['composite']>[0][number];
import {
  ALLOWED_ARTWORK_PROXY_HOSTS,
  unwrapProxiedArtworkUrl,
} from '@/lib/artwork-mapper';
import { getUpstreamReferer, isSafeProxyRedirectTarget } from '@/lib/artwork/proxy-handler';
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from '@/lib/social-metadata';

const OG_FETCH_TIMEOUT_MS = 3500;
const MAX_OG_SOURCE_BYTES = 10 * 1024 * 1024;
const OG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_OG_CACHE_ENTRIES = 60;

interface CachedOgEntry {
  buffer: Buffer;
  expiresAt: number;
}

const ogOutputCache = new Map<string, CachedOgEntry>();

export function getCachedOgImage(cacheKey: string): Buffer | null {
  const entry = ogOutputCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    ogOutputCache.delete(cacheKey);
    return null;
  }
  ogOutputCache.delete(cacheKey);
  ogOutputCache.set(cacheKey, entry);
  return entry.buffer;
}

export function setCachedOgImage(cacheKey: string, buffer: Buffer): void {
  if (!buffer || buffer.byteLength === 0) return;
  if (ogOutputCache.has(cacheKey)) {
    ogOutputCache.delete(cacheKey);
  } else if (ogOutputCache.size >= MAX_OG_CACHE_ENTRIES) {
    const oldestKey = ogOutputCache.keys().next().value;
    if (oldestKey !== undefined) {
      ogOutputCache.delete(oldestKey);
    }
  }
  ogOutputCache.set(cacheKey, {
    buffer,
    expiresAt: Date.now() + OG_CACHE_TTL_MS,
  });
}

function isAllowedOgImageSourceHost(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (ALLOWED_ARTWORK_PROXY_HOSTS.has(host)) return true;
    return (
      host.endsWith('.supabase.co') ||
      host.endsWith('.supabase.in') ||
      host === 'i.ytimg.com' ||
      host === 'cdn.myanimelist.net' ||
      host === 'media.kitsu.io' ||
      host === 'media.kitsu.app'
    );
  } catch {
    return false;
  }
}

function isHotlinkProtectedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.includes('fanart.tv') || host.includes('thetvdb.com');
}

async function fetchBufferHttp1(
  targetUrl: string,
  depth = 0
): Promise<Buffer | null> {
  if (depth > 3) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OG_FETCH_TIMEOUT_MS);

  try {
    const parsed = new URL(targetUrl);
    const needsHotlinkHeaders = isHotlinkProtectedHost(parsed.hostname);
    const headers: Record<string, string> = needsHotlinkHeaders
      ? {
          Accept: 'image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
          Referer: getUpstreamReferer(parsed.hostname),
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        }
      : {
          Accept: 'image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
          'User-Agent': 'AniScroll/1.0',
        };

    let res = await fetch(targetUrl, {
      redirect: 'manual',
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });

    // Retry once without custom headers if an upstream CDN blocks spoofed UA/Referer
    if (res.status === 403 && needsHotlinkHeaders) {
      res = await fetch(targetUrl, {
        redirect: 'manual',
        signal: controller.signal,
        cache: 'no-store',
      });
    }

    if (
      (res.status === 301 ||
        res.status === 302 ||
        res.status === 307 ||
        res.status === 308) &&
      depth < 3
    ) {
      const location = res.headers.get('location');
      if (location) {
        const nextUrl = new URL(location, parsed).toString();
        if (isSafeProxyRedirectTarget(nextUrl)) {
          clearTimeout(timer);
          return fetchBufferHttp1(nextUrl, depth + 1);
        }
      }
      return null;
    }

    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || '0');
    if (len > MAX_OG_SOURCE_BYTES) return null;

    const arr = await res.arrayBuffer();
    if (arr.byteLength === 0 || arr.byteLength > MAX_OG_SOURCE_BYTES) return null;
    return Buffer.from(arr);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function fetchBufferHttp2Once(
  targetUrl: string
): Promise<{ status: number; location?: string; buffer: Buffer | null }> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      resolve({ status: 400, buffer: null });
      return;
    }

    let settled = false;
    const client = http2.connect(parsed.origin);
    const cleanup = () => {
      try {
        if (!client.closed && !client.destroyed) client.close();
      } catch {
        // Ignore close errors
      }
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({ status: 408, buffer: null });
      }
    }, OG_FETCH_TIMEOUT_MS);

    client.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve({ status: 502, buffer: null });
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
      accept: 'image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
    });

    let status = 200;
    let location: string | undefined;
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    req.on('response', (headers) => {
      status = Number(headers[':status'] || 200);
      if (headers['location']) {
        location = String(headers['location']);
      }
    });

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      const buf = Buffer.from(chunk);
      totalBytes += buf.byteLength;
      if (totalBytes > MAX_OG_SOURCE_BYTES) {
        settled = true;
        clearTimeout(timer);
        req.close();
        cleanup();
        resolve({ status: 413, buffer: null });
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
          location,
          buffer: chunks.length > 0 ? Buffer.concat(chunks) : null,
        });
      }
    });

    req.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve({ status: 502, buffer: null });
      }
    });

    req.end();
  });
}

async function fetchArtworkBuffer(rawUrl: string | null | undefined): Promise<Buffer | null> {
  if (!rawUrl) return null;
  const unwrapped = unwrapProxiedArtworkUrl(rawUrl) || rawUrl.trim();
  if (!unwrapped || !isAllowedOgImageSourceHost(unwrapped)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(unwrapped);
  } catch {
    return null;
  }

  // Hotlink-protected CDNs prefer HTTP/2 with explicit upstream Referer
  if (
    parsed.hostname.toLowerCase().includes('fanart.tv') ||
    parsed.hostname.toLowerCase().includes('thetvdb.com')
  ) {
    const h2 = await fetchBufferHttp2Once(unwrapped);
    if (h2.status === 200 && h2.buffer && h2.buffer.byteLength > 0) {
      return h2.buffer;
    }
    if (
      (h2.status === 301 || h2.status === 302 || h2.status === 307 || h2.status === 308) &&
      h2.location
    ) {
      const nextUrl = new URL(h2.location, parsed).toString();
      if (isSafeProxyRedirectTarget(nextUrl)) {
        return fetchBufferHttp1(nextUrl, 1);
      }
    }
  }

  return fetchBufferHttp1(unwrapped);
}

let cachedLogoBuffer: Buffer | null | undefined = undefined;

function getBrandLogoBuffer(): Buffer | null {
  if (cachedLogoBuffer !== undefined) return cachedLogoBuffer;
  try {
    const logoPath = path.join(
      process.cwd(),
      'public',
      'assets',
      'aistudio',
      'Stylized_A_Swoosh_Logo_7cdc8c1f.png'
    );
    if (fs.existsSync(logoPath)) {
      cachedLogoBuffer = fs.readFileSync(logoPath);
      return cachedLogoBuffer;
    }
  } catch {
    // Ignore file system errors
  }
  cachedLogoBuffer = null;
  return null;
}

async function fetchFirstValidImage(
  candidates: Array<string | null | undefined>
): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  const seen = new Set<string>();
  const uniqueUrls: string[] = [];
  for (const c of candidates) {
    if (!c || typeof c !== 'string') continue;
    const trimmed = c.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    uniqueUrls.push(trimmed);
  }

  for (const url of uniqueUrls.slice(0, 4)) {
    const buf = await fetchArtworkBuffer(url);
    if (!buf) continue;
    try {
      const meta = await sharp(buf).metadata();
      if (meta.width && meta.height && meta.width >= 80 && meta.height >= 80) {
        return { buffer: buf, width: meta.width, height: meta.height };
      }
    } catch {
      // Try next candidate if image buffer is corrupt or SVG/HTML
    }
  }

  return null;
}

function createRoundedMaskSvg(width: number, height: number, radius: number): Buffer {
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#ffffff"/></svg>`
  );
}

function createCinemaVignetteSvg(): Buffer {
  return Buffer.from(
    `<svg width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="vignette" cx="50%" cy="50%" r="72%">
          <stop offset="0%" stop-color="#000000" stop-opacity="0.12" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0.72" />
        </radialGradient>
        <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#000000" stop-opacity="0.20" />
          <stop offset="60%" stop-color="#000000" stop-opacity="0.10" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0.58" />
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#vignette)" />
      <rect width="1200" height="630" fill="url(#bottomFade)" />
    </svg>`
  );
}

function createPosterCardFrameSvg(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): Buffer {
  return Buffer.from(
    `<svg width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x - 6}" y="${y - 4}" width="${width + 12}" height="${height + 14}" rx="${radius + 4}" ry="${radius + 4}" fill="#000000" fill-opacity="0.62" />
      <rect x="${x - 1}" y="${y - 1}" width="${width + 2}" height="${height + 2}" rx="${radius + 1}" ry="${radius + 1}" fill="none" stroke="#ffffff" stroke-opacity="0.24" stroke-width="2" />
    </svg>`
  );
}

/**
 * Generates a guaranteed 1200x630 progressive JPEG social preview card from the
 * anime's actual poster/backdrop artwork (supporting WebP, JPEG, PNG, AVIF inputs)
 * or falls back cleanly to the AniScroll monochrome brand card.
 */
export async function renderAnimeOgJpeg(params: {
  posterCandidates?: Array<string | null | undefined>;
  backdropCandidates?: Array<string | null | undefined>;
}): Promise<Buffer> {
  const [posterMedia, backdropMedia] = await Promise.all([
    fetchFirstValidImage(params.posterCandidates || []),
    fetchFirstValidImage(params.backdropCandidates || []),
  ]);

  if (!posterMedia && !backdropMedia) {
    return renderSiteBrandOgJpeg();
  }

  // Case 1: Only wide backdrop available (no poster) -> crisp full-bleed 1200x630
  if (!posterMedia && backdropMedia) {
    const base = await sharp(backdropMedia.buffer)
      .rotate()
      .toColorspace('srgb')
      .resize(OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, {
        fit: 'cover',
        position: 'attention',
      })
      .png()
      .toBuffer();

    const composites: OverlayOptions[] = [
      { input: createCinemaVignetteSvg(), top: 0, left: 0 },
    ];

    const brandMark = await buildCornerBrandBadge();
    if (brandMark) {
      composites.push({ input: brandMark, top: 28, left: OG_IMAGE_WIDTH - 28 - 54 });
    }

    return sharp(base)
      .composite(composites)
      .jpeg({ quality: 88, progressive: true })
      .toBuffer();
  }

  // Case 2: Poster available (+ optional wide backdrop) -> Blurred darkened cinema
  // backdrop filling 1200x630 with the crisp uncropped anime poster showcased cleanly.
  const activePoster = posterMedia!;
  const backgroundSource = backdropMedia || activePoster;
  const isPosterUsedAsBg = !backdropMedia;

  let bgPipeline = sharp(backgroundSource.buffer)
    .rotate()
    .toColorspace('srgb')
    .resize(OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, {
      fit: 'cover',
      position: 'attention',
    });

  bgPipeline = isPosterUsedAsBg
    ? bgPipeline.blur(26).modulate({ brightness: 0.42, saturation: 0.9 })
    : bgPipeline.blur(6).modulate({ brightness: 0.56, saturation: 0.95 });

  const bgBuffer = await bgPipeline.png().toBuffer();

  // Compute crisp uncropped portrait card geometry centered in 1200x630
  const maxCardHeight = 546;
  const maxCardWidth = 420;
  const aspect = activePoster.width / activePoster.height;
  let cardWidth = Math.round(maxCardHeight * aspect);
  let cardHeight = maxCardHeight;
  if (cardWidth > maxCardWidth) {
    cardWidth = maxCardWidth;
    cardHeight = Math.round(maxCardWidth / aspect);
  }
  if (cardWidth < 260) {
    cardWidth = 372;
    cardHeight = 546;
  }

  const cardLeft = Math.round((OG_IMAGE_WIDTH - cardWidth) / 2);
  const cardTop = Math.round((OG_IMAGE_HEIGHT - cardHeight) / 2);
  const cornerRadius = 18;

  const resizedPoster = await sharp(activePoster.buffer)
    .rotate()
    .toColorspace('srgb')
    .resize(cardWidth, cardHeight, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .composite([
      {
        input: createRoundedMaskSvg(cardWidth, cardHeight, cornerRadius),
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();

  const composites: OverlayOptions[] = [
    { input: createCinemaVignetteSvg(), top: 0, left: 0 },
    {
      input: createPosterCardFrameSvg(
        cardLeft,
        cardTop,
        cardWidth,
        cardHeight,
        cornerRadius
      ),
      top: 0,
      left: 0,
    },
    { input: resizedPoster, top: cardTop, left: cardLeft },
  ];

  const brandMark = await buildCornerBrandBadge();
  if (brandMark) {
    composites.push({ input: brandMark, top: 28, left: OG_IMAGE_WIDTH - 28 - 54 });
  }

  return sharp(bgBuffer)
    .composite(composites)
    .jpeg({ quality: 88, progressive: true })
    .toBuffer();
}

async function buildCornerBrandBadge(): Promise<Buffer | null> {
  const logoBuf = getBrandLogoBuffer();
  if (!logoBuf) return null;

  try {
    const logoResized = await sharp(logoBuf)
      .resize(34, 34, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const badgeBg = Buffer.from(
      `<svg width="54" height="54" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="54" height="54" rx="14" ry="14" fill="#0A0A0A" fill-opacity="0.82" stroke="#ffffff" stroke-opacity="0.22" stroke-width="1.5"/>
      </svg>`
    );

    return sharp(badgeBg)
      .composite([{ input: logoResized, top: 10, left: 10 }])
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

export async function renderSiteBrandOgJpeg(): Promise<Buffer> {
  const cached = getCachedOgImage('site:brand');
  if (cached) return cached;

  const backdropSvg = Buffer.from(
    `<svg width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glow" cx="50%" cy="46%" r="58%">
          <stop offset="0%" stop-color="#1E1E1E" />
          <stop offset="65%" stop-color="#090909" />
          <stop offset="100%" stop-color="#000000" />
        </radialGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#glow)" />
      <rect x="36" y="36" width="1128" height="558" rx="24" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.5" />
    </svg>`
  );

  const composites: OverlayOptions[] = [];
  const logoBuf = getBrandLogoBuffer();
  if (logoBuf) {
    try {
      const logoResized = await sharp(logoBuf)
        .resize(220, 220, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      composites.push({
        input: logoResized,
        top: Math.round((OG_IMAGE_HEIGHT - 220) / 2),
        left: Math.round((OG_IMAGE_WIDTH - 220) / 2),
      });
    } catch {
      // Continue with dark gradient card
    }
  }

  const out = await sharp(backdropSvg)
    .composite(composites)
    .jpeg({ quality: 88, progressive: true })
    .toBuffer();

  setCachedOgImage('site:brand', out);
  return out;
}
