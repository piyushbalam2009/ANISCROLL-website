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
import {
  validateLogoUploadBuffer,
  buildSupabaseLogoStoragePath,
  validateLogoStoragePathForAnime,
  MAX_CUSTOM_LOGO_BYTES,
} from './supabase/server.ts';
import { HoshikaAnimeItem } from '../types/anime.ts';
import { FanartImage, FanartLogoItem, CustomLogoItem } from '../types/artwork.ts';

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

test('CURATED_FANART_ARTWORK contains multiple logo variants (hdtvlogo & clearlogo, en & ja) for major series', () => {
  const aot = CURATED_FANART_ARTWORK['267440'];
  assert.ok(aot, 'Attack on Titan curated entry must exist');
  const aotLogos = extractAllFanartLogos(aot, toSafeArtworkUrl);
  assert.ok(aotLogos.length >= 3, 'Attack on Titan must expose multiple Fanart.tv logo candidates');
  assert.ok(aotLogos.some((l) => l.lang === 'en' && l.category === 'hdtvlogo'));
  assert.ok(aotLogos.some((l) => l.lang === 'en' && l.category === 'clearlogo'));
  assert.ok(aotLogos.some((l) => l.lang === 'ja'));

  const hxh = CURATED_FANART_ARTWORK['252322'];
  assert.ok(hxh, 'Hunter x Hunter curated entry must exist');
  const hxhLogos = extractAllFanartLogos(hxh, toSafeArtworkUrl);
  assert.ok(hxhLogos.length >= 3, 'Hunter x Hunter must expose multiple Fanart.tv logo candidates');

  const bc = CURATED_FANART_ARTWORK['331753'];
  assert.ok(bc, 'Black Clover curated entry must exist');
  const bcLogos = extractAllFanartLogos(bc, toSafeArtworkUrl);
  assert.ok(bcLogos.length >= 3, 'Black Clover must expose multiple Fanart.tv logo candidates');
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
  assert.equal(movieFanart[0].language, 'en');
  assert.equal(movieFanart[0].provider, 'fanart');
  assert.ok(movieFanart[0].proxyUrl.startsWith('/api/artwork-image/'));
});

test('resolveAnimeLogoSelection enforces manual admin lock, preserves all availableLogos, and supports Reset to Automatic', () => {
  const fanartLogos = extractAllFanartLogos(CURATED_FANART_ARTWORK['389597']);
  assert.ok(fanartLogos.length >= 3, 'Jujutsu Kaisen should have multiple Fanart.tv logos');

  // 1. Auto mode picks top English HDTVLogo
  const autoResult = resolveAnimeLogoSelection({
    availableLogos: fanartLogos,
    selectionMode: 'auto',
  });
  assert.equal(autoResult.selectionMode, 'auto');
  assert.equal(autoResult.selectedLogoSource, 'fanart_hdtvlogo');
  assert.equal(autoResult.selectedLogoLanguage, 'en');
  assert.equal(autoResult.availableLogos.length, fanartLogos.length);
  assert.equal(autoResult.selectedLogo?.source, 'fanart');
  assert.equal(autoResult.selectedLogo?.storageProvider, 'fanart');

  // 2. Manual lock picks admin-chosen custom Supabase logo
  const customSupabaseLogo: CustomLogoItem = {
    id: 'custom_123',
    url: 'https://xyz.supabase.co/storage/v1/object/public/aniscroll-artwork/anime-logos/113415/custom_123.png',
    proxyUrl: 'https://xyz.supabase.co/storage/v1/object/public/aniscroll-artwork/anime-logos/113415/custom_123.png',
    storageProvider: 'supabase',
    storageBucket: 'aniscroll-artwork',
    storagePath: 'anime-logos/113415/custom_123.png',
    fileName: 'jjk-custom.png',
    mimeType: 'image/png',
    width: 600,
    height: 210,
    fileSize: 42000,
    lang: 'en',
    selected: true,
    uploadedBy: 'admin_1',
    uploadedByEmail: 'balampiyush2009@gmail.com',
    uploadedAt: new Date().toISOString(),
  };

  const manualResult = resolveAnimeLogoSelection({
    availableLogos: fanartLogos,
    customLogos: [customSupabaseLogo],
    selectionMode: 'manual',
    manualLogoUrl: customSupabaseLogo.url,
    manualLogoSource: 'custom_upload',
    manualLogoLanguage: 'en',
  });
  assert.equal(manualResult.selectionMode, 'manual');
  assert.equal(manualResult.logoUrl, customSupabaseLogo.url);
  assert.equal(manualResult.selectedLogoSource, 'custom_upload');
  assert.equal(manualResult.logoStatus, 'custom_override');
  assert.equal(manualResult.selectedLogo?.source, 'custom');
  assert.equal(manualResult.selectedLogo?.storageProvider, 'supabase');

  // 3. Reset to Automatic preserves custom uploaded logos while returning selection to automatic Fanart.tv priority
  const resetResult = resolveAnimeLogoSelection({
    availableLogos: fanartLogos,
    customLogos: [{ ...customSupabaseLogo, selected: false }],
    selectionMode: 'auto',
    manualLogoUrl: null,
  });
  assert.equal(resetResult.selectionMode, 'auto');
  assert.equal(resetResult.selectedLogoSource, 'fanart_hdtvlogo');
  assert.equal(resetResult.selectedLogoLanguage, 'en');
  assert.equal(resetResult.customLogos.length, 1, 'Custom uploaded logos must be preserved after Reset to Automatic');
  assert.equal(resetResult.availableLogos.length, fanartLogos.length);
});

