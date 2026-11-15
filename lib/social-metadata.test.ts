import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { HoshikaAnimeItem, HoshikaEpisodeItem } from '@/types/anime';
import {
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_NAME,
  DEFAULT_SITE_TITLE,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_MIME_TYPE,
  OG_IMAGE_WIDTH,
  buildAnimeJsonLd,
  buildAnimeSocialMetadata,
  buildBrowseSocialMetadata,
  buildWatchSocialMetadata,
  resolveCanonicalOrigin,
  safeJsonLdStringify,
  sanitizeSynopsisForMetadata,
} from '@/lib/social-metadata';
import {
  renderAnimeOgJpeg,
  renderSiteBrandOgJpeg,
} from '@/lib/og-image-renderer';

function makeSampleTvAnime(overrides: Partial<HoshikaAnimeItem> = {}): HoshikaAnimeItem {
  return {
    id: '20859',
    shortId: 20859,
    slug: 'death-note',
    titleEnglish: 'Death Note',
    titleRomaji: 'DEATH NOTE',
    titleJapanese: 'デスノート',
    synopsis:
      '<p>Light Yagami finds the <i>Death Note</i>&mdash;actually &amp; mysteriously dropped by a Shinigami.<br/>(Source: AniList)</p>',
    format: 'TV',
    episodes: 37,
    seasonYear: 2006,
    startedAiring: '2006-10-04',
    averageScore: 86,
    canonCount: 1200,
    genres: [
      { name: 'Mystery', slug: 'mystery' },
      { name: 'Psychological', slug: 'psychological' },
    ],
    coverImage: 'https://cdn.hoshika.app/cover.webp',
    bannerImage: 'https://cdn.hoshika.app/banner.webp',
    ...overrides,
  };
}

function makeSampleMovieAnime(
  overrides: Partial<HoshikaAnimeItem> = {}
): HoshikaAnimeItem {
  return {
    id: '77777',
    shortId: 77777,
    slug: 'your-name',
    titleEnglish: 'Your Name.',
    titleRomaji: 'Kimi no Na wa.',
    synopsis: null,
    format: 'MOVIE',
    isStandaloneMovie: true,
    seasonYear: 2016,
    averageScore: 88,
    coverImage: 'https://cdn.hoshika.app/movie-cover.webp',
    bannerImage: 'https://cdn.hoshika.app/movie-banner.webp',
    ...overrides,
  };
}

test('resolveCanonicalOrigin honors env precedence and skips MY_APP_URL placeholder', () => {
  const prevSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const prevAppUrl = process.env.APP_URL;
  const prevProdUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const prevVercelUrl = process.env.VERCEL_URL;

  try {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.APP_URL = 'MY_APP_URL';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'aniscroll.in';
    process.env.VERCEL_URL = 'aniscroll-preview.vercel.app';
    assert.equal(resolveCanonicalOrigin(), 'https://aniscroll.in');

    process.env.APP_URL = 'https://staging.aniscroll.in/';
    assert.equal(resolveCanonicalOrigin(), 'https://staging.aniscroll.in');

    process.env.NEXT_PUBLIC_SITE_URL = 'https://aniscroll.in/subpath';
    assert.equal(resolveCanonicalOrigin(), 'https://aniscroll.in');

    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.APP_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    assert.equal(resolveCanonicalOrigin(), 'https://aniscroll.in');
  } finally {
    if (prevSiteUrl !== undefined) process.env.NEXT_PUBLIC_SITE_URL = prevSiteUrl;
    else delete process.env.NEXT_PUBLIC_SITE_URL;
    if (prevAppUrl !== undefined) process.env.APP_URL = prevAppUrl;
    else delete process.env.APP_URL;
    if (prevProdUrl !== undefined)
      process.env.VERCEL_PROJECT_PRODUCTION_URL = prevProdUrl;
    else delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (prevVercelUrl !== undefined) process.env.VERCEL_URL = prevVercelUrl;
    else delete process.env.VERCEL_URL;
  }
});

test('sanitizeSynopsisForMetadata strips HTML, entities, source note, and truncates cleanly', () => {
  const raw =
    '<p>A teenager discovers &quot;power&quot; &amp; fights monsters.<br/>(Source: AniList)</p>';
  assert.equal(
    sanitizeSynopsisForMetadata(raw, 220),
    'A teenager discovers "power" & fights monsters.'
  );

  const longText = `${'word '.repeat(60)}ending`;
  const trimmed = sanitizeSynopsisForMetadata(longText, 120);
  assert.ok(trimmed.length <= 120);
  assert.ok(trimmed.endsWith('…'));
  assert.equal(sanitizeSynopsisForMetadata(null), '');
});

test('buildAnimeSocialMetadata builds TV series OG, Twitter, and canonical metadata', () => {
  const anime = makeSampleTvAnime();
  const meta = buildAnimeSocialMetadata(anime, '20859', 'https://aniscroll.in');

  assert.equal(meta.title, 'Death Note');
  assert.equal(meta.alternates?.canonical, 'https://aniscroll.in/anime/20859');
  assert.ok(
    typeof meta.description === 'string' &&
      meta.description.includes('Death Note') &&
      !meta.description.includes('<p>')
  );

  const og = meta.openGraph as Record<string, any>;
  assert.equal(og.siteName, DEFAULT_SITE_NAME);
  assert.equal(og.title, 'Death Note');
  assert.equal(og.url, 'https://aniscroll.in/anime/20859');
  assert.equal(og.images[0].url, 'https://aniscroll.in/api/og/anime/20859');
  assert.equal(og.images[0].secureUrl, 'https://aniscroll.in/api/og/anime/20859');
  assert.equal(og.images[0].type, OG_IMAGE_MIME_TYPE);
  assert.equal(og.images[0].width, OG_IMAGE_WIDTH);
  assert.equal(og.images[0].height, OG_IMAGE_HEIGHT);

  const tw = meta.twitter as Record<string, any>;
  assert.equal(tw.card, 'summary_large_image');
  assert.equal(tw.images[0].url, 'https://aniscroll.in/api/og/anime/20859');
});

