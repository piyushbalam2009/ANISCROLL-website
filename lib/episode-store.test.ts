import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEpisodeCacheKey,
  getRetryDelayMs,
  shouldRetryEpisodeRequest,
  selectDefaultLanguage,
  createEpisodeAvailability,
  fetchEpisodeBatchWithMeta,
  resolveEpisodeAvailability,
  resetEpisodeStoreForTests,
  isRangeCached,
} from './episode-store';

test('buildEpisodeCacheKey includes animeId, language, limit, and pagination cursor', () => {
  assert.equal(
    buildEpisodeCacheKey({ animeId: 265992, language: 'sub', limit: 50 }),
    'episodes:265992:sub:50'
  );
  assert.equal(
    buildEpisodeCacheKey({ animeId: 265992, language: 'dub', limit: 50, after: 50 }),
    'episodes:265992:dub:50:after=50'
  );
  assert.equal(
    buildEpisodeCacheKey({ animeId: 41391, language: 'sub', all: true }),
    'episodes:41391:sub:all'
  );
});

test('Test A & B: Successful episode retrieval caches result and reuses on revisit without duplicate requests', async () => {
  resetEpisodeStoreForTests();
  let fetchCount = 0;

  const mockFetch = (async () => {
    fetchCount++;
    return new Response(
      JSON.stringify({
        ok: true,
        items: [
          { id: 'ep-1', number: 1, title: 'Episode 1' },
          { id: 'ep-2', number: 2, title: 'Episode 2' },
        ],
        total: 2,
        nextAfter: null,
        availability: createEpisodeAvailability({
          subAvailable: true,
          dubAvailable: true,
          subEpisodeCount: 2,
          dubEpisodeCount: 2,
        }),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as unknown as typeof fetch;

  const first = await fetchEpisodeBatchWithMeta(265992, undefined, 50, {
    language: 'sub',
    fetchImpl: mockFetch,
  });
  assert.equal(first.ok, true);
  assert.equal(first.items.length, 2);
  assert.equal(first.fromCache, false);
  assert.equal(fetchCount, 1);
  assert.equal(isRangeCached(265992, 1, 12, 'sub'), true);

  // Revisit / subsequent request must reuse cache without calling fetch again
  const second = await fetchEpisodeBatchWithMeta(265992, undefined, 50, {
    language: 'sub',
    fetchImpl: mockFetch,
  });
  assert.equal(second.ok, true);
  assert.equal(second.items.length, 2);
  assert.equal(second.fromCache, true);
  assert.equal(fetchCount, 1);
});

test('Test C: Missing episode data retries with backoff and stops immediately when episodes become available', async () => {
  resetEpisodeStoreForTests();
  let fetchCount = 0;
  const retryAttempts: number[] = [];

  const mockFetch = (async () => {
    fetchCount++;
    if (fetchCount < 3) {
      // First 2 attempts return empty episode list
      return new Response(
        JSON.stringify({ ok: true, items: [], total: 0, nextAfter: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    // 3rd attempt resolves episodes
    return new Response(
      JSON.stringify({
        ok: true,
        items: [{ id: 'ep-1', number: 1, title: 'Awakening' }],
        total: 1,
        nextAfter: null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as unknown as typeof fetch;

  const result = await fetchEpisodeBatchWithMeta(999001, undefined, 50, {
    language: 'sub',
    fetchImpl: mockFetch,
    baseDelayScheduleMs: [0, 5, 5, 5, 5],
    onRetryAttempt: (attempt) => retryAttempts.push(attempt),
  });

  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.equal(fetchCount, 3);
  assert.deepEqual(retryAttempts, [2, 3]);

  // Subsequent call uses the cached result without retrying
  const cached = await fetchEpisodeBatchWithMeta(999001, undefined, 50, {
    language: 'sub',
    fetchImpl: mockFetch,
  });
  assert.equal(cached.fromCache, true);
  assert.equal(fetchCount, 3);
});

test('Test C (exhaustion): Stops retrying after maximum 5 attempts if episode data never appears', async () => {
  resetEpisodeStoreForTests();
  let fetchCount = 0;

  const mockFetch = (async () => {
    fetchCount++;
    return new Response(
      JSON.stringify({ ok: true, items: [], total: 0, nextAfter: null }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as unknown as typeof fetch;

  const result = await fetchEpisodeBatchWithMeta(999002, undefined, 50, {
    language: 'sub',
    fetchImpl: mockFetch,
    baseDelayScheduleMs: [0, 2, 2, 2, 2],
  });

  assert.equal(result.ok, false);
  assert.equal(result.items.length, 0);
  assert.equal(fetchCount, 5);
  assert.equal(result.attempts, 5);

  // Immediately re-calling without forceRefresh must NOT start another 5-attempt loop
  const afterExhaustion = await fetchEpisodeBatchWithMeta(999002, undefined, 50, {
    language: 'sub',
    fetchImpl: mockFetch,
    baseDelayScheduleMs: [0, 2, 2, 2, 2],
  });
  assert.equal(afterExhaustion.ok, false);
  assert.equal(fetchCount, 5);
});

test('Test D, E, F: Dynamic Sub/Dub availability and default language selection', () => {
  // Test D: Sub only
  const subOnly = createEpisodeAvailability({
    subAvailable: true,
    dubAvailable: false,
    subEpisodeCount: 12,
    dubEpisodeCount: 0,
    preferredLanguage: 'dub', // even if user preferred dub, must fall back to sub
  });
  assert.equal(subOnly.sub.available, true);
  assert.equal(subOnly.sub.status, 'resolved');
  assert.equal(subOnly.dub.available, false);
  assert.equal(subOnly.dub.status, 'unavailable');
  assert.equal(subOnly.defaultLanguage, 'sub');

  // Test E: Dub only
  const dubOnly = createEpisodeAvailability({
    subAvailable: false,
    dubAvailable: true,
    subEpisodeCount: 0,
    dubEpisodeCount: 12,
    preferredLanguage: 'sub', // even if user preferred sub, must fall back to dub
  });
  assert.equal(dubOnly.sub.available, false);
  assert.equal(dubOnly.dub.available, true);
  assert.equal(dubOnly.defaultLanguage, 'dub');

  // Test F: Both available (preserves user preference)
  const bothWithDubPref = createEpisodeAvailability({
    subAvailable: true,
    dubAvailable: true,
    subEpisodeCount: 24,
    dubEpisodeCount: 24,
    preferredLanguage: 'dub',
  });
  assert.equal(bothWithDubPref.sub.available, true);
  assert.equal(bothWithDubPref.dub.available, true);
  assert.equal(bothWithDubPref.defaultLanguage, 'dub');

  const bothDefault = createEpisodeAvailability({
    subAvailable: true,
    dubAvailable: true,
    subEpisodeCount: 24,
    dubEpisodeCount: 24,
    preferredLanguage: null,
  });
  assert.equal(bothDefault.defaultLanguage, 'sub');
});

test('Test G: Simultaneous requests for the same anime share one in-flight request and reuse availability', async () => {
  resetEpisodeStoreForTests();
  let fetchCount = 0;

  const mockFetch = (async () => {
    fetchCount++;
    await new Promise((r) => setTimeout(r, 25));
    return new Response(
      JSON.stringify({
        ok: true,
        items: [{ id: 'ep-1', number: 1, title: 'Pilot' }],
        total: 1,
        nextAfter: null,
        availability: createEpisodeAvailability({
          subAvailable: true,
          dubAvailable: false,
          subEpisodeCount: 1,
          dubEpisodeCount: 0,
        }),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as unknown as typeof fetch;

  const [r1, r2, r3, av] = await Promise.all([
    fetchEpisodeBatchWithMeta(777, undefined, 50, { language: 'sub', fetchImpl: mockFetch }),
    fetchEpisodeBatchWithMeta(777, undefined, 50, { language: 'sub', fetchImpl: mockFetch }),
    fetchEpisodeBatchWithMeta(777, undefined, 50, { language: 'sub', fetchImpl: mockFetch }),
    resolveEpisodeAvailability(777, { fetchImpl: mockFetch }),
  ]);

  assert.equal(fetchCount, 1);
  assert.equal(r1.items.length, 1);
  assert.equal(r2.items.length, 1);
  assert.equal(r3.items.length, 1);
  assert.equal(av.sub.available, true);
  assert.equal(av.dub.available, false);
});

test('Test H: Error handling — 429 Retry-After, 5xx retries, and 4xx invalid IDs do not retry forever', async () => {
  // 1. Retry-After header parsing
  assert.equal(getRetryDelayMs(2, '4', () => 0), 4000);
  // 2. Exponential backoff schedule (3s, 6s, 12s, 24s)
  assert.equal(getRetryDelayMs(1, null, () => 0), 0);
  assert.equal(getRetryDelayMs(2, null, () => 0), 3000);
  assert.equal(getRetryDelayMs(3, null, () => 0), 6000);
  assert.equal(getRetryDelayMs(4, null, () => 0), 12000);
  assert.equal(getRetryDelayMs(5, null, () => 0), 24000);

  // 3. 400/404 invalid anime ID stops after 1 attempt
  resetEpisodeStoreForTests();
  let badIdFetches = 0;
  const mock400Fetch = (async () => {
    badIdFetches++;
    return new Response(JSON.stringify({ ok: false, error: 'Invalid Anime ID' }), {
      status: 400,
    });
  }) as unknown as typeof fetch;

  const badRes = await fetchEpisodeBatchWithMeta('invalid-id', undefined, 50, {
    fetchImpl: mock400Fetch,
    baseDelayScheduleMs: [0, 1, 1, 1, 1],
  });
  assert.equal(badRes.ok, false);
  assert.equal(badIdFetches, 1);

  // 4. Temporary 503 error recovers on retry
  resetEpisodeStoreForTests();
  let server503Fetches = 0;
  const mock503Fetch = (async () => {
    server503Fetches++;
    if (server503Fetches === 1) {
      return new Response(JSON.stringify({ ok: false, error: 'Upstream unavailable' }), {
        status: 503,
      });
    }
    return new Response(
      JSON.stringify({
        ok: true,
        items: [{ id: 'ep-1', number: 1, title: 'Recovered Episode' }],
        total: 1,
        nextAfter: null,
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;

  const recovered = await fetchEpisodeBatchWithMeta(888, undefined, 50, {
    fetchImpl: mock503Fetch,
    baseDelayScheduleMs: [0, 2, 2, 2, 2],
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.items.length, 1);
  assert.equal(server503Fetches, 2);

  // 5. HTTP 429 does NOT retry aggressively and activates client cooldown
  resetEpisodeStoreForTests();
  let rlFetches = 0;
  const mock429Fetch = (async () => {
    rlFetches++;
    return new Response(JSON.stringify({ ok: false, error: 'Rate limited' }), {
      status: 429,
      headers: { 'Retry-After': '30' },
    });
  }) as unknown as typeof fetch;

  const rlRes1 = await fetchEpisodeBatchWithMeta(999, undefined, 50, {
    fetchImpl: mock429Fetch,
    baseDelayScheduleMs: [0, 1, 1, 1, 1],
  });
  assert.equal(rlRes1.ok, false);
  assert.equal(rlRes1.status, 429);
  assert.equal(rlFetches, 1);

  const rlRes2 = await fetchEpisodeBatchWithMeta(1000, undefined, 50, {
    fetchImpl: mock429Fetch,
    baseDelayScheduleMs: [0, 1, 1, 1, 1],
  });
  assert.equal(rlRes2.ok, false);
  assert.equal(rlRes2.status, 429);
  assert.equal(rlFetches, 1);
});
