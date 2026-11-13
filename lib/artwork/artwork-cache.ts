import { AnimeArtworkResult } from '@/types/artwork';
import { AnimeArtworkFirestoreDoc } from '@/lib/admin/admin-firestore';
import { appCache } from '@/lib/cache';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  version: number;
  inputSignature?: string;
}

const DEFAULT_ARTWORK_TTL_MS = 15 * 60 * 1000; // 15 minutes for resolved artwork
const DEFAULT_OVERRIDE_TTL_MS = 3 * 60 * 1000; // 3 minutes for Firestore override snapshots

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

export function buildArtworkInputSignature(params: {
  hoshikaBanner?: string | null;
  hoshikaCover?: string | null;
  preferEnglish?: boolean;
}): string {
  return `${params.hoshikaBanner || ''}|${params.hoshikaCover || ''}|${
    params.preferEnglish !== false ? 'en' : 'ja'
  }`;
}

export function getCachedArtwork(
  hoshikaId: number,
  expectedInputSignature?: string
): AnimeArtworkResult | null {
  const entry = resolvedArtworkCache.get(hoshikaId);
  if (!entry) return null;
  if (
    Date.now() > entry.expiresAt ||
    entry.version !== getKeyVersion(hoshikaId)
  ) {
    resolvedArtworkCache.delete(hoshikaId);
    return null;
  }
  if (
    expectedInputSignature !== undefined &&
    entry.inputSignature !== undefined &&
    entry.inputSignature !== expectedInputSignature
  ) {
    resolvedArtworkCache.delete(hoshikaId);
    return null;
  }
  return entry.value;
}

export function setCachedArtwork(
  hoshikaId: number,
  result: AnimeArtworkResult,
  ttlMs: number = DEFAULT_ARTWORK_TTL_MS,
  inputSignature?: string
): void {
  resolvedArtworkCache.set(hoshikaId, {
    value: result,
    expiresAt: Date.now() + ttlMs,
    version: getKeyVersion(hoshikaId),
    inputSignature,
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
  const prev = firestoreOverrideCache.get(hoshikaId)?.value;
  const prevSig = prev
    ? `${prev.updatedAt || ''}:${prev.selectedLogoUrl || ''}:${prev.backgroundUrl || ''}:${prev.posterUrl || ''}:${prev.selectionMode || ''}:${(prev.customLogos || []).length}`
    : 'null';
  const nextSig = doc
    ? `${doc.updatedAt || ''}:${doc.selectedLogoUrl || ''}:${doc.backgroundUrl || ''}:${doc.posterUrl || ''}:${doc.selectionMode || ''}:${(doc.customLogos || []).length}`
    : 'null';

  if (prevSig !== nextSig) {
    bumpKeyVersion(hoshikaId);
    resolvedArtworkCache.delete(hoshikaId);
  }

  firestoreOverrideCache.set(hoshikaId, {
    value: doc,
    expiresAt: Date.now() + ttlMs,
    version: getKeyVersion(hoshikaId),
  });
}

export function invalidateCachedArtwork(hoshikaId?: number): void {
  if (typeof hoshikaId === 'number' && Number.isFinite(hoshikaId)) {
    bumpKeyVersion(hoshikaId);
    resolvedArtworkCache.delete(hoshikaId);
    firestoreOverrideCache.delete(hoshikaId);
    appCache.invalidateByPrefix(`hoshika:/anime/${hoshikaId}`);
    appCache.invalidateByPrefix(`id-map:v3:${hoshikaId}`);
  } else {
    resolvedArtworkCache.clear();
    firestoreOverrideCache.clear();
    keyVersions.clear();
    appCache.invalidateByPrefix('fanart:v1:');
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
