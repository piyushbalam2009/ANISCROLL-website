import { HoshikaEpisodeItem } from '@/types/anime';
import { WatchHistoryEntry } from '@/types/streaming';
import { needsMetadataEnrichment } from './continue-watching';
import { updateWatchHistoryMetadata } from './storage';

export type AudioLanguage = 'sub' | 'dub';

export type AvailabilityStatus = 'loading' | 'resolved' | 'unavailable' | 'error';

export interface LanguageAvailabilityState {
  available: boolean;
  status: AvailabilityStatus;
  episodeCount: number;
}

export interface EpisodeAvailabilityResult {
  sub: LanguageAvailabilityState;
  dub: LanguageAvailabilityState;
  defaultLanguage: AudioLanguage | null;
}

export interface EpisodeBatchResponse {
  ok: boolean;
  items: HoshikaEpisodeItem[];
  total: number;
  nextAfter: number | null;
  availability?: EpisodeAvailabilityResult;
  fromCache?: boolean;
  attempts?: number;
  status?: number;
  error?: string;
}

export interface EpisodeCacheKeyParams {
  animeId: string | number;
  language?: AudioLanguage;
  limit?: number;
  after?: number;
  all?: boolean;
}

interface CachedEpisodeQueryEntry {
  key: string;
  animeId: string;
  language: AudioLanguage;
  items: HoshikaEpisodeItem[];
  total: number;
  nextAfter: number | null;
  availability?: EpisodeAvailabilityResult;
  cachedAt: number;
  expiresAt: number;
}

export const EPISODE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_EPISODE_RETRY_ATTEMPTS = 5;

// Retry schedule for attempts 2..5 (Attempt 1 is immediate: 0ms)
export const RETRY_BASE_DELAYS_MS = [0, 3000, 6000, 12000, 24000] as const;

const SESSION_CACHE_STORAGE_KEY = 'aniscroll_episode_query_cache_v2';

export const MAX_ANIME_CACHE_ENTRIES = 100;
export const MAX_QUERY_CACHE_ENTRIES = 300;
export const MAX_RETRY_EXHAUSTED_ENTRIES = 200;

// 1. Per-anime episode item lookup cache: animeId -> Map<episodeNumber, HoshikaEpisodeItem>
const clientEpisodeCache: Record<string, Map<number, HoshikaEpisodeItem>> = {};
const clientEpisodeLru = new Set<string>();

// 2. Query-level cache keyed by structured cache key (e.g. `episodes:265992:sub:50`)
const episodeQueryCache = new Map<string, CachedEpisodeQueryEntry>();

// 3. Per-anime resolved Sub/Dub availability cache: animeId -> { result, expiresAt }
const availabilityCache = new Map<
  string,
  { result: EpisodeAvailabilityResult; expiresAt: number }
>();

// 4. Completed batch tracking per anime+language so completed batches are never re-requested
const completedBatchKeys = new Set<string>();
const exhaustedPaginationAnime = new Set<string>(); // `${animeId}:${language}` when nextAfter === null or items < limit

// 5. Shared in-flight request deduplication maps
const inFlightBatchRequests = new Map<string, Promise<EpisodeBatchResponse>>();
const inFlightAvailabilityRequests = new Map<string, Promise<EpisodeAvailabilityResult>>();

// 6. Retry exhaustion state per cache key so components do not loop after max attempts
const retryExhaustedState = new Map<
  string,
  { attempts: number; exhaustedAt: number; error: string }
>();

// 7. Track attempted watch-history metadata enrichments
const attemptedEnrichments = new Set<string>();

// 8. Client-side 429 cooldown to prevent episode retry storms across components
let episodeRateLimitedUntilMs = 0;

function touchAnimeCacheLru(animeKey: string): void {
  clientEpisodeLru.delete(animeKey);
  clientEpisodeLru.add(animeKey);
  while (clientEpisodeLru.size > MAX_ANIME_CACHE_ENTRIES) {
    const oldestKey = clientEpisodeLru.values().next().value;
    if (!oldestKey) break;
    clientEpisodeLru.delete(oldestKey);
    delete clientEpisodeCache[oldestKey];
    availabilityCache.delete(oldestKey);
    exhaustedPaginationAnime.delete(`${oldestKey}:sub`);
    exhaustedPaginationAnime.delete(`${oldestKey}:dub`);
    for (const qk of Array.from(episodeQueryCache.keys())) {
      if (qk.startsWith(`episodes:${oldestKey}:`)) {
        episodeQueryCache.delete(qk);
        completedBatchKeys.delete(qk);
      }
    }
  }
}

function setEpisodeQueryCacheBounded(key: string, entry: CachedEpisodeQueryEntry): void {
  episodeQueryCache.delete(key);
  episodeQueryCache.set(key, entry);
  while (episodeQueryCache.size > MAX_QUERY_CACHE_ENTRIES) {
    const oldestQueryKey = episodeQueryCache.keys().next().value;
    if (!oldestQueryKey) break;
    episodeQueryCache.delete(oldestQueryKey);
    completedBatchKeys.delete(oldestQueryKey);
  }
}

function setAvailabilityCacheBounded(
  animeKey: string,
  entry: { result: EpisodeAvailabilityResult; expiresAt: number }
): void {
  availabilityCache.delete(animeKey);
  availabilityCache.set(animeKey, entry);
  while (availabilityCache.size > MAX_ANIME_CACHE_ENTRIES) {
    const oldestKey = availabilityCache.keys().next().value;
    if (!oldestKey) break;
    availabilityCache.delete(oldestKey);
  }
}