test('validateLogoUploadBuffer validates PNG/WebP binary signatures and rejects invalid/malicious files', () => {
  // 1. Valid PNG buffer with 400x160 IHDR dimensions
  const validPng = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(validPng, 0);
  validPng.write('IHDR', 12, 'ascii');
  validPng.writeUInt32BE(400, 16);
  validPng.writeUInt32BE(160, 20);

  const pngRes = validateLogoUploadBuffer({
    buffer: validPng,
    declaredMimeType: 'image/png',
    fileName: 'logo.png',
  });
  assert.equal(pngRes.valid, true);
  assert.equal(pngRes.detectedMimeType, 'image/png');
  assert.equal(pngRes.extension, 'png');
  assert.equal(pngRes.width, 400);
  assert.equal(pngRes.height, 160);

  // 2. Valid WebP buffer (RIFF....WEBP)
  const validWebp = Buffer.alloc(48);
  validWebp.write('RIFF', 0, 'ascii');
  validWebp.write('WEBP', 8, 'ascii');
  validWebp.write('VP8X', 12, 'ascii');
  validWebp.writeUIntLE(499, 24, 3);
  validWebp.writeUIntLE(199, 27, 3);

  const webpRes = validateLogoUploadBuffer({
    buffer: validWebp,
    declaredMimeType: 'image/webp',
    fileName: 'logo.webp',
  });
  assert.equal(webpRes.valid, true);
  assert.equal(webpRes.detectedMimeType, 'image/webp');
  assert.equal(webpRes.extension, 'webp');
  assert.equal(webpRes.width, 500);
  assert.equal(webpRes.height, 200);

  // 3. Rejects empty file
  const emptyRes = validateLogoUploadBuffer({
    buffer: Buffer.alloc(0),
    declaredMimeType: 'image/png',
    fileName: 'empty.png',
  });
  assert.equal(emptyRes.valid, false);
  assert.match(emptyRes.error || '', /empty/i);

  // 4. Rejects file > 5MB
  const oversized = Buffer.alloc(MAX_CUSTOM_LOGO_BYTES + 1024);
  const overRes = validateLogoUploadBuffer({
    buffer: oversized,
    declaredMimeType: 'image/png',
    fileName: 'huge.png',
  });
  assert.equal(overRes.valid, false);
  assert.match(overRes.error || '', /5 MB/i);

  // 5. Rejects SVG upload
  const svgBuf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const svgRes = validateLogoUploadBuffer({
    buffer: svgBuf,
    declaredMimeType: 'image/svg+xml',
    fileName: 'vector.svg',
  });
  assert.equal(svgRes.valid, false);

  // 6. Rejects HTML/JS file renamed to .png
  const fakePng = Buffer.from('<!DOCTYPE html><html><script>evil()</script></html>');
  const fakeRes = validateLogoUploadBuffer({
    buffer: fakePng,
    declaredMimeType: 'image/png',
    fileName: 'disguised.png',
  });
  assert.equal(fakeRes.valid, false);
  assert.match(fakeRes.error || '', /HTML|Executable/i);
});

