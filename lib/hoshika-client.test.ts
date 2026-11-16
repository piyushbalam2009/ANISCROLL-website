import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeHoshikaRequest,
  fetchHoshikaCached,
  HOSHIKA_ENDPOINTS,
  hoshikaErrorToHttpStatus,
  resetHoshikaClientState,
  resetHoshikaTransportState,
  resolveHoshikaOrigin,
} from './hoshika-client';
import {
  mapHoshikaAnimeItem,
  mapHoshikaAnimeList,
  validateHoshikaAnimeDetailPayload,
  validateHoshikaItemsPayload,
} from './hoshika-mapper';
import { appCache } from './cache';

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

test('Origin & Endpoint Builders normalize HOSHIKA_API_ORIGIN without inventing routes', () => {
  const prevOrigin = process.env.HOSHIKA_API_ORIGIN;
  try {
    delete process.env.HOSHIKA_API_ORIGIN;
    assert.equal(resolveHoshikaOrigin(), 'https://hoshika.app');

    process.env.HOSHIKA_API_ORIGIN = 'https://hoshika.app/api/v1/';
    assert.equal(resolveHoshikaOrigin(), 'https://hoshika.app');

    assert.equal(
      HOSHIKA_ENDPOINTS.animeDetail(88291, 'en'),
      '/anime/88291?locale=en'
    );
    assert.equal(
      HOSHIKA_ENDPOINTS.animeEpisodes(88291, { locale: 'en', limit: 50, after: 50 }),
      '/anime/88291/episodes?locale=en&limit=50&after=50'
    );
    assert.equal(HOSHIKA_ENDPOINTS.home('en'), '/home?locale=en');
    assert.equal(
      HOSHIKA_ENDPOINTS.browse({ type: 'anime', sort: 'top', locale: 'en' }),
      '/browse?type=anime&sort=top&locale=en'
    );
    assert.equal(HOSHIKA_ENDPOINTS.genres(), '/genres');
    assert.equal(
      HOSHIKA_ENDPOINTS.genreTitles('action', 'en'),
      '/genre/action?type=anime&locale=en'
    );
    assert.equal(HOSHIKA_ENDPOINTS.schedule('en'), '/schedule?locale=en');
  } finally {
    if (prevOrigin === undefined) delete process.env.HOSHIKA_API_ORIGIN;
    else process.env.HOSHIKA_API_ORIGIN = prevOrigin;
  }
});

