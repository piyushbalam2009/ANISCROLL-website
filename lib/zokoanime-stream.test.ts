import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateZokoAnimeResponse,
  normalizeAndSortQualities,
  selectInitialQuality,
  selectNextFallbackQuality,
  normalizeSubtitleTracks,
  resolveSubtitleTrackForPreference,
  selectEpisodeAudioVersion,
} from './zokoanime-stream';

test('Sub/Dub Availability: validates real ZokoAnime responses and rejects error or empty payloads', () => {
  const validSubPayload = {
    source: 'zokoanime',
    anilistId: 159309,
    malId: 54000,
    title: 'Example Anime',
    episode: 3,
    type: 'sub',
    embedUrl: 'https://zokoanime.video/stream/mal/54000/3/sub',
    m3u8: 'https://example.com/master.m3u8',
    qualities: [
      {
        quality: '360p',
        resolution: '640x360',
        width: 640,
        height: 360,
        bandwidth: 900000,
        hlsProxyUrl: 'https://api.aniscroll.in/api/proxy/hls?url=360p',
      },
      {
        quality: '720p',
        resolution: '1280x720',
        width: 1280,
        height: 720,
        bandwidth: 3000000,
        hlsProxyUrl: 'https://api.aniscroll.in/api/proxy/hls?url=720p',
      },
      {
        quality: '1080p',
        resolution: '1920x1080',
        width: 1920,
        height: 1080,
        bandwidth: 5300000,
        hlsProxyUrl: 'https://api.aniscroll.in/api/proxy/hls?url=1080p',
      },
    ],
    subtitles: [
      {
        lang: 'en',
        label: 'English',
        default: true,
        src: 'https://example.com/subtitle.vtt',
        url: 'https://api.aniscroll.in/api/proxy/subtitle?url=en',
      },
    ],
    playbackMode: 'hls',
    serverName: 'ZokoAnime',
    hlsProxyUrl: 'https://api.aniscroll.in/api/proxy/hls?url=master',
    iframeOnly: false,
  };

  const validated = validateZokoAnimeResponse(validSubPayload, 159309, 3, 'sub');
  assert.ok(validated);
  assert.equal(validated.anilistId, 159309);
  assert.equal(validated.episode, 3);
  assert.equal(validated.type, 'sub');
  assert.equal(validated.qualities?.length, 3);
  // Sorted highest to lowest: 1080p, 720p, 360p
  assert.equal(validated.qualities?.[0].quality, '1080p');
  assert.equal(validated.qualities?.[1].quality, '720p');
  assert.equal(validated.qualities?.[2].quality, '360p');

  // HTTP 200 error payload from ZokoAnime when Dub is unavailable (e.g., Bocchi the Rock)
  const unavailableDubPayload = {
    source: 'zokoanime',
    anilistId: 130003,
    episode: 1,
    type: 'dub',
    error: 'ZokoAnime player configuration was not found',
  };
  assert.equal(
    validateZokoAnimeResponse(unavailableDubPayload, 130003, 1, 'dub'),
    null
  );

  // Rejects mismatched episode or type
  assert.equal(validateZokoAnimeResponse(validSubPayload, 159309, 4, 'sub'), null);
  assert.equal(validateZokoAnimeResponse(validSubPayload, 159309, 3, 'dub'), null);

  // Rejects HTTP 200 payload with empty qualities and no master hlsProxyUrl
  assert.equal(
    validateZokoAnimeResponse(
      {
        source: 'zokoanime',
        anilistId: 159309,
        episode: 3,
        type: 'sub',
        qualities: [],
        playbackMode: 'hls',
        iframeOnly: false,
      },
      159309,
      3,
      'sub'
    ),
    null
  );
});

test('Sub/Dub Selection: handles Sub only, Dub only, Both, Neither, and episode-to-episode changes', () => {
  // 1. Sub only -> 'sub'
  assert.equal(
    selectEpisodeAudioVersion({ subAvailable: true, dubAvailable: false }),
    'sub'
  );
  assert.equal(
    selectEpisodeAudioVersion({
      subAvailable: true,
      dubAvailable: false,
      userSelectedVersion: 'dub',
    }),
    'sub'
  );

  // 2. Dub only -> 'dub'
  assert.equal(
    selectEpisodeAudioVersion({ subAvailable: false, dubAvailable: true }),
    'dub'
  );
  assert.equal(
    selectEpisodeAudioVersion({
      subAvailable: false,
      dubAvailable: true,
      userSelectedVersion: 'sub',
    }),
    'dub'
  );

  // 3. Both available -> defaults to 'sub', preserves 'dub' if user selected 'dub'
  assert.equal(
    selectEpisodeAudioVersion({ subAvailable: true, dubAvailable: true }),
    'sub'
  );
  assert.equal(
    selectEpisodeAudioVersion({
      subAvailable: true,
      dubAvailable: true,
      userSelectedVersion: 'dub',
    }),
    'dub'
  );

  // 4. Neither available -> null
  assert.equal(
    selectEpisodeAudioVersion({ subAvailable: false, dubAvailable: false }),
    null
  );
});

