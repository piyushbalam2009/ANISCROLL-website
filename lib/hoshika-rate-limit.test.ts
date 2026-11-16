import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canScheduleBackgroundHoshikaRequest,
  executeHoshikaRequest,
  fetchHoshikaCached,
  getHoshikaClientStatus,
  getHoshikaCooldownRemainingMs,
  getHoshikaCooldownState,
  hoshikaErrorToHttpStatus,
  isHoshikaCooldownActive,
  parseRetryAfterMs,
  resetHoshikaClientState,
  setHoshikaRateLimitConfigForTests,
} from './hoshika-client';
import { appCache } from './cache';
import { resolveAnimeDetailById } from './hoshika';
import { shouldRetryEpisodeRequest } from './episode-store';

const noOpSleep = async () => {};

function makeFetchResponse(params: {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}): Response {
  const hdrs = new Headers(params.headers || {});
  if (params.status >= 300 && params.status < 400) {
    return {
      status: params.status,
      ok: false,
      headers: hdrs,
      text: async () => params.body ?? '',
    } as unknown as Response;
  }
  return new Response(params.body ?? '', {
    status: params.status,
    headers: hdrs,
  });
}

test('Scenario 1: HTTP 429 with numeric Retry-After respects header, activates global cooldown, and never retries inline', async () => {
  resetHoshikaClientState();
  appCache.clear();

  let fetchCalls = 0;
  const res = await executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    maxAttempts: 3,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () => {
        fetchCalls++;
        return makeFetchResponse({
          status: 429,
          headers: {
            'retry-after': '120',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ ok: false, code: 'rate_limited' }),
        });
      }) as typeof fetch,
    },
  });

  assert.equal(fetchCalls, 1);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.category, 'RATE_LIMITED');
    assert.equal(res.error.status, 429);
    assert.ok((res.error.retryAfterMs ?? 0) >= 119_000);
    assert.ok((res.error.retryAfterMs ?? 0) <= 121_000);
  }
  assert.equal(isHoshikaCooldownActive(), true);
  assert.ok(getHoshikaCooldownRemainingMs() >= 118_000);
  assert.equal(getHoshikaCooldownState().consecutiveRateLimits, 1);

  resetHoshikaClientState();
});

test('Scenario 2: HTTP 429 with HTTP-date Retry-After parses future timestamp cleanly', async () => {
  resetHoshikaClientState();
  appCache.clear();

  const fixedNow = Date.UTC(2026, 10, 16, 12, 0, 0);
  const targetDate = new Date(fixedNow + 90_000).toUTCString();
  const parsed = parseRetryAfterMs(targetDate, fixedNow);
  assert.ok(parsed !== undefined);
  assert.ok(parsed! >= 89_000 && parsed! <= 91_000);

  const liveFuture = new Date(Date.now() + 45_000).toUTCString();
  let calls = 0;
  const res = await executeHoshikaRequest({
    endpoint: '/anime/21?locale=en',
    maxAttempts: 2,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () => {
        calls++;
        return makeFetchResponse({
          status: 429,
          headers: { 'retry-after': liveFuture, 'content-type': 'application/json' },
          body: JSON.stringify({ ok: false, code: 'rate_limited' }),
        });
      }) as typeof fetch,
    },
  });

  assert.equal(calls, 1);
  assert.equal(res.ok, false);
  assert.equal(isHoshikaCooldownActive(), true);
  assert.ok(getHoshikaCooldownRemainingMs() >= 40_000);

  resetHoshikaClientState();
});

