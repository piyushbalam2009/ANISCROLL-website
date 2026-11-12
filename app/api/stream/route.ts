import { NextRequest, NextResponse } from 'next/server';
import {
  checkEpisodeStreamAvailability,
  getAniScrollStream,
} from '@/lib/aniscroll';
import { selectEpisodeAudioVersion } from '@/lib/zokoanime-stream';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const anilistIdStr = searchParams.get('anilistId');
  const episodeStr = searchParams.get('episode') || '1';
  const typeParam = searchParams.get('type');
  const preferredTypeParam = searchParams.get('preferredType');
  const checkBoth = searchParams.get('checkBoth') !== 'false';

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

  try {
    if (checkBoth) {
      const availability = await checkEpisodeStreamAvailability(
        anilistId,
        episode,
        preferredType
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
            error: `No playable Sub or Dub stream is available for Episode ${episode}.`,
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
        subAvailable: availability.subAvailable,
        dubAvailable: availability.dubAvailable,
        selectedType: effectiveType,
        stream: activeStream,
        subStream: availability.subStream,
        dubStream: availability.dubStream,
      });
    }

    const singleType: 'sub' | 'dub' = requestedType || 'sub';
    const stream = await getAniScrollStream(anilistId, episode, singleType);
    if (!stream) {
      return NextResponse.json(
        {
          ok: false,
          error: `Streaming source currently unavailable for Episode ${episode} (${singleType.toUpperCase()}).`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      selectedType: singleType,
      stream,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Failed to retrieve stream from ZokoAnime provider.' },
      { status: 500 }
    );
  }
}
