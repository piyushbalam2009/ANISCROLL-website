import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { verifyAdminRequest } from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';
import { appCache } from '@/lib/cache';
import {
  getArtworkCacheStats,
  invalidateCachedArtwork,
} from '@/lib/artwork/artwork-cache';
import { invalidateHoshikaCacheForAnime } from '@/lib/hoshika';
import { getHoshikaClientStatus } from '@/lib/hoshika-client';
import { logAdminActionServer } from '@/lib/admin/server-audit';

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageSettings')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const stats = appCache.getStats();
  const totalLookups = stats.hits + stats.staleHits + stats.misses;
  const hitRatePct =
    totalLookups > 0
      ? Math.round(((stats.hits + stats.staleHits) / totalLookups) * 100)
      : 0;

  return NextResponse.json({
    ok: true,
    stats,
    hitRatePct,
    inFlightCount: appCache.getInFlightCount(),
    artworkCache: getArtworkCacheStats(),
    hoshikaStatus: getHoshikaClientStatus(),
    diagnostics: appCache.getDiagnostics(60).reverse(),
  });
}

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageSettings')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const scope = String(body?.scope || 'all');
  const hoshikaId = body?.hoshikaId ? Number(body.hoshikaId) : undefined;

  let clearedCount = 0;

  if (scope === 'all') {
    clearedCount = appCache.getStats().size;
    appCache.clear();
    invalidateCachedArtwork();
  } else if (scope === 'artwork') {
    clearedCount = getArtworkCacheStats().resolvedSize + getArtworkCacheStats().overrideSize;
    invalidateCachedArtwork(
      hoshikaId && Number.isFinite(hoshikaId) ? hoshikaId : undefined
    );
  } else if (scope === 'catalog') {
    clearedCount = invalidateHoshikaCacheForAnime(undefined, true);
  } else if (scope === 'anime') {
    if (hoshikaId && Number.isFinite(hoshikaId)) {
      clearedCount = invalidateHoshikaCacheForAnime(hoshikaId, true);
      invalidateCachedArtwork(hoshikaId);
    } else {
      clearedCount = appCache.invalidateByPrefix('hoshika:/anime/');
    }
  } else if (scope === 'episodes') {
    if (hoshikaId && Number.isFinite(hoshikaId)) {
      clearedCount = appCache.invalidateByPrefix(`hoshika:all_episodes:${hoshikaId}:`);
      clearedCount += appCache.invalidateByPrefix(`hoshika:/anime/${hoshikaId}/episodes`);
    } else {
      clearedCount = appCache.invalidateMatching(
        (key) => key.includes('episodes')
      );
    }
  } else {
    return NextResponse.json({ error: `Invalid cache scope: ${scope}` }, { status: 400 });
  }

  try {
    revalidatePath('/');
    revalidatePath('/explore');
    revalidatePath('/trending');
    revalidatePath('/popular');
    revalidatePath('/recent');
    if (hoshikaId && Number.isFinite(hoshikaId)) {
      revalidatePath(`/anime/${hoshikaId}`);
      revalidatePath(`/watch/${hoshikaId}`);
    }
  } catch {
    // Ignore outside request context
  }

  await logAdminActionServer(verified, {
    category: 'cache',
    action: `Purged ${scope} cache`,
    targetId: hoshikaId ? String(hoshikaId) : scope,
    targetName: hoshikaId ? `Anime #${hoshikaId} (${scope})` : `Cache Scope: ${scope}`,
    details: `Cleared ${clearedCount} cache entries and revalidated affected routes`,
  });

  return NextResponse.json({
    ok: true,
    scope,
    clearedCount,
    stats: appCache.getStats(),
    artworkCache: getArtworkCacheStats(),
  });
}
