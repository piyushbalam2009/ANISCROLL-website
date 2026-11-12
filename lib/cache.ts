interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
  staleUntil: number;
}

export interface CacheSetOptions {
  ttlSeconds?: number;
  staleWhileRevalidateSeconds?: number;
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
}

export interface CacheStats {
  size: number;
  maxEntries: number;
  hits: number;
  staleHits: number;
  misses: number;
  inFlightDedupes: number;
  evictions: number;
  backgroundRevalidations: number;
}

export class MemoryCache {
  private store = new Map<string, CacheEntry<any>>();
  private inFlight = new Map<string, Promise<any>>();
  private backgroundRefreshing = new Set<string>();
  private readonly maxEntries: number;

  private stats = {
    hits: 0,
    staleHits: 0,
    misses: 0,
    inFlightDedupes: 0,
    evictions: 0,
    backgroundRevalidations: 0,
  };

  constructor(maxEntries: number = 1500) {
    this.maxEntries = Math.max(50, maxEntries);
  }

  /**
   * Get a fresh value from the cache.
   * Promotes the key in Map insertion order to maintain LRU behavior.
   */
  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    const now = Date.now();
    if (now > entry.expiresAt) {
      if (now > entry.staleUntil) {
        this.store.delete(key);
      }
      this.stats.misses++;
      return null;
    }

    // Refresh LRU order
    this.store.delete(key);
    this.store.set(key, entry);
    this.stats.hits++;
    return entry.value as T;
  }

  /**
   * Inspect an entry including whether it is fresh or within its stale-while-revalidate window.
   */
  getEntryState<T>(key: string): {
    status: 'fresh' | 'stale' | 'miss';
    value: T | null;
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
      return { status: 'fresh', value: entry.value as T };
    }

    if (now <= entry.staleUntil) {
      return { status: 'stale', value: entry.value as T };
    }

    this.store.delete(key);
    return { status: 'miss', value: null };
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

  /**
   * Deduplicated cache read-through helper with Stale-While-Revalidate (SWR)
   * and stale-on-error fallback.
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
    } = options;

    let staleFallbackValue: T | null = null;
    let hasStaleFallback = false;

    if (!forceRefresh) {
      const state = this.getEntryState<T>(key);
      if (state.status === 'fresh') {
        this.stats.hits++;
        return state.value as T;
      }

      if (state.status === 'stale') {
        this.stats.staleHits++;
        staleFallbackValue = state.value;
        hasStaleFallback = true;
        this.triggerBackgroundRevalidate(key, fetcher, {
          ttlSeconds,
          staleWhileRevalidateSeconds,
          shouldCache,
          negativeTtlSeconds,
        });
        return state.value as T;
      }

      this.stats.misses++;
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
        } else if (negativeTtlSeconds > 0) {
          this.set(key, result, {
            ttlSeconds: negativeTtlSeconds,
            staleWhileRevalidateSeconds: 0,
          });
        } else if (serveStaleOnError && hasStaleFallback && staleFallbackValue !== null) {
          return staleFallbackValue;
        }
        return result;
      } catch (err) {
        if (serveStaleOnError && hasStaleFallback && staleFallbackValue !== null) {
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
    }
  ): void {
    if (this.backgroundRefreshing.has(key) || this.inFlight.has(key)) {
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
        } else if (options.negativeTtlSeconds > 0) {
          this.set(key, result, {
            ttlSeconds: options.negativeTtlSeconds,
            staleWhileRevalidateSeconds: 0,
          });
        }
      })
      .catch(() => {
        // Keep stale entry until staleUntil expires
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

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
    this.backgroundRefreshing.clear();
  }

  getInFlightCount(): number {
    return this.inFlight.size;
  }

  getStats(): CacheStats {
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      ...this.stats,
    };
  }

  resetStats(): void {
    this.stats = {
      hits: 0,
      staleHits: 0,
      misses: 0,
      inFlightDedupes: 0,
      evictions: 0,
      backgroundRevalidations: 0,
    };
  }
}

export const appCache = new MemoryCache(1500);