test('buildAnimeSocialMetadata uses movie fallback without episode wording when synopsis is missing', () => {
  const movie = makeSampleMovieAnime();
  const meta = buildAnimeSocialMetadata(movie, '77777', 'https://aniscroll.in');

  assert.equal(meta.title, 'Your Name.');
  assert.ok(
    typeof meta.description === 'string' &&
      meta.description.includes('anime movie') &&
      !meta.description.toLowerCase().includes('episodes')
  );
  const og = meta.openGraph as Record<string, any>;
  assert.equal(og.images[0].url, 'https://aniscroll.in/api/og/anime/77777');
});

test('buildAnimeSocialMetadata returns safe defaults when anime is null', () => {
  const meta = buildAnimeSocialMetadata(null, '999999999', 'https://aniscroll.in');
  assert.deepEqual(meta.title, { absolute: DEFAULT_SITE_TITLE });
  assert.equal(meta.description, DEFAULT_SITE_DESCRIPTION);
  const og = meta.openGraph as Record<string, any>;
  assert.equal(og.siteName, DEFAULT_SITE_NAME);
  assert.equal(og.images[0].url, 'https://aniscroll.in/api/og/site');
});

test('buildWatchSocialMetadata includes episode info for TV series and omits it for movies', () => {
  const tvAnime = makeSampleTvAnime();
  const episodes: HoshikaEpisodeItem[] = [
    {
      id: 'ep-1',
      number: 1,
      title: 'Rebirth',
      synopsis: '<p>Ryuk drops his notebook into the human world.</p>',
    },
  ];

  const tvWatchMeta = buildWatchSocialMetadata({
    anime: tvAnime,
    episodes,
    rawId: '20859',
    episodeNumber: 1,
    origin: 'https://aniscroll.in',
  });
  assert.equal(tvWatchMeta.title, 'Death Note — Episode 1: Rebirth');
  assert.equal(
    tvWatchMeta.description,
    'Ryuk drops his notebook into the human world.'
  );
  const tvOg = tvWatchMeta.openGraph as Record<string, any>;
  assert.equal(tvOg.images[0].url, 'https://aniscroll.in/api/og/anime/20859?ep=1');

  const movieAnime = makeSampleMovieAnime();
  const movieWatchMeta = buildWatchSocialMetadata({
    anime: movieAnime,
    episodes,
    rawId: '77777',
    episodeNumber: 1,
    origin: 'https://aniscroll.in',
  });
  assert.equal(movieWatchMeta.title, 'Your Name.');
  const movieOg = movieWatchMeta.openGraph as Record<string, any>;
  assert.equal(movieOg.images[0].url, 'https://aniscroll.in/api/og/anime/77777');
});

test('buildBrowseSocialMetadata and buildAnimeJsonLd produce valid structured metadata', () => {
  const browse = buildBrowseSocialMetadata({
    title: 'Action Anime',
    description: 'Top action anime.',
    path: '/genres/action',
    origin: 'https://aniscroll.in',
  });
  assert.equal(browse.alternates?.canonical, 'https://aniscroll.in/genres/action');

  const tvJsonLd = buildAnimeJsonLd({
    anime: makeSampleTvAnime({ synopsis: 'Test <script>alert(1)</script>' }),
    canonicalUrl: 'https://aniscroll.in/anime/20859',
    imageUrl: 'https://aniscroll.in/api/og/anime/20859',
  });
  assert.equal(tvJsonLd['@type'], 'TVSeries');
  assert.equal(tvJsonLd.numberOfEpisodes, 37);

  const serialized = safeJsonLdStringify(tvJsonLd);
  assert.ok(!serialized.includes('<'));

  const movieJsonLd = buildAnimeJsonLd({
    anime: makeSampleMovieAnime(),
    canonicalUrl: 'https://aniscroll.in/anime/77777',
    imageUrl: 'https://aniscroll.in/api/og/anime/77777',
  });
  assert.equal(movieJsonLd['@type'], 'Movie');
  assert.equal(movieJsonLd.numberOfEpisodes, undefined);
});

test('renderSiteBrandOgJpeg and renderAnimeOgJpeg fallback output valid 1200x630 progressive JPEGs', async () => {
  const brandBuf = await renderSiteBrandOgJpeg();
  assert.ok(brandBuf.byteLength > 2000);
  // JPEG SOI marker FF D8 FF
  assert.equal(brandBuf[0], 0xff);
  assert.equal(brandBuf[1], 0xd8);
  assert.equal(brandBuf[2], 0xff);

  const brandMeta = await sharp(brandBuf).metadata();
  assert.equal(brandMeta.format, 'jpeg');
  assert.equal(brandMeta.width, OG_IMAGE_WIDTH);
  assert.equal(brandMeta.height, OG_IMAGE_HEIGHT);

  const fallbackBuf = await renderAnimeOgJpeg({
    posterCandidates: ['https://invalid.example.test/no-poster.jpg'],
    backdropCandidates: [],
  });
  const fallbackMeta = await sharp(fallbackBuf).metadata();
  assert.equal(fallbackMeta.format, 'jpeg');
  assert.equal(fallbackMeta.width, OG_IMAGE_WIDTH);
  assert.equal(fallbackMeta.height, OG_IMAGE_HEIGHT);
});