function setRetryExhaustedBounded(
  cacheKey: string,
  entry: { attempts: number; exhaustedAt: number; error: string }
): void {
  retryExhaustedState.delete(cacheKey);
  retryExhaustedState.set(cacheKey, entry);
  while (retryExhaustedState.size > MAX_RETRY_EXHAUSTED_ENTRIES) {
    const oldestKey = retryExhaustedState.keys().next().value;
    if (!oldestKey) break;
    retryExhaustedState.delete(oldestKey);
  }
}

export function getEpisodeClientCooldownRemainingMs(nowMs: number = Date.now()): number {
  return Math.max(0, episodeRateLimitedUntilMs - nowMs);
}

function recordEpisodeClientCooldown(
  retryAfterHeader: string | null,
  defaultMs: number = 15_000,
  nowMs: number = Date.now()
): number {
  let waitMs = defaultMs;
  if (retryAfterHeader) {
    const trimmed = retryAfterHeader.trim();
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds > 0) {
      waitMs = Math.min(Math.max(1000, Math.round(seconds * 1000)), 300_000);
    } else {
      const dateMs = Date.parse(trimmed);
      if (!Number.isNaN(dateMs)) {
        const diff = dateMs - nowMs;
        if (diff > 0) {
          waitMs = Math.min(Math.max(1000, diff), 300_000);
        }
      }
    }
  }
  episodeRateLimitedUntilMs = Math.max(episodeRateLimitedUntilMs, nowMs + waitMs);
  return waitMs;
}

let sessionCacheHydrated = false;

function hydrateFromSessionStorage(): void {
  if (sessionCacheHydrated || typeof window === 'undefined') return;
  sessionCacheHydrated = true;
  try {
    const raw = window.sessionStorage.getItem(SESSION_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      queries?: CachedEpisodeQueryEntry[];
      availabilities?: Array<{
        animeId: string;
        result: EpisodeAvailabilityResult;
        expiresAt: number;
      }>;
    };
    const now = Date.now();
    if (Array.isArray(parsed?.queries)) {
      for (const entry of parsed.queries) {
        if (entry && entry.expiresAt > now && Array.isArray(entry.items) && entry.items.length > 0) {
          episodeQueryCache.set(entry.key, entry);
          completedBatchKeys.add(entry.key);
          cacheEpisodes(entry.animeId, entry.items);
          if (entry.nextAfter === null && entry.total > 0 && entry.items.length < 50) {
            exhaustedPaginationAnime.add(`${entry.animeId}:${entry.language}`);
          }
          if (entry.availability) {
            availabilityCache.set(String(entry.animeId), {
              result: entry.availability,
              expiresAt: entry.expiresAt,
            });
          }
        }
      }
    }
    if (Array.isArray(parsed?.availabilities)) {
      for (const av of parsed.availabilities) {
        if (av && av.expiresAt > now && av.result) {
          availabilityCache.set(String(av.animeId), {
            result: av.result,
            expiresAt: av.expiresAt,
          });
        }
      }
    }
  } catch {
    // Ignore storage read errors
  }
}

function persistToSessionStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    const queries = Array.from(episodeQueryCache.values())
      .filter((e) => e.expiresAt > now && e.items.length > 0)
      .slice(-30);
    const availabilities = Array.from(availabilityCache.entries())
      .filter(([, v]) => v.expiresAt > now)
      .slice(-50)
      .map(([animeId, v]) => ({ animeId, result: v.result, expiresAt: v.expiresAt }));
    window.sessionStorage.setItem(
      SESSION_CACHE_STORAGE_KEY,
      JSON.stringify({ queries, availabilities })
    );
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Build a deterministic cache key including animeId, language (sub/dub), pagination limit, and cursor.
 * Example: `episodes:265992:sub:50` or `episodes:265992:sub:50:after=50`
 */
export function buildEpisodeCacheKey({
  animeId,
  language = 'sub',
  limit = 50,
  after,
  all = false,
}: EpisodeCacheKeyParams): string {
  const normalizedId = String(animeId).trim();
  const normalizedLang: AudioLanguage = language === 'dub' ? 'dub' : 'sub';
  if (all) {
    return `episodes:${normalizedId}:${normalizedLang}:all`;
  }
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
  if (after !== undefined && after !== null && after > 0) {
    return `episodes:${normalizedId}:${normalizedLang}:${normalizedLimit}:after=${after}`;
  }
  return `episodes:${normalizedId}:${normalizedLang}:${normalizedLimit}`;
}

/**
 * Pure helper: computes retry delay in milliseconds for a given 1-based attempt number.
 * Attempt 1 -> 0ms (immediate)
 * Attempt 2 -> 3000ms + jitter
 * Attempt 3 -> 6000ms + jitter
 * Attempt 4 -> 12000ms + jitter
 * Attempt 5 -> 24000ms + jitter
 * Respects HTTP 429 Retry-After header when provided.
 */
