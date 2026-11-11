import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isGenericEpisodeTitle,
  resolveDisplayAnimeTitle,
  resolveDisplayEpisodeTitle,
  calculateWatchProgress,
  getContinueWatchingThumbnailCandidates,
  resolveContinueWatchingThumbnail,
  mergeWatchHistoryEntry,
  needsMetadataEnrichment,
} from './continue-watching';

test('isGenericEpisodeTitle detects generic placeholders and preserves real episode titles', () => {
  assert.equal(isGenericEpisodeTitle(undefined, 1), true);
  assert.equal(isGenericEpisodeTitle('', 1), true);
  assert.equal(isGenericEpisodeTitle('Episode 1', 1), true);
  assert.equal(isGenericEpisodeTitle('EP 07', 7), true);
  assert.equal(isGenericEpisodeTitle('Naruto', 1, 'Naruto'), true);

  assert.equal(isGenericEpisodeTitle('Enter: The Land of Waves', 1, 'Naruto'), false);
  assert.equal(isGenericEpisodeTitle('Introducing: Naruto Uzumaki!', 1, 'Naruto'), false);
  assert.equal(isGenericEpisodeTitle("Pagma's Sword Dance", 7, 'Overgeared'), false);
});

test('getContinueWatchingThumbnailCandidates prioritizes episodeThumbnail -> animeCover -> bannerImage', () => {
  const candidates = getContinueWatchingThumbnailCandidates({
    episodeThumbnail: 'https://cdn.hoshika.app/catalog/episodes/41391/1-hd-90d2e39fcc.webp',
    animeCover: 'https://cdn.hoshika.app/catalog/covers/anime/41391.webp',
    bannerImage: 'https://cdn.hoshika.app/catalog/anime/41391/banner.webp',
  });

  assert.deepEqual(candidates, [
    'https://cdn.hoshika.app/catalog/episodes/41391/1-hd-90d2e39fcc.webp',
    'https://cdn.hoshika.app/catalog/covers/anime/41391.webp',
    'https://cdn.hoshika.app/catalog/anime/41391/banner.webp',
  ]);
  assert.equal(
    resolveContinueWatchingThumbnail({
      episodeThumbnail: 'https://cdn.hoshika.app/catalog/episodes/41391/1-hd-90d2e39fcc.webp',
      coverImage: 'https://cdn.hoshika.app/catalog/covers/anime/41391.webp',
    }),
    'https://cdn.hoshika.app/catalog/episodes/41391/1-hd-90d2e39fcc.webp'
  );
});

test('getContinueWatchingThumbnailCandidates falls back to animeCover when episodeThumbnail is missing', () => {
  const candidates = getContinueWatchingThumbnailCandidates({
    episodeThumbnail: undefined,
    coverImage: 'https://cdn.hoshika.app/catalog/anime/917635/cover.webp',
    bannerImage: 'https://cdn.hoshika.app/catalog/anime/917635/banner.webp',
  });

  assert.deepEqual(candidates, [
    'https://cdn.hoshika.app/catalog/anime/917635/cover.webp',
    'https://cdn.hoshika.app/catalog/anime/917635/banner.webp',
  ]);
});

test('mergeWatchHistoryEntry preserves valid metadata and never overwrites with null or generic values', () => {
  const initial = mergeWatchHistoryEntry({
    hoshikaId: 917635,
    anilistId: 212888,
    title: 'Overgeared',
    coverImage: 'https://cdn.hoshika.app/catalog/anime/917635/cover.webp',
    episodeNumber: 7,
    episodeTitle: "Pagma's Sword Dance",
    episodeThumbnail: 'https://cdn.hoshika.app/catalog/episodes/917635/7-326990578f.webp',
    currentTime: 600,
    duration: 1280,
    audioType: 'sub',
  });

  assert.equal(initial.anilistId, 212888);
  assert.equal(initial.animeTitle, 'Overgeared');
  assert.equal(initial.episodeTitle, "Pagma's Sword Dance");
  assert.equal(initial.episodeThumbnail, 'https://cdn.hoshika.app/catalog/episodes/917635/7-326990578f.webp');
  assert.equal(initial.animeCover, 'https://cdn.hoshika.app/catalog/anime/917635/cover.webp');
  assert.equal(initial.progress, 47);

  // Subsequent progress tick with missing/generic metadata must NOT wipe out valid metadata
  const updated = mergeWatchHistoryEntry(
    {
      hoshikaId: 917635,
      title: 'Overgeared',
      episodeNumber: 7,
      episodeTitle: 'Episode 7',
      episodeThumbnail: undefined,
      coverImage: undefined,
      currentTime: 1200,
      duration: 1280,
    },
    initial
  );

  assert.equal(updated.anilistId, 212888);
  assert.equal(updated.episodeTitle, "Pagma's Sword Dance");
  assert.equal(updated.episodeThumbnail, 'https://cdn.hoshika.app/catalog/episodes/917635/7-326990578f.webp');
  assert.equal(updated.animeCover, 'https://cdn.hoshika.app/catalog/anime/917635/cover.webp');
  assert.equal(updated.currentTime, 1200);
  assert.equal(updated.progress, 94);
});

test('resolveDisplayEpisodeTitle and resolveDisplayAnimeTitle handle missing metadata cleanly', () => {
  assert.equal(
    resolveDisplayAnimeTitle({ title: 'Naruto', episodeNumber: 1 }),
    'Naruto'
  );
  assert.equal(
    resolveDisplayEpisodeTitle({
      title: 'Naruto',
      episodeNumber: 1,
      episodeTitle: 'Enter: The Land of Waves',
    }),
    'Enter: The Land of Waves'
  );
  assert.equal(
    resolveDisplayEpisodeTitle({
      title: 'Naruto',
      episodeNumber: 1,
      episodeTitle: undefined,
    }),
    'Episode 1'
  );
  assert.equal(
    resolveDisplayEpisodeTitle({
      title: 'Naruto',
      episodeNumber: 1,
      episodeTitle: 'Naruto', // confused anime title as episode title -> fallback to Episode 1
    }),
    'Episode 1'
  );
});

test('calculateWatchProgress and needsMetadataEnrichment behave accurately', () => {
  assert.equal(calculateWatchProgress(180, 1420), 13);
  assert.equal(calculateWatchProgress(1200, 1280), 94);
  assert.equal(calculateWatchProgress(0, 1420), 0);

  assert.equal(
    needsMetadataEnrichment({
      hoshikaId: 41391,
      title: 'Naruto',
      episodeNumber: 1,
      episodeTitle: 'Episode 1',
      coverImage: 'https://cdn.hoshika.app/catalog/covers/anime/41391.webp',
    }),
    true
  );

  assert.equal(
    needsMetadataEnrichment({
      hoshikaId: 41391,
      title: 'Naruto',
      episodeNumber: 1,
      episodeTitle: 'Introducing: Naruto Uzumaki!',
      episodeThumbnail: 'https://cdn.hoshika.app/catalog/episodes/41391/1-hd-90d2e39fcc.webp',
      coverImage: 'https://cdn.hoshika.app/catalog/covers/anime/41391.webp',
    }),
    false
  );
});
