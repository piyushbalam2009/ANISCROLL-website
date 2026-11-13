import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  deleteFirestoreDocumentServer,
  fetchFirestoreDocumentServer,
  listFirestoreCollectionRest,
  verifyAdminRequest,
  writeFirestoreDocumentServer,
} from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';
import { logAdminActionServer } from '@/lib/admin/server-audit';

const VALID_TYPES = new Set(['feature', 'maintenance', 'notice', 'alert']);
const VALID_STATUSES = new Set(['draft', 'published', 'scheduled', 'archived']);

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageAnnouncements')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const docs = await listFirestoreCollectionRest('announcements', 100, verified.idToken);
  const items = docs
    .map((d) => ({ ...d.data, id: d.data.id || d.id }))
    .sort((a: any, b: any) => String(b.startsAt || '').localeCompare(String(a.startsAt || '')));

  return NextResponse.json({ ok: true, announcements: items });
}

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageAnnouncements')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const title = String(body?.title || '').trim().slice(0, 200);
  const message = String(body?.message || '').trim().slice(0, 2000);
  const type = VALID_TYPES.has(String(body?.type)) ? String(body.type) : 'notice';
  const status = VALID_STATUSES.has(String(body?.status)) ? String(body.status) : 'draft';
  const priority = body?.priority === 'high' ? 'high' : 'normal';
  const dismissible = body?.dismissible !== false;
  const ctaText = String(body?.ctaText || '').trim().slice(0, 80);
  const ctaLink = String(body?.ctaLink || '').trim().slice(0, 512);
  const startsAt = String(body?.startsAt || new Date().toISOString()).slice(0, 64);
  const expiresAt = String(body?.expiresAt || '').slice(0, 64);

  if (!title) {
    return NextResponse.json({ error: 'Announcement title is required' }, { status: 400 });
  }

  const rawId = typeof body?.id === 'string' && body.id.trim()
    ? body.id.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)
    : `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const existing = await fetchFirestoreDocumentServer('announcements', rawId, verified.idToken);

  const payload = {
    id: rawId,
    title,
    message,
    type,
    status,
    priority,
    dismissible,
    ctaText,
    ctaLink,
    startsAt,
    expiresAt,
    createdByUid: existing?.createdByUid || verified.uid,
    createdByEmail: existing?.createdByEmail || (verified.email || 'admin@aniscroll.app').slice(0, 256),
  };

  await writeFirestoreDocumentServer({
    collectionPath: 'announcements',
    docId: rawId,
    data: payload,
    idToken: verified.idToken,
  });

  try {
    revalidatePath('/');
  } catch {
    // Ignore outside request context
  }

  await logAdminActionServer(verified, {
    category: 'announcements',
    action: existing ? 'Updated announcement' : 'Created announcement',
    targetId: rawId,
    targetName: title,
    details: `Type: ${type}, Status: ${status}, Priority: ${priority}`,
  });

  return NextResponse.json({ ok: true, announcement: payload });
}

export async function DELETE(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageAnnouncements')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = (searchParams.get('id') || '').trim();
  const title = (searchParams.get('title') || id).trim();

  if (!id) {
    return NextResponse.json({ error: 'Announcement id is required' }, { status: 400 });
  }

  await deleteFirestoreDocumentServer({
    collectionPath: 'announcements',
    docId: id,
    idToken: verified.idToken,
  });

  try {
    revalidatePath('/');
  } catch {
    // Ignore outside request context
  }

  await logAdminActionServer(verified, {
    category: 'announcements',
    action: 'Deleted announcement',
    targetId: id,
    targetName: title || id,
    details: `Removed announcement ${id}`,
  });

  return NextResponse.json({ ok: true, id });
}
