import { NextRequest, NextResponse } from 'next/server';
import {
  deleteFirestoreDocumentServer,
  listFirestoreCollectionRest,
  verifyAdminRequest,
} from '@/lib/firebase-admin';
import { adminRoleToUserRole } from '@/lib/roles';
import { getRecentErrorEvents } from '@/lib/perf-monitor';
import { redactSensitiveText } from '@/lib/admin/redaction';
import { logAdminActionServer } from '@/lib/admin/server-audit';

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = adminRoleToUserRole(verified.admin.role);
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json(
      { error: 'Error logs are restricted to Owner and Admin accounts.' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const severity = (searchParams.get('severity') || 'all').toLowerCase();
  const category = (searchParams.get('category') || 'all').toLowerCase();
  const provider = (searchParams.get('provider') || 'all').toLowerCase();
  const q = (searchParams.get('q') || '').trim().toLowerCase();

  const [storedDocs, inMemory] = await Promise.all([
    listFirestoreCollectionRest('errorLogs', 150, verified.idToken),
    Promise.resolve(getRecentErrorEvents(100)),
  ]);

  const combined = new Map<string, Record<string, any>>();

  for (const doc of storedDocs) {
    const d = doc.data || {};
    const id = String(d.id || doc.id);
    combined.set(id, {
      id,
      source: 'firestore',
      severity: String(d.severity || 'error'),
      category: String(d.category || 'system'),
      provider: redactSensitiveText(d.provider || 'system', 64),
      endpoint: redactSensitiveText(d.endpoint || '', 512),
      code: redactSensitiveText(d.code || '', 64),
      statusCode: typeof d.statusCode === 'number' ? d.statusCode : null,
      message: redactSensitiveText(d.message || 'Recorded error', 1024),
      timestamp: String(d.timestamp || ''),
    });
  }

  for (const ev of inMemory) {
    if (combined.has(ev.id)) continue;
    combined.set(ev.id, {
      id: ev.id,
      source: 'runtime',
      severity: ev.code === 'server_error' || ev.code === 'timeout' ? 'error' : 'warning',
      category:
        ev.provider === 'megaplay' || ev.provider === 'zokoanime'
          ? 'stream'
          : ev.provider === 'fanart'
          ? 'artwork'
          : 'api',
      provider: redactSensitiveText(ev.provider, 64),
      endpoint: redactSensitiveText(ev.endpoint, 512),
      code: redactSensitiveText(ev.code, 64),
      statusCode: ev.status,
      message: redactSensitiveText(ev.message, 1024),
      timestamp: new Date(ev.timestamp).toISOString(),
    });
  }

  let logs = Array.from(combined.values()).sort((a, b) =>
    String(b.timestamp || '').localeCompare(String(a.timestamp || ''))
  );

  if (severity !== 'all') {
    logs = logs.filter((l) => l.severity.toLowerCase() === severity);
  }
  if (category !== 'all') {
    logs = logs.filter((l) => l.category.toLowerCase() === category);
  }
  if (provider !== 'all') {
    logs = logs.filter((l) => l.provider.toLowerCase() === provider);
  }
  if (q) {
    logs = logs.filter((l) =>
      `${l.message} ${l.provider} ${l.endpoint} ${l.code}`.toLowerCase().includes(q)
    );
  }

  return NextResponse.json({
    ok: true,
    total: logs.length,
    logs,
  });
}

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = adminRoleToUserRole(verified.admin.role);
  if (role !== 'owner') {
    return NextResponse.json(
      { error: 'Only Owner can delete stored error logs.' },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || '');

  if (action === 'delete' && body?.id) {
    await deleteFirestoreDocumentServer({
      collectionPath: 'errorLogs',
      docId: String(body.id),
      idToken: verified.idToken,
    });
    await logAdminActionServer(verified, {
      category: 'errors',
      action: 'Deleted error log entry',
      targetId: String(body.id),
      targetName: String(body.id),
      details: `Owner removed stored error log ${String(body.id)}`,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === 'clear') {
    const storedDocs = await listFirestoreCollectionRest('errorLogs', 150, verified.idToken);
    await Promise.all(
      storedDocs.map((d) =>
        deleteFirestoreDocumentServer({
          collectionPath: 'errorLogs',
          docId: d.id,
          idToken: verified.idToken,
        })
      )
    );
    await logAdminActionServer(verified, {
      category: 'errors',
      action: 'Cleared stored error logs',
      targetId: 'errorLogs',
      targetName: 'System Error Logs',
      details: `Owner cleared ${storedDocs.length} stored error logs`,
    });
    return NextResponse.json({ ok: true, deletedCount: storedDocs.length });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