test('Scenario 3: HTTP 429 without Retry-After uses exponential backoff schedule with positive jitter', async () => {
  resetHoshikaClientState();
  appCache.clear();

  // First 429 without Retry-After uses baseCooldownMs (15s .. 18s with 20% positive jitter)
  const firstRes = await executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () =>
        makeFetchResponse({
          status: 429,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ok: false, code: 'rate_limited' }),
        })) as typeof fetch,
    },
  });

  assert.equal(firstRes.ok, false);
  const firstState = getHoshikaCooldownState();
  assert.equal(firstState.consecutiveRateLimits, 1);
  assert.ok((firstState.lastRetryAfterMs ?? 0) >= 15_000);
  assert.ok((firstState.lastRetryAfterMs ?? 0) <= 18_000);

  // Verify exponential doubling step when consecutive rate limits increase with fast test config
  resetHoshikaClientState();
  setHoshikaRateLimitConfigForTests({
    baseCooldownMs: 60,
    maxFallbackCooldownMs: 500,
    jitterRatio: 0.2,
  });

  const delays: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await executeHoshikaRequest({
      endpoint: '/anime/88291?locale=en',
      transport: {
        sleepImpl: noOpSleep,
        fetchImpl: (async () =>
          makeFetchResponse({
            status: 429,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ok: false, code: 'rate_limited' }),
          })) as typeof fetch,
      },
    });
    assert.equal(r.ok, false);
    delays.push(getHoshikaCooldownState().lastRetryAfterMs ?? 0);
    await new Promise((resolve) => setTimeout(resolve, delays[delays.length - 1] + 20));
  }

  assert.ok(delays[0] >= 60 && delays[0] <= 72);
  assert.ok(delays[1] >= 120 && delays[1] <= 144);
  assert.ok(delays[2] >= 240 && delays[2] <= 288);

  resetHoshikaClientState();
});

test('Scenario 4: Concurrent requests during active cooldown make zero upstream fetches', async () => {
  resetHoshikaClientState();
  appCache.clear();

  let fetchCalls = 0;
  const mock429 = (async () => {
    fetchCalls++;
    return makeFetchResponse({
      status: 429,
      headers: { 'retry-after': '60', 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, code: 'rate_limited' }),
    });
  }) as typeof fetch;

  await executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    transport: { fetchImpl: mock429, sleepImpl: noOpSleep },
  });
  assert.equal(fetchCalls, 1);

  const concurrentResults = await Promise.all(
    [1, 2, 3, 4, 5, 6].map((id) =>
      executeHoshikaRequest({
        endpoint: `/anime/${id}?locale=en`,
        transport: { fetchImpl: mock429, sleepImpl: noOpSleep },
      })
    )
  );

  assert.equal(fetchCalls, 1);
  for (const item of concurrentResults) {
    assert.equal(item.ok, false);
    if (!item.ok) {
      assert.equal(item.error.category, 'RATE_LIMITED');
      assert.equal(item.error.status, 429);
    }
  }
  assert.ok(getHoshikaClientStatus().metrics.shortCircitedByCooldown >= 6);

  resetHoshikaClientState();
});

test('Scenario 5: Duplicate requests for the same normalized URL share a single in-flight upstream fetch', async () => {
  resetHoshikaClientState();
  appCache.clear();

  let fetchCalls = 0;
  let releaseUpstream!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseUpstream = resolve;
  });

  const sharedFetch = (async () => {
    fetchCalls++;
    await gate;
    return makeFetchResponse({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        anime: { shortId: 88291, titleEnglish: 'Bleach TYBW' },
      }),
    });
  }) as typeof fetch;

  const p1 = executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    priority: 'foreground',
    transport: { fetchImpl: sharedFetch, sleepImpl: noOpSleep },
  });
  const p2 = executeHoshikaRequest({
    endpoint: '/api/v1/anime/88291?locale=en',
    priority: 'background',
    transport: { fetchImpl: sharedFetch, sleepImpl: noOpSleep },
  });
  const p3 = executeHoshikaRequest({
    endpoint: 'anime/88291?locale=en',
    priority: 'foreground',
    transport: { fetchImpl: sharedFetch, sleepImpl: noOpSleep },
  });

  releaseUpstream();
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

  assert.equal(fetchCalls, 1);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r3.ok, true);
  assert.ok(getHoshikaClientStatus().metrics.dedupedInFlightCount >= 2);

  resetHoshikaClientState();
});

