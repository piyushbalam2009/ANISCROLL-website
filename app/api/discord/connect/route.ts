import { NextRequest, NextResponse } from 'next/server';
import { verifyServerAuthToken } from '@/lib/firebase-admin';
import {
  DISCORD_OAUTH_NONCE_COOKIE,
} from '@/lib/discord-watchlist-core';
import {
  createDiscordOAuthStateServer,
  recordVerifiedUserGrant,
  resolveDiscordRedirectUri,
} from '@/lib/discord-server-store';

export async function POST(req: NextRequest) {
  const user = await verifyServerAuthToken(req);
  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        code: 'firebase_auth_failed',
        error: 'Authentication required. Please sign in to AniScroll before connecting Discord.',
      },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));

  // Never trust a browser-supplied firebaseUid or discordUserId
  if (
    body &&
    typeof body === 'object' &&
    (('firebaseUid' in body && body.firebaseUid !== user.uid) ||
      ('uid' in body && body.uid !== user.uid))
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: 'firebase_uid_spoofing',
        error: 'Cannot initiate Discord linking for another Firebase account.',
      },
      { status: 403 }
    );
  }

  if (
    body &&
    typeof body === 'object' &&
    ('discordUserId' in body || 'discordId' in body)
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: 'forged_discord_id_rejected',
        error:
          'Discord user ID cannot be supplied by the browser. Identity is verified exclusively through Discord OAuth2.',
      },
      { status: 400 }
    );
  }

  const refreshToken =
    typeof body?.refreshToken === 'string' && body.refreshToken.trim()
      ? body.refreshToken.trim()
      : undefined;

  recordVerifiedUserGrant({
    firebaseUid: user.uid,
    idToken: user.idToken,
    refreshToken,
  });

  const reqOrigin = req.nextUrl.origin;
  const redirectUri = resolveDiscordRedirectUri(reqOrigin);

  const created = await createDiscordOAuthStateServer({
    firebaseUid: user.uid,
    redirectUri,
  });

  if (!created.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: created.code,
        error: created.error,
      },
      { status: created.status }
    );
  }

  const isHttps =
    req.nextUrl.protocol === 'https:' ||
    req.headers.get('x-forwarded-proto') === 'https';

  const res = NextResponse.json({
    ok: true,
    url: created.authorizeUrl,
    authorizeUrl: created.authorizeUrl,
    state: created.state,
    redirectUri,
    expiresAt: created.expiresAt,
  });

  res.cookies.set(DISCORD_OAUTH_NONCE_COOKIE, created.nonce, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
    maxAge: 600,
  });

  return res;
}
