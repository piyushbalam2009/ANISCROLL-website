import { NextRequest, NextResponse } from 'next/server';
import {
  filterSortPaginateWatchlist,
  validateBotWatchlistPostBody,
  verifyBotRequestEnvelope,
} from '@/lib/discord-watchlist-core';
import {
  addUserWatchlistItemServer,
  botRateLimiter,
  getConfiguredBotSecrets,
  getDiscordLinkByDiscordId,
  listUserWatchlistServer,
} from '@/lib/discord-server-store';

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || 'bot';
  return req.headers.get('x-real-ip') || 'bot';
}

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const forbiddenFirebaseUidPresent =
    searchParams.has('firebaseUid') || searchParams.has('uid');

  const envelope = verifyBotRequestEnvelope({
    headers: req.headers,
    configuredSecrets: getConfiguredBotSecrets(),
    queryDiscordUserId: searchParams.get('discordUserId'),
    forbiddenFirebaseUidPresent,
    rateLimiter: botRateLimiter,
    clientIp: getClientIp(req),
  });

  if (!envelope.ok) {
    const headers: Record<string, string> = {};
    if (envelope.retryAfterSeconds) {
      headers['Retry-After'] = String(envelope.retryAfterSeconds);
    }
    return NextResponse.json(
      {
        ok: false,
        code: envelope.code,
        error: envelope.error,
      },
      { status: envelope.status, headers }
    );
  }

  const link = await getDiscordLinkByDiscordId(envelope.discordUserId);
  if (!link) {
    return NextResponse.json(
      {
        ok: false,
        code: 'unlinked_discord_account',
        error:
          'This Discord account is not linked to an AniScroll account. Please connect Discord in your AniScroll Account Settings.',
      },
      { status: 404 }
    );
  }

  const listResult = await listUserWatchlistServer(link.firebaseUid);
  if (!listResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: listResult.code,
        error: listResult.error,
      },
      { status: listResult.status }
    );
  }

  const paged = filterSortPaginateWatchlist(listResult.items, {
    status: searchParams.get('status'),
    sort: searchParams.get('sort'),
    page: searchParams.get('page'),
    limit: searchParams.get('limit') || searchParams.get('perPage'),
  });

  if (!paged.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: paged.code,
        error: paged.error,
      },
      { status: paged.status }
    );
  }

  return NextResponse.json({
    ok: true,
    discordUserId: link.discordUserId,
    discordUsername: link.discordUsername,
    items: paged.items,
    pagination: paged.pagination,
    counts: paged.counts,
  });
}

export async function POST(req: NextRequest) {
  let rawBody: any = null;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_payload',
        error: 'Request body must be valid JSON.',
      },
      { status: 400 }
    );
  }

  const searchParams = req.nextUrl.searchParams;
  const forbiddenFirebaseUidPresent =
    searchParams.has('firebaseUid') ||
    searchParams.has('uid') ||
    (rawBody &&
      typeof rawBody === 'object' &&
      ('firebaseUid' in rawBody || 'uid' in rawBody));

  const envelope = verifyBotRequestEnvelope({
    headers: req.headers,
    configuredSecrets: getConfiguredBotSecrets(),
    queryDiscordUserId: searchParams.get('discordUserId'),
    bodyDiscordUserId: rawBody?.discordUserId,
    forbiddenFirebaseUidPresent,
    rateLimiter: botRateLimiter,
    clientIp: getClientIp(req),
  });

  if (!envelope.ok) {
    const headers: Record<string, string> = {};
    if (envelope.retryAfterSeconds) {
      headers['Retry-After'] = String(envelope.retryAfterSeconds);
    }
    return NextResponse.json(
      {
        ok: false,
        code: envelope.code,
        error: envelope.error,
      },
      { status: envelope.status, headers }
    );
  }

  const validatedBody = validateBotWatchlistPostBody(rawBody);
  if (!validatedBody.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: validatedBody.code,
        error: validatedBody.error,
      },
      { status: validatedBody.status }
    );
  }

  const link = await getDiscordLinkByDiscordId(envelope.discordUserId);
  if (!link) {
    return NextResponse.json(
      {
        ok: false,
        code: 'unlinked_discord_account',
        error:
          'This Discord account is not linked to an AniScroll account. Please connect Discord in your AniScroll Account Settings.',
      },
      { status: 404 }
    );
  }

  const createResult = await addUserWatchlistItemServer({
    firebaseUid: link.firebaseUid,
    hoshikaId: validatedBody.hoshikaId,
    query: validatedBody.query,
    status: validatedBody.status,
    episodeProgress: validatedBody.episodeProgress,
  });

  if (!createResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: createResult.code,
        error: createResult.error,
      },
      { status: createResult.status }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      discordUserId: link.discordUserId,
      item: createResult.item,
    },
    { status: 201 }
  );
}