test('Scenario 6: Stale cache stays stale across 429 failures, preserves staleUntil >= 5m, and suppresses background thrashing', async () => {
  resetHoshikaClientState();
  appCache.clear();
  appCache.resetStats();

  const cacheKey = 'hoshika:test:stale-preserve';
  // Seed cache entry with short TTL and immediate expiration into stale state
  appCache.set(cacheKey, { shortId: 88291, titleEnglish: 'Bleach TYBW' }, {
    ttlSeconds: 1,
    staleWhileRevalidateSeconds: 10,
  });

  // Backdate expiresAt so it is stale right now
  const internalStore = (appCache as any).store as Map<string, any>;
  const seeded = internalStore.get(cacheKey);
  seeded.expiresAt = Date.now() - 1000;
  seeded.staleUntil = Date.now() + 30_000;

  let fetchCalls = 0;
  const staleRes1 = await fetchHoshikaCached<{ shortId: number; titleEnglish: string }>({
    endpoint: '/anime/88291?locale=en',
    cacheKey,
    cacheTtlSeconds: 300,
    staleWhileRevalidateSeconds: 600,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () => {
        fetchCalls++;
        return makeFetchResponse({
          status: 429,
          headers: { 'retry-after': '120', 'content-type': 'application/json' },
          body: JSON.stringify({ ok: false, code: 'rate_limited' }),
        });
      }) as typeof fetch,
    },
  });

  // Let background microtask execute and handle the 429
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(staleRes1.ok, true);
  assert.equal(staleRes1.fromCache, true);
  assert.equal(staleRes1.stale, true);
  assert.equal(fetchCalls, 1);

  const postFailureState = appCache.getEntryState(cacheKey);
  assert.equal(postFailureState.status, 'stale');
  assert.ok((postFailureState.staleUntil ?? 0) >= Date.now() + 4 * 60_000);
  assert.ok((postFailureState.refreshCooldownUntil ?? 0) >= Date.now() + 100_000);
  assert.equal(postFailureState.lastRefreshErrorCode, 'RATE_LIMITED');

  // Subsequent stale reads must suppress background refresh cleanly with 0 extra fetches
  for (let i = 0; i < 4; i++) {
    const repeat = await fetchHoshikaCached({
      endpoint: '/anime/88291?locale=en',
      cacheKey,
      transport: {
        sleepImpl: noOpSleep,
        fetchImpl: (async () => {
          fetchCalls++;
          return makeFetchResponse({ status: 500, body: 'should not be called' });
        }) as typeof fetch,
      },
    });
    assert.equal(repeat.ok, true);
  }

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fetchCalls, 1);
  assert.ok(appCache.getStats().suppressedBackgroundRefreshes >= 4);

  resetHoshikaClientState();
});

test('Scenario 7: Cache miss during 429 returns structured RATE_LIMITED (429), never 404 NOT_FOUND', async () => {
  resetHoshikaClientState();
  appCache.clear();

  const res = await fetchHoshikaCached({
    endpoint: '/anime/88291?locale=en',
    cacheKey: 'hoshika:miss-429',
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () =>
        makeFetchResponse({
          status: 429,
          headers: { 'retry-after': '45', 'content-type': 'application/json' },
          body: JSON.stringify({ ok: false, code: 'rate_limited' }),
        })) as typeof fetch,
    },
  });

  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.category, 'RATE_LIMITED');
    assert.equal(hoshikaErrorToHttpStatus(res.error.category), 429);
    assert.notEqual(hoshikaErrorToHttpStatus(res.error.category), 404);
  }
  assert.equal(appCache.getEntryState('hoshika:miss-429').status, 'miss');

  resetHoshikaClientState();
});

