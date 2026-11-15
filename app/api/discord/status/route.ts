import { NextRequest, NextResponse } from 'next/server';
import { verifyServerAuthToken } from '@/lib/firebase-admin';
import {
  getDiscordLinkByFirebaseUid,
  recordVerifiedUserGrant,
} from '@/lib/discord-server-store';

export async function GET(req: NextRequest) {
  const user = await verifyServerAuthToken(req);
  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        code: 'firebase_auth_failed',
        error: 'Authentication required. Please sign in to AniScroll.',
      },
      { status: 401 }
    );
  }

  const refreshToken = req.headers.get('x-firebase-refresh-token')?.trim() || undefined;
  recordVerifiedUserGrant({
    firebaseUid: user.uid,
    idToken: user.idToken,
    refreshToken,
  });

  const link = await getDiscordLinkByFirebaseUid(user.uid);
  return NextResponse.json({
    ok: true,
    connected: Boolean(link),
    link: link
      ? {
          discordUserId: link.discordUserId,
          discordUsername: link.discordUsername,
          discordGlobalName: link.discordGlobalName,
          discordAvatar: link.discordAvatar,
          linkedAt: link.linkedAt,
          updatedAt: link.updatedAt,
        }
      : null,
  });
}
