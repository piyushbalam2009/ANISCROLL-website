import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQualityOptionsFromMaster,
  detectSegmentContainer,
  formatBytes,
  formatTransferSpeed,
  hasValidMp4Signature,
  HlsDownloadError,
  looksLikeHtmlBinary,
  parseHlsPlaylist,
  pickAudioPlaylistForVariant,
  resolveDownloadQualitiesFromStream,
  resolveHlsUrl,
  sanitizeDownloadFilename,
} from './hls-downloader';
import type { AniScrollStreamResponse } from '../types/streaming';

test('sanitizeDownloadFilename formats clean filesystem-safe MP4 filenames', () => {
  assert.equal(
    sanitizeDownloadFilename({
      animeTitle: 'Overgeared',
      episodeNumber: 8,
      qualityLabel: '1080p',
      audioType: 'dub',
    }),
    'Overgeared-Episode-08-1080p-Dub.mp4'
  );

  assert.equal(
    sanitizeDownloadFilename({
      animeTitle: "Frieren: Beyond Journey's End / Part 2?",
      episodeNumber: 12,
      qualityLabel: '720p',
      audioType: 'sub',
    }),
    'Frieren-Beyond-Journeys-End-Part-2-Episode-12-720p-Sub.mp4'
  );

  assert.equal(
    sanitizeDownloadFilename({
      animeTitle: 'Solo Leveling',
      episodeNumber: 108,
      qualityLabel: 'Original',
      audioType: 'sub',
    }),
    'Solo-Leveling-Episode-108-Original-Sub.mp4'
  );
});

test('resolveHlsUrl handles direct, standard relative, and /api/proxy/hls wrapped relative URIs', () => {
  assert.equal(
    resolveHlsUrl('https://cdn.example.com/seg1.ts', 'https://other.com/master.m3u8'),
    'https://cdn.example.com/seg1.ts'
  );

  assert.equal(
    resolveHlsUrl('1080p/index.m3u8', 'https://cdn.example.com/anime/master.m3u8'),
    'https://cdn.example.com/anime/1080p/index.m3u8'
  );

  const proxyBase =
    'https://api.aniscroll.in/api/proxy/hls?url=https%3A%2F%2Ffetch.nexabloom.top%2Fanime%2Fmaster.m3u8&ref=https%3A%2F%2Fmegaplay.buzz%2F';
  const resolvedProxyChild = resolveHlsUrl('1080p/seg-001.jpg', proxyBase);
  const parsed = new URL(resolvedProxyChild);
  assert.equal(parsed.origin, 'https://api.aniscroll.in');
  assert.equal(parsed.pathname, '/api/proxy/hls');
  assert.equal(
    parsed.searchParams.get('url'),
    'https://fetch.nexabloom.top/anime/1080p/seg-001.jpg'
  );
  assert.equal(parsed.searchParams.get('ref'), 'https://megaplay.buzz/');
});