test('Test A: Verified Hoshika v1 /api/v1/anime/88291 payload validation and compatibility mapping', async () => {
  appCache.clear();
  resetHoshikaTransportState();

  const sampleBleachPayload = {
    ok: true,
    anime: {
      id: '332450ee-69f6-468b-ad27-1f8ee41a35e9',
      shortId: 88291,
      slug: 'bleach-thousand-year-blood-war',
      titleRomaji: 'BLEACH: Sennen Kessen-hen',
      titleEnglish: 'Bleach: Thousand-Year Blood War',
      titleJapanese: 'BLEACH 千年血戦篇',
      titleLocalized: 'Bleach: Thousand-Year Blood War',
      synopsis: 'The peace is suddenly broken when warning sirens blare through the Soul Society.',
      coverImage: 'https://cdn.hoshika.app/covers/88291.webp',
      bannerImage: 'https://cdn.hoshika.app/banners/88291.webp',
      format: 'TV',
      status: 'FINISHED',
      season: 'FALL',
      seasonYear: 2022,
      episodes: 13,
      episodeDuration: 24,
      averageScore: 90,
      favoriteCount: 12450,
      genres: ['Action', 'Adventure', 'Supernatural'],
      studios: ['Pierrot'],
      videos: [
        { id: 'vid1', title: 'PV 1', youtubeId: '1sygUhb8Q2Y', image: null },
      ],
      relations: [
        {
          shortId: 269,
          slug: 'bleach',
          title: 'Bleach',
          relationType: 'PREQUEL',
          coverImage: 'https://cdn.hoshika.app/covers/269.webp',
          format: 'TV',
        },
      ],
      recommendations: [
        {
          shortId: 12345,
          slug: 'jujutsu-kaisen',
          title: 'Jujutsu Kaisen',
          coverImage: 'https://cdn.hoshika.app/covers/12345.webp',
          averageScore: 87,
          format: 'TV',
        },
      ],
      streaming: [{ platform: 'Hulu', url: 'https://hulu.com/bleach' }],
    },
  };

  let calledUrl = '';
  const res = await fetchHoshikaCached({
    endpoint: HOSHIKA_ENDPOINTS.animeDetail(88291, 'en'),
    cacheKey: 'hoshika:/anime/88291?locale=en',
    validator: validateHoshikaAnimeDetailPayload,
    mapper: (raw) => mapHoshikaAnimeItem((raw as any).anime)!,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async (url: RequestInfo | URL) => {
        calledUrl = String(url);
        return makeFetchResponse({
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify(sampleBleachPayload),
        });
      }) as typeof fetch,
    },
  });

  assert.equal(calledUrl, 'https://hoshika.app/api/v1/anime/88291?locale=en');
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.fromCache, false);
    assert.equal(res.data.shortId, 88291);
    assert.equal(res.data.titleEnglish, 'Bleach: Thousand-Year Blood War');
    assert.equal(res.data.trailerId, '1sygUhb8Q2Y');
    assert.equal(res.data.trailerSite, 'youtube');
    assert.equal(res.data.favoriteCount, 12450);
    assert.equal(res.data.relations?.[0]?.shortId, 269);
    assert.equal(res.data.relations?.[0]?.titleEnglish, 'Bleach');
    assert.equal(res.data.recommendations?.[0]?.shortId, 12345);
    assert.equal(res.data.streaming?.[0]?.platform, 'Hulu');
  }

  // Subsequent read hits cache
  const cachedRes = await fetchHoshikaCached({
    endpoint: HOSHIKA_ENDPOINTS.animeDetail(88291, 'en'),
    cacheKey: 'hoshika:/anime/88291?locale=en',
    validator: validateHoshikaAnimeDetailPayload,
    mapper: (raw) => mapHoshikaAnimeItem((raw as any).anime)!,
  });
  assert.equal(cachedRes.ok, true);
  if (cachedRes.ok) {
    assert.equal(cachedRes.fromCache, true);
    assert.equal(cachedRes.data.shortId, 88291);
  }
});

test('Test A2: Genre titles endpoint maps single `title` field cleanly without Unknown Title regression', () => {
  const genrePayload = {
    ok: true,
    genre: 'Action',
    type: 'anime',
    items: [
      {
        shortId: 88291,
        slug: 'bleach-thousand-year-blood-war',
        title: 'Bleach: Thousand-Year Blood War',
        coverImage: 'https://cdn.hoshika.app/covers/88291.webp',
        averageScore: 90,
        format: 'TV',
        userStatus: null,
      },
    ],
  };

  assert.equal(validateHoshikaItemsPayload(genrePayload), null);
  const mapped = mapHoshikaAnimeList(genrePayload.items);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].shortId, 88291);
  assert.equal(mapped[0].titleLocalized, 'Bleach: Thousand-Year Blood War');
  assert.equal(mapped[0].titleEnglish, 'Bleach: Thousand-Year Blood War');
});

test('Test B1: Rejects HTML webpage & HTTP 308 redirect to webpage as INVALID_RESPONSE without caching', async () => {
  appCache.clear();
  resetHoshikaTransportState();

  const htmlRes = await fetchHoshikaCached({
    endpoint: '/anime/88291?locale=en',
    cacheKey: 'test:html-response',
    maxAttempts: 2,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () =>
        makeFetchResponse({
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: '<!doctype html><html><body>Not Found</body></html>',
        })) as typeof fetch,
    },
  });

  assert.equal(htmlRes.ok, false);
  if (!htmlRes.ok) {
    assert.equal(htmlRes.error.category, 'INVALID_RESPONSE');
    assert.equal(hoshikaErrorToHttpStatus(htmlRes.error.category), 502);
  }
  assert.equal(appCache.getEntryState('test:html-response').status, 'miss');

  // HTTP 308 redirect to /anime/88291/bleach-thousand-year-blood-war webpage
  const redirectRes = await executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    maxAttempts: 2,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () =>
        makeFetchResponse({
          status: 308,
          headers: { location: '/anime/88291/bleach-thousand-year-blood-war' },
        })) as typeof fetch,
    },
  });

  assert.equal(redirectRes.ok, false);
  if (!redirectRes.ok) {
    assert.equal(redirectRes.error.category, 'INVALID_RESPONSE');
  }
});

