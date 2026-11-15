import { NextRequest, NextResponse } from 'next/server';
import { createDevDiscordAuthCode } from '@/lib/discord-server-store';
import { isValidDiscordSnowflake } from '@/lib/discord-watchlist-core';

/**
 * Local/Preview development Discord OAuth2 authorization screen used ONLY when
 * `NODE_ENV !== 'production'` and `DISCORD_CLIENT_ID` is not set.
 * Allows complete end-to-end verification of the 14-step OAuth state + callback flow.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production' && process.env.DISCORD_CLIENT_ID) {
    return NextResponse.json({ ok: false, error: 'Not Found' }, { status: 404 });
  }

  const state = req.nextUrl.searchParams.get('state') || '';
  const redirectUri =
    req.nextUrl.searchParams.get('redirect_uri') ||
    `${req.nextUrl.origin}/api/auth/discord/callback`;

  const customDiscordId = req.nextUrl.searchParams.get('discord_id');
  const discordId =
    customDiscordId && isValidDiscordSnowflake(customDiscordId)
      ? customDiscordId
      : '984512345678901234';
  const username =
    req.nextUrl.searchParams.get('discord_username')?.trim() ||
    'aniscroll_otaku';
  const globalName =
    req.nextUrl.searchParams.get('discord_global_name')?.trim() ||
    'AniScroll Otaku';

  const signedCode = createDevDiscordAuthCode({
    id: discordId,
    username,
    global_name: globalName,
    avatar: null,
  });

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set('code', signedCode);
  callbackUrl.searchParams.set('state', state);

  return NextResponse.redirect(callbackUrl.toString(), 302);
}