test('buildSupabaseLogoStoragePath and validateLogoStoragePathForAnime enforce anime-logos/{id}/{uuid}.{ext} structure', () => {
  const storagePath = buildSupabaseLogoStoragePath({
    anilistId: 21,
    extension: 'png',
  });
  assert.match(storagePath, /^anime-logos\/21\/[a-f0-9-]+\.png$/);

  assert.equal(
    validateLogoStoragePathForAnime({
      storagePath,
      anilistId: 21,
      hoshikaId: 1001,
    }).valid,
    true
  );
  assert.equal(
    validateLogoStoragePathForAnime({
      storagePath,
      anilistId: 999,
      hoshikaId: 888,
    }).valid,
    false
  );
  assert.equal(
    validateLogoStoragePathForAnime({
      storagePath: 'anime-logos/21/../999/hack.png',
      anilistId: 21,
    }).valid,
    false
  );
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
    logos: [],
    availableLogos: [],
    selectedLogo: null,
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

test('resolveAnimeArtwork respects artwork fallback priority hierarchy and populates backdropCandidates', async () => {
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
  assert.ok(Array.isArray(resolved.backdropCandidates));
  assert.deepEqual(resolved.backdropCandidates, [
    'https://cdn.test/banner.jpg',
    'https://cdn.test/cover.jpg',
  ]);
  assert.equal(resolved.diagnostics?.selectedBackdropSource, 'hoshika_banner');
  assert.equal(resolved.logoSource, 'typography');
  assert.equal(resolved.logoUrl, null);
  assert.equal(resolved.characterArtUrl, null, 'Character art cutouts must never be present');
});

test('matchTitleToTvdbId maps Naruto, Naruto Shippuden, Death Note, Demon Slayer, Black Clover, and Apothecary Diaries accurately without substring collisions', async () => {
  const {
    matchTitleToTvdbId,
    isValidBackdropCandidateUrl,
    isDeadLegacyFanartUrl,
  } = await import('./artwork-mapper.ts');
  const { extractAllFanartBackdrops } = await import('./fanart.ts');

  assert.equal(matchTitleToTvdbId('Naruto'), 78857, 'Naruto must map to TVDB 78857, never Naruto Shippuden or Death Note');
  assert.equal(matchTitleToTvdbId('Naruto Shippuden'), 79824);
  assert.equal(matchTitleToTvdbId('Death Note'), 79481, 'Death Note must map to TVDB 79481');
  assert.equal(matchTitleToTvdbId('Demon Slayer: Kimetsu no Yaiba'), 348545);
  assert.equal(matchTitleToTvdbId('Black Clover Season 2'), 331753);
  assert.equal(matchTitleToTvdbId('The Apothecary Diaries Season 3'), 430552);

  // Verify dead legacy /fanart/tv/ URLs and cross-series collisions are rejected
  assert.equal(
    isDeadLegacyFanartUrl(
      'https://assets.fanart.tv/fanart/tv/348545/showbackground/demon-slayer-kimetsu-no-yaiba-5cb367a455264.jpg'
    ),
    true
  );
  assert.equal(
    isDeadLegacyFanartUrl(
      'https://assets.fanart.tv/fanart/demon-slayer-kimetsu-no-yaiba-5ce04655066e4.png'
    ),
    false
  );
  assert.equal(
    isDeadLegacyFanartUrl(
      'https://assets.fanart.tv/fanart/death-note-50401ef8a8b24.png',
      41391
    ),
    true
  );

  // Verify backdrop candidate validator rejects logos, dead legacy URLs, and AniZip URLs
  assert.equal(
    isValidBackdropCandidateUrl(
      'https://assets.fanart.tv/fanart/tv/348545/hdtvlogo/demon-slayer.png'
    ),
    false
  );
  assert.equal(
    isValidBackdropCandidateUrl(
      'https://assets.fanart.tv/fanart/tv/348545/showbackground/demon-slayer-kimetsu-no-yaiba-5cb367a455264.jpg'
    ),
    false
  );
  assert.equal(
    isValidBackdropCandidateUrl(
      'https://assets.fanart.tv/fanart/tv/348545/clearlogo/demon-slayer.png'
    ),
    false
  );
  assert.equal(
    isValidBackdropCandidateUrl('https://api.ani.zip/images/banner.jpg'),
    false
  );
  assert.equal(
    isValidBackdropCandidateUrl(
      'https://cdn.hoshika.app/catalog/anime/95095/banner.webp'
    ),
    true
  );
  assert.equal(
    isValidBackdropCandidateUrl(
      'https://s4.anilist.co/file/anilistcdn/media/anime/banner/101922-33MtJGsUSxga.jpg'
    ),
    true
  );

  // Verify extractAllFanartBackdrops sorts landscape backgrounds by language & likes and never includes logos or posters
  const backdrops = extractAllFanartBackdrops(
    {
      showbackground: [
        { id: 'bg1', url: 'https://assets.fanart.tv/fanart/tv/1/showbackground/ja.jpg', lang: 'ja', likes: '50' },
        { id: 'bg2', url: 'https://assets.fanart.tv/fanart/tv/1/showbackground/en1.jpg', lang: 'en', likes: '10' },
        { id: 'bg3', url: 'https://assets.fanart.tv/fanart/tv/1/showbackground/en2.jpg', lang: 'en', likes: '30' },
      ],
      tvthumb: [
        { id: 'th1', url: 'https://assets.fanart.tv/fanart/tv/1/tvthumb/thumb1.jpg', lang: 'en', likes: '15' },
      ],
      hdtvlogo: [
        { id: 'lg1', url: 'https://assets.fanart.tv/fanart/tv/1/hdtvlogo/logo.png', lang: 'en', likes: '99' },
      ],
      tvposter: [
        { id: 'ps1', url: 'https://assets.fanart.tv/fanart/tv/1/tvposter/poster.jpg', lang: 'en', likes: '99' },
      ],
    },
    toSafeArtworkUrl
  );
  assert.equal(backdrops.length, 4);
  assert.equal(
    decodeBase64Url(backdrops[0].slice('/api/artwork-image/'.length)),
    'https://assets.fanart.tv/fanart/tv/1/showbackground/en2.jpg'
  );
  assert.equal(
    decodeBase64Url(backdrops[3].slice('/api/artwork-image/'.length)),
    'https://assets.fanart.tv/fanart/tv/1/tvthumb/thumb1.jpg'
  );
});

