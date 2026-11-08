interface CacheItem<T> {
  data: T;
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheItem<any>>();

  get<T>(key: string): T | null {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.data as T;
  }

  set<T>(key: string, data: T, ttlSeconds: number = 3600): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const appCache = new MemoryCache();
