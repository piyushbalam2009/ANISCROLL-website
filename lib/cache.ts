interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
  staleUntil: number;
  lastRefreshFailedAt?: number;
  refreshCooldownUntil?: number;
  lastRefreshErrorCode?: string;
}

export type CacheDiagnosticEventType =
  | 'Cache HIT'
  | 'Cache STALE'
  | 'Cache STALE FALLBACK'
  | 'Cache MISS'
  | 'Cache EXPIRED'
  | 'Cache REFRESH'
  | 'Cache REFRESH FAILED'
  | 'Cache SUPPRESSED';

export interface CacheDiagnosticEvent {
  event: CacheDiagnosticEventType;
  key: string;
  detail?: string;
  timestamp: number;
}

export interface CacheSetOptions {
  ttlSeconds?: number;
  staleWhileRevalidateSeconds?: number;
}

export interface CacheRefreshCooldownInfo {
  cooldownMs: number;
  errorCode?: string;
}

export interface CacheGetOrSetOptions<T> extends CacheSetOptions {
  /**
   * Optional predicate to decide whether a resolved value should be cached.
   * For example, avoid caching null/empty responses or assign a shorter negative-cache TTL.
   */
  shouldCache?: (value: T) => boolean;
  /**
   * Optional negative cache TTL in seconds when `shouldCache` returns false or value is null/undefined.
   * If omitted or 0, rejected/unmatched values are not cached.
   */
  negativeTtlSeconds?: number;
  /**
   * If true (default), return a stale cached value if the live fetcher throws or returns null/undefined.
   */
  serveStaleOnError?: boolean;
  /**
   * If true, bypass existing cache and force a fresh fetch.
   */
  forceRefresh?: boolean;
  /**
   * Optional separate fetcher for background SWR revalidation (e.g., priority: 'background').
   */
  backgroundFetcher?: () => Promise<T>;
  /**
   * Optional predicate checked before launching a background SWR refresh.
   * Returning true suppresses the background fetch without dropping stale cached data.
   */
  shouldSuppressBackgroundRefresh?: (meta: {
    key: string;
    refreshCooldownUntil?: number;
    lastRefreshFailedAt?: number;
    lastRefreshErrorCode?: string;
  }) => boolean;
  /**
   * Default negative cooldown window applied after a failed refresh when serving stale data.
   */
  negativeRefreshCooldownMs?: number;
  /**
   * Optional resolver to compute a dynamic cooldown (e.g. Retry-After from HTTP 429) on error.
   */
  getRefreshCooldownMs?: (err: unknown) => CacheRefreshCooldownInfo | null;
}

export interface CacheStats {
  size: number;
  maxEntries: number;
  hits: number;
  staleHits: number;
  staleFallbacks: number;
  misses: number;
  expired: number;
  refreshes: number;
  refreshFailures: number;
  inFlightDedupes: number;
  evictions: number;
  backgroundRevalidations: number;
  suppressedBackgroundRefreshes: number;
  activeBackgroundRefreshes: number;
}

const MAX_DIAGNOSTIC_EVENTS = 200;
const DEFAULT_NEGATIVE_REFRESH_COOLDOWN_MS = 15_000;
const MIN_PRESERVED_STALE_WINDOW_MS = 5 * 60 * 1000;

export class MemoryCache {
  private store = new Map<string, CacheEntry<any>>();
  private inFlight = new Map<string, Promise<any>>();
  private backgroundRefreshing = new Set<string>();
  private diagnostics: CacheDiagnosticEvent[] = [];
  private readonly maxEntries: number;
  private readonly maxBackgroundConcurrent: number;

  private stats = {
    hits: 0,
    staleHits: 0,
    staleFallbacks: 0,
    misses: 0,
    expired: 0,
    refreshes: 0,
    refreshFailures: 0,
    inFlightDedupes: 0,
    evictions: 0,
    backgroundRevalidations: 0,
    suppressedBackgroundRefreshes: 0,
  };

  constructor(maxEntries: number = 1500, maxBackgroundConcurrent: number = 1) {
    this.maxEntries = Math.max(50, maxEntries);
    this.maxBackgroundConcurrent = Math.max(1, maxBackgroundConcurrent);
  }

