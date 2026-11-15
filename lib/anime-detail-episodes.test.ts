import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldHideEpisodesSection,
  shouldShowEpisodesSection,
  loadAnimeDetailData,
} from './anime-detail-episodes';
import { HoshikaAnimeItem, HoshikaEpisodeItem } from '@/types/anime';

function makeAnime(overrides: Partial<HoshikaAnimeItem>): HoshikaAnimeItem {
  return {
    id: 'anime-1',
    shortId: 1001,
    slug: 'sample-anime',
    titleEnglish: 'Sample Anime',
    titleRomaji: 'Sample Anime',
    format: 'TV',
    episodes: 12,
    anilistId: 154587,
    ...overrides,
  };
}

function makeEpisodes(count: number): HoshikaEpisodeItem[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `ep-${idx + 1}`,
    number: idx + 1,
    title: `Episode ${idx + 1}`,
  }));
}

test('shouldHideEpisodesSection & shouldShowEpisodesSection handle all 7 required format cases', () => {
  // 1. MOVIE -> hide episodes
  assert.equal(shouldHideEpisodesSection({ format: 'MOVIE' }), true);
  assert.equal(shouldShowEpisodesSection({ format: 'MOVIE' }), false);
  assert.equal(shouldHideEpisodesSection({ format: 'movie' }), true);
  assert.equal(shouldHideEpisodesSection({ format: 'THEATRICAL' }), true);

  // 2. TV -> show episodes (even if title contains "Movie" or episodes is 1)
  assert.equal(shouldHideEpisodesSection({ format: 'TV' }), false);
  assert.equal(shouldShowEpisodesSection({ format: 'TV' }), true);
  assert.equal(
    shouldHideEpisodesSection(
      makeAnime({ format: 'TV', titleEnglish: 'The Movie: Series Edition', episodes: 1 })
    ),
    false
  );

  // 3. TV_SHORT -> show episodes
  assert.equal(shouldHideEpisodesSection({ format: 'TV_SHORT' }), false);
  assert.equal(shouldShowEpisodesSection({ format: 'TV_SHORT' }), true);

  // 4. OVA -> show episodes
  assert.equal(shouldHideEpisodesSection({ format: 'OVA' }), false);
  assert.equal(shouldShowEpisodesSection({ format: 'OVA' }), true);

  // 5. ONA -> show episodes
  assert.equal(shouldHideEpisodesSection({ format: 'ONA' }), false);
  assert.equal(shouldShowEpisodesSection({ format: 'ONA' }), true);

  // 6. SPECIAL -> follows standalone movie vs episodic classification
  assert.equal(
    shouldHideEpisodesSection({ format: 'SPECIAL', isStandaloneMovie: true }),
    true
  );
  assert.equal(
    shouldHideEpisodesSection({ format: 'SPECIAL', standaloneMovie: true }),
    true
  );
  assert.equal(
    shouldHideEpisodesSection({ format: 'SPECIAL', isStandaloneMovie: false }),
    false
  );
  assert.equal(shouldHideEpisodesSection({ format: 'SPECIAL' }), false);

  // 7. Unknown / missing format -> never accidentally hide episodes
  assert.equal(shouldHideEpisodesSection({ format: null }), false);
  assert.equal(shouldHideEpisodesSection({ format: undefined }), false);
  assert.equal(shouldHideEpisodesSection({ format: '' }), false);
  assert.equal(shouldHideEpisodesSection({ format: 'UNKNOWN' }), false);
  assert.equal(shouldShowEpisodesSection({ format: null }), true);
});

