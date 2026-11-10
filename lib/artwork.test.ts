import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickBestFanartImage,
  extractAllFanartLogos,
  sortLogosByPriority,
  CURATED_FANART_ARTWORK,
} from './fanart.ts';
import {
  resolveAnimeArtwork,
  toSafeArtworkUrl,
  encodeBase64Url,
  decodeBase64Url,
  isAllowedArtworkUpstreamUrl,
} from './artwork-mapper.ts';
import { resolveAnimeLogoSelection } from './artwork/logo-selector.ts';
import {
  setCachedArtwork,
  getCachedArtwork,
  invalidateCachedArtwork,
} from './artwork/artwork-cache.ts';
import {
  isBootstrappedOwnerIdentity,
  BOOTSTRAPPED_OWNER_EMAIL,
  BOOTSTRAPPED_OWNER_UID,
} from './admin/admin-permissions.ts';
import { HoshikaAnimeItem } from '../types/anime.ts';
import { FanartImage, FanartLogoItem } from '../types/artwork.ts';

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

test('toSafeArtworkUrl generates /api/artwork-image/[encoded] base64url URLs and validates hosts', () => {
  const fanartUrl = 'https://assets.fanart.tv/fanart/tv/267440/hdtvlogo/aot.png';
  const proxied = toSafeArtworkUrl(fanartUrl);
  assert.ok(proxied?.startsWith('/api/artwork-image/'), 'Must use /api/artwork-image/ route');
  assert.ok(!proxied?.includes('/api/image-proxy'), 'Must never use broken /api/image-proxy route');

  const encodedPart = proxied!.slice('/api/artwork-image/'.length);
  assert.equal(decodeBase64Url(encodedPart), fanartUrl);
  assert.equal(encodeBase64Url(fanartUrl), encodedPart);

  // Rejects non-HTTPS or disallowed domains from being proxied
  assert.equal(isAllowedArtworkUpstreamUrl('http://assets.fanart.tv/test.png'), false);
  assert.equal(isAllowedArtworkUpstreamUrl('https://evil.example.com/test.png'), false);
  assert.equal(isAllowedArtworkUpstreamUrl('https://artworks.thetvdb.com/banners/v4/1.jpg'), true);
});

test('CURATED_FANART_ARTWORK contains verified artwork for major series', () => {
  const aot = CURATED_FANART_ARTWORK['267440'];
  assert.ok(aot, 'Attack on Titan curated entry must exist');
  assert.ok(aot.hdtvlogo && aot.hdtvlogo.length > 0, 'Must have hdtvlogo');
  assert.ok(aot.showbackground && aot.showbackground.length > 0, 'Must have showbackground');
  assert.ok(aot.hdtvlogo![0].url.length > 0, 'Logo URL should be non-empty');

  const hxh = CURATED_FANART_ARTWORK['252322'];
  assert.ok(hxh, 'Hunter x Hunter curated entry must exist');
  assert.ok(hxh.hdtvlogo && hxh.hdtvlogo.length > 0, 'Must have hdtvlogo');

  const bc = CURATED_FANART_ARTWORK['331753'];
  assert.ok(bc, 'Black Clover curated entry must exist');
  assert.ok(bc.hdtvlogo && bc.hdtvlogo.length > 0, 'Must have hdtvlogo');
  assert.ok(bc.showbackground && bc.showbackground.length > 0, 'Must have showbackground');
});