test('Quality Selection & Fallback: prefers 1080p first, falls back 1080p -> 720p -> 480p -> 360p without loops', () => {
  const q360 = {
    quality: '360p',
    height: 360,
    hlsProxyUrl: 'https://api.aniscroll.in/api/proxy/hls?url=360p',
  };
  const q480 = {
    quality: '480p',
    height: 480,
    hlsProxyUrl: 'https://api.aniscroll.in/api/proxy/hls?url=480p',
  };
  const q720 = {
    quality: '720p',
    height: 720,
    hlsProxyUrl: 'https://api.aniscroll.in/api/proxy/hls?url=720p',
  };
  const q1080 = {
    quality: '1080p',
    height: 1080,
    hlsProxyUrl: 'https://api.aniscroll.in/api/proxy/hls?url=1080p',
  };

  // Case 1: 1080p, 720p, 360p -> 1080p
  assert.equal(selectInitialQuality([q360, q720, q1080])?.quality, '1080p');

  // Case 2: 720p, 360p -> 720p
  assert.equal(selectInitialQuality([q360, q720])?.quality, '720p');

  // Case 3: 480p, 360p -> 480p
  assert.equal(selectInitialQuality([q360, q480])?.quality, '480p');

  // Case 4: 360p only -> 360p
  assert.equal(selectInitialQuality([q360])?.quality, '360p');

  // Case 5: Fallback sequence when 1080p fails -> 720p -> 480p -> 360p -> null
  const allQualities = normalizeAndSortQualities([q360, q480, q720, q1080]);
  const attempted = new Set<string>();

  attempted.add(q1080.hlsProxyUrl);
  const fb1 = selectNextFallbackQuality(allQualities, q1080.hlsProxyUrl, attempted);
  assert.equal(fb1?.quality, '720p');

  attempted.add(q720.hlsProxyUrl);
  const fb2 = selectNextFallbackQuality(allQualities, q720.hlsProxyUrl, attempted);
  assert.equal(fb2?.quality, '480p');

  attempted.add(q480.hlsProxyUrl);
  const fb3 = selectNextFallbackQuality(allQualities, q480.hlsProxyUrl, attempted);
  assert.equal(fb3?.quality, '360p');

  attempted.add(q360.hlsProxyUrl);
  const fb4 = selectNextFallbackQuality(allQualities, q360.hlsProxyUrl, attempted);
  assert.equal(fb4, null);
});

test('Subtitle Tracks & Critical OFF Bug Fix: prefers proxy URL, preserves forced labels, and strictly enforces Off across quality & episode changes', () => {
  const rawSubs = [
    {
      lang: 'en',
      label: 'English',
      default: true,
      src: 'https://example.com/subtitle.vtt',
      url: 'https://api.aniscroll.in/api/proxy/subtitle?url=en_main',
    },
    {
      lang: 'en',
      label: 'English (Forced)',
      default: false,
      src: 'https://example.com/forced.vtt',
      url: 'https://api.aniscroll.in/api/proxy/subtitle?url=en_forced',
    },
    {
      lang: 'es',
      label: 'Spanish (Latin America)',
      default: false,
      src: 'https://example.com/es_direct.vtt',
      url: '', // Missing proxy URL -> falls back to direct src
    },
  ];

  const tracks = normalizeSubtitleTracks(rawSubs);
  assert.equal(tracks.length, 3);
  assert.equal(tracks[0].label, 'English');
  assert.equal(tracks[0].url, 'https://api.aniscroll.in/api/proxy/subtitle?url=en_main');
  assert.equal(tracks[1].label, 'English (Forced)');
  assert.equal(tracks[2].label, 'Spanish (Latin America)');
  assert.equal(tracks[2].url, 'https://example.com/es_direct.vtt');

  // 1. Uninitialized preference (null) selects the API default track
  assert.equal(
    resolveSubtitleTrackForPreference(tracks, null),
    'https://api.aniscroll.in/api/proxy/subtitle?url=en_main'
  );

  // 2. When user selects Off ('off'), it MUST stay 'off' and never reactivate default:true
  assert.equal(resolveSubtitleTrackForPreference(tracks, 'off'), 'off');

  // 3. When navigating to a new episode with new subtitle tracks while 'off', it stays 'off'
  const nextEpTracks = normalizeSubtitleTracks([
    {
      lang: 'en',
      label: 'English',
      default: true,
      url: 'https://api.aniscroll.in/api/proxy/subtitle?url=ep2_en',
    },
  ]);
  assert.equal(resolveSubtitleTrackForPreference(nextEpTracks, 'off'), 'off');

  // 4. When user explicitly selects 'English (Forced)', it resolves that track
  assert.equal(
    resolveSubtitleTrackForPreference(tracks, 'English (Forced)'),
    'https://api.aniscroll.in/api/proxy/subtitle?url=en_forced'
  );
});