export function getRetryDelayMs(
  attempt: number,
  retryAfterHeader?: string | null,
  jitterFn: () => number = Math.random
): number {
  if (retryAfterHeader) {
    const trimmed = retryAfterHeader.trim();
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(Math.round(seconds * 1000), 60000);
    }
    const dateMs = Date.parse(trimmed);
    if (!Number.isNaN(dateMs)) {
      const diff = dateMs - Date.now();
      if (diff > 0) {
        return Math.min(diff, 60000);
      }
    }
  }

  if (attempt <= 1) return 0;
  const idx = Math.min(attempt - 1, RETRY_BASE_DELAYS_MS.length - 1);
  const base = RETRY_BASE_DELAYS_MS[idx];
  const jitter = Math.round(Math.max(0, Math.min(1, jitterFn())) * 400);
  return base + jitter;
}

/**
 * Pure helper: determines whether an episode request should be retried.
 * - Never retries when valid episodes were returned (`itemCount > 0`).
 * - Never retries when aborted.
 * - Never retries on 4xx client errors (including 429 Too Many Requests).
 * - Stops after `maxAttempts` (default 5).
 */
export function shouldRetryEpisodeRequest(params: {
  status: number;
  itemCount: number;
  attempt: number;
  maxAttempts?: number;
  aborted?: boolean;
  languageExplicitlyUnavailable?: boolean;
}): boolean {
  const {
    status,
    itemCount,
    attempt,
    maxAttempts = MAX_EPISODE_RETRY_ATTEMPTS,
    aborted = false,
    languageExplicitlyUnavailable = false,
  } = params;

  if (aborted) return false;
  if (languageExplicitlyUnavailable) return false;
  if (attempt >= maxAttempts) return false;

  // All 4xx (including 429 rate limits and 404 invalid IDs) -> do not hammer/retry
  if (status >= 400 && status < 500) {
    return false;
  }

  // Successful response with valid episodes -> stop retrying
  if (status >= 200 && status < 300 && itemCount > 0) {
    return false;
  }

  // Retry on 5xx, network failure (status 0), or 200 with 0 episodes
  return true;
}

/**
 * Pure helper: selects default language given availability and optional user preference.
 * Priority:
 * 1. User's preferred language if available
 * 2. 'sub' if available
 * 3. 'dub' if available
 * 4. null if neither is available
 */
export function selectDefaultLanguage(
  availability: Pick<EpisodeAvailabilityResult, 'sub' | 'dub'>,
  preferredLanguage?: AudioLanguage | null
): AudioLanguage | null {
  const subOk = Boolean(availability.sub?.available && availability.sub.episodeCount > 0);
  const dubOk = Boolean(availability.dub?.available && availability.dub.episodeCount > 0);

  if (preferredLanguage === 'sub' && subOk) return 'sub';
  if (preferredLanguage === 'dub' && dubOk) return 'dub';
  if (subOk) return 'sub';
  if (dubOk) return 'dub';
  return null;
}

/**
 * Pure helper: constructs an EpisodeAvailabilityResult from Sub/Dub booleans and episode counts.
 */
export function createEpisodeAvailability(params: {
  subAvailable: boolean;
  dubAvailable: boolean;
  subEpisodeCount: number;
  dubEpisodeCount: number;
  preferredLanguage?: AudioLanguage | null;
}): EpisodeAvailabilityResult {
  const subOk = params.subAvailable && params.subEpisodeCount > 0;
  const dubOk = params.dubAvailable && params.dubEpisodeCount > 0;

  const sub: LanguageAvailabilityState = {
    available: subOk,
    status: subOk ? 'resolved' : 'unavailable',
    episodeCount: subOk ? params.subEpisodeCount : 0,
  };

  const dub: LanguageAvailabilityState = {
    available: dubOk,
    status: dubOk ? 'resolved' : 'unavailable',
    episodeCount: dubOk ? params.dubEpisodeCount : 0,
  };

  return {
    sub,
    dub,
    defaultLanguage: selectDefaultLanguage({ sub, dub }, params.preferredLanguage),
  };
}

/**
 * Retrieve cached episodes for an anime sorted by episode number.
 */
export function getCachedEpisodes(animeId: string | number): HoshikaEpisodeItem[] {
  hydrateFromSessionStorage();
  const key = String(animeId);
  const map = clientEpisodeCache[key];
  if (!map) return [];
  return Array.from(map.values()).sort((a, b) => a.number - b.number);
}

/**
 * Retrieve a single episode from cache.
 */
export function getCachedEpisode(
  animeId: string | number,
  episodeNumber: number
): HoshikaEpisodeItem | undefined {
  hydrateFromSessionStorage();
  const key = String(animeId);
  return clientEpisodeCache[key]?.get(episodeNumber);
}

/**
 * Store episodes in the client cache.
 * Never caches empty arrays as completed batches.
 */
