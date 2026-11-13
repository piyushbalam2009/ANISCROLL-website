import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeCandidateImageUrl,
  buildResilientImageCandidates,
  isDeadFanartPlaceholderUrl,
} from './image-url.ts';
import {
  detectImageContentTypeFromBuffer,
  isSafeProxyRedirectTarget,
  getUpstreamReferer,
} from './artwork/proxy-handler.ts';
import { sanitizeArtworkUrl } from './continue-watching.ts';
import nextConfig from '../next.config.ts';

test('normalizeCandidateImageUrl upgrades allowed http URLs, rejects dead fanart and invalid placeholders', () => {
  assert.equal(
    normalizeCandidateImageUrl('http://cdn.hoshika.app/catalog/covers/anime/41391.webp'),
    'https://cdn.hoshika.app/catalog/covers/anime/41391.webp'
  );
  assert.equal(
    normalizeCandidateImageUrl('https://s4.anilist.co/file/anilistcdn/media/anime/banner/1.jpg'),
    'https://s4.anilist.co/file/anilistcdn/media/anime/banner/1.jpg'
  );
  assert.equal(
    normalizeCandidateImageUrl('//cdn.hoshika.app/catalog/covers/anime/1.webp'),
    'https://cdn.hoshika.app/catalog/covers/anime/1.webp'
  );
  assert.equal(
    normalizeCandidateImageUrl('/api/artwork-image/aHR0cHM6Ly9hc3NldHMuZmFuYXJ0LnR2L2ZhbmFydC90ZXN0LnBuZw?v=123'),
    '/api/artwork-image/aHR0cHM6Ly9hc3NldHMuZmFuYXJ0LnR2L2ZhbmFydC90ZXN0LnBuZw?v=123'
  );

  // Dead legacy fanart.tv paths
  assert.equal(
    isDeadFanartPlaceholderUrl('https://assets.fanart.tv/fanart/tv/389597/hdtvlogo/solo.png'),
    true
  );
  assert.equal(
    normalizeCandidateImageUrl('https://assets.fanart.tv/fanart/tv/389597/hdtvlogo/solo.png'),
    null
  );
  assert.equal(
    normalizeCandidateImageUrl('https://assets.fanart.tv/fanart/movies/1234/moviebackground/foo.jpg'),
    null
  );
  assert.equal(
    normalizeCandidateImageUrl(
      '/api/artwork-image/' +
        Buffer.from('https://assets.fanart.tv/fanart/tv/348545/showbackground/dead.jpg').toString('base64url') +
        '?v=123'
    ),
    null
  );
  assert.equal(
    normalizeCandidateImageUrl(
      '/api/image-proxy?url=' +
        encodeURIComponent('https://assets.fanart.tv/fanart/movies/1234/moviebackground/foo.jpg')
    ),
    null
  );
  assert.equal(
    sanitizeArtworkUrl('https://assets.fanart.tv/fanart/movies/1234/moviebackground/foo.jpg'),
    undefined
  );

  // Invalid / XSS / empty strings
  assert.equal(normalizeCandidateImageUrl(''), null);
  assert.equal(normalizeCandidateImageUrl('undefined'), null);
  assert.equal(normalizeCandidateImageUrl('null'), null);
  assert.equal(normalizeCandidateImageUrl('javascript:alert(1)'), null);
  assert.equal(normalizeCandidateImageUrl('data:text/html,<script>'), null);
});

test('buildResilientImageCandidates deduplicates and preserves priority order', () => {
  const candidates = buildResilientImageCandidates(
    'https://cdn.hoshika.app/banner.webp',
    [
      null,
      'https://assets.fanart.tv/fanart/tv/1/hdtvlogo/dead.png',
      'https://cdn.hoshika.app/banner.webp',
      'https://s4.anilist.co/banner.jpg',
      'http://cdn.hoshika.app/cover.webp',
    ]
  );

  assert.deepEqual(candidates, [
    'https://cdn.hoshika.app/banner.webp',
    'https://s4.anilist.co/banner.jpg',
    'https://cdn.hoshika.app/cover.webp',
  ]);
});

