import { NextRequest, NextResponse } from 'next/server';
import {
  checkEpisodeStreamAvailability,
  getAniScrollStream,
} from '@/lib/aniscroll';
import { selectEpisodeAudioVersion } from '@/lib/zokoanime-stream';
import {
  getStreamingProviderDisplayName,
  resolveStreamingProviderForAnime,
} from '@/lib/stream-provider';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const anilistIdStr = searchParams.get('anilistId');
  const episodeStr = searchParams.get('episode') || '1';
  const typeParam = searchParams.get('type');
  const preferredTypeParam = searchParams.get('preferredType');
  const checkBoth = searchParams.get('checkBoth') !== 'false';
  const formatParam = searchParams.get('format');
  const hoshikaIdParam = searchParams.get('hoshikaId');
  const isStandaloneMovie = searchParams.get('standaloneMovie') === 'true';

  if (!anilistIdStr) {
    return NextResponse.json(
      { ok: false, error: 'anilistId is required' },
      { status: 400 }
    );
  }

  const anilistId = parseInt(anilistIdStr, 10);
  const episode = parseInt(episodeStr, 10);

  if (!Number.isFinite(anilistId) || anilistId <= 0 || !Number.isFinite(episode) || episode <= 0) {
    return NextResponse.json(
      { ok: false, error: 'Invalid anilistId or episode number' },
      { status: 400 }
    );
  }

  const requestedType: 'sub' | 'dub' | null =
    typeParam === 'dub' ? 'dub' : typeParam === 'sub' ? 'sub' : null;
  const preferredType: 'sub' | 'dub' | null =
    preferredTypeParam === 'dub'
      ? 'dub'
      : preferredTypeParam === 'sub'
      ? 'sub'
      : requestedType;

  // Always resolve authoritative content format server-side when omitted/unknown
  // so movies are never accidentally routed to MegaPlay.
  const routed = await resolveStreamingProviderForAnime({
    format: formatParam,
    isStandaloneMovie,
    hoshikaId: hoshikaIdParam,
    anilistId,
  });
  const provider = routed.provider;
  const providerLabel = getStreamingProviderDisplayName(provider);
  const resolvedFormat = routed.format !== 'UNKNOWN' ? routed.format : formatParam || null;

  try {
    if (checkBoth) {
      const availability = await checkEpisodeStreamAvailability(
        anilistId,
        episode,
        preferredType,
        {
          provider,
          format: resolvedFormat,
          isStandaloneMovie,
          hoshikaId: hoshikaIdParam,
        }
      );

      const effectiveType =
        requestedType &&
        ((requestedType === 'sub' && availability.subAvailable) ||
          (requestedType === 'dub' && availability.dubAvailable))
          ? requestedType
          : selectEpisodeAudioVersion({
              subAvailable: availability.subAvailable,
              dubAvailable: availability.dubAvailable,
              userSelectedVersion: preferredType,
            });

      const activeStream =
        effectiveType === 'dub'
          ? availability.dubStream
          : effectiveType === 'sub'
          ? availability.subStream
          : null;

      if (!activeStream || !effectiveType) {
        return NextResponse.json(
          {
            ok: false,
            provider,
            format: resolvedFormat,
            error: `No playable Sub or Dub stream is available for Episode ${episode} on ${providerLabel}.`,
            subAvailable: availability.subAvailable,
            dubAvailable: availability.dubAvailable,
            selectedType: null,
            stream: null,
            subStream: null,
            dubStream: null,
          },
          { status: 404 }
        );
      }

      return NextResponse.json({
        ok: true,
        provider,
        format: resolvedFormat,
        subAvailable: availability.subAvailable,
        dubAvailable: availability.dubAvailable,
        selectedType: effectiveType,
        stream: activeStream,
        subStream: availability.subStream,
        dubStream: availability.dubStream,
      });
    }

    const singleType: 'sub' | 'dub' = requestedType || 'sub';
    const stream = await getAniScrollStream(anilistId, episode, singleType, {
      provider,
      format: resolvedFormat,
      isStandaloneMovie,
      hoshikaId: hoshikaIdParam,
    });
    if (!stream) {
      return NextResponse.json(
        {
          ok: false,
          provider,
          format: resolvedFormat,
          error: `Streaming source currently unavailable for Episode ${episode} (${singleType.toUpperCase()}) on ${providerLabel}.`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      provider,
      format: resolvedFormat,
      selectedType: singleType,
      stream,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        provider,
        format: resolvedFormat,
        error: `Failed to retrieve stream from ${providerLabel} provider.`,
      },
      { status: 500 }
    );
  }
}