export function cacheEpisodes(
  animeId: string | number,
  items: HoshikaEpisodeItem[],
  options?: {
    language?: AudioLanguage;
    limit?: number;
    after?: number;
    total?: number;
    nextAfter?: number | null;
    availability?: EpisodeAvailabilityResult;
  }
): void {
  if (!items || items.length === 0) return;
  const key = String(animeId);
  if (!clientEpisodeCache[key]) {
    clientEpisodeCache[key] = new Map();
  }
  const map = clientEpisodeCache[key];
  for (const ep of items) {
    if (ep && typeof ep.number === 'number') {
      map.set(ep.number, ep);
    }
  }
  touchAnimeCacheLru(key);

  const lang = options?.language || 'sub';
  const limit = options?.limit || 50;
  const after = options?.after;
  const queryKey = buildEpisodeCacheKey({ animeId: key, language: lang, limit, after });
  const now = Date.now();

  setEpisodeQueryCacheBounded(queryKey, {
    key: queryKey,
    animeId: key,
    language: lang,
    items,
    total: options?.total ?? Math.max(items.length, map.size),
    nextAfter: options?.nextAfter ?? null,
    availability: options?.availability,
    cachedAt: now,
    expiresAt: now + EPISODE_CACHE_TTL_MS,
  });

  completedBatchKeys.add(queryKey);
  retryExhaustedState.delete(queryKey);

  const existingExhausted = exhaustedPaginationAnime.has(`${key}:${lang}`);
  if (
    options?.nextAfter !== null &&
    (items.length >= limit || (options?.total !== undefined && options.total > map.size))
  ) {
    exhaustedPaginationAnime.delete(`${key}:${lang}`);
  } else if (
    !existingExhausted &&
    (options?.nextAfter === null || items.length < limit) &&
    (options?.total === undefined || map.size >= options.total)
  ) {
    exhaustedPaginationAnime.add(`${key}:${lang}`);
  }

  if (options?.availability) {
    setAvailabilityCacheBounded(key, {
      result: options.availability,
      expiresAt: now + EPISODE_CACHE_TTL_MS,
    });
  }

  persistToSessionStorage();
}

/**
 * Check if a batch or range has already been completed or cached for an anime.
 */
export function isRangeCached(
  animeId: string | number,
  start: number,
  end: number,
  language: AudioLanguage = 'sub'
): boolean {
  hydrateFromSessionStorage();
  const key = String(animeId);
  const after = start > 1 ? start - 1 : undefined;
  const batchKey = buildEpisodeCacheKey({ animeId: key, language, limit: 50, after });
  const now = Date.now();

  const cachedQuery = episodeQueryCache.get(batchKey);
  if (cachedQuery) {
    if (cachedQuery.expiresAt > now && cachedQuery.items.length > 0) {
      return true;
    }
    // Entry expired — evict it and allow re-fetch instead of getting stuck in completedBatchKeys
    episodeQueryCache.delete(batchKey);
    completedBatchKeys.delete(batchKey);
    exhaustedPaginationAnime.delete(`${key}:${language}`);
  }

  if (completedBatchKeys.has(batchKey)) {
    return true;
  }

  if (exhaustedPaginationAnime.has(`${key}:${language}`) && start === 1) {
    const map = clientEpisodeCache[key];
    if (map && map.size > 0) return true;
  }

  const map = clientEpisodeCache[key];
  if (!map || map.size === 0) return false;

  let count = 0;
  for (let n = start; n <= end; n++) {
    if (map.has(n)) {
      count++;
    }
  }
  const expected = end - start + 1;
  return count >= expected;
}

/**
 * Get cached Sub/Dub availability for an anime if already resolved and not expired.
 */
export function getCachedEpisodeAvailability(
  animeId: string | number
): EpisodeAvailabilityResult | null {
  hydrateFromSessionStorage();
  const key = String(animeId);
  const cached = availabilityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  return null;
}

/**
 * Store resolved Sub/Dub availability in the shared client cache.
 */
export function setCachedEpisodeAvailability(
  animeId: string | number,
  result: EpisodeAvailabilityResult
): void {
  const key = String(animeId);
  if (
    result.sub.status === 'resolved' ||
    result.dub.status === 'resolved'
  ) {
    setAvailabilityCacheBounded(key, {
      result,
      expiresAt: Date.now() + EPISODE_CACHE_TTL_MS,
    });
    persistToSessionStorage();
  }
}

/**
 * Check if automatic retries for a batch key have already been exhausted.
 */
export function getRetryExhaustedInfo(
  cacheKey: string
): { attempts: number; exhaustedAt: number; error: string } | null {
  return retryExhaustedState.get(cacheKey) || null;
}

/**
 * Explicitly invalidate cached episode data for an anime (e.g. on user manual retry/refresh).
 */
export function invalidateAnimeEpisodeCache(animeId: string | number): void {
  const key = String(animeId);
  delete clientEpisodeCache[key];
  clientEpisodeLru.delete(key);
  availabilityCache.delete(key);

  for (const k of Array.from(episodeQueryCache.keys())) {
    if (k.startsWith(`episodes:${key}:`)) {
      episodeQueryCache.delete(k);
    }
  }
  for (const k of Array.from(completedBatchKeys.values())) {
    if (k.startsWith(`episodes:${key}:`)) {
      completedBatchKeys.delete(k);
    }
  }
  for (const k of Array.from(retryExhaustedState.keys())) {
    if (k.startsWith(`episodes:${key}:`)) {
      retryExhaustedState.delete(k);
    }
  }
  exhaustedPaginationAnime.delete(`${key}:sub`);
  exhaustedPaginationAnime.delete(`${key}:dub`);
  persistToSessionStorage();
}

/**
 * Helper for tests & diagnostics: returns number of currently active in-flight episode requests.
 */
export function getInFlightEpisodeRequestCount(): number {
  return inFlightBatchRequests.size;
}

