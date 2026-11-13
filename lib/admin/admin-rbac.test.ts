import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessAdminPathname,
  getAuthorizedNavSections,
  getBreadcrumbForAdminPath,
} from './rbac';
import {
  AdminRecord,
  DEFAULT_ROLE_PERMISSIONS,
} from './admin-permissions';
import {
  redactSensitiveText,
  sanitizeDiagnosticPayload,
  sanitizeDiagnosticUrl,
} from './redaction';
import {
  computePercentile,
  getDetailedProviderTelemetry,
  getTelemetryTimeSeries,
  recordUpstreamMetric,
  resetPerfMetrics,
} from '../perf-monitor';

function makeAdminRecord(
  role: AdminRecord['role'],
  status: AdminRecord['status'] = 'active'
): AdminRecord {
  return {
    uid: `uid_${role}`,
    email: `${role}@aniscroll.app`,
    displayName: role.toUpperCase(),
    role,
    permissions: { ...DEFAULT_ROLE_PERMISSIONS[role] },
    status,
    addedBy: 'owner',
    addedAt: '2026-01-01T00:00:00Z',
    lastLogin: '2026-01-01T00:00:00Z',
  };
}

test('RBAC route guards enforce Member < Mod < Admin < Owner hierarchy', () => {
  // Member has zero access
  assert.equal(canAccessAdminPathname('/admin', null, 'member'), false);
  assert.equal(canAccessAdminPathname('/admin/moderation', null, 'member'), false);
  assert.equal(getAuthorizedNavSections('member', null).length, 0);

  // Mod is strictly scoped to Overview, Users, Moderation, and Activity Logs
  const modRecord = makeAdminRecord('editor');
  assert.equal(canAccessAdminPathname('/admin', modRecord, 'mod'), true);
  assert.equal(canAccessAdminPathname('/admin/users', modRecord, 'mod'), true);
  assert.equal(canAccessAdminPathname('/admin/moderation', modRecord, 'mod'), true);
  assert.equal(canAccessAdminPathname('/admin/activity', modRecord, 'mod'), true);

  assert.equal(canAccessAdminPathname('/admin/admins', modRecord, 'mod'), false);
  assert.equal(canAccessAdminPathname('/admin/settings', modRecord, 'mod'), false);
  assert.equal(canAccessAdminPathname('/admin/errors', modRecord, 'mod'), false);
  assert.equal(canAccessAdminPathname('/admin/cache', modRecord, 'mod'), false);
  assert.equal(canAccessAdminPathname('/admin/anime', modRecord, 'mod'), false);
  assert.equal(canAccessAdminPathname('/admin/artwork', modRecord, 'mod'), false);
  assert.equal(canAccessAdminPathname('/admin/analytics', modRecord, 'mod'), false);

  const modHrefs = getAuthorizedNavSections('mod', modRecord).flatMap((s) =>
    s.items.map((i) => i.href)
  );
  assert.deepEqual(modHrefs, [
    '/admin',
    '/admin/users',
    '/admin/moderation',
    '/admin/activity',
  ]);

  // Admin can access all non-owner operations
  const adminRec = makeAdminRecord('administrator');
  assert.equal(canAccessAdminPathname('/admin/analytics', adminRec, 'admin'), true);
  assert.equal(canAccessAdminPathname('/admin/monitoring', adminRec, 'admin'), true);
  assert.equal(canAccessAdminPathname('/admin/settings', adminRec, 'admin'), true);
  assert.equal(canAccessAdminPathname('/admin/admins', adminRec, 'admin'), true);

  // Revoked admin is blocked
  const revokedRec = makeAdminRecord('administrator', 'revoked');
  assert.equal(canAccessAdminPathname('/admin', revokedRec, 'admin'), false);

  // Owner has full access
  const ownerRec = makeAdminRecord('owner');
  assert.equal(canAccessAdminPathname('/admin/admins', ownerRec, 'owner'), true);
  assert.equal(canAccessAdminPathname('/admin/errors', ownerRec, 'owner'), true);

  // Breadcrumbs
  assert.deepEqual(getBreadcrumbForAdminPath('/admin/artwork/21'), {
    sectionTitle: 'Content Management',
    pageLabel: 'Artwork Studio #21',
  });
  assert.deepEqual(getBreadcrumbForAdminPath('/admin/monitoring'), {
    sectionTitle: 'System Monitoring',
    pageLabel: 'API Health',
  });
});

