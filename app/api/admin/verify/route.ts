import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/firebase-admin';

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified) {
    return NextResponse.json(
      { authorized: false, error: 'Forbidden: Administrator access required' },
      { status: 403 }
    );
  }

  return NextResponse.json({
    authorized: true,
    admin: verified.admin,
    user: {
      uid: verified.user.uid,
      email: verified.user.email,
      displayName: verified.user.displayName,
      emailVerified: verified.user.emailVerified,
    },
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