test('loadAnimeDetailData skips episode & availability lookups completely for MOVIE', async () => {
  let episodeCalls = 0;
  let availabilityCalls = 0;
  let artworkCalls = 0;

  const movie = makeAnime({
    shortId: 99845,
    titleEnglish: 'Gintama: The Very Final',
    format: 'MOVIE',
    episodes: 1,
    episodeDuration: 104,
  });

  const result = await loadAnimeDetailData('99845', {
    getAnime: async () => movie,
    getEpisodes: async () => {
      episodeCalls++;
      return { items: [], total: 0, nextAfter: null };
    },
    resolveArtwork: async () => {
      artworkCalls++;
      return { posterUrl: 'https://img.example/poster.jpg' } as any;
    },
    getCachedAvailability: () => {
      availabilityCalls++;
      return null;
    },
  });

  assert.equal(result.isMovie, true);
  assert.equal(result.showEpisodesSection, false);
  assert.equal(result.normalizedFormat, 'MOVIE');
  assert.deepEqual(result.episodes, []);
  assert.equal(result.totalEpisodes, 0);
  assert.equal(result.initialAvailability, null);
  assert.equal(episodeCalls, 0);
  assert.equal(availabilityCalls, 0);
  assert.equal(artworkCalls, 1);
  assert.equal(result.anime?.shortId, 99845);
});

test('loadAnimeDetailData skips episode lookups for standalone SPECIAL movie, keeps episodic SPECIAL', async () => {
  let standaloneEpCalls = 0;
  const standaloneResult = await loadAnimeDetailData('77001', {
    getAnime: async () =>
      makeAnime({ shortId: 77001, format: 'SPECIAL', isStandaloneMovie: true, episodes: 1 }),
    getEpisodes: async () => {
      standaloneEpCalls++;
      return { items: [], total: 0, nextAfter: null };
    },
    resolveArtwork: async () => null,
    getCachedAvailability: () => null,
  });

  assert.equal(standaloneResult.isMovie, true);
  assert.equal(standaloneResult.showEpisodesSection, false);
  assert.equal(standaloneEpCalls, 0);

  let episodicEpCalls = 0;
  const episodicResult = await loadAnimeDetailData('77002', {
    getAnime: async () =>
      makeAnime({ shortId: 77002, format: 'SPECIAL', isStandaloneMovie: false, episodes: 4 }),
    getEpisodes: async () => {
      episodicEpCalls++;
      return { items: makeEpisodes(4), total: 4, nextAfter: null };
    },
    resolveArtwork: async () => null,
    getCachedAvailability: () => null,
  });

  assert.equal(episodicResult.isMovie, false);
  assert.equal(episodicResult.showEpisodesSection, true);
  assert.equal(episodicEpCalls, 1);
  assert.equal(episodicResult.episodes.length, 4);
});

test('loadAnimeDetailData preserves episodes and lookups for TV, TV_SHORT, OVA, ONA, and unknown formats', async () => {
  const formats: Array<{ format: string | null | undefined; epCount: number }> = [
    { format: 'TV', epCount: 28 },
    { format: 'TV_SHORT', epCount: 12 },
    { format: 'OVA', epCount: 6 },
    { format: 'ONA', epCount: 10 },
    { format: 'UNKNOWN', epCount: 12 },
    { format: null, epCount: 12 },
  ];

  for (const tc of formats) {
    let episodeCalls = 0;
    let availabilityCalls = 0;

    const result = await loadAnimeDetailData('26178', {
      getAnime: async () =>
        makeAnime({
          shortId: 26178,
          format: tc.format ?? null,
          episodes: tc.epCount,
        }),
      getEpisodes: async () => {
        episodeCalls++;
        return { items: makeEpisodes(tc.epCount), total: tc.epCount, nextAfter: null };
      },
      resolveArtwork: async () => null,
      getCachedAvailability: () => {
        availabilityCalls++;
        return null;
      },
    });

    assert.equal(result.isMovie, false, `Expected isMovie=false for format=${String(tc.format)}`);
    assert.equal(
      result.showEpisodesSection,
      true,
      `Expected showEpisodesSection=true for format=${String(tc.format)}`
    );
    assert.equal(episodeCalls, 1, `Expected 1 getEpisodes call for format=${String(tc.format)}`);
    assert.equal(
      availabilityCalls,
      1,
      `Expected 1 availability lookup for format=${String(tc.format)}`
    );
    assert.equal(result.episodes.length, tc.epCount);
  }
});
