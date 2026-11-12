import { AnimeArtworkResult } from '@/types/artwork';
import { AnimeArtworkFirestoreDoc } from '@/lib/admin/admin-firestore';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  version: number;
}

const DEFAULT_ARTWORK_TTL_MS = 45 * 60 * 1000; // 45 minutes for resolved artwork
const DEFAULT_OVERRIDE_TTL_MS = 5 * 60 * 1000; // 5 minutes for Firestore override snapshots

const resolvedArtworkCache = new Map<number, CacheEntry<AnimeArtworkResult>>();
const firestoreOverrideCache = new Map<
  number,
  CacheEntry<AnimeArtworkFirestoreDoc | null>
>();
const keyVersions = new Map<number, number>();

function getKeyVersion(hoshikaId: number): number {
  return keyVersions.get(hoshikaId) || 0;
}

function bumpKeyVersion(hoshikaId: number): number {
  const next = getKeyVersion(hoshikaId) + 1;
  keyVersions.set(hoshikaId, next);
  return next;
}

export function getCachedArtwork(hoshikaId: number): AnimeArtworkResult | null {
  const entry = resolvedArtworkCache.get(hoshikaId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt || entry.version !== getKeyVersion(hoshikaId)) {
    resolvedArtworkCache.delete(hoshikaId);
    return null;
  }
  return entry.value;
}

export function setCachedArtwork(
  hoshikaId: number,
  result: AnimeArtworkResult,
  ttlMs: number = DEFAULT_ARTWORK_TTL_MS
): void {
  resolvedArtworkCache.set(hoshikaId, {
    value: result,
    expiresAt: Date.now() + ttlMs,
    version: getKeyVersion(hoshikaId),
  });
}

export function getCachedArtworkOverride(
  hoshikaId: number
): AnimeArtworkFirestoreDoc | null | undefined {
  const entry = firestoreOverrideCache.get(hoshikaId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    firestoreOverrideCache.delete(hoshikaId);
    return undefined;
  }
  return entry.value;
}

export function setCachedArtworkOverride(
  hoshikaId: number,
  doc: AnimeArtworkFirestoreDoc | null,
  ttlMs: number = DEFAULT_OVERRIDE_TTL_MS
): void {
  bumpKeyVersion(hoshikaId);
  firestoreOverrideCache.set(hoshikaId, {
    value: doc,
    expiresAt: Date.now() + ttlMs,
    version: getKeyVersion(hoshikaId),
  });
  // Also clear resolved artwork cache so next request re-evaluates with the new override
  resolvedArtworkCache.delete(hoshikaId);
}

export function invalidateCachedArtwork(hoshikaId?: number): void {
  if (typeof hoshikaId === 'number' && Number.isFinite(hoshikaId)) {
    bumpKeyVersion(hoshikaId);
    resolvedArtworkCache.delete(hoshikaId);
    firestoreOverrideCache.delete(hoshikaId);
  } else {
    resolvedArtworkCache.clear();
    firestoreOverrideCache.clear();
    keyVersions.clear();
  }
}

export function getArtworkCacheStats(): {
  resolvedSize: number;
  overrideSize: number;
} {
  return {
    resolvedSize: resolvedArtworkCache.size,
    overrideSize: firestoreOverrideCache.size,
  };
}

export const getCachedResolvedArtwork = getCachedArtwork;
export const setCachedResolvedArtwork = setCachedArtwork;
export const invalidateAnimeArtworkCache = invalidateCachedArtwork;