test('detectImageContentTypeFromBuffer verifies binary magic bytes and blocks HTML/SVG/JSON payloads', () => {
  // PNG served as application/octet-stream
  const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  assert.equal(
    detectImageContentTypeFromBuffer(pngBuf, 'application/octet-stream'),
    'image/png'
  );

  // JPEG
  const jpgBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  assert.equal(detectImageContentTypeFromBuffer(jpgBuf, ''), 'image/jpeg');

  // WebP
  const webpBuf = Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'binary');
  assert.equal(
    detectImageContentTypeFromBuffer(webpBuf, 'binary/octet-stream'),
    'image/webp'
  );

  // GIF
  const gifBuf = Buffer.from('GIF89a\x01\x00\x01\x00', 'ascii');
  assert.equal(detectImageContentTypeFromBuffer(gifBuf, 'image/gif'), 'image/gif');

  // Reject HTML Cloudflare challenge page, JSON error, and SVG
  assert.equal(
    detectImageContentTypeFromBuffer(Buffer.from('<!DOCTYPE html><html>403</html>'), 'text/html'),
    null
  );
  assert.equal(
    detectImageContentTypeFromBuffer(Buffer.from('{"error":"not found"}'), 'application/json'),
    null
  );
  assert.equal(
    detectImageContentTypeFromBuffer(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml'),
    null
  );
});

test('isSafeProxyRedirectTarget blocks SSRF targets and permits trusted image CDNs', () => {
  assert.equal(
    isSafeProxyRedirectTarget('https://assets.fanart.tv/fanart/demon-slayer-kimetsu-no-yaiba-5ce04655066e4.png'),
    true
  );
  assert.equal(
    isSafeProxyRedirectTarget('https://d12345.cloudfront.net/banners/test.jpg'),
    true
  );
  assert.equal(isSafeProxyRedirectTarget('http://assets.fanart.tv/test.png'), false);
  assert.equal(isSafeProxyRedirectTarget('https://localhost/secret.png'), false);
  assert.equal(isSafeProxyRedirectTarget('https://169.254.169.254/latest/meta-data'), false);
  assert.equal(isSafeProxyRedirectTarget('https://127.0.0.1/internal.png'), false);
  assert.equal(isSafeProxyRedirectTarget('https://untrusted.example.com/evil.png'), false);

  assert.equal(getUpstreamReferer('assets.fanart.tv'), 'https://fanart.tv/');
  assert.equal(getUpstreamReferer('artworks.thetvdb.com'), 'https://thetvdb.com/');
  assert.equal(getUpstreamReferer('cdn.hoshika.app'), 'https://hoshika.app/');
});

test('next.config.ts covers required anime image hosts and keeps Next.js optimization enabled', () => {
  assert.notEqual(nextConfig.images?.unoptimized, true);
  const hostnames = new Set(
    (nextConfig.images?.remotePatterns || []).map((p) => p.hostname)
  );
  for (const required of [
    'cdn.hoshika.app',
    'assets.fanart.tv',
    'images.fanart.tv',
    'artworks.thetvdb.com',
    's4.anilist.co',
    'image.tmdb.org',
    '**.supabase.co',
    'lh3.googleusercontent.com',
  ]) {
    assert.ok(hostnames.has(required), `Missing remotePattern for ${required}`);
  }

  const localPaths = (nextConfig.images?.localPatterns || []).map((p) => p.pathname);
  assert.ok(localPaths.includes('/api/artwork-image/**'));
  assert.ok(localPaths.includes('/api/image-proxy'));
});

test('image proxy routes declare nodejs runtime and avoid 307 redirects', () => {
  const artworkRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/api/artwork-image/[encoded]/route.ts'),
    'utf8'
  );
  const imageProxyRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/api/image-proxy/route.ts'),
    'utf8'
  );
  assert.ok(artworkRoute.includes("export const runtime = 'nodejs'"));
  assert.ok(imageProxyRoute.includes("export const runtime = 'nodejs'"));
  assert.ok(!imageProxyRoute.includes('NextResponse.redirect'));
});
