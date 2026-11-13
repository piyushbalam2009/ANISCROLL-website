import {
  VerifiedAdminContext,
  writeFirestoreDocumentServer,
} from '@/lib/firebase-admin';
import { AdminActivityCategory } from '@/lib/admin/admin-firestore';
import { redactSensitiveText, sanitizeDiagnosticUrl } from '@/lib/admin/redaction';
import { adminRoleToUserRole } from '@/lib/roles';

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

export async function logAdminActionServer(
  verified: VerifiedAdminContext,
  params: {
    category: AdminActivityCategory;
    action: string;
    targetId: string | number;
    targetName: string;
    details?: string;
    status?: string;
  }
): Promise<void> {
  const id = makeId('act');
  const nowIso = new Date().toISOString();
  const roleLabel = adminRoleToUserRole(verified.admin.role);

  await writeFirestoreDocumentServer({
    collectionPath: 'adminActivityLogs',
    docId: id,
    data: {
      id,
      adminUid: verified.uid,
      adminEmail: (verified.email || 'admin@aniscroll.app').slice(0, 256),
      adminRole: roleLabel,
      category: params.category,
      action: redactSensitiveText(params.action || 'Admin Action', 120) || 'Admin Action',
      targetId: String(params.targetId || 'global').slice(0, 128) || 'global',
      targetName: redactSensitiveText(params.targetName || 'System', 300) || 'System',
      details: redactSensitiveText(params.details || '', 2000),
      status: (params.status || 'success').slice(0, 32),
      timestamp: nowIso,
    },
    idToken: verified.idToken,
    includeUpdatedAt: false,
  }).catch(() => {});
}

export async function logErrorEventServer(
  idToken: string,
  params: {
    severity: 'info' | 'warning' | 'error' | 'critical';
    category: 'api' | 'stream' | 'artwork' | 'auth' | 'database' | 'system';
    provider: string;
    endpoint?: string;
    code?: string;
    statusCode?: number;
    message: string;
  }
): Promise<void> {
  if (!idToken) return;
  const id = makeId('err');
  const nowIso = new Date().toISOString();
  const safeEndpoint = params.endpoint
    ? sanitizeDiagnosticUrl(params.endpoint) || redactSensitiveText(params.endpoint, 512)
    : undefined;

  await writeFirestoreDocumentServer({
    collectionPath: 'errorLogs',
    docId: id,
    data: {
      id,
      severity: params.severity,
      category: params.category,
      provider: redactSensitiveText(params.provider || 'system', 64) || 'system',
      ...(safeEndpoint ? { endpoint: safeEndpoint.slice(0, 512) } : {}),
      ...(params.code ? { code: redactSensitiveText(params.code, 64) } : {}),
      ...(typeof params.statusCode === 'number' && Number.isFinite(params.statusCode)
        ? { statusCode: Math.max(0, Math.round(params.statusCode)) }
        : {}),
      message: redactSensitiveText(params.message || 'Unknown error', 1024) || 'Unknown error',
      timestamp: nowIso,
    },
    idToken,
    includeUpdatedAt: false,
  }).catch(() => {});
}
