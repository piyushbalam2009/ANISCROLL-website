import type { Metadata } from 'next';
import { HoshikaAnimeItem, HoshikaEpisodeItem } from '@/types/anime';
import { isMovieContent } from '@/lib/stream-provider-core';

export const DEFAULT_SITE_NAME = 'AniScroll';
export const DEFAULT_SITE_TITLE =
  'AniScroll — Premium Monochrome Anime Streaming';
export const DEFAULT_SITE_DESCRIPTION =
  'Stream anime series and movies in monochrome minimalism with curated HD artwork, adaptive HLS playback, and AniSkip intro detection on AniScroll.';
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_IMAGE_MIME_TYPE = 'image/jpeg';

function normalizeOriginCandidate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'MY_APP_URL') return null;

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.origin.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Resolves the canonical public origin for metadataBase, og:url, and og:image.
 * Always produces an absolute HTTP(S) origin with https://aniscroll.in fallback.
 */
export function resolveCanonicalOrigin(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeOriginCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return 'https://aniscroll.in';
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

/**
 * Strips HTML tags from Hoshika/AniList synopses and truncates cleanly at a
 * word boundary for social preview descriptions.
 */
export function sanitizeSynopsisForMetadata(
  synopsis: string | null | undefined,
  maxLength: number = 220
): string {
  if (!synopsis || typeof synopsis !== 'string') return '';

  const cleaned = decodeHtmlEntities(
    synopsis
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\(Source:[^)]+\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';
  if (cleaned.length <= maxLength) return cleaned;

  const sliced = cleaned.slice(0, Math.max(40, maxLength - 1));
  const lastSpace = sliced.lastIndexOf(' ');
  const boundary = lastSpace > maxLength * 0.6 ? sliced.slice(0, lastSpace) : sliced;
  return `${boundary.replace(/[,:;.\-–—\s]+$/, '')}…`;
}

export function pickAnimeMetadataTitle(
  anime: HoshikaAnimeItem | null | undefined
): string {
  if (!anime) return DEFAULT_SITE_TITLE;
  const raw =
    anime.titleEnglish ||
    anime.titleRomaji ||
    anime.titleLocalized ||
    anime.nativeTitle ||
    anime.originalTitle ||
    '';
  const trimmed = raw.trim();
  return trimmed || DEFAULT_SITE_NAME;
}

export function buildAnimeFallbackDescription(anime: HoshikaAnimeItem): string {
  const title = pickAnimeMetadataTitle(anime);
  const yearPart = anime.seasonYear ? ` (${anime.seasonYear})` : '';
  const standalone =
    anime.isStandaloneMovie === true || anime.standaloneMovie === true;
  const isMovie = isMovieContent({
    format: anime.format ?? null,
    isStandaloneMovie: standalone,
  });

  if (isMovie) {
    return `Watch ${title}${yearPart} anime movie with Sub & Dub playback and HD artwork on AniScroll.`;
  }

  return `Watch ${title}${yearPart} episodes online with Sub & Dub playback and AniSkip on AniScroll.`;
}

function normalizeRouteId(rawId: string | number | undefined | null): string | null {
  if (rawId === undefined || rawId === null) return null;
  const str = String(rawId).trim();
  if (!/^\d+$/.test(str)) return null;
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  return str;
}

export function buildAnimeSocialMetadata(
  anime: HoshikaAnimeItem | null,
  rawId: string,
  origin: string = resolveCanonicalOrigin()
): Metadata {
  const cleanOrigin = origin.replace(/\/+$/, '');
  const siteOgImage = `${cleanOrigin}/api/og/site`;

  if (!anime) {
    const fallbackUrl = `${cleanOrigin}/anime`;
    return {
      title: {
        absolute: DEFAULT_SITE_TITLE,
      },
      description: DEFAULT_SITE_DESCRIPTION,
      alternates: {
        canonical: fallbackUrl,
      },
      openGraph: {
        type: 'website',
        siteName: DEFAULT_SITE_NAME,
        title: DEFAULT_SITE_TITLE,
        description: DEFAULT_SITE_DESCRIPTION,
        url: fallbackUrl,
        images: [
          {
            url: siteOgImage,
            secureUrl: siteOgImage,
            alt: DEFAULT_SITE_TITLE,
            type: OG_IMAGE_MIME_TYPE,
            width: OG_IMAGE_WIDTH,
            height: OG_IMAGE_HEIGHT,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title: DEFAULT_SITE_TITLE,
        description: DEFAULT_SITE_DESCRIPTION,
        images: [
          {
            url: siteOgImage,
            alt: DEFAULT_SITE_TITLE,
          },
        ],
      },
    };
  }

  const canonicalId =
    normalizeRouteId(anime.shortId) || normalizeRouteId(rawId) || String(anime.id);
  const title = pickAnimeMetadataTitle(anime);
  const description =
    sanitizeSynopsisForMetadata(anime.synopsis, 220) ||
    buildAnimeFallbackDescription(anime);
  const canonicalUrl = `${cleanOrigin}/anime/${canonicalId}`;
  const ogImageUrl = `${cleanOrigin}/api/og/anime/${canonicalId}`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: 'website',
      siteName: DEFAULT_SITE_NAME,
      title,
      description,
      url: canonicalUrl,
      images: [
        {
          url: ogImageUrl,
          secureUrl: ogImageUrl,
          alt: `${title} — ${DEFAULT_SITE_NAME}`,
          type: OG_IMAGE_MIME_TYPE,
          width: OG_IMAGE_WIDTH,
          height: OG_IMAGE_HEIGHT,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [
        {
          url: ogImageUrl,
          alt: `${title} — ${DEFAULT_SITE_NAME}`,
        },
      ],
    },
  };
}

export function buildWatchSocialMetadata(params: {
  anime: HoshikaAnimeItem | null;
  episodes?: HoshikaEpisodeItem[];
  rawId: string;
  episodeNumber: number;
  origin?: string;
}): Metadata {
  const { anime, episodes = [], rawId, episodeNumber } = params;
  const cleanOrigin = (params.origin || resolveCanonicalOrigin()).replace(/\/+$/, '');

  if (!anime) {
    return buildAnimeSocialMetadata(null, rawId, cleanOrigin);
  }

  const canonicalId =
    normalizeRouteId(anime.shortId) || normalizeRouteId(rawId) || String(anime.id);
  const animeTitle = pickAnimeMetadataTitle(anime);
  const standalone =
    anime.isStandaloneMovie === true || anime.standaloneMovie === true;
  const isMovie = isMovieContent({
    format: anime.format ?? null,
    isStandaloneMovie: standalone,
  });

  const matchingEpisode = !isMovie
    ? episodes.find((ep) => Number(ep.number) === Number(episodeNumber))
    : undefined;

  const epTitle = matchingEpisode?.title?.trim();
  const socialTitle = isMovie
    ? animeTitle
    : epTitle
    ? `${animeTitle} — Episode ${episodeNumber}: ${epTitle}`
    : `${animeTitle} — Episode ${episodeNumber}`;

  const rawSynopsis =
    (!isMovie && matchingEpisode?.synopsis) || anime.synopsis || '';
  const description =
    sanitizeSynopsisForMetadata(rawSynopsis, 220) ||
    buildAnimeFallbackDescription(anime);

  const canonicalUrl = `${cleanOrigin}/watch/${canonicalId}/${episodeNumber}`;
  const ogImageUrl = isMovie
    ? `${cleanOrigin}/api/og/anime/${canonicalId}`
    : `${cleanOrigin}/api/og/anime/${canonicalId}?ep=${episodeNumber}`;

  return {
    title: socialTitle,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: 'website',
      siteName: DEFAULT_SITE_NAME,
      title: socialTitle,
      description,
      url: canonicalUrl,
      images: [
        {
          url: ogImageUrl,
          secureUrl: ogImageUrl,
          alt: `${socialTitle} — ${DEFAULT_SITE_NAME}`,
          type: OG_IMAGE_MIME_TYPE,
          width: OG_IMAGE_WIDTH,
          height: OG_IMAGE_HEIGHT,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description,
      images: [
        {
          url: ogImageUrl,
          alt: `${socialTitle} — ${DEFAULT_SITE_NAME}`,
        },
      ],
    },
  };
}

export function buildBrowseSocialMetadata(params: {
  title: string;
  description: string;
  path: string;
  origin?: string;
  absoluteTitle?: boolean;
}): Metadata {
  const cleanOrigin = (params.origin || resolveCanonicalOrigin()).replace(/\/+$/, '');
  const normalizedPath = params.path.startsWith('/') ? params.path : `/${params.path}`;
  const canonicalUrl =
    normalizedPath === '/' ? cleanOrigin : `${cleanOrigin}${normalizedPath}`;
  const ogImageUrl = `${cleanOrigin}/api/og/site`;

  return {
    title: params.absoluteTitle ? { absolute: params.title } : params.title,
    description: params.description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: 'website',
      siteName: DEFAULT_SITE_NAME,
      title: params.title,
      description: params.description,
      url: canonicalUrl,
      images: [
        {
          url: ogImageUrl,
          secureUrl: ogImageUrl,
          alt: params.title,
          type: OG_IMAGE_MIME_TYPE,
          width: OG_IMAGE_WIDTH,
          height: OG_IMAGE_HEIGHT,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: params.title,
      description: params.description,
      images: [
        {
          url: ogImageUrl,
          alt: params.title,
        },
      ],
    },
  };
}

export function buildAnimeJsonLd(params: {
  anime: HoshikaAnimeItem;
  canonicalUrl: string;
  imageUrl: string;
}): Record<string, unknown> {
  const { anime, canonicalUrl, imageUrl } = params;
  const standalone =
    anime.isStandaloneMovie === true || anime.standaloneMovie === true;
  const isMovie = isMovieContent({
    format: anime.format ?? null,
    isStandaloneMovie: standalone,
  });

  const title = pickAnimeMetadataTitle(anime);
  const description =
    sanitizeSynopsisForMetadata(anime.synopsis, 300) ||
    buildAnimeFallbackDescription(anime);

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': isMovie ? 'Movie' : 'TVSeries',
    name: title,
    url: canonicalUrl,
    image: imageUrl,
    description,
    genre: Array.isArray(anime.genres)
      ? anime.genres.map((g) => g.name).filter(Boolean)
      : undefined,
  };

  if (anime.titleJapanese) {
    jsonLd.alternateName = anime.titleJapanese;
  }
  if (anime.startedAiring) {
    jsonLd.datePublished = anime.startedAiring;
  }
  if (!isMovie && anime.episodes && anime.episodes > 0) {
    jsonLd.numberOfEpisodes = anime.episodes;
  }
  if (anime.averageScore && anime.averageScore > 0) {
    const rating10 =
      anime.averageScore > 10
        ? Number((anime.averageScore / 10).toFixed(1))
        : Number(anime.averageScore.toFixed(1));
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: rating10,
      bestRating: 10,
      worstRating: 1,
      ratingCount: anime.canonCount || 1,
    };
  }

  return jsonLd;
}

export function safeJsonLdStringify(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
