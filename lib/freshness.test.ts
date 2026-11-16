import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCache } from './cache';
import {
  buildArtworkInputSignature,
  getCachedArtwork,
  setCachedArtwork,
  setCachedArtworkOverride,
  invalidateCachedArtwork,
} from './artwork/artwork-cache';
import {
  appendArtworkVersion,
  normalizeArtworkVersionToken,
  toSafeArtworkUrl,
  resolveAnimeArtwork,
} from './artwork-mapper';
import {
  cacheEpisodes,
  getCachedEpisode,
  isRangeCached,
  fetchEpisodeBatchWithMeta,
  resetEpisodeStoreForTests,
  EPISODE_CACHE_TTL_MS,
} from './episode-store';
import type { AnimeArtworkResult } from '@/types/artwork';

describe('MemoryCache — Freshness, Diagnostics, Error Preservation & Recovery', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache(50);
  });

  it('records Cache MISS -> HIT -> EXPIRED -> REFRESH diagnostics and refreshes expired entries', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { title: `Version ${calls}` };
    };

    const first = await cache.getOrSet('anime:100', fetcher, {
      ttlSeconds: 0.04,
      staleWhileRevalidateSeconds: 0,
    });
    assert.deepEqual(first, { title: 'Version 1' });

    const second = await cache.getOrSet('anime:100', fetcher, {
      ttlSeconds: 0.04,
      staleWhileRevalidateSeconds: 0,
    });
    assert.deepEqual(second, { title: 'Version 1' });

    await new Promise((r) => setTimeout(r, 60));

    const third = await cache.getOrSet('anime:100', fetcher, {
      ttlSeconds: 60,
      staleWhileRevalidateSeconds: 0,
    });
    assert.deepEqual(third, { title: 'Version 2' });
    assert.equal(calls, 2);

    const events = cache.getDiagnostics().map((d) => d.event);
    assert.ok(events.includes('Cache MISS'));
    assert.ok(events.includes('Cache HIT'));
    assert.ok(events.includes('Cache EXPIRED'));
    assert.ok(events.includes('Cache REFRESH'));
  });

  it('preserves stale fallback on failed upstream refresh and recovers cleanly when upstream succeeds', async () => {
    let mode: 'ok-1' | 'fail' | 'ok-2' = 'ok-1';
    const fetcher = async () => {
      if (mode === 'fail') {
        throw new Error('Upstream 503');
      }
      return { banner: mode === 'ok-1' ? 'old-banner.jpg' : 'new-banner.jpg' };
    };

    const v1 = await cache.getOrSet('anime:banner:1', fetcher, {
      ttlSeconds: 0.03,
      staleWhileRevalidateSeconds: 0,
    });
    assert.equal(v1.banner, 'old-banner.jpg');

    await new Promise((r) => setTimeout(r, 50));
    mode = 'fail';

    const duringOutage = await cache.getOrSet('anime:banner:1', fetcher, {
      ttlSeconds: 60,
      staleWhileRevalidateSeconds: 0,
    });
    assert.equal(duringOutage.banner, 'old-banner.jpg');
    assert.equal(cache.getStats().refreshFailures, 1);

    // forceRefresh immediately picks up recovery without overwriting with empty data
    mode = 'ok-2';
    const recovered = await cache.getOrSet('anime:banner:1', fetcher, {
      ttlSeconds: 60,
      staleWhileRevalidateSeconds: 0,
      forceRefresh: true,
    });
    assert.equal(recovered.banner, 'new-banner.jpg');
  });

  it('invalidates matching key prefixes cleanly via invalidateByPrefix', () => {
    cache.set('hoshika:/anime/42?locale=en', { id: 42 }, 300);
    cache.set('hoshika:/anime/42/episodes?locale=en', { items: [1] }, 300);
    cache.set('hoshika:/anime/99?locale=en', { id: 99 }, 300);

    const removed = cache.invalidateByPrefix('hoshika:/anime/42');
    assert.equal(removed, 2);
    assert.equal(cache.get('hoshika:/anime/42?locale=en'), null);
    assert.equal(cache.get('hoshika:/anime/42/episodes?locale=en'), null);
    assert.deepEqual(cache.get('hoshika:/anime/99?locale=en'), { id: 99 });
  });
});

