import { NextRequest, NextResponse } from 'next/server';
import {
  isValidHoshikaId,
  validateBotWatchlistPatchBody,
  verifyBotRequestEnvelope,
} from '@/lib/discord-watchlist-core';
import {
  botRateLimiter,
  deleteUserWatchlistItemServer,
  getConfiguredBotSecrets,
  getDiscordLinkByDiscordId,
  getUserWatchlistItemServer,
  updateUserWatchlistItemServer,
} from '@/lib/discord-server-store';

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || 'bot';
  return req.headers.get('x-real-ip') || 'bot';
}

function parseHoshikaIdParam(raw: string): number | null {
  const num = Number(raw);
  if (!isValidHoshikaId(num)) return null;
  return num;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ hoshikaId: string }> }
) {
  const { hoshikaId: rawId } = await context.params;
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

  const hoshikaId = parseHoshikaIdParam(rawId);
  if (!hoshikaId) {
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_hoshika_id',
        error: 'hoshikaId URL parameter must be a positive integer Hoshika shortId.',
      },
      { status: 400 }
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

  const itemResult = await getUserWatchlistItemServer(link.firebaseUid, hoshikaId);
  if (!itemResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: itemResult.code,
        error: itemResult.error,
      },
      { status: itemResult.status }
    );
  }

  return NextResponse.json({
    ok: true,
    discordUserId: link.discordUserId,
    item: itemResult.item,
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ hoshikaId: string }> }
) {
  const { hoshikaId: rawId } = await context.params;
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

  const hoshikaId = parseHoshikaIdParam(rawId);
  if (!hoshikaId) {
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_hoshika_id',
        error: 'hoshikaId URL parameter must be a positive integer Hoshika shortId.',
      },
      { status: 400 }
    );
  }

  const validatedPatch = validateBotWatchlistPatchBody(rawBody);
  if (!validatedPatch.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: validatedPatch.code,
        error: validatedPatch.error,
      },
      { status: validatedPatch.status }
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

  const updateResult = await updateUserWatchlistItemServer({
    firebaseUid: link.firebaseUid,
    hoshikaId,
    patch: validatedPatch.patch,
  });

  if (!updateResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: updateResult.code,
        error: updateResult.error,
      },
      { status: updateResult.status }
    );
  }

  return NextResponse.json({
    ok: true,
    discordUserId: link.discordUserId,
    item: updateResult.item,
  });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ hoshikaId: string }> }
) {
  const { hoshikaId: rawId } = await context.params;
  const searchParams = req.nextUrl.searchParams;
  let bodyDiscordId: unknown = undefined;
  let bodyHasFirebaseUid = false;

  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const parsed = await req.json().catch(() => null);
    if (parsed && typeof parsed === 'object') {
      bodyDiscordId = parsed.discordUserId;
      bodyHasFirebaseUid = 'firebaseUid' in parsed || 'uid' in parsed;
    }
  }

  const forbiddenFirebaseUidPresent =
    searchParams.has('firebaseUid') ||
    searchParams.has('uid') ||
    bodyHasFirebaseUid;

  const envelope = verifyBotRequestEnvelope({
    headers: req.headers,
    configuredSecrets: getConfiguredBotSecrets(),
    queryDiscordUserId: searchParams.get('discordUserId'),
    bodyDiscordUserId: bodyDiscordId,
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

  const hoshikaId = parseHoshikaIdParam(rawId);
  if (!hoshikaId) {
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_hoshika_id',
        error: 'hoshikaId URL parameter must be a positive integer Hoshika shortId.',
      },
      { status: 400 }
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

  const delResult = await deleteUserWatchlistItemServer({
    firebaseUid: link.firebaseUid,
    hoshikaId,
  });

  if (!delResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: delResult.code,
        error: delResult.error,
      },
      { status: delResult.status }
    );
  }

  return NextResponse.json({
    ok: true,
    deleted: true,
    discordUserId: link.discordUserId,
    hoshikaId: delResult.hoshikaId,
  });
}
