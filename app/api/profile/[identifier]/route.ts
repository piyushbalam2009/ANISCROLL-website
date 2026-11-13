import { NextRequest, NextResponse } from 'next/server';
import {
  fetchFirestoreDocumentRest,
  verifyServerAuthToken,
} from '@/lib/firebase-admin';
import {
  filterPublicProfileForViewer,
  toPublicUserProfile,
} from '@/lib/profile-privacy';
import { resolveEffectiveUserRole, UserRole } from '@/lib/roles';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await context.params;
  const cleanId = decodeURIComponent(identifier || '').trim();
  if (!cleanId) {
    return NextResponse.json(
      { ok: false, error: 'Missing profile identifier.' },
      { status: 400 }
    );
  }

  const viewerUser = await verifyServerAuthToken(req);
  let viewerRole: UserRole | null = null;
  if (viewerUser) {
    const viewerAdmin = await fetchFirestoreDocumentRest(
      'admins',
      viewerUser.uid,
      viewerUser.idToken
    );
    viewerRole = resolveEffectiveUserRole({
      uid: viewerUser.uid,
      email: viewerUser.email,
      adminRecord: viewerAdmin
        ? { role: viewerAdmin.role, status: viewerAdmin.status }
        : null,
    });
  }

  const normalizedHandle = cleanId.replace(/^@+/, '').toLowerCase();
  let targetUid = cleanId;

  // Check if identifier resolves via /usernames/{handle}
  if (/^[a-z0-9_]{3,24}$/.test(normalizedHandle)) {
    const usernameDoc = await fetchFirestoreDocumentRest(
      'usernames',
      normalizedHandle,
      viewerUser?.idToken
    );
    if (usernameDoc?.uid) {
      targetUid = String(usernameDoc.uid);
    }
  }

  const [publicDoc, adminDoc] = await Promise.all([
    fetchFirestoreDocumentRest('publicProfiles', targetUid, viewerUser?.idToken),
    fetchFirestoreDocumentRest('admins', targetUid, viewerUser?.idToken).catch(
      () => null
    ),
  ]);

  if (!publicDoc) {
    return NextResponse.json(
      { ok: false, error: 'Profile not found.' },
      { status: 404 }
    );
  }

  const effectiveRole = resolveEffectiveUserRole({
    uid: targetUid,
    profileRole: publicDoc.role,
    adminRecord: adminDoc
      ? { role: adminDoc.role, status: adminDoc.status }
      : null,
  });

  const projected = toPublicUserProfile(publicDoc, effectiveRole);
  const filtered = filterPublicProfileForViewer(projected, {
    uid: viewerUser?.uid || null,
    role: viewerRole,
  });

  if (!filtered.accessible || !filtered.profile) {
    return NextResponse.json(
      {
        ok: false,
        restricted: true,
        error: filtered.reason || 'This profile is private.',
        minimal: {
          uid: projected.uid,
          username: projected.username,
          displayName: projected.displayName,
          role: projected.role,
          privacy: { profileVisibility: projected.privacy.profileVisibility },
        },
      },
      { status: 403 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      isOwner: filtered.isOwnerViewer,
      profile: filtered.profile,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
