import { NextRequest, NextResponse } from 'next/server';
import { DISCORD_OAUTH_NONCE_COOKIE } from '@/lib/discord-watchlist-core';
import {
  consumeDiscordOAuthStateServer,
  exchangeDiscordCodeForIdentity,
  resolveDiscordRedirectUri,
  saveDiscordAccountLinkServer,
} from '@/lib/discord-server-store';

function wantsJsonResponse(req: NextRequest): boolean {
  const format = req.nextUrl.searchParams.get('format');
  if (format === 'json') return true;
  const accept = req.headers.get('accept') || '';
  if (accept.includes('application/json') && !accept.includes('text/html')) {
    return true;
  }
  return false;
}

function buildCallbackHtmlResponse(params: {
  ok: boolean;
  code: string;
  message: string;
  redirectPath: string;
  discordUsername?: string;
  httpStatus?: number;
}): NextResponse {
  const safePayload = JSON.stringify({
    type: 'ANISCROLL_DISCORD_OAUTH_RESULT',
    ok: params.ok,
    status: params.ok ? 'connected' : 'error',
    code: params.code,
    message: params.message,
    error: params.ok ? null : params.message,
    discordUsername: params.discordUsername || null,
  });
  const safeRedirect = JSON.stringify(params.redirectPath);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AniScroll Discord Verification</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000000;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .card {
      max-width: 420px;
      padding: 28px;
      border-radius: 16px;
      background: #0A0A0A;
      border: 1px solid #292929;
      text-align: center;
    }
    h1 { font-size: 16px; margin: 0 0 8px; }
    p { font-size: 13px; color: #A0A0A0; margin: 0 0 16px; line-height: 1.5; }
    a {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 10px;
      background: #ffffff;
      color: #000000;
      text-decoration: none;
      font-size: 12px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${params.ok ? 'Discord Account Connected' : 'Discord Connection Issue'}</h1>
    <p>${params.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
    <a href="${params.redirectPath}">Return to Account Settings</a>
  </div>
  <script>
    (function () {
      var payload = ${safePayload};
      var redirectUrl = ${safeRedirect};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, '*');
          setTimeout(function () { window.close(); }, 150);
          return;
        }
      } catch (e) {}
      window.location.replace(redirectUrl);
    })();
  </script>
</body>
</html>`;

  const res = new NextResponse(html, {
    status: params.httpStatus ?? (params.ok ? 200 : 400),
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
  res.cookies.delete(DISCORD_OAUTH_NONCE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const oauthError = searchParams.get('error');
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const forgedDiscordId =
    searchParams.get('discordUserId') || searchParams.get('discord_id');

  const jsonMode = wantsJsonResponse(req);

  if (forgedDiscordId) {
    if (jsonMode) {
      return NextResponse.json(
        {
          ok: false,
          code: 'forged_discord_id_rejected',
          error: 'Browser-supplied Discord user IDs are forbidden.',
        },
        { status: 400 }
      );
    }
    return buildCallbackHtmlResponse({
      ok: false,
      code: 'forged_discord_id_rejected',
      message: 'Browser-supplied Discord user IDs are forbidden.',
      redirectPath: '/settings?section=account&discord_error=forged_discord_id_rejected',
      httpStatus: 400,
    });
  }

  if (oauthError) {
    const errDesc =
      searchParams.get('error_description') ||
      'Discord authorization was cancelled or denied.';
    if (jsonMode) {
      return NextResponse.json(
        {
          ok: false,
          code: 'discord_oauth_denied',
          error: errDesc,
        },
        { status: 400 }
      );
    }
    return buildCallbackHtmlResponse({
      ok: false,
      code: 'discord_oauth_denied',
      message: errDesc,
      redirectPath: `/settings?section=account&discord_error=${encodeURIComponent(
        errDesc
      )}`,
      httpStatus: 400,
    });
  }

  const cookieNonce = req.cookies.get(DISCORD_OAUTH_NONCE_COOKIE)?.value || null;
  const stateResult = await consumeDiscordOAuthStateServer({
    state,
    cookieNonce,
  });

  if (!stateResult.ok) {
    if (jsonMode) {
      return NextResponse.json(
        {
          ok: false,
          code: stateResult.code,
          error: stateResult.error,
        },
        { status: stateResult.status }
      );
    }
    return buildCallbackHtmlResponse({
      ok: false,
      code: stateResult.code,
      message: stateResult.error,
      redirectPath: `/settings?section=account&discord_error=${encodeURIComponent(
        stateResult.error
      )}`,
      httpStatus: stateResult.status,
    });
  }

  if (!code || !code.trim()) {
    if (jsonMode) {
      return NextResponse.json(
        {
          ok: false,
          code: 'invalid_authorization_code',
          error: 'Missing Discord authorization code.',
        },
        { status: 400 }
      );
    }
    return buildCallbackHtmlResponse({
      ok: false,
      code: 'invalid_authorization_code',
      message: 'Missing Discord authorization code.',
      redirectPath: '/settings?section=account&discord_error=missing_code',
      httpStatus: 400,
    });
  }

  const redirectUri =
    stateResult.record.redirectUri ||
    resolveDiscordRedirectUri(req.nextUrl.origin);

  const exchangeResult = await exchangeDiscordCodeForIdentity({
    code,
    redirectUri,
  });

  if (!exchangeResult.ok) {
    if (jsonMode) {
      return NextResponse.json(
        {
          ok: false,
          code: exchangeResult.code,
          error: exchangeResult.error,
        },
        { status: exchangeResult.status }
      );
    }
    return buildCallbackHtmlResponse({
      ok: false,
      code: exchangeResult.code,
      message: exchangeResult.error,
      redirectPath: `/settings?section=account&discord_error=${encodeURIComponent(
        exchangeResult.error
      )}`,
      httpStatus: exchangeResult.status,
    });
  }

  const linkResult = await saveDiscordAccountLinkServer({
    firebaseUid: stateResult.record.firebaseUid,
    discordProfile: exchangeResult.identity,
  });

  if (!linkResult.ok) {
    if (jsonMode) {
      return NextResponse.json(
        {
          ok: false,
          code: linkResult.code,
          error: linkResult.error,
        },
        { status: linkResult.status }
      );
    }
    return buildCallbackHtmlResponse({
      ok: false,
      code: linkResult.code,
      message: linkResult.error,
      redirectPath: `/settings?section=account&discord_error=${encodeURIComponent(
        linkResult.error
      )}`,
      httpStatus: linkResult.status,
    });
  }

  if (jsonMode) {
    const res = NextResponse.json({
      ok: true,
      connected: true,
      link: {
        discordUserId: linkResult.link.discordUserId,
        discordUsername: linkResult.link.discordUsername,
        discordGlobalName: linkResult.link.discordGlobalName,
        discordAvatar: linkResult.link.discordAvatar,
        linkedAt: linkResult.link.linkedAt,
        updatedAt: linkResult.link.updatedAt,
      },
    });
    res.cookies.delete(DISCORD_OAUTH_NONCE_COOKIE);
    return res;
  }

  return buildCallbackHtmlResponse({
    ok: true,
    code: 'connected',
    message: `Connected Discord account @${linkResult.link.discordUsername}.`,
    redirectPath: `/settings?section=account&discord=connected&discord_username=${encodeURIComponent(
      linkResult.link.discordUsername
    )}`,
    discordUsername: linkResult.link.discordUsername,
    httpStatus: 200,
  });
}