test('Test B2: Classifies Cloudflare challenge as CLOUDFLARE_BLOCKED and never retries or caches', async () => {
  appCache.clear();
  let calls = 0;

  const cfRes = await fetchHoshikaCached({
    endpoint: '/anime/88291?locale=en',
    cacheKey: 'test:cf-block',
    maxAttempts: 3,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () => {
        calls++;
        return makeFetchResponse({
          status: 403,
          headers: {
            'content-type': 'text/html',
            server: 'cloudflare',
            'cf-mitigated': 'challenge',
            'cf-ray': 'abc123',
          },
          body: '<!doctype html><html><title>Just a moment...</title></html>',
        });
      }) as typeof fetch,
    },
  });

  assert.equal(calls, 1, 'Cloudflare challenge must NOT be aggressively retried');
  assert.equal(cfRes.ok, false);
  if (!cfRes.ok) {
    assert.equal(cfRes.error.category, 'CLOUDFLARE_BLOCKED');
    assert.equal(hoshikaErrorToHttpStatus(cfRes.error.category), 503);
  }
  assert.equal(appCache.getEntryState('test:cf-block').status, 'miss');
});

test('Test B3: HTTP 404 returns NOT_FOUND without retrying, whereas HTTP 429 & 503 retry safely', async () => {
  appCache.clear();

  let notFoundCalls = 0;
  const nfRes = await executeHoshikaRequest({
    endpoint: '/anime/999999999?locale=en',
    maxAttempts: 3,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () => {
        notFoundCalls++;
        return makeFetchResponse({
          status: 404,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ok: false, code: 'not_found' }),
        });
      }) as typeof fetch,
    },
  });
  assert.equal(notFoundCalls, 1);
  assert.equal(nfRes.ok, false);
  if (!nfRes.ok) {
    assert.equal(nfRes.error.category, 'NOT_FOUND');
    assert.equal(hoshikaErrorToHttpStatus(nfRes.error.category), 404);
  }

  resetHoshikaClientState();
  let rlCalls = 0;
  const rlRes = await executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    maxAttempts: 2,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () => {
        rlCalls++;
        return makeFetchResponse({
          status: 429,
          headers: { 'retry-after': '12', 'content-type': 'application/json' },
          body: JSON.stringify({ ok: false, error: 'Too many requests' }),
        });
      }) as typeof fetch,
    },
  });
  assert.equal(rlCalls, 1);
  assert.equal(rlRes.ok, false);
  if (!rlRes.ok) {
    assert.equal(rlRes.error.category, 'RATE_LIMITED');
    assert.equal(hoshikaErrorToHttpStatus(rlRes.error.category), 429);
  }
  // Subsequent request during cooldown must short-circuit without calling fetchImpl
  const rlSecond = await executeHoshikaRequest({
    endpoint: '/anime/21?locale=en',
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () => {
        rlCalls++;
        return makeFetchResponse({ status: 200, body: '{}' });
      }) as typeof fetch,
    },
  });
  assert.equal(rlCalls, 1);
  assert.equal(rlSecond.ok, false);
  resetHoshikaClientState();

  let s503Calls = 0;
  const s503Res = await executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    maxAttempts: 2,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () => {
        s503Calls++;
        return makeFetchResponse({
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Service unavailable' }),
        });
      }) as typeof fetch,
    },
  });
  assert.equal(s503Calls, 2);
  assert.equal(s503Res.ok, false);
  if (!s503Res.ok) {
    assert.equal(s503Res.error.category, 'UPSTREAM_UNAVAILABLE');
    assert.equal(hoshikaErrorToHttpStatus(s503Res.error.category), 503);
  }
});

