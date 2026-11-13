import {
  AnimeArtworkResult,
  ArtworkResolutionDiagnostics,
  FanartLogoItem,
} from '@/types/artwork';
import { HoshikaAnimeItem } from '@/types/anime';
import {
  fetchFanartArtwork,
  pickBestFanartImage,
  extractAllFanartLogos,
  extractAllFanartBackdrops,
} from './fanart';
import {
  getCachedArtwork,
  setCachedArtwork,
  getCachedArtworkOverride,
  setCachedArtworkOverride,
  buildArtworkInputSignature,
} from './artwork/artwork-cache';
import { resolveAnimeLogoSelection } from './artwork/logo-selector';
import { getHoshikaAnime } from './hoshika';
import { resolveAnimeIds } from './id-mapper';
import { AnimeArtworkFirestoreDoc } from './admin/admin-firestore';
import { appCache } from './cache';
import firebaseAppletConfig from '../firebase-applet-config.json';

// Allowed upstream artwork hosts for the secure image proxy (/api/artwork-image/[encoded])
export const ALLOWED_ARTWORK_PROXY_HOSTS = new Set([
  'artworks.thetvdb.com',
  'assets.fanart.tv',
  'fanart.tv',
  'images.fanart.tv',
  'cdn.hoshika.app',
  's4.anilist.co',
  'image.tmdb.org',
]);

// Hosts that require hotlink-protection / HTTP2 header proxying through /api/artwork-image/[encoded]
const HOTLINK_PROXIED_HOSTS = new Set([
  'artworks.thetvdb.com',
  'assets.fanart.tv',
  'fanart.tv',
  'images.fanart.tv',
]);

/**
 * Universal base64url encoder that works in both Node.js and browser runtimes.
 */
export function encodeBase64Url(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('base64url');
  }
  const utf8Bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Universal base64url decoder that works in both Node.js and browser runtimes.
 */
export function decodeBase64Url(encoded: string): string | null {
  if (!encoded || typeof encoded !== 'string') return null;
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(encoded, 'base64url').toString('utf8');
    }
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const binary = atob(base64 + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Validates whether an upstream URL is safe to proxy through /api/artwork-image/[encoded].
 */
export function isAllowedArtworkUpstreamUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_ARTWORK_PROXY_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Unwraps a local /api/artwork-image/[encoded] or /api/image-proxy?url=... URL back to its raw upstream URL.
 */
export function unwrapProxiedArtworkUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/api/artwork-image/')) {
    const encoded = trimmed.slice('/api/artwork-image/'.length).split('?')[0];
    return decodeBase64Url(encoded);
  }
  if (trimmed.startsWith('/api/image-proxy?url=')) {
    try {
      const rawParam = trimmed.slice('/api/image-proxy?url='.length).split('&v=')[0];
      return decodeURIComponent(rawParam);
    } catch {
      return null;
    }
  }
  return trimmed;
}

export function normalizeArtworkVersionToken(
  value: unknown
): string | number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      const parsed = Date.parse(trimmed);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return trimmed;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value && typeof value === 'object') {
    const maybeTs = value as {
      toMillis?: () => number;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof maybeTs.toMillis === 'function') {
      return maybeTs.toMillis();
    }
    if (typeof maybeTs.seconds === 'number') {
      return Math.round(maybeTs.seconds * 1000);
    }
    if (typeof maybeTs._seconds === 'number') {
      return Math.round(maybeTs._seconds * 1000);
    }
  }
  return null;
}

/**
 * Appends a deterministic version token (?v=...) to an artwork URL when an admin override
 * or content update timestamp is present, ensuring browsers and Next.js <Image> immediately
 * fetch updated artwork without ever using random per-render cache busters.
 */
export function appendArtworkVersion(
  url: string | null | undefined,
  versionToken?: string | number | null
): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (versionToken === null || versionToken === undefined || versionToken === '') {
    return trimmed;
  }

  const cleanVersion = String(versionToken)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '');
  if (!cleanVersion) return trimmed;

  // Strip any existing v= parameter before appending the deterministic version
  const [basePart, queryPart] = trimmed.split('?');
  if (!queryPart) {
    return `${basePart}?v=${cleanVersion}`;
  }
  const params = new URLSearchParams(queryPart);
  params.set('v', cleanVersion);
  return `${basePart}?${params.toString()}`;
}

/**
 * Rewrites external Fanart.tv and TheTVDB image URLs through our local
 * base64url-encoded proxy route (/api/artwork-image/[encoded]) so hotlink
 * protection and HTTP/2 header restrictions never break browser rendering.
 */
export function toSafeArtworkUrl(
  url: string | null | undefined,
  versionToken?: string | number | null
): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Already a local proxy route
  if (trimmed.startsWith('/api/artwork-image/')) {
    return versionToken ? appendArtworkVersion(trimmed, versionToken) : trimmed;
  }

  // Upgrade legacy /api/image-proxy?url=... URLs if encountered
  if (trimmed.startsWith('/api/image-proxy?url=')) {
    try {
      const legacyTarget = decodeURIComponent(
        trimmed.slice('/api/image-proxy?url='.length).split('&v=')[0]
      );
      if (isAllowedArtworkUpstreamUrl(legacyTarget)) {
        const proxied = `/api/artwork-image/${encodeBase64Url(legacyTarget)}`;
        return versionToken ? appendArtworkVersion(proxied, versionToken) : proxied;
      }
    } catch {
      return null;
    }
  }

  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === 'https:' &&
      HOTLINK_PROXIED_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
      // Encode the canonical upstream URL without transient version params
      const proxied = `/api/artwork-image/${encodeBase64Url(trimmed)}`;
      return versionToken ? appendArtworkVersion(proxied, versionToken) : proxied;
    }
  } catch {
    // Non-URL or relative path
  }

  return versionToken ? appendArtworkVersion(trimmed, versionToken) : trimmed;
}

