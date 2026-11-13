import { NextRequest, NextResponse } from 'next/server';
import { verifyServerAuthToken, writeFirestoreDocumentServer } from '@/lib/firebase-admin';
import { redactSensitiveText } from '@/lib/admin/redaction';

const VALID_TARGET_TYPES = new Set(['user', 'anime', 'episode', 'other']);

export async function POST(req: NextRequest) {
  const user = await verifyServerAuthToken(req);
  if (!user) {
    return NextResponse.json({ error: 'Authentication required to submit a report' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const targetType = VALID_TARGET_TYPES.has(String(body?.targetType))
    ? String(body.targetType)
    : 'other';
  const targetId = String(body?.targetId || '').trim().slice(0, 128);
  const targetName = redactSensitiveText(String(body?.targetName || '').trim(), 300);
  const reason = redactSensitiveText(String(body?.reason || '').trim(), 200);
  const details = redactSensitiveText(String(body?.details || '').trim(), 2000);

  if (!targetId || !reason) {
    return NextResponse.json(
      { error: 'Target ID and report reason are required' },
      { status: 400 }
    );
  }

  const reportId = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await writeFirestoreDocumentServer({
    collectionPath: 'reports',
    docId: reportId,
    data: {
      id: reportId,
      reporterUid: user.uid,
      reporterLabel: redactSensitiveText(user.displayName || 'AniScroll Member', 120),
      targetType,
      targetId,
      ...(targetName ? { targetName } : {}),
      reason,
      ...(details ? { details } : {}),
      status: 'open',
    },
    idToken: user.idToken,
  });

  return NextResponse.json({
    ok: true,
    id: reportId,
    status: 'open',
  });
}