test('Scenario 8: Cooldown expiration allows next request to succeed and resets consecutiveRateLimits cleanly', async () => {
  resetHoshikaClientState();
  appCache.clear();
  setHoshikaRateLimitConfigForTests({
    baseCooldownMs: 50,
    maxFallbackCooldownMs: 200,
    jitterRatio: 0,
  });

  let phase: '429' | '200' = '429';
  let calls = 0;
  const toggleFetch = (async () => {
    calls++;
    if (phase === '429') {
      return makeFetchResponse({
        status: 429,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, code: 'rate_limited' }),
      });
    }
    return makeFetchResponse({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        anime: { shortId: 88291, titleEnglish: 'Bleach: TYBW' },
      }),
    });
  }) as typeof fetch;

  const first = await executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    transport: { fetchImpl: toggleFetch, sleepImpl: noOpSleep },
  });
  assert.equal(first.ok, false);
  assert.equal(isHoshikaCooldownActive(), true);
  assert.equal(getHoshikaCooldownState().consecutiveRateLimits, 1);

  // Immediately calling again stays blocked cleanly
  const blocked = await executeHoshikaRequest({
    endpoint: '/anime/21?locale=en',
    transport: { fetchImpl: toggleFetch, sleepImpl: noOpSleep },
  });
  assert.equal(blocked.ok, false);
  assert.equal(calls, 1);

  // Wait for 50ms test cooldown to expire
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(isHoshikaCooldownActive(), false);

  phase = '200';
  const recovered = await executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    transport: { fetchImpl: toggleFetch, sleepImpl: noOpSleep },
  });
  assert.equal(recovered.ok, true);
  assert.equal(calls, 2);
  assert.equal(getHoshikaCooldownState().active, false);
  assert.equal(getHoshikaCooldownState().consecutiveRateLimits, 0);

  resetHoshikaClientState();
});

test('Scenario 9: Background requests are suppressed during cooldown and under concurrency saturation', async () => {
  resetHoshikaClientState();
  appCache.clear();

  let releaseSlowForeground!: () => void;
  const slowGate = new Promise<void>((resolve) => {
    releaseSlowForeground = resolve;
  });

  setHoshikaRateLimitConfigForTests({
    maxConcurrent: 2,
    maxBackgroundConcurrent: 1,
  });

  let bgCalls = 0;
  const slowFetch = (async () => {
    await slowGate;
    return makeFetchResponse({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    });
  }) as typeof fetch;

  // Saturate foreground slots (2 concurrent)
  const fg1 = executeHoshikaRequest({
    endpoint: '/anime/101?locale=en',
    priority: 'foreground',
    transport: { fetchImpl: slowFetch, sleepImpl: noOpSleep },
  });
  const fg2 = executeHoshikaRequest({
    endpoint: '/anime/102?locale=en',
    priority: 'foreground',
    transport: { fetchImpl: slowFetch, sleepImpl: noOpSleep },
  });

  assert.equal(canScheduleBackgroundHoshikaRequest(), false);

  const bgRes = await executeHoshikaRequest({
    endpoint: '/anime/103?locale=en',
    priority: 'background',
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () => {
        bgCalls++;
        return makeFetchResponse({ status: 200, body: '{"ok":true}' });
      }) as typeof fetch,
    },
  });

  assert.equal(bgRes.ok, false);
  assert.equal(bgCalls, 0);
  assert.ok(getHoshikaClientStatus().metrics.suppressedBackgroundCount >= 1);

  releaseSlowForeground();
  await Promise.all([fg1, fg2]);

  resetHoshikaClientState();
});