  private recordDiagnostic(
    event: CacheDiagnosticEventType,
    key: string,
    detail?: string
  ): void {
    const item: CacheDiagnosticEvent = {
      event,
      key,
      detail,
      timestamp: Date.now(),
    };
    this.diagnostics.push(item);
    if (this.diagnostics.length > MAX_DIAGNOSTIC_EVENTS) {
      this.diagnostics.shift();
    }

    const isRateLimitedDetail =
      typeof detail === 'string' &&
      (detail.includes('RATE_LIMITED') || detail.includes('429'));

    const shouldLog =
      typeof process !== 'undefined' &&
      process.env.NODE_ENV !== 'test' &&
      (process.env.ANISCROLL_CACHE_LOG === 'true' ||
        (event === 'Cache REFRESH FAILED' && !isRateLimitedDetail));

    if (shouldLog) {
      console.info(
        `[AniScroll][${event}] key="${key}"${detail ? ` (${detail})` : ''}`
      );
    }
  }

  /**
   * Get a fresh value from the cache.
   * Promotes the key in Map insertion order to maintain LRU behavior.
   */
  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.stats.misses++;
      this.recordDiagnostic('Cache MISS', key);
      return null;
    }

    const now = Date.now();
    if (now > entry.expiresAt) {
      if (now > entry.staleUntil) {
        this.store.delete(key);
      }
      this.stats.expired++;
      this.stats.misses++;
      this.recordDiagnostic('Cache EXPIRED', key);
      return null;
    }

    // Refresh LRU order
    this.store.delete(key);
    this.store.set(key, entry);
    this.stats.hits++;
    this.recordDiagnostic('Cache HIT', key);
    return entry.value as T;
  }

  /**
   * Inspect an entry including whether it is fresh, within its stale-while-revalidate window,
   * expired past staleUntil, or a complete cache miss.
   */
  getEntryState<T>(key: string): {
    status: 'fresh' | 'stale' | 'expired' | 'miss';
    value: T | null;
    createdAt?: number;
    expiresAt?: number;
    staleUntil?: number;
    refreshCooldownUntil?: number;
    lastRefreshFailedAt?: number;
    lastRefreshErrorCode?: string;
  } {
    const entry = this.store.get(key);
    if (!entry) {
      return { status: 'miss', value: null };
    }

    const now = Date.now();
    if (now <= entry.expiresAt) {
      // Refresh LRU order
      this.store.delete(key);
      this.store.set(key, entry);
      return {
        status: 'fresh',
        value: entry.value as T,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        staleUntil: entry.staleUntil,
        refreshCooldownUntil: entry.refreshCooldownUntil,
        lastRefreshFailedAt: entry.lastRefreshFailedAt,
        lastRefreshErrorCode: entry.lastRefreshErrorCode,
      };
    }

    if (now <= entry.staleUntil) {
      return {
        status: 'stale',
        value: entry.value as T,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        staleUntil: entry.staleUntil,
        refreshCooldownUntil: entry.refreshCooldownUntil,
        lastRefreshFailedAt: entry.lastRefreshFailedAt,
        lastRefreshErrorCode: entry.lastRefreshErrorCode,
      };
    }

    const expiredVal = entry.value as T;
    this.store.delete(key);
    return {
      status: 'expired',
      value: expiredVal,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      staleUntil: entry.staleUntil,
      refreshCooldownUntil: entry.refreshCooldownUntil,
      lastRefreshFailedAt: entry.lastRefreshFailedAt,
      lastRefreshErrorCode: entry.lastRefreshErrorCode,
    };
  }

  /**
   * Set a value in the cache with TTL and optional Stale-While-Revalidate window.
   * Evicts least-recently-used (oldest) entries when capacity is exceeded.
   */
  set<T>(
    key: string,
    value: T,
    ttlSecondsOrOptions: number | CacheSetOptions = 300
  ): void {
    const ttlSeconds =
      typeof ttlSecondsOrOptions === 'number'
        ? ttlSecondsOrOptions
        : ttlSecondsOrOptions.ttlSeconds ?? 300;

    const swrSeconds =
      typeof ttlSecondsOrOptions === 'number'
        ? Math.min(ttlSeconds * 2, 1800)
        : ttlSecondsOrOptions.staleWhileRevalidateSeconds ??
          Math.min(ttlSeconds * 2, 1800);

    if (ttlSeconds <= 0) {
      this.store.delete(key);
      return;
    }

    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      this.evictOldest();
    }

    const now = Date.now();
    const expiresAt = now + ttlSeconds * 1000;
    const staleUntil = expiresAt + Math.max(0, swrSeconds) * 1000;

    this.store.set(key, {
      value,
      createdAt: now,
      expiresAt,
      staleUntil,
    });
  }

  private preserveStaleEntryOnFailure<T>(
    key: string,
    fallbackValue: T,
    previousCreatedAt: number | undefined,
    previousStaleUntil: number | undefined,
    cooldownMs: number,
    errorCode?: string
  ): void {
    const now = Date.now();
    const safeCooldownMs = Math.max(1000, cooldownMs);
    const preservedStaleUntil = Math.max(
      now + Math.max(safeCooldownMs, MIN_PRESERVED_STALE_WINDOW_MS),
      previousStaleUntil ?? 0
    );

    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      this.evictOldest();
    }

    // Keep expiresAt in the past so the entry remains clearly marked as 'stale'
    // rather than 'fresh', while refreshCooldownUntil blocks upstream thrashing.
    this.store.set(key, {
      value: fallbackValue,
      createdAt: previousCreatedAt ?? now,
      expiresAt: now - 1,
      staleUntil: preservedStaleUntil,
      lastRefreshFailedAt: now,
      refreshCooldownUntil: now + safeCooldownMs,
      lastRefreshErrorCode: errorCode,
    });
  }

  /**
   * Deduplicated cache read-through helper with Stale-While-Revalidate (SWR),
   * negative refresh cooldowns, background refresh suppression, and stale-on-error fallback.
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheGetOrSetOptions<T> = {}
  ): Promise<T> {
    const {
      ttlSeconds = 300,
      staleWhileRevalidateSeconds = Math.min(ttlSeconds * 2, 1800),
      shouldCache = (val: T) => val !== null && val !== undefined,
      negativeTtlSeconds = 0,
      serveStaleOnError = true,
      forceRefresh = false,
      backgroundFetcher,
      shouldSuppressBackgroundRefresh,
      negativeRefreshCooldownMs = DEFAULT_NEGATIVE_REFRESH_COOLDOWN_MS,
      getRefreshCooldownMs,
    } = options;

    let staleFallbackValue: T | null = null;
    let hasStaleFallback = false;
    let previousCreatedAt: number | undefined;
    let previousStaleUntil: number | undefined;

    if (!forceRefresh) {
      const state = this.getEntryState<T>(key);
      if (state.status === 'fresh') {
        this.stats.hits++;
        this.recordDiagnostic('Cache HIT', key);
        return state.value as T;
      }

      if (state.status === 'stale') {
        this.stats.staleHits++;
        staleFallbackValue = state.value;
        hasStaleFallback = true;
        previousCreatedAt = state.createdAt;
        previousStaleUntil = state.staleUntil;
        this.recordDiagnostic('Cache STALE', key, 'serving stale & evaluating revalidation');
        this.triggerBackgroundRevalidate(key, backgroundFetcher || fetcher, {
          ttlSeconds,
          staleWhileRevalidateSeconds,
          shouldCache,
          negativeTtlSeconds,
          shouldSuppressBackgroundRefresh,
          negativeRefreshCooldownMs,
          getRefreshCooldownMs,
        });
        return state.value as T;
      }

      if (state.status === 'expired') {
        this.stats.expired++;
        this.stats.misses++;
        if (state.value !== null && state.value !== undefined) {
          staleFallbackValue = state.value;
          hasStaleFallback = true;
          previousCreatedAt = state.createdAt;
          previousStaleUntil = state.staleUntil;
        }
        this.recordDiagnostic('Cache EXPIRED', key, 'fetching fresh data');
      } else {
        this.stats.misses++;
        this.recordDiagnostic('Cache MISS', key);
      }
    } else {
      const existing = this.store.get(key);
      if (existing && existing.value !== null && existing.value !== undefined) {
        staleFallbackValue = existing.value as T;
        hasStaleFallback = true;
        previousCreatedAt = existing.createdAt;
        previousStaleUntil = existing.staleUntil;
      }
      this.recordDiagnostic('Cache REFRESH', key, 'forced refresh');
    }

    // Deduplicate concurrent in-flight requests for the same key
    const existingPromise = this.inFlight.get(key);
    if (existingPromise && !forceRefresh) {
      this.stats.inFlightDedupes++;
      return existingPromise as Promise<T>;
    }

    const fetchPromise = (async (): Promise<T> => {
      try {
        const result = await fetcher();
        if (shouldCache(result)) {
          this.set(key, result, {
            ttlSeconds,
            staleWhileRevalidateSeconds,
          });
          this.stats.refreshes++;
          this.recordDiagnostic('Cache REFRESH', key, `ttl=${ttlSeconds}s`);
          return result;
        } else if (negativeTtlSeconds > 0) {
          if (serveStaleOnError && hasStaleFallback && staleFallbackValue !== null) {
            this.stats.refreshFailures++;
            this.stats.staleFallbacks++;
            this.preserveStaleEntryOnFailure(
              key,
              staleFallbackValue,
              previousCreatedAt,
              previousStaleUntil,
              negativeRefreshCooldownMs,
              'INVALID_RESPONSE'
            );
            this.recordDiagnostic(
              'Cache STALE FALLBACK',
              key,
              'empty/invalid upstream response; preserving previous cached data'
            );
            return staleFallbackValue;
          }
          this.set(key, result, {
            ttlSeconds: negativeTtlSeconds,
            staleWhileRevalidateSeconds: 0,
          });
          return result;
        } else if (serveStaleOnError && hasStaleFallback && staleFallbackValue !== null) {
          this.stats.refreshFailures++;
          this.stats.staleFallbacks++;
          this.preserveStaleEntryOnFailure(
            key,
            staleFallbackValue,
            previousCreatedAt,
            previousStaleUntil,
            negativeRefreshCooldownMs,
            'INVALID_RESPONSE'
          );
          this.recordDiagnostic(
            'Cache STALE FALLBACK',
            key,
            'upstream returned uncacheable response; serving fallback without dropping stale data'
          );
          return staleFallbackValue;
        }
        return result;
      } catch (err: any) {
        this.stats.refreshFailures++;
        const cooldownInfo = getRefreshCooldownMs ? getRefreshCooldownMs(err) : null;
        const cooldownMs = cooldownInfo?.cooldownMs ?? negativeRefreshCooldownMs;
        const errCode = cooldownInfo?.errorCode;

        this.recordDiagnostic(
          'Cache REFRESH FAILED',
          key,
          `${errCode ? `${errCode}: ` : ''}${err?.message || 'upstream fetcher threw error'}`
        );
        if (serveStaleOnError && hasStaleFallback && staleFallbackValue !== null) {
          this.stats.staleFallbacks++;
          this.preserveStaleEntryOnFailure(
            key,
            staleFallbackValue,
            previousCreatedAt,
            previousStaleUntil,
            cooldownMs,
            errCode
          );
          return staleFallbackValue;
        }
        throw err;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, fetchPromise);
    return fetchPromise;
  }

  private triggerBackgroundRevalidate<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: {
      ttlSeconds: number;
      staleWhileRevalidateSeconds: number;
      shouldCache: (val: T) => boolean;
      negativeTtlSeconds: number;
      shouldSuppressBackgroundRefresh?: CacheGetOrSetOptions<T>['shouldSuppressBackgroundRefresh'];
      negativeRefreshCooldownMs: number;
      getRefreshCooldownMs?: CacheGetOrSetOptions<T>['getRefreshCooldownMs'];
    }
  ): void {
    if (this.backgroundRefreshing.has(key) || this.inFlight.has(key)) {
      return;
    }

    const currentEntry = this.store.get(key);
    const now = Date.now();
    if (
      currentEntry?.refreshCooldownUntil &&
      now < currentEntry.refreshCooldownUntil
    ) {
      this.stats.suppressedBackgroundRefreshes++;
      this.recordDiagnostic(
        'Cache SUPPRESSED',
        key,
        `negative refresh cooldown active (${Math.ceil(
          (currentEntry.refreshCooldownUntil - now) / 1000
        )}s)`
      );
      return;
    }

    if (this.backgroundRefreshing.size >= this.maxBackgroundConcurrent) {
      this.stats.suppressedBackgroundRefreshes++;
      this.recordDiagnostic(
        'Cache SUPPRESSED',
        key,
        `background concurrency limit (${this.maxBackgroundConcurrent}) reached`
      );
      return;
    }

    if (
      options.shouldSuppressBackgroundRefresh &&
      options.shouldSuppressBackgroundRefresh({
        key,
        refreshCooldownUntil: currentEntry?.refreshCooldownUntil,
        lastRefreshFailedAt: currentEntry?.lastRefreshFailedAt,
        lastRefreshErrorCode: currentEntry?.lastRefreshErrorCode,
      })
    ) {
      this.stats.suppressedBackgroundRefreshes++;
      this.recordDiagnostic(
        'Cache SUPPRESSED',
        key,
        'caller suppressed background refresh (e.g. upstream cooldown)'
      );
      return;
    }

    this.backgroundRefreshing.add(key);
    this.stats.backgroundRevalidations++;

    Promise.resolve()
      .then(() => fetcher())
      .then((result) => {
        if (options.shouldCache(result)) {
          this.set(key, result, {
            ttlSeconds: options.ttlSeconds,
            staleWhileRevalidateSeconds: options.staleWhileRevalidateSeconds,
          });
          this.stats.refreshes++;
          this.recordDiagnostic('Cache REFRESH', key, 'background SWR success');
        } else {
          this.stats.refreshFailures++;
          this.recordDiagnostic(
            'Cache REFRESH FAILED',
            key,
            'background SWR returned empty/uncacheable result'
          );
          const current = this.store.get(key);
          if (current) {
            const cooldownMs = Math.max(1000, options.negativeRefreshCooldownMs);
            const t = Date.now();
            current.lastRefreshFailedAt = t;
            current.refreshCooldownUntil = t + cooldownMs;
            current.lastRefreshErrorCode = 'INVALID_RESPONSE';
            // Preserve valid stale entry across failure instead of collapsing staleUntil to 15s
            current.staleUntil = Math.max(
              current.staleUntil,
              t + Math.max(cooldownMs, MIN_PRESERVED_STALE_WINDOW_MS)
            );
          }
        }
      })
      .catch((err: any) => {
        this.stats.refreshFailures++;
        const cooldownInfo = options.getRefreshCooldownMs
          ? options.getRefreshCooldownMs(err)
          : null;
        const cooldownMs = Math.max(
          1000,
          cooldownInfo?.cooldownMs ?? options.negativeRefreshCooldownMs
        );
        const errCode = cooldownInfo?.errorCode;

        this.recordDiagnostic(
          'Cache REFRESH FAILED',
          key,
          `${errCode ? `${errCode}: ` : ''}${err?.message || 'background SWR error'}`
        );
        const current = this.store.get(key);
        if (current) {
          const t = Date.now();
          current.lastRefreshFailedAt = t;
          current.refreshCooldownUntil = t + cooldownMs;
          current.lastRefreshErrorCode = errCode;
          // Preserve valid stale entry instead of shrinking staleUntil to 15s (stops thrashing)
          current.staleUntil = Math.max(
            current.staleUntil,
            t + Math.max(cooldownMs, MIN_PRESERVED_STALE_WINDOW_MS)
          );
        }
      })
      .finally(() => {
        this.backgroundRefreshing.delete(key);
      });
  }

  private evictOldest(): void {
    const now = Date.now();
    // First sweep any completely expired entries (past staleUntil)
    for (const [k, v] of this.store.entries()) {
      if (now > v.staleUntil) {
        this.store.delete(k);
        this.stats.evictions++;
        if (this.store.size < this.maxEntries) {
          return;
        }
      }
    }

    // Evict oldest LRU entry (first key in Map iteration order)
    const oldestKey = this.store.keys().next().value;
    if (oldestKey !== undefined) {
      this.store.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      if (Date.now() > entry.staleUntil) {
        this.store.delete(key);
      }
      return false;
    }
    return true;
  }

  delete(key: string): void {
    this.store.delete(key);
    this.inFlight.delete(key);
    this.backgroundRefreshing.delete(key);
  }

  /**
   * Invalidates all cached entries whose key starts with any of the provided prefixes
   * or contains the given substring. Returns the count of deleted keys.
   */
  invalidateByPrefix(prefix: string): number {
    if (!prefix) return 0;
    let deleted = 0;
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) {
        this.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  invalidateMatching(predicate: (key: string) => boolean): number {
    let deleted = 0;
    for (const key of Array.from(this.store.keys())) {
      if (predicate(key)) {
        this.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
    this.backgroundRefreshing.clear();
  }

  getInFlightCount(): number {
    return this.inFlight.size;
  }

  getBackgroundRefreshingCount(): number {
    return this.backgroundRefreshing.size;
  }

  getDiagnostics(limit: number = 50): CacheDiagnosticEvent[] {
    return this.diagnostics.slice(-Math.max(1, limit));
  }

  getStats(): CacheStats {
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      ...this.stats,
      activeBackgroundRefreshes: this.backgroundRefreshing.size,
    };
  }

  resetStats(): void {
    this.stats = {
      hits: 0,
      staleHits: 0,
      staleFallbacks: 0,
      misses: 0,
      expired: 0,
      refreshes: 0,
      refreshFailures: 0,
      inFlightDedupes: 0,
      evictions: 0,
      backgroundRevalidations: 0,
      suppressedBackgroundRefreshes: 0,
    };
    this.diagnostics = [];
  }
}

export const appCache = new MemoryCache(1500, 1);