// Known Hoshika shortId / AniList ID -> TVDB ID fast-lookup table
const HOSHIKA_TO_TVDB_MAP: Record<number, number> = {
  1780: 267440, // Attack on Titan
  33374: 267440, // Attack on Titan (Hoshika ID)
  11240: 252322, // Hunter x Hunter (2011)
  3847: 331753, // Black Clover
  556910: 331753, // Black Clover Season 2
  1706: 79481, // Death Note
  20859: 79481, // Death Note (Hoshika ID)
  41391: 78857, // Naruto (Hoshika ID)
  95095: 348545, // Demon Slayer: Kimetsu no Yaiba (Hoshika ID)
  558999: 430552, // The Apothecary Diaries Season 3 (Hoshika ID)
  11061: 252322, // Hunter x Hunter (AniList ID)
  16498: 267440, // Attack on Titan (AniList ID)
  101922: 348545, // Demon Slayer (AniList ID)
  1535: 79481, // Death Note (AniList ID)
  20: 78857, // Naruto (AniList ID)
  1735: 79824, // Naruto Shippuden (AniList ID)
};

// Normalized Title -> TVDB ID fast-lookup table for popular anime series
const TITLE_TO_TVDB_MAP: Record<string, number> = {
  'attack on titan': 267440,
  'shingeki no kyojin': 267440,
  'hunter x hunter': 252322,
  'hunter x hunter 2011': 252322,
  'black clover': 331753,
  'jujutsu kaisen': 377543,
  'demon slayer': 348545,
  'demon slayer kimetsu no yaiba': 348545,
  'kimetsu no yaiba': 348545,
  'solo leveling': 389597,
  'ore dake level up na ken': 389597,
  'frieren': 424536,
  'frieren beyond journeys end': 424536,
  'sousou no frieren': 424536,
  'one piece': 81797,
  'bleach': 74796,
  'bleach thousand year blood war': 74796,
  'sennen kessen hen': 74796,
  'chainsaw man': 393409,
  'death note': 79481,
  'naruto': 78857,
  'naruto shippuden': 79824,
  'naruto shippuuden': 79824,
  'boruto': 321285,
  'boruto naruto next generations': 321285,
  'blue lock': 408630,
  'dandadan': 442531,
  'dan da dan': 442531,
  'kaiju no 8': 423043,
  'kaijuu 8 gou': 423043,
  'wind breaker': 433181,
  'oshi no ko': 421069,
  'vinland saga': 359274,
  'cyberpunk edgerunners': 405920,
  'the apothecary diaries': 430552,
  'apothecary diaries': 430552,
  'kusuriya no hitorigoto': 430552,
  'mashle': 421914,
  'mashle magic and muscles': 421914,
  'delicious in dungeon': 423175,
  'dungeon meshi': 423175,
  'spyxfamily': 387279,
  'spy x family': 387279,
  'my hero academia': 305074,
  'boku no hero academia': 305074,
};

export function normalizeLookupTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(
      /\b(season\s*\d+|part\s*\d+|\d+(st|nd|rd|th)\s*season|cour\s*\d+|the\s+final\s+season|spade\s+kingdom\s+raid)\b/gi,
      ''
    )
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchTitleToTvdbId(title?: string | null): number | null {
  if (!title) return null;
  const clean = normalizeLookupTitle(title);
  if (!clean) return null;

  // 1. Exact normalized match
  if (TITLE_TO_TVDB_MAP[clean]) {
    return TITLE_TO_TVDB_MAP[clean];
  }

  // 2. Strip leading "the " and check exact match
  const withoutThe = clean.replace(/^the\s+/, '').trim();
  if (withoutThe && TITLE_TO_TVDB_MAP[withoutThe]) {
    return TITLE_TO_TVDB_MAP[withoutThe];
  }

  // 3. If title has a colon or hyphen subtitle (e.g. "Demon Slayer: Kimetsu no Yaiba - Entertainment District Arc"),
  // check the base franchise prefix before the delimiter (never use arbitrary substring matching that confuses "Naruto" with "Naruto Shippuden")
  const delimiters = [':', ' - ', ' – ', ' — '];
  for (const delim of delimiters) {
    if (title.includes(delim)) {
      const prefix = normalizeLookupTitle(title.split(delim)[0]);
      if (prefix && prefix.length >= 4 && TITLE_TO_TVDB_MAP[prefix]) {
        return TITLE_TO_TVDB_MAP[prefix];
      }
    }
  }

  return null;
}

// Cache upstream image reachability checks for 30 minutes
const upstreamReachabilityCache = new Map<
  string,
  { ok: boolean; expiresAt: number }
>();