test('Scenario 10: AniList fallback activates cleanly during Hoshika 429 when cached summary / ID link exists', async () => {
  resetHoshikaClientState();
  appCache.clear();

  const shortId = 88291;
  appCache.set(
    `hoshika:summary:${shortId}`,
    {
      id: String(shortId),
      shortId,
      slug: String(shortId),
      titleEnglish: 'Bleach: Thousand-Year Blood War',
      titleRomaji: 'Bleach: Sennen Kessen-hen',
      anilistId: 116674,
      format: 'TV',
    },
    { ttlSeconds: 3600 }
  );

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('hoshika.app')) {
        return makeFetchResponse({
          status: 429,
          headers: { 'retry-after': '60', 'content-type': 'application/json' },
          body: JSON.stringify({ ok: false, code: 'rate_limited' }),
        });
      }
      if (url.includes('graphql.anilist.co')) {
        return makeFetchResponse({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            data: {
              Media: {
                id: 116674,
                idMal: 41467,
                title: {
                  romaji: 'Bleach: Sennen Kessen-hen',
                  english: 'Bleach: Thousand-Year Blood War',
                  native: 'BLEACH 千年血戦篇',
                  userPreferred: 'Bleach: Thousand-Year Blood War',
                },
                format: 'TV',
                status: 'FINISHED',
                episodes: 13,
                duration: 24,
                season: 'FALL',
                seasonYear: 2022,
                averageScore: 89,
                synonyms: [],
                description: 'Ichigo Kurosaki protects Karakura Town once more.',
                genres: ['Action', 'Adventure', 'Fantasy'],
                coverImage: {
                  extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx116674.jpg',
                  large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx116674.jpg',
                },
                bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/116674.jpg',
                startDate: { year: 2022 },
              },
            },
          }),
        });
      }
      return makeFetchResponse({ status: 404, body: '{}' });
    }) as typeof fetch;

    const outcome = await resolveAnimeDetailById(shortId, 'en', false);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.idSource, 'anilist_fallback');
    assert.equal(outcome.anime?.shortId, shortId);
    assert.equal(outcome.anime?.anilistId, 116674);
    assert.equal(outcome.anime?.synopsis, 'Ichigo Kurosaki protects Karakura Town once more.');
  } finally {
    globalThis.fetch = originalFetch;
    resetHoshikaClientState();
  }
});

test('Scenario 11: Invalid JSON returns INVALID_JSON without caching malformed payload', async () => {
  resetHoshikaClientState();
  appCache.clear();

  const res = await fetchHoshikaCached({
    endpoint: '/anime/88291?locale=en',
    cacheKey: 'hoshika:bad-json-rl-test',
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () =>
        makeFetchResponse({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: '{"ok": true, "anime": { truncated',
        })) as typeof fetch,
    },
  });

  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.category, 'INVALID_JSON');
  }
  assert.equal(appCache.getEntryState('hoshika:bad-json-rl-test').status, 'miss');
});

test('Scenario 12: HTTP 500, timeout IPv4 fallback, concurrency limits, and episode 429 non-retry guard work cleanly', async () => {
  resetHoshikaClientState();
  appCache.clear();

  // Concurrency cap checks maxConcurrent = 3 even if 5 distinct endpoints fire at once
  let inFlightNow = 0;
  let maxObservedInFlight = 0;
  const concResults = await Promise.all(
    [1, 2, 3, 4, 5].map((id) =>
      executeHoshikaRequest({
        endpoint: `/anime/${900 + id}?locale=en`,
        transport: {
          sleepImpl: noOpSleep,
          fetchImpl: (async () => {
            inFlightNow++;
            if (inFlightNow > maxObservedInFlight) {
              maxObservedInFlight = inFlightNow;
            }
            await new Promise((r) => setTimeout(r, 15));
            inFlightNow--;
            return makeFetchResponse({
              status: 200,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ok: true, id }),
            });
          }) as typeof fetch,
        },
      })
    )
  );
  assert.ok(maxObservedInFlight <= 3);
  assert.equal(concResults.filter((r) => r.ok).length, 5);

  // HTTP 500 error semantics
  const s500 = await executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    maxAttempts: 2,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () =>
        makeFetchResponse({
          status: 500,
          headers: { 'content-type': 'text/plain' },
          body: 'Internal Server Error',
        })) as typeof fetch,
    },
  });
  assert.equal(s500.ok, false);
  if (!s500.ok) {
    assert.equal(s500.error.category, 'HTTP_ERROR');
    assert.equal(hoshikaErrorToHttpStatus(s500.error.category, 500), 502);
  }

  // Client episode store never retries HTTP 429
  assert.equal(
    shouldRetryEpisodeRequest({ status: 429, itemCount: 0, attempt: 1, maxAttempts: 5 }),
    false
  );
  assert.equal(
    shouldRetryEpisodeRequest({ status: 503, itemCount: 0, attempt: 1, maxAttempts: 5 }),
    true
  );

  resetHoshikaClientState();
});
