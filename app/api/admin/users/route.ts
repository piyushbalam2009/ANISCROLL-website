import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdminApp, verifyAdminRequest } from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageUsers')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const adminApp = getFirebaseAdminApp();
  if (!adminApp) {
    return NextResponse.json({
      source: 'firestore_only',
      users: [],
    });
  }

  try {
    const listUsersResult = await getAuth(adminApp).listUsers(200);
    const users = listUsersResult.users.map((u) => ({
      uid: u.uid,
      email: u.email || '',
      displayName: u.displayName || u.email?.split('@')[0] || 'AniScroll User',
      photoURL: u.photoURL || '',
      disabled: Boolean(u.disabled),
      provider:
        u.providerData?.[0]?.providerId === 'google.com' ? 'google' : 'password',
      createdAt: u.metadata.creationTime || '',
      lastSignInTime: u.metadata.lastSignInTime || '',
    }));

    return NextResponse.json({
      source: 'firebase_admin',
      users,
    });
  } catch (error) {
    console.warn('firebase-admin listUsers fallback:', error);
    return NextResponse.json({
      source: 'firestore_only',
      users: [],
    });
  }
}

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageUsers')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { action, uid } = body;

  if (!uid || typeof uid !== 'string') {
    return NextResponse.json({ error: 'Missing target user UID' }, { status: 400 });
  }

  const adminApp = getFirebaseAdminApp();
  if (adminApp) {
    try {
      const adminAuth = getAuth(adminApp);
      if (action === 'disable' || action === 'ban') {
        await adminAuth.updateUser(uid, { disabled: true });
      } else if (action === 'enable') {
        await adminAuth.updateUser(uid, { disabled: false });
      } else if (action === 'delete') {
        await adminAuth.deleteUser(uid);
      }
    } catch (err) {
      console.warn('firebase-admin auth user update warning:', err);
    }
  }

  return NextResponse.json({ ok: true, uid, action });
}
