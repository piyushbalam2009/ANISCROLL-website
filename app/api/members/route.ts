import { NextRequest, NextResponse } from 'next/server';
import {
  fetchFirestoreDocumentRest,
  listFirestoreCollectionRest,
  queryPublicProfilesRest,
  verifyServerAuthToken,
} from '@/lib/firebase-admin';
import {
  filterPublicProfileForViewer,
  PublicUserProfile,
  toPublicUserProfile,
} from '@/lib/profile-privacy';
import {
  normalizeUserRole,
  resolveEffectiveUserRole,
  USER_ROLE_RANK,
  UserRole,
} from '@/lib/roles';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const queryText = (searchParams.get('q') || '').trim().toLowerCase();
  const roleFilter = (searchParams.get('role') || 'all').trim().toLowerCase();

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

  const rawDocs =
    viewerRole === 'owner' || viewerRole === 'admin'
      ? await listFirestoreCollectionRest(
          'publicProfiles',
          120,
          viewerUser?.idToken
        )
      : await queryPublicProfilesRest(
          viewerUser ? ['public', 'members'] : ['public'],
          120,
          viewerUser?.idToken
        );

  const visibleMembers: PublicUserProfile[] = [];
  for (const item of rawDocs) {
    const projected = toPublicUserProfile(
      item.data,
      normalizeUserRole(item.data.role)
    );
    const filtered = filterPublicProfileForViewer(projected, {
      uid: viewerUser?.uid || null,
      role: viewerRole,
    });
    if (!filtered.accessible || !filtered.profile) continue;

    if (roleFilter !== 'all' && filtered.profile.role !== roleFilter) continue;

    if (queryText) {
      const hay = `${filtered.profile.displayName} ${filtered.profile.username} ${filtered.profile.bio}`.toLowerCase();
      if (!hay.includes(queryText)) continue;
    }

    visibleMembers.push(filtered.profile);
  }

  visibleMembers.sort((a, b) => {
    const rankDiff = USER_ROLE_RANK[b.role] - USER_ROLE_RANK[a.role];
    if (rankDiff !== 0) return rankDiff;
    return a.displayName.localeCompare(b.displayName);
  });

  return NextResponse.json(
    {
      ok: true,
      members: visibleMembers,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
