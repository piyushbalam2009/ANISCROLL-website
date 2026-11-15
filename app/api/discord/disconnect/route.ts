import { NextRequest, NextResponse } from 'next/server';
import { verifyServerAuthToken } from '@/lib/firebase-admin';
import { unlinkDiscordAccountServer } from '@/lib/discord-server-store';

async function handleDisconnect(req: NextRequest) {
  const user = await verifyServerAuthToken(req);
  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        code: 'firebase_auth_failed',
        error: 'Authentication required to disconnect Discord.',
      },
      { status: 401 }
    );
  }

  const result = await unlinkDiscordAccountServer({
    firebaseUid: user.uid,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: result.code,
        error: result.error,
      },
      { status: result.status }
    );
  }

  return NextResponse.json({
    ok: true,
    connected: false,
    unlinkedDiscordUserId: result.unlinkedDiscordUserId,
    message:
      'Discord account disconnected. Your AniScroll watchlist and account data remain preserved.',
  });
}

export async function DELETE(req: NextRequest) {
  return handleDisconnect(req);
}

export async function POST(req: NextRequest) {
  return handleDisconnect(req);
}
