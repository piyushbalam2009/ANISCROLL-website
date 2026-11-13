import { NextRequest, NextResponse } from 'next/server';
import {
  fetchFirestoreDocumentRest,
  getFirebaseAdminAuth,
  hasFirebaseServiceAccountCredentials,
  listFirestoreCollectionRest,
  verifyAdminRequest,
} from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';
import { adminRoleToUserRole, resolveEffectiveUserRole } from '@/lib/roles';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageUsers')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { uid: rawUid } = await params;
  const uid = (rawUid || '').trim();
  if (!uid || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) {
    return NextResponse.json({ error: 'Invalid user UID' }, { status: 400 });
  }

  const actorRole = adminRoleToUserRole(verified.admin.role);
  const isMod = actorRole === 'mod';

  const [privateProfile, publicProfile, adminDoc, reportsDocs] = await Promise.all([
    fetchFirestoreDocumentRest(`users/${uid}/profile`, 'details', verified.idToken),
    fetchFirestoreDocumentRest('publicProfiles', uid, verified.idToken),
    fetchFirestoreDocumentRest('admins', uid, verified.idToken),
    listFirestoreCollectionRest('reports', 100, verified.idToken),
  ]);

  let authUser: {
    email?: string;
    emailVerified?: boolean;
    disabled?: boolean;
    creationTime?: string;
    lastSignInTime?: string;
    providerId?: string;
  } | null = null;

  const adminAuth = await getFirebaseAdminAuth();
  if (adminAuth) {
    try {
      const u = await adminAuth.getUser(uid);
      authUser = {
        email: u.email || undefined,
        emailVerified: u.emailVerified,
        disabled: u.disabled,
        creationTime: u.metadata.creationTime,
        lastSignInTime: u.metadata.lastSignInTime,
        providerId: u.providerData?.[0]?.providerId,
      };
    } catch {
      authUser = null;
    }
  }

  if (!privateProfile && !publicProfile && !adminDoc && !authUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const email =
    privateProfile?.email || adminDoc?.email || authUser?.email || '';
  const effectiveRole = resolveEffectiveUserRole({
    uid,
    email: email || null,
    profileRole: privateProfile?.role || publicProfile?.role,
    adminRecord: adminDoc
      ? { role: adminDoc.role, status: adminDoc.status }
      : null,
  });

  // Only Admin/Owner with Firebase Admin SDK can list subcollection watch data
  let watchlist: Array<Record<string, any>> = [];
  let watchHistory: Array<Record<string, any>> = [];
  let continueWatching: Array<Record<string, any>> = [];

  const hasAdminSdk = hasFirebaseServiceAccountCredentials() && Boolean(adminAuth);
  if (!isMod && hasAdminSdk) {
    const [wl, wh, cw] = await Promise.all([
      listFirestoreCollectionRest(`users/${uid}/watchlist`, 40),
      listFirestoreCollectionRest(`users/${uid}/watchHistory`, 40),
      listFirestoreCollectionRest(`users/${uid}/continueWatching`, 20),
    ]);
    watchlist = wl.map((d) => d.data);
    watchHistory = wh.map((d) => d.data);
    continueWatching = cw.map((d) => d.data);
  }

  const relatedReports = reportsDocs
    .map((r) => r.data)
    .filter((r) => r.targetId === uid || r.reporterUid === uid)
    .slice(0, 20);

  return NextResponse.json({
    ok: true,
    user: {
      uid,
      displayName:
        publicProfile?.displayName ||
        privateProfile?.displayName ||
        adminDoc?.displayName ||
        'AniScroll Member',
      username: publicProfile?.username || privateProfile?.username || '',
      bio: publicProfile?.bio || privateProfile?.bio || '',
      email: isMod ? undefined : email,
      photoURL: publicProfile?.photoURL || privateProfile?.photoURL || '',
      role: effectiveRole,
      status:
        publicProfile?.status ||
        privateProfile?.status ||
        (authUser?.disabled ? 'disabled' : 'active'),
      provider:
        privateProfile?.provider ||
        (authUser?.providerId === 'google.com' ? 'google' : 'password'),
      privacy: publicProfile?.privacy || privateProfile?.privacy || null,
      stats: publicProfile?.stats || privateProfile?.stats || null,
      joinedAt:
        publicProfile?.joinedAt ||
        privateProfile?.createdAt ||
        authUser?.creationTime ||
        '',
      lastSignInTime: authUser?.lastSignInTime || '',
      emailVerified: authUser?.emailVerified ?? null,
    },
    adminRecord: isMod ? null : adminDoc,
    relatedReports,
    watchDataAvailable: !isMod && hasAdminSdk,
    watchlistCount: watchlist.length,
    watchHistoryCount: watchHistory.length,
    continueWatchingCount: continueWatching.length,
    recentWatchHistory: watchHistory.slice(0, 10),
    watchlistSample: watchlist.slice(0, 10),
  });
}