test('parseHlsPlaylist parses multi-audio MegaPlay master playlists and ignores I-frame variants', () => {
  const masterM3u8 = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="Japanese",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="ja",URI="audio/ja/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",DEFAULT=NO,AUTOSELECT=NO,LANGUAGE="en",URI="audio/en/index.m3u8"
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=200000,RESOLUTION=1920x1080,URI="iframes.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aac",NAME="360p"
index-f3.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aac",NAME="720p"
index-f2.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5500000,RESOLUTION=1920x1080,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aac",NAME="1080p"
index-f1.m3u8`;

  const parsed = parseHlsPlaylist(masterM3u8, 'https://cdn.example.com/ep8/master.m3u8');
  assert.equal(parsed.kind, 'master');
  if (parsed.kind !== 'master') return;

  assert.equal(parsed.variants.length, 3);
  assert.equal(parsed.audioTracks.length, 2);

  const options = buildQualityOptionsFromMaster(parsed);
  assert.deepEqual(
    options.map((o) => o.label),
    ['1080p', '720p', '360p']
  );
  assert.equal(options[0].playlistUrl, 'https://cdn.example.com/ep8/index-f1.m3u8');

  const dubAudio = pickAudioPlaylistForVariant({
    audioTracks: options[0].audioTracks,
    audioGroupId: options[0].audioGroupId,
    audioType: 'dub',
  });
  const subAudio = pickAudioPlaylistForVariant({
    audioTracks: options[0].audioTracks,
    audioGroupId: options[0].audioGroupId,
    audioType: 'sub',
  });
  assert.equal(dubAudio?.url, 'https://cdn.example.com/ep8/audio/en/index.m3u8');
  assert.equal(subAudio?.url, 'https://cdn.example.com/ep8/audio/ja/index.m3u8');
});

test('parseHlsPlaylist parses disguised TS segment extensions and byte-range fMP4 playlists', () => {
  const mediaM3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXTINF:4.004,
https://api.aniscroll.in/api/proxy/hls?url=https%3A%2F%2Fcdn.test%2Fseg-000.jpg
#EXTINF:4.004,
https://api.aniscroll.in/api/proxy/hls?url=https%3A%2F%2Fcdn.test%2Fseg-001.html
#EXTINF:3.500,
https://api.aniscroll.in/api/proxy/hls?url=https%3A%2F%2Fcdn.test%2Fseg-002.css
#EXT-X-ENDLIST`;

  const parsed = parseHlsPlaylist(mediaM3u8, 'https://api.aniscroll.in/api/proxy/hls?url=index.m3u8');
  assert.equal(parsed.kind, 'media');
  if (parsed.kind !== 'media') return;
  assert.equal(parsed.segments.length, 3);
  assert.equal(parsed.isFmp4, false);
  assert.ok(Math.abs(parsed.totalDurationSeconds - 11.508) < 0.001);

  const fmp4M3u8 = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"
#EXTINF:4.0,
#EXT-X-BYTERANGE:102400@720
media.mp4
#EXTINF:4.0,
#EXT-X-BYTERANGE:98000
media.mp4`;
  const parsedFmp4 = parseHlsPlaylist(fmp4M3u8, 'https://cdn.example.com/hls/v.m3u8');
  assert.equal(parsedFmp4.kind, 'media');
  if (parsedFmp4.kind !== 'media') return;
  assert.equal(parsedFmp4.isFmp4, true);
  assert.equal(parsedFmp4.initMapUrl, 'https://cdn.example.com/hls/init.mp4');
  assert.deepEqual(parsedFmp4.segments[0].byteRange, { length: 102400, offset: 720 });
  assert.deepEqual(parsedFmp4.segments[1].byteRange, { length: 98000, offset: 103120 });
});

test('parseHlsPlaylist rejects HTML responses, invalid playlists, and DRM encryption cleanly', () => {
  assert.throws(
    () => parseHlsPlaylist('<!DOCTYPE html><html><body>502</body></html>', 'https://cdn.test/a.m3u8', 'text/html'),
    (err: unknown) => err instanceof HlsDownloadError && err.code === 'INVALID_PLAYLIST'
  );

  assert.throws(
    () => parseHlsPlaylist('not a playlist at all', 'https://cdn.test/a.m3u8'),
    (err: unknown) => err instanceof HlsDownloadError && err.code === 'INVALID_PLAYLIST'
  );

  assert.throws(
    () =>
      parseHlsPlaylist(
        '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://fairplay.key",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:4,\nseg0.ts',
        'https://cdn.test/a.m3u8'
      ),
    (err: unknown) =>
      err instanceof HlsDownloadError &&
      err.code === 'DRM_UNSUPPORTED' &&
      err.recoverable === false
  );
});

test('resolveDownloadQualitiesFromStream handles discrete qualities, direct media playlists, and embed-only streams', async () => {
  const zokoStream: AniScrollStreamResponse = {
    source: 'zokoanime',
    provider: 'zokoanime',
    anilistId: 21519,
    episode: 1,
    type: 'dub',
    playbackMode: 'hls',
    hlsProxyUrl: 'https://cdn.test/master.m3u8',
    qualities: [
      { quality: '720p', resolution: '1280x720', hlsProxyUrl: 'https://cdn.test/720.m3u8' },
      { quality: '1080p', resolution: '1920x1080', hlsProxyUrl: 'https://cdn.test/1080.m3u8' },
    ],
  };

  const zokoResult = await resolveDownloadQualitiesFromStream(zokoStream);
  assert.deepEqual(
    zokoResult.options.map((q) => q.label),
    ['1080p', '720p']
  );

  const singleMediaStream: AniScrollStreamResponse = {
    source: 'zokoanime',
    provider: 'zokoanime',
    anilistId: 112151,
    episode: 1,
    type: 'sub',
    playbackMode: 'hls',
    hlsProxyUrl: 'https://cdn.test/single.m3u8',
  };

  const mockFetch: typeof fetch = async () =>
    new Response('#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:5.0,\nseg0.ts.jpg\n#EXT-X-ENDLIST', {
      status: 200,
      headers: { 'content-type': 'application/vnd.apple.mpegurl' },
    });

  const singleResult = await resolveDownloadQualitiesFromStream(singleMediaStream, {
    fetchFn: mockFetch,
  });
  assert.equal(singleResult.options.length, 1);
  assert.equal(singleResult.options[0].label, 'Original');

  const embedOnlyStream: AniScrollStreamResponse = {
    source: 'megaplay',
    provider: 'megaplay',
    anilistId: 999,
    episode: 1,
    type: 'sub',
    playbackMode: 'embed',
    iframeOnly: true,
    embedUrl: 'https://embed.example.com/123',
  };

  const embedResult = await resolveDownloadQualitiesFromStream(embedOnlyStream);
  assert.equal(embedResult.options.length, 0);
  assert.equal(embedResult.unsupportedReason, 'embed_only');
});

test('binary container and MP4 signature validation helpers work accurately', () => {
  const tsChunk = new Uint8Array(400);
  tsChunk[0] = 0x47;
  tsChunk[188] = 0x47;
  assert.equal(detectSegmentContainer(tsChunk, false), 'mpegts');

  const ftypChunk = new Uint8Array(64);
  ftypChunk[4] = 0x66;
  ftypChunk[5] = 0x74;
  ftypChunk[6] = 0x79;
  ftypChunk[7] = 0x70;
  assert.equal(hasValidMp4Signature(ftypChunk), true);
  assert.equal(detectSegmentContainer(ftypChunk, false), 'fmp4');

  const htmlBytes = new TextEncoder().encode('<!DOCTYPE html><html>Error</html>');
  assert.equal(looksLikeHtmlBinary(htmlBytes), true);
  assert.equal(looksLikeHtmlBinary(tsChunk), false);

  assert.equal(formatBytes(1536 * 1024), '1.5 MB');
  assert.equal(formatTransferSpeed(4.2 * 1024 * 1024), '4.2 MB/s');
});