test('Redaction strips Bearer tokens, JWTs, API keys, and query secrets', () => {
  const rawText =
    'Authorization: Bearer abc123.def456 token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signature123 AIzaSyDummyKeyValue1234567890abcd';
  const redacted = redactSensitiveText(rawText);
  assert.equal(redacted.includes('abc123.def456'), false);
  assert.equal(redacted.includes('eyJhbGciOiJIUzI1NiJ9'), false);
  assert.equal(redacted.includes('AIzaSyDummyKeyValue'), false);

  const sanitizedUrl = sanitizeDiagnosticUrl(
    'https://cdn.example.com/hls/master.m3u8?token=secret_abc&hdntl=signed123&quality=1080p'
  );
  assert.equal(sanitizedUrl.includes('secret_abc'), false);
  assert.equal(sanitizedUrl.includes('signed123'), false);
  assert.equal(sanitizedUrl.includes('quality=1080p'), true);

  const sanitizedObj = sanitizeDiagnosticPayload({
    status: 200,
    authorization: 'Bearer xyz',
    apiKey: 'secret-key',
    nested: {
      url: 'https://api.aniscroll.in/stream?sig=privateSig123',
      provider: 'megaplay',
    },
  }) as Record<string, any>;

  assert.equal(sanitizedObj.authorization, '[REDACTED]');
  assert.equal(sanitizedObj.apiKey, '[REDACTED]');
  assert.equal(sanitizedObj.nested.url.includes('privateSig123'), false);
  assert.equal(sanitizedObj.nested.provider, 'megaplay');
});

test('Perf monitor computes exact p50/p95 percentiles, time series, and provider health', () => {
  resetPerfMetrics();
  assert.equal(computePercentile([], 95), 0);
  assert.equal(computePercentile([10, 20, 30, 40, 100], 50), 30);
  assert.equal(computePercentile([10, 20, 30, 40, 100], 95), 100);

  const now = Date.now();
  recordUpstreamMetric({
    provider: 'megaplay',
    endpoint: '/megaplay/21/1/sub',
    durationMs: 120,
    status: 200,
    fromCache: false,
    timestamp: now - 60_000,
  });
  recordUpstreamMetric({
    provider: 'megaplay',
    endpoint: '/megaplay/21/2/sub',
    durationMs: 240,
    status: 200,
    fromCache: false,
    timestamp: now,
  });
  recordUpstreamMetric({
    provider: 'zokoanime',
    endpoint: '/zokoanime/16498/1/sub',
    durationMs: 500,
    status: 502,
    fromCache: false,
    errorCode: 'server_error',
    timestamp: now,
  });

  const providers = getDetailedProviderTelemetry(['megaplay', 'zokoanime', 'aniskip']);
  const mega = providers.find((p) => p.provider === 'megaplay')!;
  const zoko = providers.find((p) => p.provider === 'zokoanime')!;
  const skip = providers.find((p) => p.provider === 'aniskip')!;

  assert.equal(mega.healthState, 'healthy');
  assert.equal(mega.p50DurationMs, 120);
  assert.equal(mega.p95DurationMs, 240);
  assert.equal(zoko.healthState, 'unavailable');
  assert.equal(skip.healthState, 'unknown');

  const series = getTelemetryTimeSeries(5, 12);
  assert.ok(series.length >= 1);
  assert.equal(series.reduce((acc, b) => acc + b.calls, 0), 3);

  resetPerfMetrics();
});
