import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { verifyAdminRequest } from '@/lib/firebase-admin';
import { appCache } from '@/lib/cache';
import { invalidateHoshikaCacheForAnime } from '@/lib/hoshika';
import { invalidateCachedArtwork } from '@/lib/artwork/artwork-cache';

type InvalidationScope = 'anime' | 'episodes' | 'artwork' | 'catalog' | 'all';

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized: Valid administrator token required' },
      { status: 401 }
    );
  }

  let body: { hoshikaId?: number | string; scope?: InvalidationScope } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rawId = body?.hoshikaId;
  const numericId =
    rawId !== undefined && rawId !== null && String(rawId).trim() !== ''
      ? Number(rawId)
      : undefined;
  const validId =
    numericId !== undefined && Number.isFinite(numericId) && numericId > 0
      ? numericId
      : undefined;
  const scope: InvalidationScope = body?.scope || (validId ? 'anime' : 'all');

  let clearedEntries = 0;

  if (scope === 'all') {
    clearedEntries = appCache.getStats().size;
    appCache.clear();
    invalidateCachedArtwork();
  } else {
    if (scope === 'anime' || scope === 'episodes') {
      clearedEntries += invalidateHoshikaCacheForAnime(validId, scope === 'anime');
    }
    if (scope === 'catalog') {
      clearedEntries += invalidateHoshikaCacheForAnime(undefined, true);
    }
    if (scope === 'artwork' || scope === 'anime') {
      invalidateCachedArtwork(validId);
      if (!validId) {
        clearedEntries += appCache.invalidateByPrefix('fanart:v1:');
        clearedEntries += appCache.invalidateByPrefix('anilist:artwork-meta:');
        clearedEntries += appCache.invalidateByPrefix('anizip:ext-ids:');
      }
    }
  }

  try {
    revalidatePath('/');
    revalidatePath('/explore');
    revalidatePath('/trending');
    revalidatePath('/popular');
    revalidatePath('/recent');
    if (validId) {
      revalidatePath(`/anime/${validId}`);
      revalidatePath(`/admin/artwork/${validId}`);
    }
  } catch {
    // Ignore outside request context
  }

  return NextResponse.json({
    ok: true,
    scope,
    hoshikaId: validId ?? null,
    clearedEntries,
    timestamp: Date.now(),
  });
}
