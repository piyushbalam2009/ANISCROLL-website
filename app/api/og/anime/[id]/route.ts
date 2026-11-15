import { NextRequest, NextResponse } from 'next/server';
import { getHoshikaAnime, getEpisodesForWatch } from '@/lib/hoshika';
import { getCachedArtwork } from '@/lib/artwork/artwork-cache';
import { resolveAnimeArtwork, unwrapProxiedArtworkUrl } from '@/lib/artwork-mapper';
import { isMovieContent } from '@/lib/stream-provider-core';
import {
  getCachedOgImage,
  setCachedOgImage,
  renderAnimeOgJpeg,
  renderSiteBrandOgJpeg,
} from '@/lib/og-image-renderer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OG_IMAGE_HEADERS: Record<string, string> = {
  'Content-Type': 'image/jpeg',
  'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

function unwrapCandidate(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const unwrapped = unwrapProxiedArtworkUrl(trimmed);
  const clean = (unwrapped || trimmed).split('?v=')[0];
  return clean.startsWith('https://') ? clean : null;
}

async function generateOgResponseBuffer(id: string, epParam: string | null): Promise<Buffer> {
  const cleanId = id?.trim();
  if (!cleanId || !/^\d+$/.test(cleanId)) {
    return renderSiteBrandOgJpeg();
  }

  const numericId = Number(cleanId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    return renderSiteBrandOgJpeg();
  }

  const parsedEp =
    epParam && /^\d+$/.test(epParam.trim()) ? Number(epParam.trim()) : null;
  const episodeNumber =
    parsedEp && Number.isSafeInteger(parsedEp) && parsedEp > 0 ? parsedEp : null;

  const cacheKey = episodeNumber
    ? `anime:${numericId}:ep:${episodeNumber}`
    : `anime:${numericId}`;
  const cached = getCachedOgImage(cacheKey);
  if (cached) {
    return cached;
  }

  const anime = await getHoshikaAnime(cleanId, 'en').catch(() => null);
  if (!anime) {
    return renderSiteBrandOgJpeg();
  }

  const standalone =
    anime.isStandaloneMovie === true || anime.standaloneMovie === true;
  const isMovie = isMovieContent({
    format: anime.format ?? null,
    isStandaloneMovie: standalone,
  });

  const cachedArtwork = getCachedArtwork(anime.shortId || numericId);

  const [resolvedArtwork, episodeData] = await Promise.all([
    cachedArtwork
      ? Promise.resolve(cachedArtwork)
      : withTimeout(resolveAnimeArtwork(anime.shortId || numericId, anime), 2200),
    !isMovie && episodeNumber
      ? withTimeout(getEpisodesForWatch(cleanId, episodeNumber, 'en'), 1800)
      : Promise.resolve(null),
  ]);

  const matchingEpisode =
    !isMovie && episodeNumber && episodeData?.items
      ? episodeData.items.find((ep) => Number(ep.number) === episodeNumber)
      : undefined;

  const posterCandidates = [
    unwrapCandidate(resolvedArtwork?.posterUrl),
    unwrapCandidate(anime.coverImage),
  ].filter((v): v is string => Boolean(v));

  const backdropCandidates = [
    unwrapCandidate(matchingEpisode?.thumbnail),
    unwrapCandidate(resolvedArtwork?.backgroundUrl),
    ...(resolvedArtwork?.backdropCandidates || []).map(unwrapCandidate),
    unwrapCandidate(anime.bannerImage),
    unwrapCandidate(anime.coverImage),
  ].filter((v): v is string => Boolean(v));

  const output = await renderAnimeOgJpeg({
    posterCandidates,
    backdropCandidates,
  });

  setCachedOgImage(cacheKey, output);
  return output;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const epParam = req.nextUrl.searchParams.get('ep');
    const buffer = await generateOgResponseBuffer(id, epParam);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        ...OG_IMAGE_HEADERS,
        'Content-Length': String(buffer.byteLength),
      },
    });
  } catch {
    const fallback = await renderSiteBrandOgJpeg();
    return new NextResponse(new Uint8Array(fallback), {
      status: 200,
      headers: {
        ...OG_IMAGE_HEADERS,
        'Content-Length': String(fallback.byteLength),
      },
    });
  }
}

export async function HEAD(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const epParam = req.nextUrl.searchParams.get('ep');
    const buffer = await generateOgResponseBuffer(id, epParam);

    return new NextResponse(null, {
      status: 200,
      headers: {
        ...OG_IMAGE_HEADERS,
        'Content-Length': String(buffer.byteLength),
      },
    });
  } catch {
    return new NextResponse(null, {
      status: 200,
      headers: OG_IMAGE_HEADERS,
    });
  }
}
