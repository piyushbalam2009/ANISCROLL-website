import { NextRequest, NextResponse } from 'next/server';
import {
  deleteFirestoreDocumentServer,
  fetchFirestoreDocumentRest,
  getFirebaseAdminAuth,
  listFirestoreCollectionRest,
  verifyAdminRequest,
  writeFirestoreDocumentServer,
} from '@/lib/firebase-admin';
import { adminRoleToUserRole, canActorModerateUser, resolveEffectiveUserRole } from '@/lib/roles';
import { redactSensitiveText } from '@/lib/admin/redaction';
import { logAdminActionServer } from '@/lib/admin/server-audit';

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status') || 'all';
  const targetTypeFilter = searchParams.get('targetType') || 'all';

  const docs = await listFirestoreCollectionRest('reports', 200, verified.idToken);
  const allReports: Array<Record<string, any>> = docs
    .map((d): Record<string, any> => ({ ...(d.data || {}), id: d.data?.id || d.id }))
    .sort((a, b) =>
      String(b.createdAt || b.resolvedAt || '').localeCompare(
        String(a.createdAt || a.resolvedAt || '')
      )
    );

  const counts = {
    all: allReports.length,
    open: allReports.filter((r) => r.status === 'open').length,
    in_review: allReports.filter((r) => r.status === 'in_review').length,
    resolved: allReports.filter((r) => r.status === 'resolved').length,
    dismissed: allReports.filter((r) => r.status === 'dismissed').length,
  };

  const filtered = allReports.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (targetTypeFilter !== 'all' && r.targetType !== targetTypeFilter) return false;
    return true;
  });

  return NextResponse.json({
    ok: true,
    counts,
    reports: filtered,
  });
}

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const actorRole = adminRoleToUserRole(verified.admin.role);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || '').trim();
  const reportId = String(body?.reportId || '').trim();

  if (!reportId || !/^[a-zA-Z0-9_-]{1,128}$/.test(reportId)) {
    return NextResponse.json({ error: 'Invalid reportId' }, { status: 400 });
  }

  const existing = await fetchFirestoreDocumentRest(
    'reports',
    reportId,
    verified.idToken
  );

  if (!existing) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  if (action === 'delete_report') {
    if (actorRole !== 'owner') {
      return NextResponse.json(
        { error: 'Only the Owner can delete moderation reports.' },
        { status: 403 }
      );
    }
    const deleted = await deleteFirestoreDocumentServer({
      collectionPath: 'reports',
      docId: reportId,
      idToken: verified.idToken,
    });
    if (!deleted) {
      return NextResponse.json(
        { error: 'Failed to delete report' },
        { status: 500 }
      );
    }
    await logAdminActionServer(verified, {
      category: 'moderation',
      action: 'Deleted moderation report',
      targetId: reportId,
      targetName: existing.targetName || existing.targetId || reportId,
      details: `Removed report ${reportId}`,
    });
    return NextResponse.json({ ok: true, deleted: true, reportId });
  }

  const nextStatus = String(body?.status || '').trim();
  if (!['open', 'in_review', 'resolved', 'dismissed'].includes(nextStatus)) {
    return NextResponse.json(
      { error: 'Invalid report status' },
      { status: 400 }
    );
  }

  const resolutionNote = redactSensitiveText(body?.resolutionNote || '', 1000);
  const moderateAction = body?.moderateUserAction as
    | 'disable'
    | 'ban'
    | 'enable'
    | undefined;
  let actionTaken = redactSensitiveText(
    body?.actionTaken || `marked_${nextStatus}`,
    120
  );

  // Optional chained user moderation when targetType === 'user'
  if (
    moderateAction &&
    ['disable', 'ban', 'enable'].includes(moderateAction) &&
    existing.targetType === 'user' &&
    existing.targetId
  ) {
    const targetUid = String(existing.targetId);
    const [targetPrivate, targetPublic, targetAdmin] = await Promise.all([
      fetchFirestoreDocumentRest(
        `users/${targetUid}/profile`,
        'details',
        verified.idToken
      ),
      fetchFirestoreDocumentRest('publicProfiles', targetUid, verified.idToken),
      fetchFirestoreDocumentRest('admins', targetUid, verified.idToken),
    ]);

    const targetEmail =
      (typeof targetPrivate?.email === 'string' && targetPrivate.email) ||
      (typeof targetAdmin?.email === 'string' && targetAdmin.email) ||
      '';

    const targetCurrentRole = resolveEffectiveUserRole({
      uid: targetUid,
      email: targetEmail || null,
      profileRole: targetPrivate?.role || targetPublic?.role,
      adminRecord: targetAdmin
        ? { role: targetAdmin.role, status: targetAdmin.status }
        : null,
    });

    const modCheck = canActorModerateUser({
      actorRole,
      actorUid: verified.uid,
      targetUid,
      targetEmail,
      targetCurrentRole,
      action: moderateAction,
    });

    if (!modCheck.allowed) {
      return NextResponse.json(
        { error: modCheck.reason || 'Forbidden user moderation action.' },
        { status: 403 }
      );
    }

    const nextUserStatus =
      moderateAction === 'enable'
        ? 'active'
        : moderateAction === 'ban'
        ? 'banned'
        : 'disabled';

    if (targetPrivate) {
      await writeFirestoreDocumentServer({
        collectionPath: `users/${targetUid}/profile`,
        docId: 'details',
        data: {
          ...targetPrivate,
          status: nextUserStatus,
        },
        idToken: verified.idToken,
      }).catch(() => {});
    }
    if (targetPublic) {
      await writeFirestoreDocumentServer({
        collectionPath: 'publicProfiles',
        docId: targetUid,
        data: {
          ...targetPublic,
          status: nextUserStatus,
        },
        idToken: verified.idToken,
      }).catch(() => {});
    }

    const adminAuth = await getFirebaseAdminAuth();
    if (adminAuth) {
      try {
        await adminAuth.updateUser(targetUid, {
          disabled: moderateAction !== 'enable',
        });
      } catch {
        // Non-fatal
      }
    }
    actionTaken = `user_${nextUserStatus}`;
  }

  const nowIso = new Date().toISOString();
  // Strictly preserve existing immutable fields (`id`, `reporterUid`, `targetType`, `targetId`, `reason`)
  // so Firestore rules `affectedKeys().hasOnly(...)` passes cleanly.
  const updatedDoc = {
    ...existing,
    id: existing.id || reportId,
    reporterUid: existing.reporterUid,
    targetType: existing.targetType,
    targetId: existing.targetId,
    reason: existing.reason,
    status: nextStatus,
    actionTaken: actionTaken || `marked_${nextStatus}`,
    resolutionNote,
    resolvedByUid: verified.uid,
    resolvedByEmail: (verified.email || 'staff@aniscroll.app').slice(0, 256),
    resolvedAt: nowIso,
  };

  await writeFirestoreDocumentServer({
    collectionPath: 'reports',
    docId: reportId,
    data: updatedDoc,
    idToken: verified.idToken,
  });

  await logAdminActionServer(verified, {
    category: 'moderation',
    action: `Report ${nextStatus} (${actionTaken})`,
    targetId: reportId,
    targetName: existing.targetName || existing.targetId || reportId,
    details: resolutionNote
      ? `Action: ${actionTaken}. Note: ${resolutionNote}`
      : `Action: ${actionTaken} on ${existing.targetType} ${existing.targetId}`,
  });

  return NextResponse.json({
    ok: true,
    report: updatedDoc,
  });
}
