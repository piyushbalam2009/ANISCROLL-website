import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAnimeFormat,
  isMovieContent,
  selectStreamingProvider,
  getStreamingProviderDisplayName,
  buildProviderWatchUrl,
} from './stream-provider-core';
import {
  validateMegaPlayResponse,
  validateZokoAnimeResponse,
  normalizeHlsMasterLevels,
  selectInitialHlsLevelIndex,
  normalizeSubtitleTracks,
  resolveSubtitleTrackForPreference,
} from './zokoanime-stream';

test('Provider Routing: routes TV series formats to MegaPlay and movies/unknown safely to ZokoAnime', () => {
  // Series formats -> MegaPlay
  assert.equal(selectStreamingProvider({ format: 'TV' }), 'megaplay');
  assert.equal(selectStreamingProvider({ format: 'tv' }), 'megaplay');
  assert.equal(selectStreamingProvider({ format: 'TV_SHORT' }), 'megaplay');
  assert.equal(selectStreamingProvider({ format: 'OVA' }), 'megaplay');
  assert.equal(selectStreamingProvider({ format: 'ONA' }), 'megaplay');
  assert.equal(selectStreamingProvider({ format: 'SPECIAL' }), 'megaplay');

  // Movie formats -> ZokoAnime
  assert.equal(selectStreamingProvider({ format: 'MOVIE' }), 'zokoanime');
  assert.equal(selectStreamingProvider({ format: 'movie' }), 'zokoanime');
  assert.equal(
    selectStreamingProvider({ format: 'SPECIAL', isStandaloneMovie: true }),
    'zokoanime'
  );

  // Unknown/missing format -> Safe ZokoAnime fallback (never accidentally send movies to MegaPlay)
  assert.equal(selectStreamingProvider({ format: null }), 'zokoanime');
  assert.equal(selectStreamingProvider({ format: undefined }), 'zokoanime');
  assert.equal(selectStreamingProvider({ format: '' }), 'zokoanime');
  assert.equal(selectStreamingProvider({ format: 'UNKNOWN' }), 'zokoanime');

  assert.equal(isMovieContent({ format: 'MOVIE' }), true);
  assert.equal(isMovieContent({ format: 'TV' }), false);
  assert.equal(isMovieContent({ format: 'SPECIAL', isStandaloneMovie: true }), true);
  assert.equal(normalizeAnimeFormat('tv_short'), 'TV_SHORT');
  assert.equal(getStreamingProviderDisplayName('megaplay'), 'MegaPlay');
  assert.equal(getStreamingProviderDisplayName('zokoanime'), 'ZokoAnime');
});

test('Endpoint URLs: builds exact MegaPlay and ZokoAnime watch endpoints', () => {
  assert.equal(
    buildProviderWatchUrl('megaplay', 113415, 1, 'sub'),
    'https://api.aniscroll.in/api/watch/megaplay/113415/1/sub'
  );
  assert.equal(
    buildProviderWatchUrl('megaplay', 154587, 12, 'dub'),
    'https://api.aniscroll.in/api/watch/megaplay/154587/12/dub'
  );
  assert.equal(
    buildProviderWatchUrl('zokoanime', 21519, 1, 'sub'),
    'https://api.aniscroll.in/api/watch/zokoanime/21519/1/sub'
  );
  assert.equal(
    buildProviderWatchUrl('zokoanime', 20954, 1, 'dub'),
    'https://api.aniscroll.in/api/watch/zokoanime/20954/1/dub'
  );
});

test('MegaPlay Normalization: accepts single master hlsProxyUrl without qualities[], preserves skip: null, and rejects errors', () => {
  const realMegaPlayPayload = {
    anilistId: 113415,
    malId: 40748,
    title: 'JUJUTSU KAISEN',
    episode: 1,
    type: 'sub',
    source: 'megaplay',
    server: 'MegaPlay Direct',
    availableServers: ['MegaPlay Direct'],
    embedUrl: 'https://megaplay.buzz/',
    m3u8: 'https://fetch.nexabloom.top/anime/abc/master.m3u8',
    hlsProxyUrl:
      'https://api.aniscroll.in/api/proxy/hls?url=https%3A%2F%2Ffetch.nexabloom.top%2Fanime%2Fabc%2Fmaster.m3u8',
    playbackMode: 'hls',
    iframeOnly: false,
    subtitles: [
      {
        url: 'https://api.aniscroll.in/api/proxy/subtitle?url=eng-2.vtt',
        lang: 'English',
        default: true,
      },
      {
        url: 'https://api.aniscroll.in/api/proxy/subtitle?url=ara-3.vtt',
        lang: 'Arabic',
        default: false,
      },
    ],
    intro: { start: 90, end: 180 },
    outro: null,
    note: null,
  };

  const validated = validateMegaPlayResponse(realMegaPlayPayload, 113415, 1, 'sub');
  assert.ok(validated);
  assert.equal(validated.provider, 'megaplay');
  assert.equal(validated.source, 'megaplay');
  assert.equal(validated.serverName, 'MegaPlay Direct');
  assert.deepEqual(validated.availableServers, ['MegaPlay Direct']);
  assert.equal(validated.qualities?.length, 0);
  assert.equal(validated.hlsProxyUrl, realMegaPlayPayload.hlsProxyUrl);
  // AniSkip stays completely independent of provider skip fields
  assert.equal(validated.skip, null);
  assert.equal(validated.subtitles?.length, 2);
  assert.equal(validated.subtitles?.[0].label, 'English');

  // Error payload returned by MegaPlay when dub is unavailable
  const megaPlayUnavailable = {
    error: 'MegaPlay failed to resolve a stream for episode 1',
    source: 'megaplay',
  };
  assert.equal(validateMegaPlayResponse(megaPlayUnavailable, 130003, 1, 'dub'), null);
});

