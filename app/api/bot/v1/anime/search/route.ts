import { NextRequest, NextResponse } from 'next/server';
import {
  extractBotSecretFromHeaders,
  extractWatchlistMetadataFromHoshikaAnime,
  isValidHoshikaId,
  timingSafeSecretMatch,
} from '@/lib/discord-watchlist-core';
import {
  botRateLimiter,
  getConfiguredBotSecrets,
} from '@/lib/discord-server-store';
import { resolveAnimeDetailById, searchHoshikaDetailed } from '@/lib/hoshika';
import { hoshikaErrorToHttpStatus } from '@/lib/hoshika-client';

/**
 * Bot-authenticated Hoshika search & metadata lookup endpoint:
 * - GET /api/bot/v1/anime/search?q={query}&limit=10
 * - GET /api/bot/v1/anime/search?hoshikaId={shortId}
 *
 * Strictly returns Hoshika shortId and watchlist metadata without official streaming links or AniSkip.
 */
export async function GET(req: NextRequest) {
  const configuredSecrets = getConfiguredBotSecrets();
  const providedSecret = extractBotSecretFromHeaders(req.headers);

  if (!providedSecret) {
    return NextResponse.json(
      {
        ok: false,
        code: 'missing_bot_secret',
        error: 'Missing bot authentication secret.',
      },
      { status: 401 }
    );
  }

  if (!timingSafeSecretMatch(providedSecret, configuredSecrets)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_bot_secret',
        error: 'Invalid bot authentication secret.',
      },
      { status: 401 }
    );
  }

  const rateCheck = botRateLimiter.check('bot:anime:search');
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        ok: false,
        code: 'rate_limited',
        error: 'Too many search requests.',
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) },
      }
    );
  }

  const searchParams = req.nextUrl.searchParams;
  const rawShortId = searchParams.get('hoshikaId') || searchParams.get('shortId');
  const query = searchParams.get('q')?.trim() || '';
  const limit = Math.min(
    10,
    Math.max(1, Number(searchParams.get('limit')) || 10)
  );

  if (rawShortId) {
    if (!isValidHoshikaId(rawShortId)) {
      return NextResponse.json(
        {
          ok: false,
          code: 'invalid_hoshika_id',
          error: 'hoshikaId must be a positive integer Hoshika shortId.',
        },
        { status: 400 }
      );
    }
    const outcome = await resolveAnimeDetailById(Number(rawShortId), 'en');
    if (outcome.status === 'upstream_error') {
      const category = outcome.error?.category || 'UPSTREAM_UNAVAILABLE';
      return NextResponse.json(
        {
          ok: false,
          code: category,
          error: outcome.error?.message || 'Hoshika metadata temporarily unavailable.',
        },
        {
          status: hoshikaErrorToHttpStatus(category, outcome.error?.status),
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        }
      );
    }

    const extracted = outcome.anime
      ? extractWatchlistMetadataFromHoshikaAnime(outcome.anime)
      : null;
    if (!extracted) {
      return NextResponse.json(
        {
          ok: false,
          code: 'anime_not_found',
          error: `Anime #${rawShortId} not found on Hoshika.`,
        },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ok: true,
      anime: extracted,
    });
  }

  if (!query) {
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_payload',
        error: 'Provide either q (search query) or hoshikaId.',
      },
      { status: 400 }
    );
  }

  const searchRes = await searchHoshikaDetailed(query, limit);
  if (!searchRes.ok && searchRes.error) {
    return NextResponse.json(
      {
        ok: false,
        code: searchRes.error.category,
        error: searchRes.error.message,
        items: [],
      },
      {
        status: hoshikaErrorToHttpStatus(searchRes.error.category, searchRes.error.status),
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  }

  const items = searchRes.items
    .map((item) => extractWatchlistMetadataFromHoshikaAnime(item))
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({
    ok: true,
    query,
    items,
  });
}
