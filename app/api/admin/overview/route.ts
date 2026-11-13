import { NextRequest, NextResponse } from 'next/server';
import {
  listFirestoreCollectionRest,
  runCollectionGroupQueryRest,
  verifyAdminRequest,
} from '@/lib/firebase-admin';
import { adminRoleToUserRole } from '@/lib/roles';
import {
  getDetailedProviderTelemetry,
  getPerfSummaryStats,
  getRecentErrorEvents,
  getTelemetryTimeSeries,
} from '@/lib/perf-monitor';
import { appCache } from '@/lib/cache';
import { getArtworkCacheStats } from '@/lib/artwork/artwork-cache';

type TimeRangeKey = '24h' | '7d' | '30d' | '90d';

const RANGE_MS_MAP: Record<TimeRangeKey, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

function parseTimestampMs(raw: unknown): number | null {
  if (!raw) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof raw === 'object' && raw !== null) {
    const secs = (raw as { seconds?: number }).seconds;
    if (typeof secs === 'number') return secs * 1000;
  }
  return null;
}

function buildRegistrationSeries(
  profiles: Array<{ id: string; data: Record<string, any> }>,
  range: TimeRangeKey
): Array<{ label: string; count: number; cumulative: number }> {
  const days = range === '24h' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;

  const dated: number[] = [];
  for (const p of profiles) {
    const ms =
      parseTimestampMs(p.data?.joinedAt) ??
      parseTimestampMs(p.data?.createdAt);
    if (ms !== null) dated.push(ms);
  }
  if (dated.length === 0) return [];

  const bucketCount = range === '24h' ? 8 : range === '7d' ? 7 : range === '30d' ? 10 : 12;
  const stepMs = (days * 24 * 60 * 60 * 1000) / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, i) => {
    const start = cutoff + i * stepMs;
    const d = new Date(start);
    const label =
      range === '24h'
        ? `${String(d.getHours()).padStart(2, '0')}:00`
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { start, end: start + stepMs, label, count: 0 };
  });

  let priorCount = 0;
  for (const ts of dated) {
    if (ts < cutoff) {
      priorCount++;
      continue;
    }
    const idx = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((ts - cutoff) / stepMs))
    );
    buckets[idx]!.count++;
  }

  let running = priorCount;
  return buckets.map((b) => {
    running += b.count;
    return {
      label: b.label,
      count: b.count,
      cumulative: running,
    };
  });
}

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userRole = adminRoleToUserRole(verified.admin.role);
  const isMod = userRole === 'mod';

  const { searchParams } = new URL(req.url);
  const rawRange = searchParams.get('range') || '7d';
  const range: TimeRangeKey =
    rawRange === '24h' || rawRange === '7d' || rawRange === '30d' || rawRange === '90d'
      ? rawRange
      : '7d';
  const windowMs = RANGE_MS_MAP[range];

  const [publicProfiles, privateProfiles, adminDocs, reportDocs, activityDocs] =
    await Promise.all([
      listFirestoreCollectionRest('publicProfiles', 300, verified.idToken),
      runCollectionGroupQueryRest('profile', 300, verified.idToken),
      listFirestoreCollectionRest('admins', 100, verified.idToken),
      listFirestoreCollectionRest('reports', 200, verified.idToken),
      listFirestoreCollectionRest('adminActivityLogs', 100, verified.idToken),
    ]);

  // Deduplicate users across private/public profiles
  const userMap = new Map<string, { id: string; data: Record<string, any> }>();
  for (const p of privateProfiles) {
    const uid = String(p.data?.uid || '');
    if (uid) userMap.set(uid, { id: uid, data: p.data });
  }
  for (const p of publicProfiles) {
    const uid = String(p.data?.uid || p.id || '');
    if (!uid) continue;
    const existing = userMap.get(uid);
    userMap.set(uid, {
      id: uid,
      data: { ...(existing?.data || {}), ...p.data },
    });
  }

  const allUsers = Array.from(userMap.values());
  const activeUsers = allUsers.filter(
    (u) => (u.data?.status || 'active') === 'active'
  ).length;
  const restrictedUsers = allUsers.filter(
    (u) => u.data?.status === 'disabled' || u.data?.status === 'banned'
  ).length;
  const roleBreakdown = {
    owner: allUsers.filter((u) => u.data?.role === 'owner').length,
    admin: allUsers.filter((u) => u.data?.role === 'admin').length,
    mod: allUsers.filter((u) => u.data?.role === 'mod').length,
    member: allUsers.filter(
      (u) => !u.data?.role || u.data?.role === 'member' || u.data?.role === 'user'
    ).length,
  };

  const openReports = reportDocs.filter(
    (r) => r.data?.status === 'open' || r.data?.status === 'in_review'
  );
  const resolvedReports = reportDocs.filter(
    (r) => r.data?.status === 'resolved' || r.data?.status === 'dismissed'
  );

  const sortedActivity = activityDocs
    .map((d) => d.data)
    .sort((a, b) =>
      String(b.timestamp || '').localeCompare(String(a.timestamp || ''))
    );

  const registrationSeries = buildRegistrationSeries(allUsers, range);

  if (isMod) {
    const modActivity = sortedActivity.filter(
      (a) => a.category === 'moderation' || a.category === 'users'
    );
    return NextResponse.json({
      ok: true,
      range,
      scopedRole: 'mod',
      users: {
        total: allUsers.length,
        active: activeUsers,
        restricted: restrictedUsers,
        roleBreakdown,
        registrationSeries,
      },
      moderation: {
        total: reportDocs.length,
        open: openReports.length,
        resolved: resolvedReports.length,
        recentQueue: openReports.slice(0, 8).map((r) => r.data),
      },
      activity: {
        recent: modActivity.slice(0, 12),
        totalCount: modActivity.length,
      },
    });
  }

  // Full telemetry for Admin & Owner
  const [artworkDocs, announcementDocs, auditDocs, errorDocs, streamingDocs] =
    await Promise.all([
      listFirestoreCollectionRest('animeArtwork', 300, verified.idToken),
      listFirestoreCollectionRest('announcements', 100, verified.idToken),
      listFirestoreCollectionRest('artworkAuditLogs', 100, verified.idToken),
      listFirestoreCollectionRest('errorLogs', 100, verified.idToken),
      listFirestoreCollectionRest('streamingLogs', 100, verified.idToken),
    ]);

  const artworkItems = artworkDocs.map((d) => d.data);
  const totalArtwork = artworkItems.length;
  const validLogos = artworkItems.filter(
    (a) => Boolean(a.selectedLogoUrl) && a.selectedLogoSource !== 'typography_fallback'
  ).length;
  const missingLogos = artworkItems.filter(
    (a) =>
      !a.selectedLogoUrl ||
      a.logoStatus === 'missing' ||
      a.selectedLogoSource === 'typography_fallback'
  ).length;
  const japaneseOnlyLogos = artworkItems.filter(
    (a) => a.selectedLogoLanguage === 'ja' || a.logoStatus === 'japanese_only'
  ).length;
  const customLogos = artworkItems.filter(
    (a) =>
      a.selectedLogoSource === 'custom_upload' ||
      (Array.isArray(a.customLogos) && a.customLogos.length > 0)
  ).length;
  const manualOverrides = artworkItems.filter(
    (a) => a.selectionMode === 'manual'
  ).length;

  const perfSummary = getPerfSummaryStats(windowMs);
  const providerTelemetry = getDetailedProviderTelemetry(
    ['hoshika', 'anilist', 'megaplay', 'zokoanime', 'aniskip', 'fanart'],
    windowMs
  );
  const telemetrySeries = getTelemetryTimeSeries(
    range === '24h' ? 15 : 5,
    12,
    windowMs
  );
  const cacheStats = appCache.getStats();
  const artworkCacheStats = getArtworkCacheStats();
  const recentErrors = getRecentErrorEvents(25);

  const sortedAudits = auditDocs
    .map((d) => d.data)
    .sort((a, b) =>
      String(b.timestamp || '').localeCompare(String(a.timestamp || ''))
    );

  const sortedStreamLogs = streamingDocs
    .map((d) => d.data)
    .sort((a, b) =>
      String(b.checkedAt || '').localeCompare(String(a.checkedAt || ''))
    );

  return NextResponse.json({
    ok: true,
    range,
    scopedRole: userRole,
    users: {
      total: allUsers.length,
      active: activeUsers,
      restricted: restrictedUsers,
      adminsCount: Math.max(1, adminDocs.filter((a) => a.data?.status === 'active').length),
      roleBreakdown,
      registrationSeries,
    },
    artwork: {
      total: totalArtwork,
      validLogos,
      missingLogos,
      japaneseOnlyLogos,
      customLogos,
      manualOverrides,
      autoSelected: Math.max(0, totalArtwork - manualOverrides),
      coveragePct: totalArtwork > 0 ? Math.round((validLogos / totalArtwork) * 100) : 0,
      missingSamples: artworkItems
        .filter(
          (a) =>
            !a.selectedLogoUrl ||
            a.logoStatus === 'missing' ||
            a.selectedLogoSource === 'typography_fallback' ||
            a.logoStatus === 'japanese_only'
        )
        .slice(0, 6),
    },
    announcements: {
      total: announcementDocs.length,
      published: announcementDocs.filter((a) => a.data?.status === 'published').length,
    },
    moderation: {
      total: reportDocs.length,
      open: openReports.length,
      resolved: resolvedReports.length,
      recentQueue: openReports.slice(0, 6).map((r) => r.data),
    },
    telemetry: {
      perfSummary,
      providerTelemetry,
      telemetrySeries,
      cacheStats,
      artworkCacheStats,
      recentStreamLogs: sortedStreamLogs.slice(0, 10),
      storedErrorsCount: errorDocs.length,
      inMemoryErrorsCount: recentErrors.length,
    },
    activity: {
      recent: sortedActivity.slice(0, 10),
      recentArtworkAudits: sortedAudits.slice(0, 8),
      totalCount: sortedActivity.length + sortedAudits.length,
    },
  });
}
