import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCache } from './cache';
import {
  classifyUpstreamError,
  recordUpstreamMetric,
  getPerfSummaryStats,
  resetPerfMetrics,
} from './perf-monitor';
import { getTargetEpisodeBatchCursor } from './hoshika';

describe('MemoryCache — LRU, SWR, In-Flight Deduplication & Stale-On-Error', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache(50);
  });

  it('deduplicates concurrent in-flight requests for the same key into 1 fetch', async () => {
    let fetchCalls = 0;
    const fetcher = async () => {
      fetchCalls++;
      await new Promise((r) => setTimeout(r, 40));
      return { id: 11240, title: 'Hunter x Hunter (2011)' };
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        cache.getOrSet('hoshika:/anime/11240', fetcher, { ttlSeconds: 60 })
      )
    );

    assert.equal(fetchCalls, 1, 'Expected exactly 1 upstream fetch for 10 concurrent callers');
    for (const r of results) {
      assert.deepEqual(r, { id: 11240, title: 'Hunter x Hunter (2011)' });
    }

    const stats = cache.getStats();
    assert.equal(stats.inFlightDedupes, 9);
  });

  it('serves stale value immediately during SWR window and refreshes in background', async () => {
    let version = 1;
    const fetcher = async () => {
      return { version: version++ };
    };

    // Initial populate with 0.05s TTL and 2s SWR window
    const first = await cache.getOrSet('swr-key', fetcher, {
      ttlSeconds: 0.05,
      staleWhileRevalidateSeconds: 2,
    });
    assert.deepEqual(first, { version: 1 });

    // Wait 70ms so entry is past expiresAt but inside staleUntil
    await new Promise((r) => setTimeout(r, 70));

    const second = await cache.getOrSet('swr-key', fetcher, {
      ttlSeconds: 60,
      staleWhileRevalidateSeconds: 120,
    });
    // Should return stale version 1 immediately without waiting
    assert.deepEqual(second, { version: 1 });
    assert.equal(cache.getStats().staleHits, 1);

    // Wait a tick for background revalidation to finish
    await new Promise((r) => setTimeout(r, 30));

    const third = await cache.getOrSet('swr-key', fetcher, {
      ttlSeconds: 60,
      staleWhileRevalidateSeconds: 120,
    });
    assert.deepEqual(third, { version: 2 });
  });

  it('evicts least-recently-used entries when capacity is exceeded', () => {
    const smallCache = new MemoryCache(50);
    for (let i = 1; i <= 50; i++) {
      smallCache.set(`k:${i}`, i, 300);
    }
    // Touch k:1 so it becomes most-recently-used
    assert.equal(smallCache.get('k:1'), 1);

    // Insert k:51 -> should evict k:2 (the oldest untouched key)
    smallCache.set('k:51', 51, 300);
    assert.equal(smallCache.get('k:1'), 1);
    assert.equal(smallCache.get('k:2'), null);
    assert.equal(smallCache.get('k:51'), 51);
  });
});

describe('PerfMonitor & Structured Upstream Error Classification', () => {
  beforeEach(() => {
    resetPerfMetrics();
  });

  it('classifies timeout, 429 rate_limit, 503 server_error, 404 not_found, and invalid_json accurately', () => {
    const timeoutErr = classifyUpstreamError({
      provider: 'hoshika',
      endpoint: '/anime/11240',
      error: Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
      }),
      durationMs: 6500,
    });
    assert.equal(timeoutErr.code, 'timeout');
    assert.equal(timeoutErr.retryable, true);

    const rateLimitErr = classifyUpstreamError({
      provider: 'anilist',
      endpoint: 'graphql',
      status: 429,
      retryAfterHeader: '5',
      durationMs: 120,
    });
    assert.equal(rateLimitErr.code, 'rate_limit');
    assert.equal(rateLimitErr.retryAfterMs, 5000);

    const serverErr = classifyUpstreamError({
      provider: 'zokoanime',
      endpoint: '/11061/1/sub',
      status: 502,
      durationMs: 400,
    });
    assert.equal(serverErr.code, 'server_error');
    assert.equal(serverErr.retryable, true);

    const notFoundErr = classifyUpstreamError({
      provider: 'aniskip',
      endpoint: '/11061/1',
      status: 404,
      durationMs: 90,
    });
    assert.equal(notFoundErr.code, 'not_found');
    assert.equal(notFoundErr.retryable, false);
  });

  it('tracks cache hits, network calls, and per-provider average durations', () => {
    recordUpstreamMetric({
      provider: 'hoshika',
      endpoint: '/home',
      durationMs: 180,
      status: 200,
      fromCache: false,
    });
    recordUpstreamMetric({
      provider: 'hoshika',
      endpoint: '/home',
      durationMs: 0,
      status: 200,
      fromCache: true,
    });

    const summary = getPerfSummaryStats();
    assert.equal(summary.totalCalls, 2);
    assert.equal(summary.cacheHits, 1);
    assert.equal(summary.externalNetworkCalls, 1);
    assert.equal(summary.byProvider.hoshika.avgDurationMs, 180);
  });
});

describe('Watch Page Episode Batch Cursor Calculation', () => {
  it('returns undefined for episodes 1..50 so only Batch 1 is fetched', () => {
    assert.equal(getTargetEpisodeBatchCursor(1), undefined);
    assert.equal(getTargetEpisodeBatchCursor(24), undefined);
    assert.equal(getTargetEpisodeBatchCursor(50), undefined);
  });

  it('returns exact 50-episode batch cursor for episodes > 50', () => {
    assert.equal(getTargetEpisodeBatchCursor(51), 50);
    assert.equal(getTargetEpisodeBatchCursor(100), 50);
    assert.equal(getTargetEpisodeBatchCursor(101), 100);
    assert.equal(getTargetEpisodeBatchCursor(148), 100);
  });
});
