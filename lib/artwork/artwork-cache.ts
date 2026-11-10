import { AnimeArtworkResult } from '@/types/artwork';
import { AnimeArtworkFirestoreDoc } from '@/lib/admin/admin-firestore';

const DEFAULT_TTL_MS = 1000 * 60 * 60; // 1 hour default

interface CachedArtworkEntry {
  data: AnimeArtworkResult;
  expiresAt: number;
}

interface CachedOverrideEntry {
  data: AnimeArtworkFirestoreDoc | null;
  expiresAt: number;
}

const resolvedArtworkCache = new Map<number, CachedArtworkEntry>();
const firestoreOverrideCache = new Map<number, CachedOverrideEntry>();

export function getCachedResolvedArtwork(hoshikaId: number): AnimeArtworkResult | null {
  const entry = resolvedArtworkCache.get(hoshikaId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    resolvedArtworkCache.delete(hoshikaId);
    return null;
  }
  return entry.data;
}

export function setCachedResolvedArtwork(
  hoshikaId: number,
  data: AnimeArtworkResult,
  ttlMs = DEFAULT_TTL_MS
): void {
  resolvedArtworkCache.set(hoshikaId, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

export function getCachedFirestoreOverride(
  hoshikaId: number
): { hit: boolean; doc: AnimeArtworkFirestoreDoc | null } {
  const entry = firestoreOverrideCache.get(hoshikaId);
  if (!entry) return { hit: false, doc: null };
  if (Date.now() > entry.expiresAt) {
    firestoreOverrideCache.delete(hoshikaId);
    return { hit: false, doc: null };
  }
  return { hit: true, doc: entry.data };
}

export function setCachedFirestoreOverride(
  hoshikaId: number,
  doc: AnimeArtworkFirestoreDoc | null,
  ttlMs = 1000 * 60 * 5
): void {
  firestoreOverrideCache.set(hoshikaId, {
    data: doc,
    expiresAt: Date.now() + ttlMs,
  });
}

export function invalidateAnimeArtworkCache(
  hoshikaId?: number,
  updatedOverride?: AnimeArtworkFirestoreDoc | null
): void {
  if (typeof hoshikaId === 'number') {
    resolvedArtworkCache.delete(hoshikaId);
    if (updatedOverride !== undefined) {
      setCachedFirestoreOverride(hoshikaId, updatedOverride, 1000 * 60 * 30);
    } else {
      firestoreOverrideCache.delete(hoshikaId);
    }
  } else {
    resolvedArtworkCache.clear();
    firestoreOverrideCache.clear();
  }
}

export function getArtworkCacheStats(): {
  resolvedEntries: number;
  overrideEntries: number;
} {
  return {
    resolvedEntries: resolvedArtworkCache.size,
    overrideEntries: firestoreOverrideCache.size,
  };
}
