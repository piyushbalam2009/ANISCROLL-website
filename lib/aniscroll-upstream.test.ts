import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProviderResponseFailure,
  mapErrorCodeToHttpStatus,
  getCachedOrWarmServerAudioAvailability,
} from './aniscroll';
import { appCache } from './cache';

test('MegaPlay 502 stream unavailability JSON is classified as definitive 404 (no retry)', () => {
  const result = classifyProviderResponseFailure({
    provider: 'megaplay',
    status: 502,
    contentType: 'application/json; charset=utf-8',
    payload: {
      error: 'MegaPlay failed to resolve a stream for episode 1',
      source: 'megaplay',
    },
    episode: 1,
    type: 'sub',
  });

  assert.equal(result.definitiveUnavailable, true);
  assert.equal(result.errorCode, 'not_found');
  assert.equal(result.httpStatus, 404);
  assert.equal(result.retryable, false);
});

test('ZokoAnime 502 player configuration not found JSON is classified as definitive 404 (no retry)', () => {
  const result = classifyProviderResponseFailure({
    provider: 'zokoanime',
    status: 502,
    contentType: 'application/json; charset=utf-8',
    payload: {
      source: 'zokoanime',
      anilistId: 6162,
      episode: 1,
      type: 'dub',
      error: 'ZokoAnime player configuration was not found',
    },
    episode: 1,
    type: 'dub',
  });

  assert.equal(result.definitiveUnavailable, true);
  assert.equal(result.errorCode, 'not_found');
  assert.equal(result.httpStatus, 404);
  assert.equal(result.retryable, false);
});

test('Upstream 502/503 outage, 429 rate limit, 200 HTML, and timeout map to non-200 HTTP statuses', () => {
  const html502 = classifyProviderResponseFailure({
    provider: 'megaplay',
    status: 502,
    contentType: 'text/html',
    payload: null,
    episode: 1,
    type: 'sub',
  });
  assert.equal(html502.definitiveUnavailable, false);
  assert.equal(html502.errorCode, 'server_error');
  assert.equal(html502.httpStatus, 502);
  assert.equal(html502.retryable, true);

  const rateLimit = classifyProviderResponseFailure({
    provider: 'zokoanime',
    status: 429,
    contentType: 'application/json',
    retryAfterHeader: '12',
    episode: 1,
    type: 'sub',
  });
  assert.equal(rateLimit.definitiveUnavailable, false);
  assert.equal(rateLimit.errorCode, 'rate_limit');
  assert.equal(rateLimit.httpStatus, 429);
  assert.equal(rateLimit.retryable, false);
  assert.equal(rateLimit.retryAfterSeconds, 12);

  const badSchema200 = classifyProviderResponseFailure({
    provider: 'megaplay',
    status: 200,
    contentType: 'application/json',
    payload: { ok: true, anilistId: 21 },
    episode: 1,
    type: 'sub',
  });
  assert.equal(badSchema200.definitiveUnavailable, false);
  assert.equal(badSchema200.errorCode, 'parse_error');
  assert.equal(badSchema200.httpStatus, 502);

  assert.equal(mapErrorCodeToHttpStatus('timeout'), 504);
  assert.equal(mapErrorCodeToHttpStatus('rate_limit'), 429);
  assert.equal(mapErrorCodeToHttpStatus('not_found'), 404);
  assert.equal(mapErrorCodeToHttpStatus('invalid_json'), 502);
  assert.equal(mapErrorCodeToHttpStatus('network_error'), 502);
});

test('getCachedOrWarmServerAudioAvailability returns null synchronously on cold cache without firing SSR fetches', async () => {
  appCache.clear();
  let fetchCalled = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error('fetch should not run during SSR cache check');
  }) as typeof fetch;

  try {
    const result = getCachedOrWarmServerAudioAvailability({
      hoshikaId: 922641,
      anilistId: 1565,
      episodeCount: 191,
      format: 'TV',
    });
    assert.equal(result, null);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});
