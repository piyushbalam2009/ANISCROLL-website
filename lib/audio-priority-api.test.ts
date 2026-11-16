import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET as getStreamRoute } from '../app/api/stream/route';
import { appCache } from './cache';

function buildValidProviderStream(params: {
  provider: 'megaplay' | 'zokoanime';
  anilistId: number;
  episode: number;
  type: 'sub' | 'dub';
}) {
  return {
    source: params.provider,
    anilistId: params.anilistId,
    malId: 1000 + params.anilistId,
    episode: params.episode,
    type: params.type,
    playbackMode: 'hls',
    hlsProxyUrl: `https://api.aniscroll.in/api/proxy/hls?url=${params.provider}-${params.anilistId}-${params.episode}-${params.type}.m3u8`,
    subtitles: [],
    qualities:
      params.provider === 'zokoanime'
        ? [
            {
              quality: '1080p',
              height: 1080,
              hlsProxyUrl: `https://api.aniscroll.in/api/proxy/hls?url=${params.provider}-${params.anilistId}-${params.episode}-${params.type}-1080p.m3u8`,
            },
          ]
        : [],
  };
}

test('GET /api/stream enforces Default Audio Mode priority across all 4 Sub/Dub combinations', async () => {
  const origFetch = globalThis.fetch;

  try {
    // Case 1 & 2: Both Sub and Dub available (MegaPlay TV series, id 910001)
    appCache.clear();
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/megaplay/910001/1/sub')) {
        return new Response(
          JSON.stringify(
            buildValidProviderStream({
              provider: 'megaplay',
              anilistId: 910001,
              episode: 1,
              type: 'sub',
            })
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/megaplay/910001/1/dub')) {
        return new Response(
          JSON.stringify(
            buildValidProviderStream({
              provider: 'megaplay',
              anilistId: 910001,
              episode: 1,
              type: 'dub',
            })
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    // Default = dub -> selects dub when both exist
    const resDubPref = await getStreamRoute(
      new NextRequest(
        'http://localhost:3000/api/stream?anilistId=910001&episode=1&format=TV&preferredType=dub'
      )
    );
    assert.equal(resDubPref.status, 200);
    assert.equal(resDubPref.headers.get('cache-control'), 'no-store, max-age=0');
    const dubBody = await resDubPref.json();
    assert.equal(dubBody.ok, true);
    assert.equal(dubBody.subAvailable, true);
    assert.equal(dubBody.dubAvailable, true);
    assert.equal(dubBody.selectedType, 'dub');
    assert.equal(dubBody.stream?.type, 'dub');

    // Default = sub -> selects sub when both exist (even with warm cache from above)
    const resSubPref = await getStreamRoute(
      new NextRequest(
        'http://localhost:3000/api/stream?anilistId=910001&episode=1&format=TV&preferredType=sub'
      )
    );
    assert.equal(resSubPref.status, 200);
    const subBody = await resSubPref.json();
    assert.equal(subBody.ok, true);
    assert.equal(subBody.subAvailable, true);
    assert.equal(subBody.dubAvailable, true);
    assert.equal(subBody.selectedType, 'sub');
    assert.equal(subBody.stream?.type, 'sub');

    // Case 3: Default = dub, only Sub available -> selects sub & marks dubAvailable=false
    appCache.clear();
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/megaplay/910002/1/sub')) {
        return new Response(
          JSON.stringify(
            buildValidProviderStream({
              provider: 'megaplay',
              anilistId: 910002,
              episode: 1,
              type: 'sub',
            })
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          source: 'megaplay',
          error: 'MegaPlay failed to resolve a stream for episode 1',
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const resDubPrefSubOnly = await getStreamRoute(
      new NextRequest(
        'http://localhost:3000/api/stream?anilistId=910002&episode=1&format=TV&preferredType=dub'
      )
    );
    assert.equal(resDubPrefSubOnly.status, 200);
    const subOnlyBody = await resDubPrefSubOnly.json();
    assert.equal(subOnlyBody.ok, true);
    assert.equal(subOnlyBody.subAvailable, true);
    assert.equal(subOnlyBody.dubAvailable, false);
    assert.equal(subOnlyBody.dubStream, null);
    assert.equal(subOnlyBody.selectedType, 'sub');
    assert.equal(subOnlyBody.stream?.type, 'sub');

    // Case 4: Default = sub, only Dub available (ZokoAnime movie, id 910003) -> selects dub
    appCache.clear();
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/zokoanime/910003/1/dub')) {
        return new Response(
          JSON.stringify(
            buildValidProviderStream({
              provider: 'zokoanime',
              anilistId: 910003,
              episode: 1,
              type: 'dub',
            })
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          source: 'zokoanime',
          error: 'ZokoAnime player configuration was not found',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const resSubPrefDubOnly = await getStreamRoute(
      new NextRequest(
        'http://localhost:3000/api/stream?anilistId=910003&episode=1&format=MOVIE&preferredType=sub'
      )
    );
    assert.equal(resSubPrefDubOnly.status, 200);
    const dubOnlyBody = await resSubPrefDubOnly.json();
    assert.equal(dubOnlyBody.ok, true);
    assert.equal(dubOnlyBody.provider, 'zokoanime');
    assert.equal(dubOnlyBody.subAvailable, false);
    assert.equal(dubOnlyBody.subStream, null);
    assert.equal(dubOnlyBody.dubAvailable, true);
    assert.equal(dubOnlyBody.selectedType, 'dub');
    assert.equal(dubOnlyBody.stream?.type, 'dub');

    // Case 5: Neither Sub nor Dub available -> returns non-200 error, both false
    appCache.clear();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          source: 'megaplay',
          error: 'MegaPlay failed to resolve a stream for episode 1',
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    const resNeither = await getStreamRoute(
      new NextRequest(
        'http://localhost:3000/api/stream?anilistId=910004&episode=1&format=TV&preferredType=dub'
      )
    );
    assert.equal(resNeither.status, 404);
    const neitherBody = await resNeither.json();
    assert.equal(neitherBody.ok, false);
    assert.equal(neitherBody.subAvailable, false);
    assert.equal(neitherBody.dubAvailable, false);
    assert.equal(neitherBody.selectedType, null);
    assert.equal(neitherBody.stream, null);
  } finally {
    globalThis.fetch = origFetch;
    appCache.clear();
  }
});

test('GET /api/stream handles shared multi-audio URLs and explicit type=dub without Sub/Dub cross-contamination', async () => {
  const origFetch = globalThis.fetch;

  try {
    appCache.clear();
    const sharedMasterProxyUrl =
      'https://api.aniscroll.in/api/proxy/hls?url=https://example.com/shared/master.m3u8';

    // Upstream returns same master HLS URL for both /sub and /dub (multi-audio HLS manifest)
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/megaplay/212888/8/sub')) {
        return new Response(
          JSON.stringify({
            source: 'megaplay',
            anilistId: 212888,
            malId: 64340,
            episode: 8,
            type: 'sub',
            playbackMode: 'hls',
            hlsProxyUrl: sharedMasterProxyUrl,
            subtitles: [],
            qualities: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/megaplay/212888/8/dub')) {
        return new Response(
          JSON.stringify({
            source: 'megaplay',
            anilistId: 212888,
            malId: 64340,
            episode: 8,
            type: 'dub',
            playbackMode: 'hls',
            hlsProxyUrl: sharedMasterProxyUrl,
            subtitles: [],
            qualities: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    // 1. Sub requested first (warms sub cache)
    const subReq = await getStreamRoute(
      new NextRequest(
        'http://localhost:3000/api/stream?anilistId=212888&episode=8&format=ONA&type=sub&preferredType=sub'
      )
    );
    assert.equal(subReq.status, 200);
    const subJson = await subReq.json();
    assert.equal(subJson.selectedType, 'sub');
    assert.equal(subJson.stream?.type, 'sub');

    // 2. Dub requested next with explicit type=dub&preferredType=dub must select Dub
    const dubReq = await getStreamRoute(
      new NextRequest(
        'http://localhost:3000/api/stream?anilistId=212888&episode=8&format=ONA&type=dub&preferredType=dub'
      )
    );
    assert.equal(dubReq.status, 200);
    const dubJson = await dubReq.json();
    assert.equal(dubJson.subAvailable, true);
    assert.equal(dubJson.dubAvailable, true);
    assert.equal(dubJson.selectedType, 'dub');
    assert.equal(dubJson.stream?.type, 'dub');
    assert.equal(dubJson.subStream?.type, 'sub');
    assert.equal(dubJson.dubStream?.type, 'dub');

    // 3. Explicit type=dub overrides conflicting preferredType=sub if present
    const explicitDubReq = await getStreamRoute(
      new NextRequest(
        'http://localhost:3000/api/stream?anilistId=212888&episode=8&format=ONA&type=dub&preferredType=sub'
      )
    );
    assert.equal(explicitDubReq.status, 200);
    const explicitDubJson = await explicitDubReq.json();
    assert.equal(explicitDubJson.selectedType, 'dub');
    assert.equal(explicitDubJson.stream?.type, 'dub');

    // 4. Rejects upstream /dub endpoint that mistakenly returns type: 'sub'
    appCache.clear();
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/megaplay/212999/8/sub')) {
        return new Response(
          JSON.stringify(
            buildValidProviderStream({
              provider: 'megaplay',
              anilistId: 212999,
              episode: 8,
              type: 'sub',
            })
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/megaplay/212999/8/dub')) {
        return new Response(
          JSON.stringify(
            buildValidProviderStream({
              provider: 'megaplay',
              anilistId: 212999,
              episode: 8,
              type: 'sub', // Corrupted upstream type!
            })
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }) as typeof fetch;

    const contaminatedReq = await getStreamRoute(
      new NextRequest(
        'http://localhost:3000/api/stream?anilistId=212999&episode=8&format=TV&type=dub&preferredType=dub'
      )
    );
    assert.equal(contaminatedReq.status, 200);
    const contaminatedJson = await contaminatedReq.json();
    assert.equal(contaminatedJson.dubAvailable, false);
    assert.equal(contaminatedJson.dubStream, null);
    assert.equal(contaminatedJson.selectedType, 'sub');
    assert.equal(contaminatedJson.stream?.type, 'sub');
  } finally {
    globalThis.fetch = origFetch;
    appCache.clear();
  }
});

