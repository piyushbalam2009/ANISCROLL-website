/**
 * Client- and server-safe image URL normalization and resilient fallback candidate utilities.
 */

const HTTPS_UPGRADE_HOSTS = [
  'cdn.hoshika.app',
  'hoshika.app',
  's4.anilist.co',
  'assets.fanart.tv',
  'images.fanart.tv',
  'fanart.tv',
  'artworks.thetvdb.com',
  'image.tmdb.org',
  'lh3.googleusercontent.com',
  'firebasestorage.googleapis.com',
  'i.ytimg.com',
];

function shouldUpgradeToHttps(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (HTTPS_UPGRADE_HOSTS.includes(host)) return true;
  if (host.endsWith('.supabase.co') || host.endsWith('.supabase.in')) return true;
  if (host.endsWith('.anilist.co') || host.endsWith('.hoshika.app')) return true;
  if (host.endsWith('.googleusercontent.com')) return true;
  return false;
}

function decodeProxyPayload(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith('/api/artwork-image/')) {
    const encoded = trimmed.slice('/api/artwork-image/'.length).split('?')[0];
    if (encoded) {
      try {
        const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
        const standardBase64 = base64 + pad;

        if (typeof atob === 'function' && typeof TextDecoder !== 'undefined') {
          const binary = atob(standardBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          return new TextDecoder().decode(bytes);
        }
        return Buffer.from(standardBase64, 'base64').toString('utf8');
      } catch {
        return trimmed;
      }
    }
  }
  if (trimmed.startsWith('/api/image-proxy?')) {
    try {
      const parsed = new URL(trimmed, 'http://localhost');
      const rawParam = parsed.searchParams.get('url');
      if (rawParam) return rawParam;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Checks whether a URL (raw or proxied) points to a known-dead legacy Fanart.tv placeholder path.
 */
export function isDeadFanartPlaceholderUrl(url: string): boolean {
  const unwrapped = decodeProxyPayload(url);
  const lower = `${url} ${unwrapped}`.toLowerCase();
  return (
    lower.includes('assets.fanart.tv/fanart/tv/') ||
    lower.includes('assets.fanart.tv/fanart/movies/')
  );
}

/**
 * Normalizes and validates an image URL for both Next.js <Image> and direct <img> fallback.
 * Returns null if the URL is empty, malformed, placeholder, or known-dead.
 */
export function normalizeCandidateImageUrl(
  rawUrl?: string | null
): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let trimmed = rawUrl.trim();
  if (
    !trimmed ||
    trimmed === 'undefined' ||
    trimmed === 'null' ||
    trimmed === 'N/A'
  ) {
    return null;
  }

  // Upgrade protocol-relative URLs to HTTPS
  if (trimmed.startsWith('//')) {
    trimmed = `https:${trimmed}`;
  }

  // Allow safe local/relative paths
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) return null;
    if (isDeadFanartPlaceholderUrl(trimmed)) return null;
    return trimmed;
  }

  // Reject javascript:/data:text etc., allow data:image/* only if explicitly needed
  if (trimmed.startsWith('data:')) {
    return trimmed.startsWith('data:image/') ? trimmed : null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' && shouldUpgradeToHttps(parsed.hostname)) {
      parsed.protocol = 'https:';
      trimmed = parsed.toString();
    } else if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }

    if (isDeadFanartPlaceholderUrl(trimmed)) {
      return null;
    }

    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Builds an ordered, deduplicated list of valid candidate image URLs.
 */
export function buildResilientImageCandidates(
  primary?: string | null,
  fallbacks: Array<string | null | undefined> = []
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of [primary, ...fallbacks]) {
    const normalized = normalizeCandidateImageUrl(raw);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}
