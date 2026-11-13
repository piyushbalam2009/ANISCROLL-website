import { NextRequest, NextResponse } from 'next/server';
import {
  deleteFirestoreDocumentServer,
  fetchFirestoreDocumentRest,
  verifyServerAuthToken,
  writeFirestoreDocumentServer,
} from '@/lib/firebase-admin';
import {
  DEFAULT_PRIVACY_SETTINGS,
  generateDefaultUsername,
  sanitizeBio,
  sanitizeFavouriteAnimeList,
  sanitizePrivacySettings,
  sanitizeRecentActivityList,
  toPublicUserProfile,
  validateUsername,
} from '@/lib/profile-privacy';
import { resolveEffectiveUserRole } from '@/lib/roles';

function sanitizeAvatarUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().slice(0, 1024);
  if (!trimmed) return '';
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }
  return '';
}

export async function GET(req: NextRequest) {
  const user = await verifyServerAuthToken(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const [privateDoc, publicDoc, adminDoc] = await Promise.all([
    fetchFirestoreDocumentRest(
      `users/${user.uid}/profile`,
      'details',
      user.idToken
    ),
    fetchFirestoreDocumentRest('publicProfiles', user.uid, user.idToken),
    fetchFirestoreDocumentRest('admins', user.uid, user.idToken),
  ]);

  const effectiveRole = resolveEffectiveUserRole({
    uid: user.uid,
    email: user.email,
    profileRole: privateDoc?.role || publicDoc?.role,
    adminRecord: adminDoc
      ? { role: adminDoc.role, status: adminDoc.status }
      : null,
  });

  const merged = {
    uid: user.uid,
    displayName:
      privateDoc?.displayName ||
      publicDoc?.displayName ||
      user.displayName ||
      'AniScroll Member',
    email: privateDoc?.email || user.email,
    username:
      privateDoc?.username ||
      publicDoc?.username ||
      generateDefaultUsername({
        displayName: privateDoc?.displayName || user.displayName,
        email: user.email,
        uid: user.uid,
      }),
    bio: sanitizeBio(privateDoc?.bio ?? publicDoc?.bio ?? ''),
    photoURL: privateDoc?.photoURL ?? publicDoc?.photoURL ?? '',
    avatarCharacterId:
      privateDoc?.avatarCharacterId ?? publicDoc?.avatarCharacterId ?? null,
    avatarCharacterName:
      privateDoc?.avatarCharacterName ?? publicDoc?.avatarCharacterName ?? null,
    avatarAnimeName:
      privateDoc?.avatarAnimeName ?? publicDoc?.avatarAnimeName ?? null,
    provider: privateDoc?.provider === 'google' ? 'google' : 'password',
    status: privateDoc?.status || publicDoc?.status || 'active',
    role: effectiveRole,
    privacy: sanitizePrivacySettings(privateDoc?.privacy ?? publicDoc?.privacy),
    favouriteAnime: sanitizeFavouriteAnimeList(
      privateDoc?.favouriteAnime ?? publicDoc?.favouriteAnime
    ),
    stats: privateDoc?.stats ?? publicDoc?.stats ?? null,
    recentActivity: sanitizeRecentActivityList(
      privateDoc?.recentActivity ?? publicDoc?.recentActivity
    ),
    joinedAt:
      privateDoc?.createdAt || publicDoc?.joinedAt || new Date().toISOString(),
  };

  return NextResponse.json({
    ok: true,
    profile: merged,
    publicProfile: toPublicUserProfile(merged, effectiveRole),
  });
}

export async function PATCH(req: NextRequest) {
  const user = await verifyServerAuthToken(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Authentication required.' },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const [existingPrivate, existingPublic, adminDoc] = await Promise.all([
    fetchFirestoreDocumentRest(
      `users/${user.uid}/profile`,
      'details',
      user.idToken
    ),
    fetchFirestoreDocumentRest('publicProfiles', user.uid, user.idToken),
    fetchFirestoreDocumentRest('admins', user.uid, user.idToken),
  ]);

  // Never trust browser-supplied role or status
  const authoritativeRole = resolveEffectiveUserRole({
    uid: user.uid,
    email: user.email,
    profileRole: existingPrivate?.role || existingPublic?.role,
    adminRecord: adminDoc
      ? { role: adminDoc.role, status: adminDoc.status }
      : null,
  });

  const nextDisplayName =
    typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim().slice(0, 120)
      : existingPrivate?.displayName ||
        existingPublic?.displayName ||
        user.displayName ||
        'AniScroll Member';

  const currentUsername =
    existingPrivate?.username ||
    existingPublic?.username ||
    generateDefaultUsername({
      displayName: nextDisplayName,
      email: user.email,
      uid: user.uid,
    });

  let nextUsername = currentUsername;
  if (typeof body.username === 'string') {
    const check = validateUsername(body.username);
    if (!check.valid) {
      return NextResponse.json(
        { ok: false, error: check.error || 'Invalid username.' },
        { status: 400 }
      );
    }
    nextUsername = check.normalized;
  }

  // Enforce uniqueness of username via /usernames/{usernameLower}
  if (nextUsername !== currentUsername || !existingPublic?.username) {
    const existingClaim = await fetchFirestoreDocumentRest(
      'usernames',
      nextUsername,
      user.idToken
    );
    if (existingClaim && existingClaim.uid && existingClaim.uid !== user.uid) {
      return NextResponse.json(
        {
          ok: false,
          error: `Username @${nextUsername} is already taken. Please choose another.`,
        },
        { status: 409 }
      );
    }

    await writeFirestoreDocumentServer({
      collectionPath: 'usernames',
      docId: nextUsername,
      data: {
        uid: user.uid,
        username: nextUsername,
      },
      idToken: user.idToken,
    });

    if (currentUsername && currentUsername !== nextUsername) {
      const oldClaim = await fetchFirestoreDocumentRest(
        'usernames',
        currentUsername,
        user.idToken
      );
      if (oldClaim && oldClaim.uid === user.uid) {
        await deleteFirestoreDocumentServer({
          collectionPath: 'usernames',
          docId: currentUsername,
          idToken: user.idToken,
        });
      }
    }
  }

  const nextBio =
    body.bio !== undefined
      ? sanitizeBio(body.bio)
      : sanitizeBio(existingPrivate?.bio ?? existingPublic?.bio ?? '');

  const nextPhotoURL =
    body.photoURL !== undefined
      ? sanitizeAvatarUrl(body.photoURL)
      : sanitizeAvatarUrl(
          existingPrivate?.photoURL ?? existingPublic?.photoURL ?? ''
        );

  const hasAvatarMeta =
    body.avatarCharacterId !== undefined ||
    body.avatarCharacterName !== undefined ||
    body.avatarAnimeName !== undefined;

  const nextAvatarCharId = hasAvatarMeta
    ? typeof body.avatarCharacterId === 'number' && body.avatarCharacterId > 0
      ? Math.round(body.avatarCharacterId)
      : null
    : existingPrivate?.avatarCharacterId ??
      existingPublic?.avatarCharacterId ??
      null;

  const nextAvatarCharName = hasAvatarMeta
    ? typeof body.avatarCharacterName === 'string' &&
      body.avatarCharacterName.trim()
      ? body.avatarCharacterName.trim().slice(0, 120)
      : null
    : existingPrivate?.avatarCharacterName ??
      existingPublic?.avatarCharacterName ??
      null;

  const nextAvatarAnimeName = hasAvatarMeta
    ? typeof body.avatarAnimeName === 'string' && body.avatarAnimeName.trim()
      ? body.avatarAnimeName.trim().slice(0, 200)
      : null
    : existingPrivate?.avatarAnimeName ??
      existingPublic?.avatarAnimeName ??
      null;

  const nextPrivacy =
    body.privacy !== undefined
      ? sanitizePrivacySettings(body.privacy)
      : sanitizePrivacySettings(
          existingPrivate?.privacy ??
            existingPublic?.privacy ??
            DEFAULT_PRIVACY_SETTINGS
        );

  const nextFavourites =
    body.favouriteAnime !== undefined
      ? sanitizeFavouriteAnimeList(body.favouriteAnime)
      : sanitizeFavouriteAnimeList(
          existingPrivate?.favouriteAnime ?? existingPublic?.favouriteAnime
        );

  const nextStats = existingPrivate?.stats ??
    existingPublic?.stats ?? {
      watchedEpisodes: 0,
      watchlistCount: 0,
      completedCount: 0,
      updatedAt: Date.now(),
    };

  const nextRecentActivity = sanitizeRecentActivityList(
    existingPrivate?.recentActivity ?? existingPublic?.recentActivity
  );

  const joinedAt =
    existingPrivate?.createdAt ||
    existingPublic?.joinedAt ||
    new Date().toISOString();

  const privatePayload: Record<string, any> = {
    uid: user.uid,
    displayName: nextDisplayName,
    username: nextUsername,
    email: existingPrivate?.email || user.email || 'user@aniscroll.app',
    photoURL: nextPhotoURL,
    avatarCharacterId: nextAvatarCharId,
    avatarCharacterName: nextAvatarCharName,
    avatarAnimeName: nextAvatarAnimeName,
    bio: nextBio,
    provider: existingPrivate?.provider === 'google' ? 'google' : 'password',
    status: existingPrivate?.status || 'active',
    role: authoritativeRole,
    privacy: nextPrivacy,
    favouriteAnime: nextFavourites,
    stats: nextStats,
    recentActivity: nextRecentActivity,
    migrationCompleted: Boolean(existingPrivate?.migrationCompleted),
  };

  const publicPayload: Record<string, any> = {
    uid: user.uid,
    username: nextUsername,
    displayName: nextDisplayName,
    bio: nextBio,
    photoURL: nextPhotoURL,
    avatarCharacterId: nextAvatarCharId,
    avatarCharacterName: nextAvatarCharName,
    avatarAnimeName: nextAvatarAnimeName,
    role: authoritativeRole,
    status: existingPrivate?.status || existingPublic?.status || 'active',
    privacy: nextPrivacy,
    favouriteAnime: nextFavourites,
    stats: nextStats,
    recentActivity: nextRecentActivity,
    joinedAt: typeof joinedAt === 'string' ? joinedAt : new Date().toISOString(),
  };

  try {
    await Promise.all([
      writeFirestoreDocumentServer({
        collectionPath: `users/${user.uid}/profile`,
        docId: 'details',
        data: privatePayload,
        idToken: user.idToken,
      }),
      writeFirestoreDocumentServer({
        collectionPath: 'publicProfiles',
        docId: user.uid,
        data: publicPayload,
        idToken: user.idToken,
      }),
    ]);
  } catch (err) {
    console.error('[API /profile PATCH] Failed to persist profile:', err);
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Unable to save profile updates.',
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    profile: privatePayload,
    publicProfile: toPublicUserProfile(publicPayload, authoritativeRole),
  });
}
