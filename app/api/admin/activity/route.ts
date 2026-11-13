import { NextRequest, NextResponse } from 'next/server';
import { listFirestoreCollectionRest, verifyAdminRequest } from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';
import { adminRoleToUserRole } from '@/lib/roles';

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'viewLogs')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const role = adminRoleToUserRole(verified.admin.role);
  const isMod = role === 'mod';

  const { searchParams } = new URL(req.url);
  const category = (searchParams.get('category') || 'all').trim().toLowerCase();
  const q = (searchParams.get('q') || '').trim().toLowerCase();

  const [activityDocs, artworkAuditDocs] = await Promise.all([
    listFirestoreCollectionRest('adminActivityLogs', 150, verified.idToken),
    isMod
      ? Promise.resolve([])
      : listFirestoreCollectionRest('artworkAuditLogs', 120, verified.idToken),
  ]);

  let activityLogs = activityDocs
    .map((d) => ({ ...d.data, id: d.data.id || d.id }))
    .sort((a: any, b: any) =>
      String(b.timestamp || '').localeCompare(String(a.timestamp || ''))
    );

  if (isMod) {
    activityLogs = activityLogs.filter(
      (log: any) => log.category === 'moderation' || log.category === 'users'
    );
  }

  if (category !== 'all') {
    activityLogs = activityLogs.filter(
      (log: any) => String(log.category || '').toLowerCase() === category
    );
  }

  if (q) {
    activityLogs = activityLogs.filter((log: any) =>
      `${log.action || ''} ${log.targetName || ''} ${log.details || ''} ${log.adminEmail || ''}`
        .toLowerCase()
        .includes(q)
    );
  }

  let artworkLogs = isMod
    ? []
    : artworkAuditDocs
        .map((d) => ({ ...d.data, id: d.data.id || d.id }))
        .sort((a: any, b: any) =>
          String(b.timestamp || '').localeCompare(String(a.timestamp || ''))
        );

  if (q && artworkLogs.length > 0) {
    artworkLogs = artworkLogs.filter((log: any) =>
      `${log.animeTitle || ''} ${log.action || ''} ${log.changedByEmail || ''} ${log.hoshikaId || ''}`
        .toLowerCase()
        .includes(q)
    );
  }

  return NextResponse.json({
    ok: true,
    scopedRole: role,
    restrictedArtworkLogs: isMod,
    activityLogs,
    artworkLogs,
  });
}