export function getEpisodeStoreCacheSizes(): {
  animeCount: number;
  queryCount: number;
  availabilityCount: number;
  retryExhaustedCount: number;
} {
  return {
    animeCount: Object.keys(clientEpisodeCache).length,
    queryCount: episodeQueryCache.size,
    availabilityCount: availabilityCache.size,
    retryExhaustedCount: retryExhaustedState.size,
  };
}

/**
 * Reset all in-memory stores (used by unit tests).
 */
export function resetEpisodeStoreForTests(): void {
  for (const k of Object.keys(clientEpisodeCache)) {
    delete clientEpisodeCache[k];
  }
  clientEpisodeLru.clear();
  episodeQueryCache.clear();
  availabilityCache.clear();
  completedBatchKeys.clear();
  exhaustedPaginationAnime.clear();
  inFlightBatchRequests.clear();
  inFlightAvailabilityRequests.clear();
  retryExhaustedState.clear();
  attemptedEnrichments.clear();
  episodeRateLimitedUntilMs = 0;
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export interface FetchEpisodeBatchOptions {
  language?: AudioLanguage;
  forceRefresh?: boolean;
  maxAttempts?: number;
  signal?: AbortSignal;
  baseDelayScheduleMs?: readonly number[];
  fetchImpl?: typeof fetch;
  onRetryAttempt?: (attempt: number, delayMs: number) => void;
}

/**
 * Fetch an episode batch with:
 * 1. Shared cache lookup (`episodes:{animeId}:{language}:{limit}`)
 * 2. In-flight request deduplication across all components
 * 3. Controlled exponential backoff + jitter retries when episodes are unavailable
 * 4. Automatic Sub/Dub availability extraction & caching
 */
export async function fetchEpisodeBatchWithMeta(
  animeId: string | number,
  after?: number,
  limit: number = 50,
  options: FetchEpisodeBatchOptions = {}
): Promise<EpisodeBatchResponse> {
  hydrateFromSessionStorage();

  const key = String(animeId).trim();
  const language: AudioLanguage = options.language === 'dub' ? 'dub' : 'sub';
  const cacheKey = buildEpisodeCacheKey({ animeId: key, language, limit, after });
  const fetchFn = options.fetchImpl || fetch;
  const maxAttempts = options.maxAttempts ?? MAX_EPISODE_RETRY_ATTEMPTS;

  if (options.forceRefresh) {
    episodeQueryCache.delete(cacheKey);
    completedBatchKeys.delete(cacheKey);
    retryExhaustedState.delete(cacheKey);
    exhaustedPaginationAnime.delete(`${key}:${language}`);
  }

  // 1. Return from query cache if valid and non-empty
  const now = Date.now();
  const cachedEntry = episodeQueryCache.get(cacheKey);
  if (!options.forceRefresh && cachedEntry && cachedEntry.expiresAt > now && cachedEntry.items.length > 0) {
    return {
      ok: true,
      items: cachedEntry.items,
      total: cachedEntry.total,
      nextAfter: cachedEntry.nextAfter,
      availability: cachedEntry.availability || getCachedEpisodeAvailability(key) || undefined,
      fromCache: true,
      attempts: 0,
      status: 200,
    };
  }

  // 2. If pagination for this anime+language was already exhausted on an earlier batch, do not fetch beyond end
  if (
    !options.forceRefresh &&
    after !== undefined &&
    after > 0 &&
    exhaustedPaginationAnime.has(`${key}:${language}`)
  ) {
    const allCached = getCachedEpisodes(key);
    const slice = allCached.filter((e) => e.number > after && e.number <= after + limit);
    return {
      ok: true,
      items: slice,
      total: allCached.length,
      nextAfter: null,
      availability: getCachedEpisodeAvailability(key) || undefined,
      fromCache: true,
      attempts: 0,
      status: 200,
    };
  }

  // 3. If global client episode cooldown is active, skip upstream fetch to avoid 429 storms
  if (!options.forceRefresh && episodeRateLimitedUntilMs > now) {
    return {
      ok: false,
      items: [],
      total: 0,
      nextAfter: null,
      availability: getCachedEpisodeAvailability(key) || undefined,
      fromCache: false,
      attempts: 0,
      status: 429,
      error: 'Rate limited by upstream episode server. Please wait a moment.',
    };
  }

  // 4. If previous automatic retries already exhausted for this key (and not forceRefresh), do not loop endlessly
  const exhausted = retryExhaustedState.get(cacheKey);
  if (!options.forceRefresh && exhausted && now - exhausted.exhaustedAt < 60_000) {
    return {
      ok: false,
      items: [],
      total: 0,
      nextAfter: null,
      availability: getCachedEpisodeAvailability(key) || undefined,
      fromCache: false,
      attempts: exhausted.attempts,
      error: exhausted.error,
    };
  }

  // 4. Share in-flight request across simultaneous callers
  const existingInFlight = inFlightBatchRequests.get(cacheKey);
  if (existingInFlight) {
    if (options.signal) {
      return new Promise<EpisodeBatchResponse>((resolve, reject) => {
        if (options.signal!.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        options.signal!.addEventListener('abort', onAbort, { once: true });
        existingInFlight
          .then((res) => {
            options.signal!.removeEventListener('abort', onAbort);
            resolve(res);
          })
          .catch((err) => {
            options.signal!.removeEventListener('abort', onAbort);
            reject(err);
          });
      });
    }
    return existingInFlight;
  }

  const requestPromise = (async (): Promise<EpisodeBatchResponse> => {
    let attempt = 0;
    let lastError = 'Episodes are not available yet.';
    let lastStatus = 0;
    let lastAvailability: EpisodeAvailabilityResult | undefined =
      getCachedEpisodeAvailability(key) || undefined;

    try {
      while (attempt < maxAttempts) {
        attempt++;

        if (options.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const params = new URLSearchParams({
          limit: String(limit),
          lang: language,
        });
        if (after !== undefined && after > 0) {
          params.append('after', String(after));
        }
        if (options.forceRefresh) {
          params.append('refresh', 'true');
        }

        let res: Response | null = null;
        let retryAfterHeader: string | null = null;

        try {
          res = await fetchFn(`/api/episodes/${key}?${params.toString()}`);
          lastStatus = res.status;
          retryAfterHeader = res.headers?.get?.('Retry-After') || null;
        } catch (networkErr: any) {
          if (networkErr?.name === 'AbortError') {
            throw networkErr;
          }
          lastStatus = 0;
          lastError = networkErr?.message || 'Network error while fetching episodes';
        }

        if (res) {
          let data: any = null;
          try {
            data = await res.json();
          } catch {
            data = null;
          }

          if (data?.availability) {
            lastAvailability = data.availability;
            setCachedEpisodeAvailability(key, data.availability);
          }

          const items: HoshikaEpisodeItem[] = Array.isArray(data?.items) ? data.items : [];
          const total: number = typeof data?.total === 'number' ? data.total : items.length;
          const nextAfter: number | null = data?.nextAfter ?? null;

          // Check if the requested language is explicitly marked unavailable while the other language is resolved
          const langState = lastAvailability?.[language];
          const languageExplicitlyUnavailable =
            langState?.status === 'unavailable' &&
            (lastAvailability?.sub.status === 'resolved' ||
              lastAvailability?.dub.status === 'resolved');

          // Case 1: Valid episodes found -> cache and stop retrying immediately
          if (res.ok && items.length > 0) {
            cacheEpisodes(key, items, {
              language,
              limit,
              after,
              total,
              nextAfter,
              availability: lastAvailability,
            });
            return {
              ok: true,
              items,
              total,
              nextAfter,
              availability: lastAvailability,
              fromCache: false,
              attempts: attempt,
              status: res.status,
            };
          }

          // Case 2: Requested language is explicitly unavailable (e.g. Dub requested on a Sub-only anime)
          if (res.ok && languageExplicitlyUnavailable) {
            return {
              ok: true,
              items: [],
              total: 0,
              nextAfter: null,
              availability: lastAvailability,
              fromCache: false,
              attempts: attempt,
              status: res.status,
            };
          }

          if (res.status === 429) {
            recordEpisodeClientCooldown(retryAfterHeader);
          }

          lastError =
            data?.error ||
            (res.status === 429
              ? 'Rate limited by upstream episode server.'
              : res.status >= 400
              ? `Episode request failed (${res.status}).`
              : 'Episode data is not yet available.');

          const canRetry = shouldRetryEpisodeRequest({
            status: res.status,
            itemCount: items.length,
            attempt,
            maxAttempts,
            aborted: Boolean(options.signal?.aborted),
            languageExplicitlyUnavailable,
          });

          if (!canRetry) {
            break;
          }

          // Compute controlled retry delay
          const scheduleOverride = options.baseDelayScheduleMs;
          const delayMs =
            scheduleOverride && scheduleOverride[attempt] !== undefined
              ? scheduleOverride[attempt]
              : getRetryDelayMs(attempt + 1, retryAfterHeader);

          options.onRetryAttempt?.(attempt + 1, delayMs);
          await sleepWithAbort(delayMs, options.signal);
          continue;
        }

        // Network failure path (res === null)
        const canRetryNetwork = shouldRetryEpisodeRequest({
          status: 0,
          itemCount: 0,
          attempt,
          maxAttempts,
          aborted: Boolean(options.signal?.aborted),
        });

        if (!canRetryNetwork) {
          break;
        }

        const scheduleOverride = options.baseDelayScheduleMs;
        const delayMs =
          scheduleOverride && scheduleOverride[attempt] !== undefined
            ? scheduleOverride[attempt]
            : getRetryDelayMs(attempt + 1, null);

        options.onRetryAttempt?.(attempt + 1, delayMs);
        await sleepWithAbort(delayMs, options.signal);
      }

      // Max attempts reached or non-retryable error — do NOT permanently cache empty result as success,
      // but record retry exhaustion so re-renders do not automatically restart the retry loop.
      setRetryExhaustedBounded(cacheKey, {
        attempts: attempt,
        exhaustedAt: Date.now(),
        error: lastError,
      });

      return {
        ok: false,
        items: [],
        total: 0,
        nextAfter: null,
        availability: lastAvailability,
        fromCache: false,
        attempts: attempt,
        status: lastStatus,
        error: lastError,
      };
    } finally {
      inFlightBatchRequests.delete(cacheKey);
    }
  })();

  inFlightBatchRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

/**
 * Backwards-compatible wrapper returning the `HoshikaEpisodeItem[]` array.
 */
export async function fetchEpisodeBatch(
  animeId: string | number,
  after?: number,
  limit: number = 50,
  options?: FetchEpisodeBatchOptions
): Promise<HoshikaEpisodeItem[]> {
  const result = await fetchEpisodeBatchWithMeta(animeId, after, limit, options);
  return result.items;
}

/**
 * Fetch all episodes for an anime with deduplication and caching.
 */
export async function fetchAllAnimeEpisodes(
  animeId: string | number,
  language: AudioLanguage = 'sub',
  forceRefresh: boolean = false
): Promise<HoshikaEpisodeItem[]> {
  hydrateFromSessionStorage();
  const key = String(animeId).trim();
  const requestKey = buildEpisodeCacheKey({ animeId: key, language, all: true });

  if (forceRefresh) {
    episodeQueryCache.delete(requestKey);
  } else {
    const cachedQuery = episodeQueryCache.get(requestKey);
    if (cachedQuery && cachedQuery.expiresAt > Date.now() && cachedQuery.items.length > 0) {
      return cachedQuery.items;
    }
  }

  if (!forceRefresh && episodeRateLimitedUntilMs > Date.now()) {
    return [];
  }

  const existing = !forceRefresh ? inFlightBatchRequests.get(requestKey) : undefined;
  if (existing) {
    const res = await existing;
    return res.items;
  }

  const promise = (async (): Promise<EpisodeBatchResponse> => {
    try {
      const refreshQuery = forceRefresh ? '&refresh=true' : '';
      const res = await fetch(`/api/episodes/${key}?all=true&lang=${language}${refreshQuery}`);
      if (!res.ok) {
        if (res.status === 429) {
          recordEpisodeClientCooldown(res.headers?.get?.('Retry-After') || null);
        }
        return {
          ok: false,
          items: [],
          total: 0,
          nextAfter: null,
          status: res.status,
          error: `Failed to fetch all episodes (${res.status})`,
        };
      }
      const data = await res.json();
      const items: HoshikaEpisodeItem[] = Array.isArray(data?.items) ? data.items : [];
      if (data?.availability) {
        setCachedEpisodeAvailability(key, data.availability);
      }
      if (items.length > 0) {
        cacheEpisodes(key, items, {
          language,
          limit: items.length,
          total: data?.total ?? items.length,
          nextAfter: null,
          availability: data?.availability,
        });
        episodeQueryCache.set(requestKey, {
          key: requestKey,
          animeId: key,
          language,
          items,
          total: data?.total ?? items.length,
          nextAfter: null,
          availability: data?.availability,
          cachedAt: Date.now(),
          expiresAt: Date.now() + EPISODE_CACHE_TTL_MS,
        });
      }
      return {
        ok: true,
        items,
        total: data?.total ?? items.length,
        nextAfter: null,
        availability: data?.availability,
        status: res.status,
      };
    } catch (err: any) {
      return {
        ok: false,
        items: [],
        total: 0,
        nextAfter: null,
        error: err?.message || 'Error fetching all episodes',
      };
    } finally {
      inFlightBatchRequests.delete(requestKey);
    }
  })();

  inFlightBatchRequests.set(requestKey, promise);
  const res = await promise;
  return res.items;
}

/**
 * Resolve Sub and Dub availability for an anime.
 * - Reuses cached availability if already resolved.
 * - Shares in-flight requests if another component is already resolving availability or episode batch 0.
 */
export async function resolveEpisodeAvailability(
  animeId: string | number,
  options?: {
    preferredLanguage?: AudioLanguage | null;
    forceRefresh?: boolean;
    fetchImpl?: typeof fetch;
  }
): Promise<EpisodeAvailabilityResult> {
  hydrateFromSessionStorage();
  const key = String(animeId).trim();

  if (!options?.forceRefresh) {
    const cached = getCachedEpisodeAvailability(key);
    if (cached) {
      return {
        ...cached,
        defaultLanguage: selectDefaultLanguage(cached, options?.preferredLanguage),
      };
    }
  }

  // If a batch request for this anime is already in flight, await it first to avoid a duplicate network call
  for (const [reqKey, reqPromise] of inFlightBatchRequests.entries()) {
    if (reqKey.startsWith(`episodes:${key}:`)) {
      try {
        const batchRes = await reqPromise;
        if (batchRes.availability) {
          return {
            ...batchRes.availability,
            defaultLanguage: selectDefaultLanguage(
              batchRes.availability,
              options?.preferredLanguage
            ),
          };
        }
      } catch {
        // Continue to dedicated availability check if batch failed
      }
    }
  }

  const existingAvPromise = inFlightAvailabilityRequests.get(key);
  if (existingAvPromise && !options?.forceRefresh) {
    const res = await existingAvPromise;
    return {
      ...res,
      defaultLanguage: selectDefaultLanguage(res, options?.preferredLanguage),
    };
  }

  const fetchFn = options?.fetchImpl || fetch;

  const avPromise = (async (): Promise<EpisodeAvailabilityResult> => {
    try {
      const refreshQuery = options?.forceRefresh ? '&refresh=true' : '';
      const res = await fetchFn(
        `/api/episodes/${key}?limit=50&checkAvailability=true${refreshQuery}`
      );
      if (!res.ok) {
        const cachedEps = getCachedEpisodes(key);
        if (cachedEps.length > 0) {
          return createEpisodeAvailability({
            subAvailable: true,
            dubAvailable: false,
            subEpisodeCount: cachedEps.length,
            dubEpisodeCount: 0,
            preferredLanguage: options?.preferredLanguage,
          });
        }
        return {
          sub: { available: false, status: 'error', episodeCount: 0 },
          dub: { available: false, status: 'error', episodeCount: 0 },
          defaultLanguage: null,
        };
      }

      const data = await res.json();
      const items: HoshikaEpisodeItem[] = Array.isArray(data?.items) ? data.items : [];

      if (items.length > 0) {
        cacheEpisodes(key, items, {
          language: 'sub',
          limit: 50,
          total: data?.total ?? items.length,
          nextAfter: data?.nextAfter ?? null,
          availability: data?.availability,
        });
      }

      if (data?.availability) {
        setCachedEpisodeAvailability(key, data.availability);
        return {
          ...data.availability,
          defaultLanguage: selectDefaultLanguage(data.availability, options?.preferredLanguage),
        };
      }

      const fallback = createEpisodeAvailability({
        subAvailable: items.length > 0,
        dubAvailable: false,
        subEpisodeCount: data?.total || items.length,
        dubEpisodeCount: 0,
        preferredLanguage: options?.preferredLanguage,
      });
      setCachedEpisodeAvailability(key, fallback);
      return fallback;
    } catch {
      const cachedEps = getCachedEpisodes(key);
      if (cachedEps.length > 0) {
        return createEpisodeAvailability({
          subAvailable: true,
          dubAvailable: false,
          subEpisodeCount: cachedEps.length,
          dubEpisodeCount: 0,
          preferredLanguage: options?.preferredLanguage,
        });
      }
      return {
        sub: { available: false, status: 'error', episodeCount: 0 },
        dub: { available: false, status: 'error', episodeCount: 0 },
        defaultLanguage: null,
      };
    } finally {
      inFlightAvailabilityRequests.delete(key);
    }
  })();

  inFlightAvailabilityRequests.set(key, avPromise);
  return avPromise;
}

/**
 * Enriches watch history / continue watching items that are missing episode thumbnails,
 * real episode titles, or anime cover images by fetching real episode & anime metadata.
 */
export async function enrichWatchHistoryEntries(
  entries: WatchHistoryEntry[]
): Promise<void> {
  if (!entries || entries.length === 0 || typeof window === 'undefined') return;
  if (episodeRateLimitedUntilMs > Date.now()) return;

  const toEnrich = entries.filter((entry) => {
    const key = `${entry.hoshikaId}:${entry.episodeNumber}`;
    if (attemptedEnrichments.has(key)) return false;
    return needsMetadataEnrichment(entry);
  });

  if (toEnrich.length === 0) return;

  let nextIdx = 0;
  const maxWorkers = Math.min(2, toEnrich.length);
  const runWorker = async () => {
    while (nextIdx < toEnrich.length) {
      if (episodeRateLimitedUntilMs > Date.now()) break;
      const currentIdx = nextIdx++;
      const entry = toEnrich[currentIdx];
      if (!entry) break;

      const key = `${entry.hoshikaId}:${entry.episodeNumber}`;
      attemptedEnrichments.add(key);

      // Check in-memory episode cache first
      const cachedEp = getCachedEpisode(entry.hoshikaId, entry.episodeNumber);
      if (
        cachedEp?.title &&
        cachedEp?.thumbnail &&
        (entry.coverImage || entry.animeCover)
      ) {
        updateWatchHistoryMetadata({
          hoshikaId: entry.hoshikaId,
          episodeNumber: entry.episodeNumber,
          episodeTitle: cachedEp.title,
          episodeThumbnail: cachedEp.thumbnail,
        });
        continue;
      }

      try {
        const res = await fetch(
          `/api/episodes/${entry.hoshikaId}?episode=${entry.episodeNumber}&includeAnime=true`
        );
        if (res.status === 429) {
          recordEpisodeClientCooldown(res.headers?.get?.('Retry-After') || null);
          break;
        }
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data?.items) && data.items.length > 0) {
          cacheEpisodes(entry.hoshikaId, data.items, {
            language: 'sub',
            limit: 50,
            total: data?.total ?? data.items.length,
            nextAfter: data?.nextAfter ?? null,
            availability: data?.availability,
          });
        }

        const ep: HoshikaEpisodeItem | null =
          data?.episode ||
          (Array.isArray(data?.items)
            ? data.items.find((e: HoshikaEpisodeItem) => e.number === entry.episodeNumber)
            : null);

        const anime = data?.anime;
        const resolvedAnimeTitle =
          anime?.titleEnglish ||
          anime?.titleRomaji ||
          anime?.titleLocalized ||
          entry.animeTitle ||
          entry.title;

        updateWatchHistoryMetadata({
          hoshikaId: entry.hoshikaId,
          episodeNumber: entry.episodeNumber,
          anilistId: anime?.anilistId ?? entry.anilistId ?? null,
          title: resolvedAnimeTitle,
          animeTitle: resolvedAnimeTitle,
          coverImage: anime?.coverImage || entry.coverImage || entry.animeCover,
          animeCover: anime?.coverImage || entry.animeCover || entry.coverImage,
          bannerImage: anime?.bannerImage || entry.bannerImage,
          episodeTitle: ep?.title || entry.episodeTitle,
          episodeThumbnail: ep?.thumbnail || entry.episodeThumbnail,
        });
      } catch (err) {
        console.error('Failed to enrich watch history metadata:', err);
      }
    }
  };

  await Promise.all(Array.from({ length: maxWorkers }, () => runWorker()));
}