/**
 * Verifies whether an external Fanart.tv / TVDB image URL actually exists (HTTP 200 + image/*)
 * so dead/404 upstream assets are never chosen ahead of working Hoshika or AniList banners.
 */
export async function verifyUpstreamArtworkUrl(
  urlOrProxy: string | null | undefined
): Promise<boolean> {
  if (!urlOrProxy) return false;
  const rawUrl = (unwrapProxiedArtworkUrl(urlOrProxy) || urlOrProxy).split('?v=')[0];
  if (!rawUrl || !rawUrl.startsWith('https://')) return false;

  const now = Date.now();
  const cached = upstreamReachabilityCache.get(rawUrl);
  if (cached && now < cached.expiresAt) {
    return cached.ok;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(rawUrl, {
      method: 'HEAD',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/png,image/*,*/*;q=0.8',
        Referer: 'https://fanart.tv/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    let ok = res.status === 200;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ok && ct && !ct.startsWith('image/') && !ct.includes('octet-stream')) {
      ok = false;
    }

    // Some CDNs reject HEAD with 405; fall back to range GET if 405
    if (res.status === 405) {
      const getRes = await fetch(rawUrl, {
        method: 'GET',
        headers: {
          Range: 'bytes=0-63',
          Accept: 'image/*,*/*;q=0.8',
          Referer: 'https://fanart.tv/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
        cache: 'no-store',
      });
      const getCt = (getRes.headers.get('content-type') || '').toLowerCase();
      ok =
        (getRes.status === 200 || getRes.status === 206) &&
        (!getCt || getCt.startsWith('image/'));
    }

    upstreamReachabilityCache.set(rawUrl, {
      ok,
      expiresAt: now + (ok ? 30 * 60 * 1000 : 10 * 60 * 1000),
    });
    return ok;
  } catch {
    upstreamReachabilityCache.set(rawUrl, {
      ok: false,
      expiresAt: now + 5 * 60 * 1000,
    });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Detects dead legacy placeholder URLs (/fanart/tv/<id>/... or /fanart/movies/<id>/...)
 * that always return HTTP 404 on assets.fanart.tv, as well as cross-series pollution.
 */
export function isDeadLegacyFanartUrl(
  url: string | null | undefined,
  hoshikaId?: number
): boolean {
  if (!url || typeof url !== 'string') return false;
  const raw = (unwrapProxiedArtworkUrl(url) || url).trim().toLowerCase();
  if (!raw) return false;

  if (
    raw.includes('assets.fanart.tv/fanart/tv/') ||
    raw.includes('assets.fanart.tv/fanart/movies/')
  ) {
    return true;
  }

  // Guard against historical Naruto (41391) / Naruto Shippuden (30350) <-> Death Note (20859/1706) TVDB collision
  if ((hoshikaId === 41391 || hoshikaId === 30350) && raw.includes('death-note')) {
    return true;
  }
  if ((hoshikaId === 20859 || hoshikaId === 1706) && raw.includes('naruto')) {
    return true;
  }

  return false;
}

/**
 * Checks whether a candidate URL is a valid landscape backdrop candidate
 * (rejects transparent logos, custom logo uploads, dead legacy Fanart URLs, and AniZip URLs).
 */
export function isValidBackdropCandidateUrl(
  url: string | null | undefined,
  hoshikaId?: number
): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (isDeadLegacyFanartUrl(trimmed, hoshikaId)) return false;

  const raw = (unwrapProxiedArtworkUrl(trimmed) || trimmed).toLowerCase();

  // Never allow logos or AniZip images as backdrops
  if (
    raw.includes('/hdtvlogo/') ||
    raw.includes('/clearlogo/') ||
    raw.includes('/hdmovielogo/') ||
    raw.includes('/movielogo/') ||
    raw.includes('/anime-logos/') ||
    raw.includes('ani.zip') ||
    raw.includes('anizip')
  ) {
    return false;
  }

  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/api/artwork-image/')
  );
}

/**
 * Resolves external IDs (thetvdb_id, themoviedb_id, mal_id) from AniList ID using ani.zip
 * (Used strictly for external ID mapping, NEVER for logo or backdrop images.)
 */
export async function resolveExternalIdsFromAnilist(
  anilistId?: number | null
): Promise<{
  tvdbId: number | null;
  tmdbId: number | null;
  malId: number | null;
}> {
  if (!anilistId) {
    return { tvdbId: null, tmdbId: null, malId: null };
  }

  const cacheKey = `anizip:ext-ids:v2:${anilistId}`;
  const cached = appCache.get<{
    tvdbId: number | null;
    tmdbId: number | null;
    malId: number | null;
  }>(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const res = await fetch(`https://api.ani.zip/mappings?anilist_id=${anilistId}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });

    if (res.ok) {
      const data = await res.json();
      const mappings = data?.mappings || {};
      const tvdbId = mappings.thetvdb_id ? Number(mappings.thetvdb_id) : null;
      const tmdbId = mappings.themoviedb_id ? Number(mappings.themoviedb_id) : null;
      const malId = mappings.mal_id ? Number(mappings.mal_id) : null;

      const result = {
        tvdbId: Number.isFinite(tvdbId) ? tvdbId : null,
        tmdbId: Number.isFinite(tmdbId) ? tmdbId : null,
        malId: Number.isFinite(malId) ? malId : null,
      };
      appCache.set(cacheKey, result, 1800);
      return result;
    }
  } catch {
    // Non-fatal fallback
  } finally {
    clearTimeout(timeout);
  }

  return { tvdbId: null, tmdbId: null, malId: null };
}

/**
 * Queries AniList GraphQL to resolve anilistId (from malId or title) and fetch bannerImage fallback.
 * Uses TTL-backed appCache instead of an unbounded non-expiring Map so updated banners are picked up.
 */
async function resolveAnilistMetadata(params: {
  anilistId?: number | null;
  malId?: number | null;
  title?: string | null;
}): Promise<{ anilistId: number | null; bannerImage: string | null }> {
  const { anilistId, malId, title } = params;
  if (!anilistId && !malId && !title) {
    return { anilistId: null, bannerImage: null };
  }

  const cacheKey = `anilist:artwork-meta:v2:${anilistId || ''}:${malId || ''}:${(
    title || ''
  ).toLowerCase()}`;
  const cached = appCache.get<{
    anilistId: number | null;
    bannerImage: string | null;
  }>(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const query = `
      query ($id: Int, $idMal: Int, $search: String) {
        Media(id: $id, idMal: $idMal, search: $search, type: ANIME) {
          id
          bannerImage
        }
      }
    `;

    const variables: Record<string, any> = {};
    if (anilistId) variables.id = anilistId;
    else if (malId) variables.idMal = malId;
    else if (title) variables.search = title;

    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (res.ok) {
      const json = await res.json();
      const media = json?.data?.Media;
      if (media) {
        const result = {
          anilistId: media.id || anilistId || null,
          bannerImage: media.bannerImage || null,
        };
        // Cache for 30 minutes if bannerImage is present, or 5 minutes if bannerImage is currently null
        appCache.set(cacheKey, result, result.bannerImage ? 1800 : 300);
        return result;
      }
    }
  } catch {
    // Ignore error and fall back
  } finally {
    clearTimeout(timeout);
  }

  return { anilistId: anilistId || null, bannerImage: null };
}

function parseNumericId(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export interface ResolveArtworkParams {
  hoshikaId: number;
  anilistId?: number | null;
  malId?: number | null;
  tvdbId?: number | null;
  tmdbId?: number | null;
  title?: string | null;
  titleRomaji?: string | null;
  format?: string | null;
  hoshikaBanner?: string | null;
  hoshikaCover?: string | null;
  preferEnglish?: boolean;
  bypassCache?: boolean;
}

/**
 * Resolves anime artwork with strict priority order:
 * Backdrops:
 * 1. Verified Admin-selected background override (when explicitly configured/reviewed by admin)
 * 2. Verified Fanart.tv landscape background (showbackground / moviebackground / tvthumb / moviethumb)
 * 3. Hoshika landscape banner (bannerImage)
 * 4. AniList landscape banner (bannerImage)
 * 5. Anime poster (coverImage as last resort)
 *
 * Logos:
 * 1. Admin-selected custom logo (Supabase Storage / manual override)
 * 2. Admin-selected Fanart.tv logo (manual override)
 * 3. Verified Automatic Fanart.tv English HDTVLogo -> ClearLogo -> Japanese HDTVLogo -> ClearLogo
 * 4. Hoshika title typography fallback (never uses AniZip for logos)
 */
const inFlightArtworkMap = new Map<number, Promise<AnimeArtworkResult>>();

export async function resolveAnimeArtwork(
  input: string | number | ResolveArtworkParams,
  animeItem?: HoshikaAnimeItem | null
): Promise<AnimeArtworkResult> {
  const initialHoshikaId =
    typeof input === 'number' || typeof input === 'string'
      ? Number(input)
      : input.hoshikaId;
  const bypassCacheFlag =
    typeof input === 'object' && input !== null ? Boolean(input.bypassCache) : false;

  // Only serve immediate fast-path cached artwork if the Firestore override snapshot is ALSO still fresh
  // AND any caller-provided banner/cover signature matches what was cached.
  if (!bypassCacheFlag && Number.isFinite(initialHoshikaId) && initialHoshikaId > 0) {
    const overrideStillFresh =
      initialHoshikaId === 99999 ||
      getCachedArtworkOverride(initialHoshikaId) !== undefined;

    if (overrideStillFresh) {
      const callerInputSig =
        typeof input === 'object' && input !== null
          ? buildArtworkInputSignature({
              hoshikaBanner: input.hoshikaBanner ?? animeItem?.bannerImage,
              hoshikaCover: input.hoshikaCover ?? animeItem?.coverImage,
              preferEnglish: input.preferEnglish,
            })
          : animeItem
            ? buildArtworkInputSignature({
                hoshikaBanner: animeItem.bannerImage,
                hoshikaCover: animeItem.coverImage,
                preferEnglish: true,
              })
            : undefined;

      const cached = getCachedArtwork(initialHoshikaId, callerInputSig);
      if (cached && cached.backgroundUrl) {
        return cached;
      }
    }

    const existingInFlight = inFlightArtworkMap.get(initialHoshikaId);
    if (existingInFlight) {
      return existingInFlight;
    }
  }

  const workPromise = (async (): Promise<AnimeArtworkResult> => {
    let resolvedItem = animeItem;
    if ((typeof input === 'number' || typeof input === 'string') && !resolvedItem) {
      const numericId = Number(input);
      if (Number.isFinite(numericId) && numericId > 0 && numericId !== 99999) {
        resolvedItem = await getHoshikaAnime(numericId, 'en', bypassCacheFlag);
      }
    }

    const params: ResolveArtworkParams =
      typeof input === 'number' || typeof input === 'string'
        ? {
            hoshikaId: Number(input),
            anilistId: resolvedItem?.anilistId || null,
            malId: resolvedItem?.malId || null,
            tvdbId: parseNumericId(resolvedItem?.thetvdbId),
            tmdbId: parseNumericId(resolvedItem?.themoviedbId),
            title: resolvedItem?.titleEnglish || resolvedItem?.titleRomaji || null,
            titleRomaji: resolvedItem?.titleRomaji || null,
            format: resolvedItem?.format || null,
            hoshikaBanner: resolvedItem?.bannerImage || null,
            hoshikaCover: resolvedItem?.coverImage || null,
          }
        : input;

    const {
      hoshikaId,
      anilistId: initialAnilistId,
      malId,
      tvdbId: initialTvdbId,
      tmdbId: initialTmdbId,
      title,
      titleRomaji,
      format,
      hoshikaBanner: rawHoshikaBanner,
      hoshikaCover: rawHoshikaCover,
      preferEnglish = true,
      bypassCache = false,
    } = params;

    const hoshikaBanner = rawHoshikaBanner || resolvedItem?.bannerImage || null;
    const hoshikaCover = rawHoshikaCover || resolvedItem?.coverImage || null;
    const inputSignature = buildArtworkInputSignature({
      hoshikaBanner,
      hoshikaCover,
      preferEnglish,
    });

    let firestoreOverride = bypassCache
      ? undefined
      : getCachedArtworkOverride(hoshikaId);

    const overridePromise =
      firestoreOverride === undefined && hoshikaId !== 99999
        ? fetchPublicArtworkOverrideRest(hoshikaId).then((doc) => {
            if (doc !== undefined) {
              setCachedArtworkOverride(hoshikaId, doc);
            }
            return doc;
          })
        : Promise.resolve(firestoreOverride);

    let anilistId = initialAnilistId || null;
    const canonicalTvdbId =
      HOSHIKA_TO_TVDB_MAP[hoshikaId] ||
      (anilistId ? HOSHIKA_TO_TVDB_MAP[anilistId] : null) ||
      matchTitleToTvdbId(title) ||
      matchTitleToTvdbId(titleRomaji) ||
      null;

    // Run Firestore override lookup and initial AniList ID resolution in parallel if needed
    const [resolvedOverride, idRes] = await Promise.all([
      overridePromise,
      !anilistId && hoshikaId !== 99999
        ? resolveAnimeIds(hoshikaId, resolvedItem).catch(() => null)
        : Promise.resolve(null),
    ]);

    firestoreOverride = resolvedOverride;

    // Now that Firestore override has been checked/updated (bumping keyVersion if changed),
    // check if our resolved artwork cache is still valid for this inputSignature
    if (!bypassCache) {
      const cached = getCachedArtwork(hoshikaId, inputSignature);
      if (cached && cached.backgroundUrl) {
        return cached;
      }
    }

    if (!anilistId && idRes?.aniListId) {
      anilistId = idRes.aniListId;
    }

    let tvdbId: number | null =
      canonicalTvdbId ||
      (anilistId ? HOSHIKA_TO_TVDB_MAP[anilistId] : null) ||
      initialTvdbId ||
      firestoreOverride?.tvdbId ||
      null;

    let tmdbId: number | null = firestoreOverride?.tmdbId || initialTmdbId || null;
    let anilistBanner: string | null = null;

    // Run AniList banner fallback query (only if hoshikaBanner is missing or anilistId is still missing)
    // and ani.zip external ID mapping (only if tvdbId/tmdbId is still missing) IN PARALLEL!
    const needsAnilistBannerOrId =
      hoshikaId !== 99999 &&
      (!hoshikaBanner || !anilistId) &&
      Boolean(anilistId || malId || title);

    const needsExternalIds =
      (!tvdbId || (!tmdbId && format === 'MOVIE')) &&
      Boolean(anilistId) &&
      hoshikaId !== 99999;

    const [anilistMeta, externalIdsResult] = await Promise.all([
      needsAnilistBannerOrId
        ? resolveAnilistMetadata({ anilistId, malId, title })
        : Promise.resolve({ anilistId, bannerImage: null }),
      needsExternalIds && anilistId
        ? resolveExternalIdsFromAnilist(anilistId)
        : Promise.resolve({ tvdbId, tmdbId, malId: malId || null }),
    ]);

    if (!anilistId && anilistMeta.anilistId) {
      anilistId = anilistMeta.anilistId;
      if (HOSHIKA_TO_TVDB_MAP[anilistId]) {
        tvdbId = HOSHIKA_TO_TVDB_MAP[anilistId];
      }
    }
    anilistBanner = anilistMeta.bannerImage;

    let externalIds = externalIdsResult;
    // If anilistId was just discovered via anilistMeta and we still need tvdbId/tmdbId, resolve external IDs
    if (!needsExternalIds && (!tvdbId || (!tmdbId && format === 'MOVIE')) && anilistId && hoshikaId !== 99999) {
      externalIds = await resolveExternalIdsFromAnilist(anilistId);
    }

    tvdbId = canonicalTvdbId || externalIds.tvdbId || tvdbId || null;
    tmdbId = tmdbId || externalIds.tmdbId || null;

    const overrideVersionToken = normalizeArtworkVersionToken(
      firestoreOverride?.updatedAt
    );

    let backgroundUrl: string | null = null;
    let backgroundSource: AnimeArtworkResult['backgroundSource'] = 'none';
    let posterUrl: string | null =
      firestoreOverride?.posterUrl &&
      !isDeadLegacyFanartUrl(firestoreOverride.posterUrl, hoshikaId)
        ? toSafeArtworkUrl(firestoreOverride.posterUrl, overrideVersionToken)
        : hoshikaCover || null;
    let source: AnimeArtworkResult['source'] = 'hoshika';

    const isMovie = format === 'MOVIE' && !tvdbId && Boolean(tmdbId);
    let fanartAvailableLogos: FanartLogoItem[] = [];
    const verifiedFanartBackdrops: string[] = [];

    // Step 4: Fetch Fanart.tv artwork (Movies via TMDB ID or TV via TVDB ID)
    const fanartData =
      isMovie && tmdbId
        ? await fetchFanartArtwork(tmdbId, 'movies', bypassCache)
        : tvdbId
        ? await fetchFanartArtwork(tvdbId, 'tv', bypassCache)
        : null;

    if (fanartData) {
      fanartAvailableLogos = extractAllFanartLogos(
        fanartData,
        toSafeArtworkUrl,
        preferEnglish
      );

      const rawBackdrops = extractAllFanartBackdrops(
        fanartData,
        undefined,
        preferEnglish ? 'en' : 'ja'
      );

      // Probe top Fanart.tv backdrop candidates (max 3) IN PARALLEL so dead 404 URLs are never chosen over live Hoshika/AniList banners
      const validBackdropCandidates = rawBackdrops
        .slice(0, 3)
        .filter((rawBgUrl) => isValidBackdropCandidateUrl(rawBgUrl, hoshikaId));

      const reachabilityResults = await Promise.all(
        validBackdropCandidates.map(async (rawBgUrl) => {
          const isReachable =
            hoshikaId === 99999 ? true : await verifyUpstreamArtworkUrl(rawBgUrl);
          return isReachable ? toSafeArtworkUrl(rawBgUrl) : null;
        })
      );

      for (const safeBg of reachabilityResults) {
        if (safeBg) {
          verifiedFanartBackdrops.push(safeBg);
        }
      }

      if (verifiedFanartBackdrops.length > 0) {
        backgroundUrl = verifiedFanartBackdrops[0];
        backgroundSource = 'fanart';
        source = 'fanart';
      }

      const poster = isMovie
        ? pickBestFanartImage(fanartData.movieposter, 'en')
        : pickBestFanartImage(fanartData.tvposter, 'en');
      if (poster?.url && !posterUrl && !isDeadLegacyFanartUrl(poster.url, hoshikaId)) {
        const isPosterReachable =
          hoshikaId === 99999 ? true : await verifyUpstreamArtworkUrl(poster.url);
        if (isPosterReachable) {
          posterUrl = toSafeArtworkUrl(poster.url);
        }
      }
    }

    // Merge Fanart.tv available logos with stored Firestore availableLogos, filtering out dead /fanart/tv/ URLs
    const storedLogos: FanartLogoItem[] = (
      firestoreOverride?.availableLogos || []
    )
      .filter((item) => item?.url && !isDeadLegacyFanartUrl(item.url, hoshikaId))
      .map((item) => {
        const lang = (item.lang || item.language || 'en').toLowerCase();
        const category =
          item.category ||
          (item.source === 'fanart_clearlogo' ? 'clearlogo' : 'hdtvlogo');
        return {
          ...item,
          lang,
          language: lang,
          category,
          type: category,
          provider: 'fanart',
          proxyUrl: toSafeArtworkUrl(item.url) || item.proxyUrl || item.url,
        };
      });

    const combinedLogosMap = new Map<string, FanartLogoItem>();
    for (const logo of [
      ...fanartAvailableLogos.filter((l) => !isDeadLegacyFanartUrl(l.url, hoshikaId)),
      ...storedLogos,
    ]) {
      if (!logo || !logo.url) continue;
      const key = `${logo.category}:${logo.id || logo.url}:${logo.lang || 'en'}`;
      if (!combinedLogosMap.has(key)) {
        combinedLogosMap.set(key, logo);
      }
    }
    const mergedAvailableLogos = Array.from(combinedLogosMap.values());

    const cleanManualLogoUrl =
      firestoreOverride?.selectedLogoUrl &&
      !isDeadLegacyFanartUrl(firestoreOverride.selectedLogoUrl, hoshikaId)
        ? firestoreOverride.selectedLogoUrl
        : null;

    // Resolve final logo using the 8-step priority selector (respects manual overrides for both TV & Movie)
    const logoResolution = resolveAnimeLogoSelection({
      availableLogos: mergedAvailableLogos,
      customLogos: firestoreOverride?.customLogos || [],
      hiddenLogoIds: firestoreOverride?.hiddenLogoIds || [],
      selectionMode: firestoreOverride?.selectionMode || 'auto',
      manualLogoId: cleanManualLogoUrl ? firestoreOverride?.selectedLogo?.id || null : null,
      manualLogoUrl: cleanManualLogoUrl,
      manualLogoSource: cleanManualLogoUrl ? firestoreOverride?.selectedLogoSource : undefined,
      manualLogoLanguage: firestoreOverride?.selectedLogoLanguage,
      selectedLogo: cleanManualLogoUrl ? firestoreOverride?.selectedLogo || null : null,
      logoDisplay: firestoreOverride?.logoDisplay,
      preferEnglish,
    });

    let logoUrl: string | null = null;
    let logoSource: AnimeArtworkResult['logoSource'] =
      logoResolution.selectedLogoSource === 'typography_fallback'
        ? 'typography'
        : logoResolution.selectedLogoSource;

    if (logoResolution.logoUrl) {
      if (logoResolution.selectedLogoSource === 'custom_upload') {
        logoUrl = appendArtworkVersion(
          logoResolution.logoUrl,
          overrideVersionToken
        );
      } else if (!isDeadLegacyFanartUrl(logoResolution.logoUrl, hoshikaId)) {
        const isLogoReachable =
          hoshikaId === 99999
            ? true
            : await verifyUpstreamArtworkUrl(logoResolution.logoUrl);
        if (isLogoReachable) {
          logoUrl = toSafeArtworkUrl(
            logoResolution.logoUrl,
            logoResolution.selectionMode === 'manual' ? overrideVersionToken : null
          );
        } else {
          logoUrl = null;
          logoSource = 'typography';
        }
      } else {
        logoUrl = null;
        logoSource = 'typography';
      }
    }

    if (
      logoResolution.selectionMode === 'manual' ||
      logoResolution.selectedLogoSource === 'custom_upload'
    ) {
      source = 'custom_override';
    } else if (logoUrl && source === 'hoshika') {
      source = 'fanart';
    }

    // Step 5: Build ordered landscape backdropCandidates and select primary backgroundUrl
    const candidateSet = new Set<string>();
    const addBackdropCandidate = (url: string | null | undefined) => {
      if (!url || !isValidBackdropCandidateUrl(url, hoshikaId)) return;
      const trimmed = url.trim();
      if (!candidateSet.has(trimmed)) {
        candidateSet.add(trimmed);
      }
    };

    // Firestore admin override backgroundUrl (only if not a dead /fanart/tv/ URL)
    let verifiedOverrideBackground: string | null = null;
    if (
      firestoreOverride?.backgroundUrl &&
      isValidBackdropCandidateUrl(firestoreOverride.backgroundUrl, hoshikaId)
    ) {
      const rawOverrideBg =
        unwrapProxiedArtworkUrl(firestoreOverride.backgroundUrl) ||
        firestoreOverride.backgroundUrl;
      const needsProbe = HOTLINK_PROXIED_HOSTS.has(
        (() => {
          try {
            return new URL(rawOverrideBg).hostname.toLowerCase();
          } catch {
            return '';
          }
        })()
      );
      const overrideOk =
        !needsProbe ||
        hoshikaId === 99999 ||
        (await verifyUpstreamArtworkUrl(rawOverrideBg));
      if (overrideOk) {
        verifiedOverrideBackground = toSafeArtworkUrl(
          firestoreOverride.backgroundUrl,
          overrideVersionToken
        );
      }
    }

    // If an admin explicitly reviewed/saved a custom backdrop override, prioritize it first
    const hasExplicitAdminBackdrop = Boolean(
      verifiedOverrideBackground &&
        (firestoreOverride?.reviewed ||
          firestoreOverride?.selectionMode === 'manual')
    );

    if (hasExplicitAdminBackdrop && verifiedOverrideBackground) {
      addBackdropCandidate(verifiedOverrideBackground);
      backgroundUrl = verifiedOverrideBackground;
      backgroundSource = 'fanart';
      source = 'custom_override';
    }

    // 1. Verified Fanart.tv landscape backgrounds
    for (const bg of verifiedFanartBackdrops) {
      addBackdropCandidate(bg);
    }

    // 2. Verified override background (if not already added first)
    if (verifiedOverrideBackground) {
      addBackdropCandidate(verifiedOverrideBackground);
    }

    // 3. Hoshika landscape banner
    if (hoshikaBanner && isValidBackdropCandidateUrl(hoshikaBanner, hoshikaId)) {
      addBackdropCandidate(hoshikaBanner);
    }

    // 4. AniList landscape banner
    if (anilistBanner && isValidBackdropCandidateUrl(anilistBanner, hoshikaId)) {
      addBackdropCandidate(anilistBanner);
    }

    // 5. Hoshika cover poster (last-resort fallback)
    if (hoshikaCover && isValidBackdropCandidateUrl(hoshikaCover, hoshikaId)) {
      addBackdropCandidate(hoshikaCover);
    }

    if (!backgroundUrl) {
      if (hoshikaBanner && isValidBackdropCandidateUrl(hoshikaBanner, hoshikaId)) {
        backgroundUrl = hoshikaBanner;
        backgroundSource = 'hoshika_banner';
        if (source === 'hoshika') source = 'hoshika';
      } else if (anilistBanner && isValidBackdropCandidateUrl(anilistBanner, hoshikaId)) {
        backgroundUrl = anilistBanner;
        backgroundSource = 'anilist_banner';
        if (source === 'hoshika') source = 'anilist';
      } else if (verifiedOverrideBackground) {
        backgroundUrl = verifiedOverrideBackground;
        backgroundSource = 'fanart';
      } else if (hoshikaCover && isValidBackdropCandidateUrl(hoshikaCover, hoshikaId)) {
        backgroundUrl = hoshikaCover;
        backgroundSource = 'hoshika_cover';
      }
    }

    const backdropCandidates = Array.from(candidateSet);

    const diagnostics: ArtworkResolutionDiagnostics = {
      requestedId: hoshikaId,
      resolvedAnilistId: anilistId,
      resolvedTvdbId: tvdbId,
      resolvedTmdbId: tmdbId,
      fanartBackdropCount: verifiedFanartBackdrops.length,
      hoshikaBannerAvailable: Boolean(hoshikaBanner),
      anilistBannerAvailable: Boolean(anilistBanner),
      selectedBackdropUrl: backgroundUrl,
      selectedBackdropSource: backgroundSource || 'none',
      candidateCount: backdropCandidates.length,
    };

    if (
      typeof process !== 'undefined' &&
      process.env.NODE_ENV !== 'test' &&
      process.env.ANISCROLL_CACHE_LOG === 'true'
    ) {
      console.info(
        `[AniScroll][Artwork resolver source] hoshikaId=${hoshikaId} source="${source}" backdrop="${backgroundSource}" logo="${logoSource}"`
      );
    }

    const finalResult: AnimeArtworkResult = {
      hoshikaId,
      title: title || titleRomaji || firestoreOverride?.title || 'Unknown Anime',
      anilistId,
      malId: externalIds.malId || malId || null,
      tvdbId,
      tmdbId,
      backgroundUrl,
      backgroundSource,
      backdropCandidates,
      logoUrl,
      logoSource,
      characterArtUrl: null,
      posterUrl,
      source,
      fetchedAt: Date.now(),
      logos: logoResolution.availableLogos,
      availableLogos: logoResolution.availableLogos,
      selectedLogo: logoResolution.selectedLogo,
      customLogos: logoResolution.customLogos,
      hiddenLogoIds: logoResolution.hiddenLogoIds,
      selectionMode: logoResolution.selectionMode,
      selectedLogoSource: logoUrl ? logoResolution.selectedLogoSource : 'typography_fallback',
      selectedLogoLanguage: logoResolution.selectedLogoLanguage,
      logoDisplay: logoResolution.logoDisplay,
      logoStatus: logoUrl ? logoResolution.logoStatus : 'typography_fallback',
      hasEnglishLogo: logoResolution.hasEnglishLogo,
      hasJapaneseLogo: logoResolution.hasJapaneseLogo,
      reviewed: firestoreOverride?.reviewed ?? false,
      overrideUpdatedAt: overrideVersionToken,
      diagnostics,
    };

    if (backgroundUrl) {
      setCachedArtwork(hoshikaId, finalResult, undefined, inputSignature);
    }
    return finalResult;
  })();

  if (!bypassCacheFlag && Number.isFinite(initialHoshikaId) && initialHoshikaId > 0) {
    inFlightArtworkMap.set(initialHoshikaId, workPromise);
    workPromise.finally(() => {
      inFlightArtworkMap.delete(initialHoshikaId);
    });
  }

  return workPromise;
}

function parseRestValue(valObj: Record<string, any>): any {
  if (!valObj || typeof valObj !== 'object') return null;
  if ('stringValue' in valObj) return valObj.stringValue;
  if ('integerValue' in valObj) return Number(valObj.integerValue);
  if ('doubleValue' in valObj) return Number(valObj.doubleValue);
  if ('booleanValue' in valObj) return Boolean(valObj.booleanValue);
  if ('nullValue' in valObj) return null;
  if ('timestampValue' in valObj) return valObj.timestampValue;
  if ('mapValue' in valObj) {
    return parseRestFields(valObj.mapValue?.fields || {});
  }
  if ('arrayValue' in valObj) {
    const values = valObj.arrayValue?.values || [];
    return values.map((v: Record<string, any>) => parseRestValue(v));
  }
  return null;
}

function parseRestFields(
  fields: Record<string, Record<string, any>>
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, valObj] of Object.entries(fields)) {
    result[key] = parseRestValue(valObj);
  }
  return result;
}

async function fetchPublicArtworkOverrideRest(
  hoshikaId: number
): Promise<AnimeArtworkFirestoreDoc | null | undefined> {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    firebaseAppletConfig.projectId;
  const databaseId =
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ||
    firebaseAppletConfig.firestoreDatabaseId ||
    '(default)';

  if (!projectId) return undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/databases/${encodeURIComponent(
      databaseId
    )}/documents/animeArtwork/${encodeURIComponent(String(hoshikaId))}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      return undefined;
    }

    const rawDoc = await res.json();
    if (!rawDoc?.fields) return null;
    return parseRestFields(rawDoc.fields) as AnimeArtworkFirestoreDoc;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