test('Test B4: Invalid JSON returns INVALID_JSON without retry or cache', async () => {
  appCache.clear();
  const badJsonRes = await fetchHoshikaCached({
    endpoint: '/anime/88291?locale=en',
    cacheKey: 'test:bad-json',
    maxAttempts: 2,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () =>
        makeFetchResponse({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: '{"ok": true, "anime": { invalid_json',
        })) as typeof fetch,
    },
  });
  assert.equal(badJsonRes.ok, false);
  if (!badJsonRes.ok) {
    assert.equal(badJsonRes.error.category, 'INVALID_JSON');
  }
  assert.equal(appCache.getEntryState('test:bad-json').status, 'miss');
});

test('Test B5: Timeout/connection failure triggers safe IPv4 fallback and recovers if IPv4 works; classifies DNS & TLS errors cleanly', async () => {
  resetHoshikaTransportState();

  let ipv4FallbackCalled = false;
  const recoveredViaIpv4 = await executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    maxAttempts: 1,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () => {
        const timeoutErr = new Error('Connect Timeout Error');
        (timeoutErr as any).code = 'UND_ERR_CONNECT_TIMEOUT';
        throw timeoutErr;
      }) as typeof fetch,
      ipv4TransportImpl: async () => {
        ipv4FallbackCalled = true;
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({
            ok: true,
            anime: { shortId: 88291, titleEnglish: 'Bleach: Thousand-Year Blood War' },
          }),
          ipFamily: 'ipv4',
        };
      },
    },
  });

  assert.equal(ipv4FallbackCalled, true);
  assert.equal(recoveredViaIpv4.ok, true);
  if (recoveredViaIpv4.ok) {
    assert.equal(recoveredViaIpv4.ipFamily, 'ipv4');
  }

  // Timeout on both primary & IPv4 fallback -> TIMEOUT
  const bothTimeout = await executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    maxAttempts: 1,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () => {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        throw err;
      }) as typeof fetch,
      ipv4TransportImpl: async () => {
        const err = new Error('IPv4 timeout');
        err.name = 'TimeoutError';
        throw err;
      },
    },
  });
  assert.equal(bothTimeout.ok, false);
  if (!bothTimeout.ok) {
    assert.equal(bothTimeout.error.category, 'TIMEOUT');
    assert.equal(hoshikaErrorToHttpStatus(bothTimeout.error.category), 504);
  }

  // DNS error (ENOTFOUND -> non-retryable DNS_ERROR)
  let dnsCalls = 0;
  const dnsRes = await executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    maxAttempts: 3,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () => {
        dnsCalls++;
        const err = new Error('getaddrinfo ENOTFOUND hoshika.app');
        (err as any).code = 'ENOTFOUND';
        throw err;
      }) as typeof fetch,
    },
  });
  assert.equal(dnsCalls, 1);
  assert.equal(dnsRes.ok, false);
  if (!dnsRes.ok) {
    assert.equal(dnsRes.error.category, 'DNS_ERROR');
  }

  // TLS error (CERT_HAS_EXPIRED -> never disables TLS, non-retryable TLS_ERROR)
  let tlsCalls = 0;
  const tlsRes = await executeHoshikaRequest({
    endpoint: '/anime/88291?locale=en',
    maxAttempts: 3,
    transport: {
      sleepImpl: noOpSleep,
      fetchImpl: (async () => {
        tlsCalls++;
        const err = new Error('certificate has expired');
        (err as any).code = 'CERT_HAS_EXPIRED';
        throw err;
      }) as typeof fetch,
    },
  });
  assert.equal(tlsCalls, 1);
  assert.equal(tlsRes.ok, false);
  if (!tlsRes.ok) {
    assert.equal(tlsRes.error.category, 'TLS_ERROR');
  }
});
