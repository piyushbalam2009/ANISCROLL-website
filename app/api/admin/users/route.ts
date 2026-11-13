import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import {
  deleteFirestoreDocumentServer,
  fetchFirestoreDocumentRest,
  getFirebaseAdminApp,
  listFirestoreCollectionRest,
  runCollectionGroupQueryRest,
  verifyAdminRequest,
  writeFirestoreDocumentServer,
} from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';
import {
  adminRoleToUserRole,
  canActorAssignRole,
  canActorModerateUser,
  getAdminPermissionsForUserRole,
  normalizeUserRole,
  resolveEffectiveUserRole,
  USER_ROLE_RANK,
  UserRole,
  userRoleToAdminRole,
} from '@/lib/roles';
import { generateDefaultUsername } from '@/lib/profile-privacy';
import { logAdminActionServer } from '@/lib/admin/server-audit';

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageUsers')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  const roleFilter = (searchParams.get('role') || 'all').trim().toLowerCase();
  const statusFilter = (searchParams.get('status') || 'all').trim().toLowerCase();
  const sortBy = (searchParams.get('sort') || 'role').trim().toLowerCase();
  const pageParam = searchParams.get('page');
  const limitParam = searchParams.get('limit');

  const [publicProfiles, adminDocs, privateProfiles] = await Promise.all([
    listFirestoreCollectionRest('publicProfiles', 250, verified.idToken),
    listFirestoreCollectionRest('admins', 100, verified.idToken),
    runCollectionGroupQueryRest('profile', 250, verified.idToken),
  ]);

  const adminMap = new Map<string, Record<string, any>>();
  for (const adm of adminDocs) {
    adminMap.set(adm.id, adm.data);
  }

  const merged = new Map<string, Record<string, any>>();

  for (const doc of privateProfiles) {
    const d = doc.data;
    const uid = String(d.uid || '');
    if (!uid) continue;
    const adm = adminMap.get(uid);
    const effectiveRole = resolveEffectiveUserRole({
      uid,
      email: d.email || adm?.email || null,
      profileRole: d.role,
      adminRecord: adm ? { role: adm.role, status: adm.status } : null,
    });
    merged.set(uid, {
      uid,
      displayName: d.displayName || 'AniScroll Member',
      username:
        d.username ||
        generateDefaultUsername({
          displayName: d.displayName,
          email: d.email,
          uid,
        }),
      email: d.email || adm?.email || '',
      photoURL: d.photoURL || '',
      provider: d.provider || 'password',
      status: d.status || d.accountStatus || 'active',
      role: effectiveRole,
      createdAt: d.createdAt || '',
      lastSignInTime: '',
    });
  }

  for (const doc of publicProfiles) {
    const d = doc.data;
    const uid = String(d.uid || doc.id);
    if (!uid) continue;
    const existing = merged.get(uid);
    const adm = adminMap.get(uid);
    const effectiveRole = resolveEffectiveUserRole({
      uid,
      email: existing?.email || adm?.email || null,
      profileRole: d.role || existing?.role,
      adminRecord: adm ? { role: adm.role, status: adm.status } : null,
    });
    merged.set(uid, {
      uid,
      displayName: d.displayName || existing?.displayName || 'AniScroll Member',
      username: d.username || existing?.username || '',
      email: existing?.email || adm?.email || '',
      photoURL: d.photoURL || existing?.photoURL || '',
      provider: existing?.provider || 'password',
      status: d.status || existing?.status || 'active',
      role: effectiveRole,
      createdAt: d.joinedAt || existing?.createdAt || d.createdAt || '',
      lastSignInTime: existing?.lastSignInTime || '',
    });
  }

  const adminApp = getFirebaseAdminApp();
  let source = 'firestore_only';
  if (adminApp) {
    try {
      const listUsersResult = await getAuth(adminApp).listUsers(250);
      source = 'firebase_admin';
      for (const u of listUsersResult.users) {
        const existing = merged.get(u.uid);
        const adm = adminMap.get(u.uid);
        const effectiveRole = resolveEffectiveUserRole({
          uid: u.uid,
          email: u.email || null,
          profileRole: existing?.role,
          adminRecord: adm ? { role: adm.role, status: adm.status } : null,
        });
        merged.set(u.uid, {
          uid: u.uid,
          email: u.email || existing?.email || '',
          displayName:
            existing?.displayName ||
            u.displayName ||
            u.email?.split('@')[0] ||
            'AniScroll Member',
          username: existing?.username || '',
          photoURL: existing?.photoURL || u.photoURL || '',
          disabled: Boolean(u.disabled),
          status: existing?.status || (u.disabled ? 'disabled' : 'active'),
          role: effectiveRole,
          provider:
            u.providerData?.[0]?.providerId === 'google.com'
              ? 'google'
              : 'password',
          createdAt: existing?.createdAt || u.metadata.creationTime || '',
          lastSignInTime: u.metadata.lastSignInTime || '',
        });
      }
    } catch (error) {
      console.warn('firebase-admin listUsers fallback:', error);
    }
  }

  let users = Array.from(merged.values());

  if (q) {
    users = users.filter((u) => {
      const hay = `${u.displayName || ''} ${u.username || ''} ${u.email || ''} ${u.uid || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }

  if (roleFilter !== 'all') {
    users = users.filter((u) => normalizeUserRole(u.role) === roleFilter);
  }

  if (statusFilter !== 'all') {
    users = users.filter((u) => String(u.status || 'active').toLowerCase() === statusFilter);
  }

  users.sort((a, b) => {
    if (sortBy === 'name') {
      return String(a.displayName || '').localeCompare(String(b.displayName || ''));
    }
    if (sortBy === 'recent') {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    }
    const rankDiff =
      USER_ROLE_RANK[normalizeUserRole(b.role)] -
      USER_ROLE_RANK[normalizeUserRole(a.role)];
    if (rankDiff !== 0) return rankDiff;
    return String(a.displayName || '').localeCompare(String(b.displayName || ''));
  });

  const total = users.length;
  if (pageParam || limitParam) {
    const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitParam || '25', 10) || 25));
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const paged = users.slice((safePage - 1) * limit, safePage * limit);
    return NextResponse.json({
      source,
      users: paged,
      total,
      page: safePage,
      limit,
      totalPages,
    });
  }

  return NextResponse.json({
    source,
    users,
    total,
    page: 1,
    limit: total || 25,
    totalPages: 1,
  });
}

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageUsers')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { action, uid, role: rawNextRole, email: targetEmailBody, displayName: targetNameBody } = body;

  if (!uid || typeof uid !== 'string') {
    return NextResponse.json({ error: 'Missing target user UID' }, { status: 400 });
  }

  const actorRole: UserRole = adminRoleToUserRole(verified.admin.role);

  const [targetPrivate, targetPublic, targetAdmin] = await Promise.all([
    fetchFirestoreDocumentRest(`users/${uid}/profile`, 'details', verified.idToken),
    fetchFirestoreDocumentRest('publicProfiles', uid, verified.idToken),
    fetchFirestoreDocumentRest('admins', uid, verified.idToken),
  ]);

  const targetEmail =
    (typeof targetPrivate?.email === 'string' && targetPrivate.email) ||
    (typeof targetAdmin?.email === 'string' && targetAdmin.email) ||
    (typeof targetEmailBody === 'string' && targetEmailBody) ||
    '';

  const targetCurrentRole = resolveEffectiveUserRole({
    uid,
    email: targetEmail || null,
    profileRole: targetPrivate?.role || targetPublic?.role,
    adminRecord: targetAdmin
      ? { role: targetAdmin.role, status: targetAdmin.status }
      : null,
  });

  if (action === 'set_role') {
    const nextRole = normalizeUserRole(rawNextRole);
    if (!['member', 'mod', 'admin', 'owner'].includes(String(rawNextRole || '').toLowerCase())) {
      return NextResponse.json({ error: 'Invalid target role.' }, { status: 400 });
    }

    const permissionCheck = canActorAssignRole({
      actorRole,
      actorUid: verified.uid,
      targetUid: uid,
      targetEmail,
      targetCurrentRole,
      targetNextRole: nextRole,
    });

    if (!permissionCheck.allowed) {
      return NextResponse.json(
        { error: permissionCheck.reason || 'Forbidden role assignment.' },
        { status: 403 }
      );
    }

    const nowIso = new Date().toISOString();
    const resolvedDisplayName =
      targetPrivate?.displayName ||
      targetPublic?.displayName ||
      targetAdmin?.displayName ||
      (typeof targetNameBody === 'string' && targetNameBody.trim()) ||
      targetEmail.split('@')[0] ||
      'AniScroll Member';

    const resolvedUsername =
      targetPrivate?.username ||
      targetPublic?.username ||
      generateDefaultUsername({
        displayName: resolvedDisplayName,
        email: targetEmail,
        uid,
      });

    // 1. Update /users/{uid}/profile/details if present
    if (targetPrivate) {
      await writeFirestoreDocumentServer({
        collectionPath: `users/${uid}/profile`,
        docId: 'details',
        data: {
          ...targetPrivate,
          role: nextRole,
        },
        idToken: verified.idToken,
      });
    }

    // 2. Update /publicProfiles/{uid} (creating projection if user hasn't opened profile yet)
    await writeFirestoreDocumentServer({
      collectionPath: 'publicProfiles',
      docId: uid,
      data: {
        uid,
        username: resolvedUsername,
        displayName: resolvedDisplayName,
        bio: targetPublic?.bio || targetPrivate?.bio || '',
        photoURL: targetPublic?.photoURL || targetPrivate?.photoURL || '',
        avatarCharacterId:
          targetPublic?.avatarCharacterId ?? targetPrivate?.avatarCharacterId ?? null,
        avatarCharacterName:
          targetPublic?.avatarCharacterName ?? targetPrivate?.avatarCharacterName ?? null,
        avatarAnimeName:
          targetPublic?.avatarAnimeName ?? targetPrivate?.avatarAnimeName ?? null,
        role: nextRole,
        status: targetPublic?.status || targetPrivate?.status || 'active',
        privacy: targetPublic?.privacy ||
          targetPrivate?.privacy || {
            profileVisibility: 'public',
            showWatchHistory: true,
            showWatchlist: true,
            showActivity: true,
          },
        favouriteAnime: targetPublic?.favouriteAnime || targetPrivate?.favouriteAnime || [],
        stats: targetPublic?.stats ||
          targetPrivate?.stats || {
            watchedEpisodes: 0,
            watchlistCount: 0,
            completedCount: 0,
            updatedAt: Date.now(),
          },
        recentActivity: targetPublic?.recentActivity || targetPrivate?.recentActivity || [],
        joinedAt: targetPublic?.joinedAt || targetPrivate?.createdAt || nowIso,
      },
      idToken: verified.idToken,
    });

    // 3. Synchronize /admins/{uid} RBAC record
    const mappedAdminRole = userRoleToAdminRole(nextRole);
    if (mappedAdminRole) {
      const perms = getAdminPermissionsForUserRole(nextRole)!;
      await writeFirestoreDocumentServer({
        collectionPath: 'admins',
        docId: uid,
        data: {
          uid,
          email: (targetEmail || `${uid}@aniscroll.app`).toLowerCase(),
          displayName: resolvedDisplayName,
          role: mappedAdminRole,
          permissions: perms,
          status: 'active',
          addedBy: targetAdmin?.addedBy || verified.email || verified.uid,
          addedAt: targetAdmin?.addedAt || nowIso,
          lastLogin: targetAdmin?.lastLogin || nowIso,
        },
        idToken: verified.idToken,
      });
    } else if (targetAdmin) {
      await deleteFirestoreDocumentServer({
        collectionPath: 'admins',
        docId: uid,
        idToken: verified.idToken,
      });
    }

    // 4. Immutable activity log
    const logId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await writeFirestoreDocumentServer({
      collectionPath: 'adminActivityLogs',
      docId: logId,
      data: {
        id: logId,
        adminUid: verified.uid,
        adminEmail: verified.email || 'admin@aniscroll.app',
        category: 'users',
        action: `Changed user role (${targetCurrentRole} -> ${nextRole})`,
        targetId: uid,
        targetName: targetEmail || resolvedDisplayName,
        details: `Updated role for ${resolvedDisplayName} (${uid}) from ${targetCurrentRole} to ${nextRole}`,
        timestamp: nowIso,
      },
      idToken: verified.idToken,
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      uid,
      role: nextRole,
    });
  }

  // Moderation actions: disable | ban | enable | delete
  const modCheck = canActorModerateUser({
    actorRole,
    actorUid: verified.uid,
    targetUid: uid,
    targetEmail,
    targetCurrentRole,
    action: action as 'disable' | 'ban' | 'enable' | 'delete',
  });

  if (!modCheck.allowed) {
    return NextResponse.json(
      { error: modCheck.reason || 'Forbidden moderation action.' },
      { status: 403 }
    );
  }

  const nextStatus =
    action === 'enable'
      ? 'active'
      : action === 'ban'
      ? 'banned'
      : action === 'disable'
      ? 'disabled'
      : null;

  if (nextStatus) {
    if (targetPrivate) {
      await writeFirestoreDocumentServer({
        collectionPath: `users/${uid}/profile`,
        docId: 'details',
        data: {
          ...targetPrivate,
          status: nextStatus,
        },
        idToken: verified.idToken,
      }).catch(() => {});
    }
    if (targetPublic) {
      await writeFirestoreDocumentServer({
        collectionPath: 'publicProfiles',
        docId: uid,
        data: {
          ...targetPublic,
          status: nextStatus,
        },
        idToken: verified.idToken,
      }).catch(() => {});
    }
  } else if (action === 'delete') {
    await Promise.all([
      deleteFirestoreDocumentServer({
        collectionPath: `users/${uid}/profile`,
        docId: 'details',
        idToken: verified.idToken,
      }),
      deleteFirestoreDocumentServer({
        collectionPath: 'publicProfiles',
        docId: uid,
        idToken: verified.idToken,
      }),
      targetAdmin
        ? deleteFirestoreDocumentServer({
            collectionPath: 'admins',
            docId: uid,
            idToken: verified.idToken,
          })
        : Promise.resolve(true),
    ]).catch(() => {});
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

  await logAdminActionServer(verified, {
    category: 'users',
    action: `${action === 'enable' ? 'Re-enabled' : action === 'ban' ? 'Banned' : action === 'disable' ? 'Disabled' : 'Deleted'} user account`,
    targetId: uid,
    targetName:
      targetEmail ||
      targetPublic?.displayName ||
      targetPrivate?.displayName ||
      uid,
    details: `Executed ${action} action on ${uid} (role: ${targetCurrentRole})`,
  });

  return NextResponse.json({ ok: true, uid, action });
}