test('extractAllFanartLogos and sortLogosByPriority enforce strict priority hierarchy including movie logos', () => {
  const unsorted: FanartLogoItem[] = [
    {
      id: 'ja_clear',
      url: 'https://assets.fanart.tv/ja-clear.png',
      proxyUrl: 'https://assets.fanart.tv/ja-clear.png',
      lang: 'ja',
      likes: 100,
      source: 'fanart_clearlogo',
      category: 'clearlogo',
    },
    {
      id: 'ja_hd',
      url: 'https://assets.fanart.tv/ja-hd.png',
      proxyUrl: 'https://assets.fanart.tv/ja-hd.png',
      lang: 'ja',
      likes: 50,
      source: 'fanart_hdtvlogo',
      category: 'hdtvlogo',
    },
    {
      id: 'en_clear',
      url: 'https://assets.fanart.tv/en-clear.png',
      proxyUrl: 'https://assets.fanart.tv/en-clear.png',
      lang: 'en',
      likes: 40,
      source: 'fanart_clearlogo',
      category: 'clearlogo',
    },
    {
      id: 'en_hd_low',
      url: 'https://assets.fanart.tv/en-hd-1.png',
      proxyUrl: 'https://assets.fanart.tv/en-hd-1.png',
      lang: 'en',
      likes: 5,
      source: 'fanart_hdtvlogo',
      category: 'hdtvlogo',
    },
    {
      id: 'en_hd_high',
      url: 'https://assets.fanart.tv/en-hd-2.png',
      proxyUrl: 'https://assets.fanart.tv/en-hd-2.png',
      lang: 'en',
      likes: 20,
      source: 'fanart_hdtvlogo',
      category: 'hdtvlogo',
    },
  ];

  const sorted = sortLogosByPriority(unsorted, true);
  assert.deepEqual(
    sorted.map((x) => x.id),
    ['en_hd_high', 'en_hd_low', 'en_clear', 'ja_hd', 'ja_clear']
  );

  const movieFanart = extractAllFanartLogos(
    {
      hdmovielogo: [{ id: 'm1', url: 'https://assets.fanart.tv/m1.png', lang: 'en', likes: '12' }],
      movielogo: [{ id: 'm2', url: 'https://assets.fanart.tv/m2.png', lang: 'ja', likes: '30' }],
    },
    toSafeArtworkUrl
  );
  assert.equal(movieFanart.length, 2);
  assert.equal(movieFanart[0].lang, 'en');
  assert.ok(movieFanart[0].proxyUrl.startsWith('/api/artwork-image/'));
});

test('resolveAnimeLogoSelection enforces manual admin lock over automatic Fanart.tv logos', () => {
  const fanartLogos = extractAllFanartLogos(CURATED_FANART_ARTWORK['389597']);

  // 1. Auto mode picks top English HDTVLogo
  const autoResult = resolveAnimeLogoSelection({
    availableLogos: fanartLogos,
    selectionMode: 'auto',
  });
  assert.equal(autoResult.selectionMode, 'auto');
  assert.equal(autoResult.selectedLogoSource, 'fanart_hdtvlogo');
  assert.equal(autoResult.selectedLogoLanguage, 'en');

  // 2. Manual lock picks admin-chosen custom or alternate logo and is NEVER overridden
  const manualResult = resolveAnimeLogoSelection({
    availableLogos: fanartLogos,
    selectionMode: 'manual',
    manualLogoUrl: 'https://firebasestorage.googleapis.com/v0/b/custom-logo.png',
    manualLogoSource: 'custom_upload',
    manualLogoLanguage: 'en',
  });
  assert.equal(manualResult.selectionMode, 'manual');
  assert.equal(
    manualResult.logoUrl,
    'https://firebasestorage.googleapis.com/v0/b/custom-logo.png'
  );
  assert.equal(manualResult.selectedLogoSource, 'custom_upload');
  assert.equal(manualResult.logoStatus, 'custom_override');
});

test('artwork cache versioned invalidation immediately clears stale entries', () => {
  setCachedArtwork(88888, {
    hoshikaId: 88888,
    backgroundUrl: 'https://cdn.test/bg.jpg',
    logoUrl: null,
    characterArtUrl: null,
    posterUrl: null,
    source: 'hoshika',
    fetchedAt: Date.now(),
  });
  assert.ok(getCachedArtwork(88888));
  invalidateCachedArtwork(88888);
  assert.equal(getCachedArtwork(88888), null);
});

test('bootstrapped owner permission check verifies both email and UID consistently', () => {
  assert.equal(isBootstrappedOwnerIdentity({ email: BOOTSTRAPPED_OWNER_EMAIL }), true);
  assert.equal(isBootstrappedOwnerIdentity({ uid: BOOTSTRAPPED_OWNER_UID }), true);
  assert.equal(isBootstrappedOwnerIdentity({ email: 'other@example.com', uid: 'user_123' }), false);
});

test('resolveAnimeArtwork respects artwork fallback priority hierarchy', async () => {
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
  assert.equal(resolved.backgroundSource, 'hoshika_banner');
  assert.equal(resolved.backgroundUrl, 'https://cdn.test/banner.jpg');
  assert.equal(resolved.logoSource, 'typography');
  assert.equal(resolved.logoUrl, null);
  assert.equal(resolved.characterArtUrl, null, 'Character art cutouts must never be present');
});