describe('Artwork Cache & Mapper — Signature Invalidation, Versioning & Admin Override Priority', () => {
  beforeEach(() => {
    invalidateCachedArtwork();
  });

  it('invalidates cached artwork automatically when Hoshika banner/cover input signature changes', () => {
    const sampleArtwork: AnimeArtworkResult = {
      hoshikaId: 777,
      title: 'Sample Anime',
      backgroundUrl: 'https://cdn.hoshika.app/banner-v1.jpg',
      backgroundSource: 'hoshika_banner',
      logoUrl: null,
      logoSource: 'typography',
      posterUrl: 'https://cdn.hoshika.app/cover-v1.jpg',
      characterArtUrl: null,
      source: 'hoshika',
      fetchedAt: Date.now(),
    };

    const sig1 = buildArtworkInputSignature({
      hoshikaBanner: 'https://cdn.hoshika.app/banner-v1.jpg',
      hoshikaCover: 'https://cdn.hoshika.app/cover-v1.jpg',
    });
    setCachedArtwork(777, sampleArtwork, 60_000, sig1);

    assert.ok(getCachedArtwork(777, sig1));

    const sig2 = buildArtworkInputSignature({
      hoshikaBanner: 'https://cdn.hoshika.app/banner-v2.jpg',
      hoshikaCover: 'https://cdn.hoshika.app/cover-v1.jpg',
    });
    assert.equal(
      getCachedArtwork(777, sig2),
      null,
      'Must miss cache when upstream banner changes'
    );
  });

  it('invalidates resolved artwork immediately when Firestore override changes', () => {
    const sampleArtwork: AnimeArtworkResult = {
      hoshikaId: 888,
      title: 'Override Test',
      backgroundUrl: 'https://cdn.hoshika.app/bg.jpg',
      backgroundSource: 'hoshika_banner',
      logoUrl: 'https://cdn.hoshika.app/logo-old.png',
      logoSource: 'custom_upload',
      posterUrl: null,
      characterArtUrl: null,
      source: 'custom_override',
      fetchedAt: Date.now(),
    };

    setCachedArtworkOverride(888, {
      hoshikaId: 888,
      selectedLogoUrl: 'https://cdn.hoshika.app/logo-old.png',
      updatedAt: 1000,
    } as any);
    setCachedArtwork(888, sampleArtwork, 60_000);
    assert.ok(getCachedArtwork(888));

    setCachedArtworkOverride(888, {
      hoshikaId: 888,
      selectedLogoUrl: 'https://cdn.hoshika.app/logo-new.png',
      updatedAt: 2000,
    } as any);

    assert.equal(
      getCachedArtwork(888),
      null,
      'Resolved artwork must be evicted when override changes'
    );
  });

  it('appends deterministic ?v= version tokens cleanly without duplicating or inventing random params', () => {
    const url = 'https://cdn.example.com/logo.png';
    assert.equal(appendArtworkVersion(url, 1731450000), 'https://cdn.example.com/logo.png?v=1731450000');
    assert.equal(
      appendArtworkVersion('https://cdn.example.com/logo.png?v=100', 200),
      'https://cdn.example.com/logo.png?v=200'
    );
    assert.equal(appendArtworkVersion(url, null), url);

    const proxied = toSafeArtworkUrl(
      'https://assets.fanart.tv/fanart/test-logo.png',
      1731450000
    );
    assert.ok(proxied?.startsWith('/api/artwork-image/'));
    assert.ok(proxied?.endsWith('?v=1731450000'));

    const isoToken = normalizeArtworkVersionToken('2026-11-10T13:40:09.403Z');
    const firestoreTsToken = normalizeArtworkVersionToken({
      toMillis: () => 1794318009403,
    });
    const rawSecondsToken = normalizeArtworkVersionToken({
      seconds: 1794318009.403,
    });
    assert.equal(isoToken, 1794318009403);
    assert.equal(firestoreTsToken, isoToken);
    assert.equal(rawSecondsToken, isoToken);
  });

  it('prioritizes explicit admin-reviewed backdrop override and versions custom artwork URLs', async () => {
    setCachedArtworkOverride(99999, {
      hoshikaId: 99999,
      title: 'Test Reviewed Override',
      selectionMode: 'manual',
      reviewed: true,
      selectedLogoUrl: 'https://my-bucket.supabase.co/storage/v1/object/public/aniscroll-artwork/anime-logos/99999/logo.png',
      selectedLogoSource: 'custom_upload',
      selectedLogoLanguage: 'en',
      backgroundUrl: 'https://cdn.hoshika.app/admin-backdrop.jpg',
      posterUrl: 'https://cdn.hoshika.app/admin-poster.jpg',
      updatedAt: 987654321,
      customLogos: [
        {
          id: 'custom_1',
          url: 'https://my-bucket.supabase.co/storage/v1/object/public/aniscroll-artwork/anime-logos/99999/logo.png',
          proxyUrl: 'https://my-bucket.supabase.co/storage/v1/object/public/aniscroll-artwork/anime-logos/99999/logo.png',
          lang: 'en',
          selected: true,
        },
      ],
    } as any);

    const result = await resolveAnimeArtwork({
      hoshikaId: 99999,
      title: 'Test Reviewed Override',
      hoshikaBanner: 'https://cdn.hoshika.app/old-hoshika-banner.jpg',
      hoshikaCover: 'https://cdn.hoshika.app/old-hoshika-cover.jpg',
    });

    assert.equal(result.backgroundUrl, 'https://cdn.hoshika.app/admin-backdrop.jpg?v=987654321');
    assert.equal(result.posterUrl, 'https://cdn.hoshika.app/admin-poster.jpg?v=987654321');
    assert.equal(
      result.logoUrl,
      'https://my-bucket.supabase.co/storage/v1/object/public/aniscroll-artwork/anime-logos/99999/logo.png?v=987654321'
    );
    assert.equal(result.source, 'custom_override');
  });
});

