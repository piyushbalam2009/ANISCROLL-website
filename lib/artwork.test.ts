import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickBestFanartImage,
  CURATED_FANART_ARTWORK,
} from './fanart.ts';
import { resolveAnimeArtwork } from './artwork-mapper.ts';
import { HoshikaAnimeItem } from '../types/anime.ts';
import { FanartImage } from '../types/artwork.ts';

test('pickBestFanartImage selects English and highest liked image', () => {
  const images: FanartImage[] = [
    { id: '1', url: 'https://assets.fanart.tv/1.png', lang: 'ja', likes: '50' },
    { id: '2', url: 'https://assets.fanart.tv/2.png', lang: 'en', likes: '10' },
    { id: '3', url: 'https://assets.fanart.tv/3.png', lang: 'en', likes: '25' },
    { id: '4', url: 'https://assets.fanart.tv/4.png', lang: 'fr', likes: '5' },
  ];

  const best = pickBestFanartImage(images, 'en');
  assert.ok(best);
  assert.equal(best?.id, '3', 'Should choose the English image with highest likes (25)');
});

test('pickBestFanartImage handles empty and undefined lists safely', () => {
  assert.equal(pickBestFanartImage([]), null);
  assert.equal(pickBestFanartImage(undefined), null);
});

test('CURATED_FANART_ARTWORK contains verified artwork for major series', () => {
  // Attack on Titan TVDB
  const aot = CURATED_FANART_ARTWORK['267440'];
  assert.ok(aot, 'Attack on Titan curated entry must exist');
  assert.ok(aot.hdtvlogo && aot.hdtvlogo.length > 0, 'Must have hdtvlogo');
  assert.ok(aot.showbackground && aot.showbackground.length > 0, 'Must have showbackground');
  assert.ok(aot.hdtvlogo![0].url.length > 0, 'Logo URL should be non-empty');

  // Hunter x Hunter TVDB
  const hxh = CURATED_FANART_ARTWORK['252322'];
  assert.ok(hxh, 'Hunter x Hunter curated entry must exist');
  assert.ok(hxh.hdtvlogo && hxh.hdtvlogo.length > 0, 'Must have hdtvlogo');

  // Black Clover TVDB
  const bc = CURATED_FANART_ARTWORK['331753'];
  assert.ok(bc, 'Black Clover curated entry must exist');
  assert.ok(bc.hdtvlogo && bc.hdtvlogo.length > 0, 'Must have hdtvlogo');
  assert.ok(bc.showbackground && bc.showbackground.length > 0, 'Must have showbackground');
});

test('resolveAnimeArtwork respects artwork fallback priority hierarchy', async () => {
  // Mock anime without external mapping
  const mockAnime: HoshikaAnimeItem = {
    id: 'test_anime_99999',
    shortId: 99999,
    slug: 'test-anime',
    titleEnglish: 'Test Fallback Series',
    bannerImage: 'https://cdn.test/banner.jpg',
    coverImage: 'https://cdn.test/cover.jpg',
    format: 'TV',
  };

  const resolved = await resolveAnimeArtwork(99999, mockAnime);
  assert.equal(resolved.hoshikaId, 99999);
  assert.equal(resolved.title, 'Test Fallback Series');

  // Since 99999 has no Fanart mapping, it falls back to Hoshika banner and custom typography
  assert.equal(resolved.backgroundSource, 'hoshika_banner');
  assert.equal(resolved.backgroundUrl, 'https://cdn.test/banner.jpg');
  assert.equal(resolved.logoSource, 'typography');
  assert.equal(resolved.logoUrl, null);
  // Crucial requirement: characterArtUrl must be strictly null (disabled)
  assert.equal(resolved.characterArtUrl, null, 'Character art cutouts must never be present');
});