test('ZokoAnime Movie Normalization: preserves discrete quality URLs and sets provider to zokoanime', () => {
  const moviePayload = {
    source: 'zokoanime',
    anilistId: 21519,
    malId: 32281,
    title: 'Your Name.',
    episode: 1,
    type: 'sub',
    qualities: [
      {
        quality: '720p',
        resolution: '1280x720',
        width: 1280,
        height: 720,
        bandwidth: 2200000,
        hlsProxyUrl: 'https://api.aniscroll.in/api/proxy/hls?url=720p',
      },
      {
        quality: '1080p',
        resolution: '1920x1080',
        width: 1920,
        height: 1080,
        bandwidth: 5100000,
        hlsProxyUrl: 'https://api.aniscroll.in/api/proxy/hls?url=1080p',
      },
    ],
    subtitles: [
      {
        lang: 'en',
        label: 'English',
        default: true,
        url: 'https://api.aniscroll.in/api/proxy/subtitle?url=movie-en',
      },
    ],
    playbackMode: 'hls',
    serverName: 'ZokoAnime',
    hlsProxyUrl: 'https://api.aniscroll.in/api/proxy/hls?url=master',
    iframeOnly: false,
  };

  const validated = validateZokoAnimeResponse(moviePayload, 21519, 1, 'sub');
  assert.ok(validated);
  assert.equal(validated.provider, 'zokoanime');
  assert.equal(validated.qualities?.length, 2);
  assert.equal(validated.qualities?.[0].quality, '1080p');
  assert.equal(validated.skip, null);
});

test('HLS.js Master Playlist Levels: normalizes detected resolutions, keeps levelIndex, and prefers 1080p', () => {
  const rawLevels = [
    { width: 640, height: 360, bitrate: 800000 },
    { width: 1280, height: 720, bitrate: 2500000 },
    { width: 1920, height: 1080, bitrate: 4800000 },
    { width: 1280, height: 720, bitrate: 1800000 }, // duplicate height -> keep higher bitrate index (1)
  ];

  const normalized = normalizeHlsMasterLevels(rawLevels);
  assert.equal(normalized.length, 3);
  assert.deepEqual(
    normalized.map((l) => [l.label, l.levelIndex]),
    [
      ['1080p', 2],
      ['720p', 1],
      ['360p', 0],
    ]
  );

  // Prefers 1080p when available
  assert.equal(selectInitialHlsLevelIndex(normalized), 2);

  // Prefers 720p when 1080p absent
  const without1080 = normalized.filter((l) => l.height !== 1080);
  assert.equal(selectInitialHlsLevelIndex(without1080), 1);

  // Empty levels -> Auto (-1)
  assert.equal(normalizeHlsMasterLevels([]).length, 0);
  assert.equal(selectInitialHlsLevelIndex([]), -1);
});

test('MegaPlay Subtitle Matching: resolves lang="English" and preserves Off across episodes', () => {
  const megaPlaySubs = normalizeSubtitleTracks([
    {
      url: 'https://api.aniscroll.in/api/proxy/subtitle?url=eng',
      lang: 'English',
      default: true,
    },
    {
      url: 'https://api.aniscroll.in/api/proxy/subtitle?url=fre',
      lang: 'French',
      default: false,
    },
  ]);

  assert.equal(
    resolveSubtitleTrackForPreference(megaPlaySubs, 'en'),
    'https://api.aniscroll.in/api/proxy/subtitle?url=eng'
  );
  assert.equal(
    resolveSubtitleTrackForPreference(megaPlaySubs, 'English'),
    'https://api.aniscroll.in/api/proxy/subtitle?url=eng'
  );
  assert.equal(resolveSubtitleTrackForPreference(megaPlaySubs, 'off'), 'off');
});