describe('Episode Store — Expiration, Metadata Updates & Force Refresh', () => {
  beforeEach(() => {
    resetEpisodeStoreForTests();
  });

  it('updates cached episode titles and thumbnails when newer data is cached', () => {
    cacheEpisodes(
      555,
      [
        {
          id: '555-1',
          number: 1,
          title: 'Episode 1',
          thumbnail: 'https://cdn.hoshika.app/ep1-old.jpg',
        },
      ],
      { language: 'sub', limit: 50, total: 12, nextAfter: null }
    );

    assert.equal(getCachedEpisode(555, 1)?.title, 'Episode 1');

    cacheEpisodes(
      555,
      [
        {
          id: '555-1',
          number: 1,
          title: 'Cruelty',
          thumbnail: 'https://cdn.hoshika.app/ep1-new.jpg',
        },
      ],
      { language: 'sub', limit: 50, total: 12, nextAfter: null }
    );

    const updated = getCachedEpisode(555, 1);
    assert.equal(updated?.title, 'Cruelty');
    assert.equal(updated?.thumbnail, 'https://cdn.hoshika.app/ep1-new.jpg');
  });

  it('expires isRangeCached once EPISODE_CACHE_TTL_MS elapses instead of sticking in completedBatchKeys', () => {
    const realNow = Date.now;
    let fakeNow = 1_000_000;
    Date.now = () => fakeNow;

    try {
      cacheEpisodes(
        777,
        [{ id: '777-1', number: 1, title: 'Pilot', thumbnail: null }],
        { language: 'sub', limit: 50, total: 12, nextAfter: null }
      );
      assert.equal(isRangeCached(777, 1, 50, 'sub'), true);

      // Advance time past TTL
      fakeNow += EPISODE_CACHE_TTL_MS + 1000;
      assert.equal(isRangeCached(777, 1, 50, 'sub'), false);
    } finally {
      Date.now = realNow;
    }
  });

  it('appends refresh=true to /api/episodes fetch URL when forceRefresh is requested', async () => {
    const requestedUrls: string[] = [];
    const mockFetch: typeof fetch = async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          ok: true,
          items: [{ number: 1, title: 'Fresh Title', thumbnail: 'https://cdn.hoshika.app/ep1.jpg' }],
          total: 1,
          nextAfter: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await fetchEpisodeBatchWithMeta(901, undefined, 50, {
      language: 'sub',
      forceRefresh: true,
      fetchImpl: mockFetch,
    });

    assert.equal(res.ok, true);
    assert.equal(res.items[0].title, 'Fresh Title');
    assert.ok(requestedUrls[0]?.includes('refresh=true'));
  });
});
