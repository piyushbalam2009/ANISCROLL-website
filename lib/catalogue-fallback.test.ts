import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapAniListMediaToFallbackAnime,
  mapAniListMediaListToHoshikaItems,
} from './hoshika';
import { getCurrentAnimeSeasonAndYear } from './anilist';
import {
  getPerfSummaryStats,
  recordEpisodeFailure,
  recordFallbackUsage,
  recordStreamFailure,
  recordUpstreamMetric,
  resetPerfMetrics,
} from './perf-monitor';
import {
  cacheEpisodes,
  getCachedEpisodes,
  getEpisodeStoreCacheSizes,
  MAX_ANIME_CACHE_ENTRIES,
  resetEpisodeStoreForTests,
} from './episode-store';
import { selectStreamingProvider } from './stream-provider-core';

describe('Catalogue Fallback, Bounded Episode Store & Telemetry', () => {
  beforeEach(() => {
    resetPerfMetrics();
    resetEpisodeStoreForTests();
  });

  it('maps AniList media into HoshikaAnimeItem fallback format without fabricated episodes or air dates', () => {
    const sampleMedia = {
      id: 154587,
      idMal: 52991,
      title: {
        romaji: 'Sousou no Frieren',
        english: 'Frieren: Beyond Journey’s End',
        native: '葬送のフリーレン',
      },
      description: '<p>An elf mage reflects on her journey.</p><br><i>Source: AniList</i>',
      format: 'TV',
      status: 'FINISHED',
      episodes: 28,
      duration: 24,
      season: 'FALL',
      seasonYear: 2023,
      averageScore: 91,
      genres: ['Adventure', 'Drama', 'Fantasy'],
      coverImage: {
        extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/frieren.jpg',
        large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/frieren.jpg',
        color: '#d4e6f1',
      },
      bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/frieren.jpg',
      studios: {
        nodes: [{ name: 'Madhouse' }],
      },
      synonyms: ['Frieren'],
    };

    const mapped = mapAniListMediaToFallbackAnime(99123, sampleMedia);
    assert.equal(mapped.shortId, 99123);
    assert.equal(mapped.anilistId, 154587);
    assert.equal(mapped.malId, 52991);
    assert.equal(mapped.titleEnglish, 'Frieren: Beyond Journey’s End');
    assert.equal(mapped.format, 'TV');
    assert.equal(mapped.episodes, 28);
    assert.equal(mapped.synopsis?.includes('<p>'), false);
    assert.deepEqual(mapped.studios, ['Madhouse']);

    const listMapped = mapAniListMediaListToHoshikaItems([sampleMedia]);
    assert.equal(listMapped.length, 1);
    assert.equal(listMapped[0].anilistId, 154587);
    assert.equal(listMapped[0].titleEnglish, 'Frieren: Beyond Journey’s End');
  });

  it('resolves current anime season and year deterministically', () => {
    assert.deepEqual(getCurrentAnimeSeasonAndYear(new Date('2026-02-15T00:00:00Z')), {
      season: 'WINTER',
      year: 2026,
    });
    assert.deepEqual(getCurrentAnimeSeasonAndYear(new Date('2026-05-10T00:00:00Z')), {
      season: 'SPRING',
      year: 2026,
    });
    assert.deepEqual(getCurrentAnimeSeasonAndYear(new Date('2026-08-20T00:00:00Z')), {
      season: 'SUMMER',
      year: 2026,
    });
    assert.deepEqual(getCurrentAnimeSeasonAndYear(new Date('2026-11-16T00:00:00Z')), {
      season: 'FALL',
      year: 2026,
    });
  });

  it('tracks cache hit rate percentage, AniList fallback count, episode failures, and stream failures', () => {
    recordUpstreamMetric({
      provider: 'hoshika',
      endpoint: '/anime/88291',
      durationMs: 1,
      status: 200,
      fromCache: true,
    });
    recordUpstreamMetric({
      provider: 'hoshika',
      endpoint: '/anime/88291',
      durationMs: 1,
      status: 200,
      fromCache: true,
    });
    recordUpstreamMetric({
      provider: 'hoshika',
      endpoint: '/home',
      durationMs: 2,
      status: 200,
      fromCache: true,
      staleRevalidated: true,
    });
    recordUpstreamMetric({
      provider: 'hoshika',
      endpoint: '/browse',
      durationMs: 120,
      status: 200,
      fromCache: false,
    });

    recordFallbackUsage('anilist');
    recordFallbackUsage('anilist');
    recordEpisodeFailure();
    recordStreamFailure();

    const summary = getPerfSummaryStats();
    assert.equal(summary.totalCalls, 4);
    assert.equal(summary.cacheHits, 3);
    assert.equal(summary.staleHits, 1);
    assert.equal(summary.cacheHitRatePct, 75);
    assert.equal(summary.anilistFallbackCount, 2);
    assert.equal(summary.episodeFailureCount, 1);
    assert.equal(summary.streamFailureCount, 1);
  });

  it('enforces bounded LRU eviction in episode-store when exceeding MAX_ANIME_CACHE_ENTRIES', () => {
    const totalToInsert = MAX_ANIME_CACHE_ENTRIES + 15;
    for (let i = 1; i <= totalToInsert; i++) {
      cacheEpisodes(i, [{ id: `ep-${i}-1`, number: 1, title: `Episode 1 of Anime ${i}` }]);
    }

    const sizes = getEpisodeStoreCacheSizes();
    assert.equal(sizes.animeCount, MAX_ANIME_CACHE_ENTRIES);
    assert.equal(sizes.queryCount <= MAX_ANIME_CACHE_ENTRIES, true);

    // Oldest entries (1..15) should be evicted
    assert.equal(getCachedEpisodes(1).length, 0);
    assert.equal(getCachedEpisodes(15).length, 0);

    // Newest entry should still be cached
    assert.equal(getCachedEpisodes(totalToInsert).length, 1);
    assert.equal(
      getCachedEpisodes(totalToInsert)[0].title,
      `Episode 1 of Anime ${totalToInsert}`
    );
  });

  it('routes standalone movies to zokoanime and episodic series to megaplay consistently', () => {
    assert.equal(selectStreamingProvider({ format: 'TV', isStandaloneMovie: false }), 'megaplay');
    assert.equal(selectStreamingProvider({ format: 'ONA', isStandaloneMovie: false }), 'megaplay');
    assert.equal(selectStreamingProvider({ format: 'MOVIE', isStandaloneMovie: false }), 'zokoanime');
    assert.equal(selectStreamingProvider({ format: 'SPECIAL', isStandaloneMovie: true }), 'zokoanime');
    assert.equal(selectStreamingProvider({ format: 'OVA', isStandaloneMovie: true }), 'zokoanime');
  });
});
