import { NextRequest, NextResponse } from 'next/server';
import {
  checkEpisodeStreamAvailabilityDetailed,
  DetailedStreamOutcome,
  getAniScrollStreamDetailed,
} from '@/lib/aniscroll';
import { selectEpisodeAudioVersion } from '@/lib/zokoanime-stream';
import {
  getStreamingProviderDisplayName,
  resolveStreamingProviderForAnime,
} from '@/lib/stream-provider';

function pickAggregateFailureOutcome(
  subOutcome: DetailedStreamOutcome,
  dubOutcome: DetailedStreamOutcome,
  requestedType: 'sub' | 'dub' | null,
  preferredType: 'sub' | 'dub' | null
): {
  httpStatus: 400 | 404 | 429 | 502 | 504;
  errorCode: string;
  upstreamStatus: number | null;
  retryAfterSeconds?: number;
  message: string | null;
} {
  const outcomes = [subOutcome, dubOutcome];
  const preferredOutcome =
    requestedType === 'dub' || preferredType === 'dub'
      ? dubOutcome
      : requestedType === 'sub' || preferredType === 'sub'
      ? subOutcome
      : subOutcome;

  const rateLimited = outcomes.find((o) => o.errorCode === 'rate_limit');
  if (rateLimited) {
    return {
      httpStatus: 429,
      errorCode: 'rate_limit',
      upstreamStatus: rateLimited.upstreamStatus,
      retryAfterSeconds: rateLimited.retryAfterSeconds,
      message: rateLimited.message,
    };
  }

  const timedOut = outcomes.find((o) => o.errorCode === 'timeout');
  if (timedOut) {
    return {
      httpStatus: 504,
      errorCode: 'timeout',
      upstreamStatus: timedOut.upstreamStatus,
      message: timedOut.message,
    };
  }

  const upstreamFailure = outcomes.find(
    (o) =>
      o.errorCode === 'server_error' ||
      o.errorCode === 'invalid_json' ||
      o.errorCode === 'parse_error' ||
      o.errorCode === 'network_error'
  );
  if (upstreamFailure) {
    return {
      httpStatus: 502,
      errorCode: upstreamFailure.errorCode || 'server_error',
      upstreamStatus: upstreamFailure.upstreamStatus,
      message: upstreamFailure.message,
    };
  }

  return {
    httpStatus: preferredOutcome.httpStatus === 200 ? 404 : preferredOutcome.httpStatus,
    errorCode: preferredOutcome.errorCode || 'not_found',
    upstreamStatus: preferredOutcome.upstreamStatus,
    message: preferredOutcome.message,
  };
}

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
      { ok: false, errorCode: 'bad_request', error: 'anilistId is required' },
      { status: 400 }
    );
  }

  const anilistId = parseInt(anilistIdStr, 10);
  const episode = parseInt(episodeStr, 10);

  if (!Number.isFinite(anilistId) || anilistId <= 0 || !Number.isFinite(episode) || episode <= 0) {
    return NextResponse.json(
      { ok: false, errorCode: 'bad_request', error: 'Invalid anilistId or episode number' },
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
      const availability = await checkEpisodeStreamAvailabilityDetailed(
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
        const failure = pickAggregateFailureOutcome(
          availability.subOutcome,
          availability.dubOutcome,
          requestedType,
          preferredType
        );
        const headers: Record<string, string> = {
          'Cache-Control': 'no-store, max-age=0',
        };
        if (failure.httpStatus === 429 && failure.retryAfterSeconds) {
          headers['Retry-After'] = String(failure.retryAfterSeconds);
        }

        return NextResponse.json(
          {
            ok: false,
            provider,
            format: resolvedFormat,
            errorCode: failure.errorCode,
            upstreamStatus: failure.upstreamStatus,
            error:
              failure.message ||
              `No playable Sub or Dub stream is available for Episode ${episode} on ${providerLabel}.`,
            subAvailable: false,
            dubAvailable: false,
            subErrorCode: availability.subOutcome.errorCode,
            dubErrorCode: availability.dubOutcome.errorCode,
            selectedType: null,
            stream: null,
            subStream: null,
            dubStream: null,
          },
          { status: failure.httpStatus, headers }
        );
      }

      return NextResponse.json(
        {
          ok: true,
          provider,
          format: resolvedFormat,
          subAvailable: availability.subAvailable,
          dubAvailable: availability.dubAvailable,
          selectedType: effectiveType,
          stream: activeStream,
          subStream: availability.subStream,
          dubStream: availability.dubStream,
          subErrorCode: availability.subOutcome.errorCode,
          dubErrorCode: availability.dubOutcome.errorCode,
        },
        {
          headers: {
            'Cache-Control': 'no-store, max-age=0',
          },
        }
      );
    }

    const singleType: 'sub' | 'dub' = preferredType || requestedType || 'sub';
    const outcome = await getAniScrollStreamDetailed(anilistId, episode, singleType, {
      provider,
      format: resolvedFormat,
      isStandaloneMovie,
      hoshikaId: hoshikaIdParam,
    });

    if (!outcome.stream) {
      const headers: Record<string, string> = {
        'Cache-Control': 'no-store, max-age=0',
      };
      if (outcome.httpStatus === 429 && outcome.retryAfterSeconds) {
        headers['Retry-After'] = String(outcome.retryAfterSeconds);
      }

      return NextResponse.json(
        {
          ok: false,
          provider,
          format: resolvedFormat,
          errorCode: outcome.errorCode || 'not_found',
          upstreamStatus: outcome.upstreamStatus,
          error:
            outcome.message ||
            `Streaming source currently unavailable for Episode ${episode} (${singleType.toUpperCase()}) on ${providerLabel}.`,
        },
        { status: outcome.httpStatus === 200 ? 404 : outcome.httpStatus, headers }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        provider,
        format: resolvedFormat,
        selectedType: singleType,
        stream: outcome.stream,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        provider,
        format: resolvedFormat,
        errorCode: 'server_error',
        error: `Failed to retrieve stream from ${providerLabel} provider.`,
      },
      { status: 502, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
