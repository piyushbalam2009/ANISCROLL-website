import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ClientEpisodeStreamCache,
  buildClientStreamCacheKey,
} from './client-stream-cache';
import type { AniScrollStreamResponse } from '@/types/streaming';

function makeStream(params: {
  provider?: 'megaplay' | 'zokoanime';
  anilistId?: number;
  episode?: number;
  type: 'sub' | 'dub';
  hlsUrl?: string;
}): AniScrollStreamResponse {
  const provider = params.provider ?? 'megaplay';
  const anilistId = params.anilistId ?? 212888;
  const episode = params.episode ?? 8;
  return {
    source: provider,
    provider,
    anilistId,
    episode,
    type: params.type,
    playbackMode: 'hls',
    hlsProxyUrl:
      params.hlsUrl ??
      `https://api.aniscroll.in/api/proxy/hls?url=https://example.com/${anilistId}/${episode}/${params.type}.m3u8`,
    qualities: [],
    subtitles: [],
  };
}

test('ClientEpisodeStreamCache isolates Sub and Dub by audio type key', () => {
  const cache = new ClientEpisodeStreamCache(60_000);

  assert.equal(
    buildClientStreamCacheKey('megaplay', 212888, 8, 'sub'),
    'megaplay:212888:8:sub'
  );
  assert.equal(
    buildClientStreamCacheKey('megaplay', 212888, 8, 'dub'),
    'megaplay:212888:8:dub'
  );

  const subStream = makeStream({ type: 'sub' });
  const dubStream = makeStream({ type: 'dub' });

  cache.setEpisodeBundle({
    provider: 'megaplay',
    anilistId: 212888,
    episode: 8,
    subAvailable: true,
    dubAvailable: true,
    subStream,
    dubStream,
    now: 1_000,
  });

  // Requesting Dub picks dub stream cleanly
  const resolvedDub = cache.resolveForPreference({
    provider: 'megaplay',
    anilistId: 212888,
    episode: 8,
    defaultAudio: 'dub',
    now: 2_000,
  });
  assert.ok(resolvedDub);
  assert.equal(resolvedDub.chosenVersion, 'dub');
  assert.equal(resolvedDub.chosenStream?.type, 'dub');
  assert.equal(resolvedDub.chosenStream?.hlsProxyUrl, dubStream.hlsProxyUrl);

  // Requesting Sub picks sub stream cleanly
  const resolvedSub = cache.resolveForPreference({
    provider: 'megaplay',
    anilistId: 212888,
    episode: 8,
    defaultAudio: 'sub',
    now: 2_000,
  });
  assert.ok(resolvedSub);
  assert.equal(resolvedSub.chosenVersion, 'sub');
  assert.equal(resolvedSub.chosenStream?.type, 'sub');
  assert.equal(resolvedSub.chosenStream?.hlsProxyUrl, subStream.hlsProxyUrl);
});

test('ClientEpisodeStreamCache bypasses cache when Sub was cached first and Dub was not confirmed unavailable', () => {
  const cache = new ClientEpisodeStreamCache(60_000);
  const subStream = makeStream({ type: 'sub' });

  // Simulate partial bundle where Sub was cached and Dub had a transient failure (errorCode != 'not_found')
  cache.setEpisodeBundle({
    provider: 'megaplay',
    anilistId: 212888,
    episode: 8,
    subAvailable: true,
    dubAvailable: false,
    subStream,
    dubStream: null,
    dubErrorCode: 'timeout',
    now: 1_000,
  });

  // Subsequent Dub request MUST bypass cache (return null) rather than serving Sub
  const resolved = cache.resolveForPreference({
    provider: 'megaplay',
    anilistId: 212888,
    episode: 8,
    defaultAudio: 'dub',
    now: 2_000,
  });
  assert.equal(resolved, null);

  // If Dub WAS definitively unavailable ('not_found'), fallback to Sub is allowed
  cache.setEpisodeBundle({
    provider: 'megaplay',
    anilistId: 212888,
    episode: 8,
    subAvailable: true,
    dubAvailable: false,
    subStream,
    dubStream: null,
    dubErrorCode: 'not_found',
    now: 3_000,
  });
  const fallbackResolved = cache.resolveForPreference({
    provider: 'megaplay',
    anilistId: 212888,
    episode: 8,
    defaultAudio: 'dub',
    now: 4_000,
  });
  assert.ok(fallbackResolved);
  assert.equal(fallbackResolved.chosenVersion, 'sub');
  assert.equal(fallbackResolved.chosenStream?.type, 'sub');
});

test('ClientEpisodeStreamCache rejects mismatched type, anilistId, episode, and respects TTL + deleteEpisode', () => {
  const cache = new ClientEpisodeStreamCache(10_000);

  // Reject storing Sub stream under Dub key
  const mismatchedSet = cache.setStream({
    provider: 'megaplay',
    anilistId: 212888,
    episode: 8,
    type: 'dub',
    available: true,
    stream: makeStream({ type: 'sub', episode: 8 }),
    now: 1_000,
  });
  assert.equal(mismatchedSet, false);
  assert.equal(
    cache.getStream({
      provider: 'megaplay',
      anilistId: 212888,
      episode: 8,
      type: 'dub',
      now: 1_000,
    }),
    null
  );

  // Reject storing episode 7 stream under episode 8 key
  const wrongEpSet = cache.setStream({
    provider: 'megaplay',
    anilistId: 212888,
    episode: 8,
    type: 'dub',
    available: true,
    stream: makeStream({ type: 'dub', episode: 7 }),
    now: 1_000,
  });
  assert.equal(wrongEpSet, false);

  // Past episode cache never leaks into current episode
  cache.setEpisodeBundle({
    provider: 'megaplay',
    anilistId: 212888,
    episode: 7,
    subAvailable: true,
    dubAvailable: true,
    subStream: makeStream({ type: 'sub', episode: 7 }),
    dubStream: makeStream({ type: 'dub', episode: 7 }),
    now: 1_000,
  });
  assert.equal(
    cache.resolveForPreference({
      provider: 'megaplay',
      anilistId: 212888,
      episode: 8,
      defaultAudio: 'dub',
      now: 2_000,
    }),
    null
  );

  // TTL expiration
  assert.ok(
    cache.resolveForPreference({
      provider: 'megaplay',
      anilistId: 212888,
      episode: 7,
      defaultAudio: 'dub',
      now: 5_000,
    })
  );
  assert.equal(
    cache.resolveForPreference({
      provider: 'megaplay',
      anilistId: 212888,
      episode: 7,
      defaultAudio: 'dub',
      now: 12_000,
    }),
    null
  );

  // deleteEpisode removes sub, dub, and availability cleanly
  cache.setEpisodeBundle({
    provider: 'megaplay',
    anilistId: 212888,
    episode: 8,
    subAvailable: true,
    dubAvailable: true,
    subStream: makeStream({ type: 'sub', episode: 8 }),
    dubStream: makeStream({ type: 'dub', episode: 8 }),
    now: 20_000,
  });
  cache.deleteEpisode('megaplay', 212888, 8);
  assert.equal(
    cache.getStream({
      provider: 'megaplay',
      anilistId: 212888,
      episode: 8,
      type: 'sub',
      now: 20_500,
    }),
    null
  );
  assert.equal(
    cache.getStream({
      provider: 'megaplay',
      anilistId: 212888,
      episode: 8,
      type: 'dub',
      now: 20_500,
    }),
    null
  );
});
