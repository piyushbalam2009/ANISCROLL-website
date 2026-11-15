import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  timingSafeSecretMatch,
  isValidDiscordSnowflake,
  isValidFirebaseUid,
  isValidHoshikaId,
  generateOAuthStateBundle,
  validateOAuthStateRecord,
  validateDiscordLinkUniqueness,
  SlidingWindowRateLimiter,
  verifyBotRequestEnvelope,
  extractWatchlistMetadataFromHoshikaAnime,
  validateBotWatchlistPostBody,
  validateBotWatchlistPatchBody,
  filterSortPaginateWatchlist,
} from './discord-watchlist-core';

const PRIMARY_SECRET = 'aniscroll_bot_secret_primary_9876543210_secure';
const PREVIOUS_SECRET = 'aniscroll_bot_secret_previous_1234567890_rotate';
const VALID_DISCORD_ID = '112233445566778899';
const SECOND_DISCORD_ID = '998877665544332211';

describe('Phase 13 Security & Discord Watchlist Core Unit Tests', () => {
  it('1. Unauthenticated / invalid Firebase UID rejected when linking Discord', () => {
    const res = validateDiscordLinkUniqueness({
      firebaseUid: '',
      discordProfile: { id: VALID_DISCORD_ID, username: 'aniscroll_fan' },
      existingByDiscordId: null,
      existingByFirebaseUid: null,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.status, 401);
      assert.equal(res.code, 'invalid_firebase_uid');
    }
    assert.equal(isValidFirebaseUid(''), false);
    assert.equal(isValidFirebaseUid('invalid/uid/with/slashes'), false);
  });

  it('2. Forged or malformed Discord snowflake ID rejected', () => {
    assert.equal(isValidDiscordSnowflake('12345'), false);
    assert.equal(isValidDiscordSnowflake('not_a_snowflake_id!!'), false);
    assert.equal(isValidDiscordSnowflake(VALID_DISCORD_ID), true);

    const res = validateDiscordLinkUniqueness({
      firebaseUid: 'firebase_user_1',
      discordProfile: { id: 'forged_non_snowflake', username: 'attacker' },
      existingByDiscordId: null,
      existingByFirebaseUid: null,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, 'invalid_discord_identity');
    }
  });

  it('3. Invalid OAuth state rejected', () => {
    const bundle = generateOAuthStateBundle({
      firebaseUid: 'firebase_user_1',
      redirectUri: 'https://aniscroll.in/api/auth/discord/callback',
      nowMs: 1_000_000,
    });

    const malformed = validateOAuthStateRecord({
      state: 'invalid_short_state',
      record: bundle.record,
      nowMs: 1_001_000,
    });
    assert.equal(malformed.ok, false);
    if (!malformed.ok) {
      assert.equal(malformed.code, 'invalid_oauth_state');
    }

    const wrongState = validateOAuthStateRecord({
      state: 'a'.repeat(64),
      record: bundle.record,
      nowMs: 1_001_000,
    });
    assert.equal(wrongState.ok, false);
    if (!wrongState.ok) {
      assert.equal(wrongState.code, 'invalid_oauth_state');
    }
  });

  it('4. Reused (single-use) OAuth state rejected', () => {
    const bundle = generateOAuthStateBundle({
      firebaseUid: 'firebase_user_1',
      redirectUri: 'https://aniscroll.in/api/auth/discord/callback',
      nowMs: 1_000_000,
    });

    const firstUse = validateOAuthStateRecord({
      state: bundle.state,
      record: bundle.record,
      cookieNonce: bundle.nonce,
      nowMs: 1_005_000,
    });
    assert.equal(firstUse.ok, true);

    const secondUse = validateOAuthStateRecord({
      state: bundle.state,
      record: { ...bundle.record, consumed: true },
      cookieNonce: bundle.nonce,
      nowMs: 1_006_000,
    });
    assert.equal(secondUse.ok, false);
    if (!secondUse.ok) {
      assert.equal(secondUse.code, 'reused_oauth_state');
    }
  });

  it('5. Expired OAuth state rejected and CSRF nonce mismatch rejected', () => {
    const bundle = generateOAuthStateBundle({
      firebaseUid: 'firebase_user_1',
      redirectUri: 'https://aniscroll.in/api/auth/discord/callback',
      nowMs: 1_000_000,
      ttlMs: 600_000,
    });

    const expired = validateOAuthStateRecord({
      state: bundle.state,
      record: bundle.record,
      cookieNonce: bundle.nonce,
      nowMs: 1_600_001,
    });
    assert.equal(expired.ok, false);
    if (!expired.ok) {
      assert.equal(expired.status, 410);
      assert.equal(expired.code, 'expired_oauth_state');
    }

    const csrfMismatch = validateOAuthStateRecord({
      state: bundle.state,
      record: bundle.record,
      cookieNonce: 'forged_csrf_cookie_nonce_value',
      nowMs: 1_100_000,
    });
    assert.equal(csrfMismatch.ok, false);
    if (!csrfMismatch.ok) {
      assert.equal(csrfMismatch.code, 'csrf_validation_failed');
    }
  });

  it('6. Discord account already linked to another website account is rejected (1:1 uniqueness)', () => {
    const existingLink = {
      discordUserId: VALID_DISCORD_ID,
      firebaseUid: 'firebase_user_owner_A',
      discordUsername: 'otaku_master',
      discordGlobalName: 'Otaku Master',
      discordAvatar: null,
      linkedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const attemptByUserB = validateDiscordLinkUniqueness({
      firebaseUid: 'firebase_user_attacker_B',
      discordProfile: { id: VALID_DISCORD_ID, username: 'otaku_master' },
      existingByDiscordId: existingLink,
      existingByFirebaseUid: null,
    });
    assert.equal(attemptByUserB.ok, false);
    if (!attemptByUserB.ok) {
      assert.equal(attemptByUserB.status, 409);
      assert.equal(attemptByUserB.code, 'discord_account_already_linked');
    }
  });

  it('7. Website account already linked to another Discord account is rejected (1:1 uniqueness)', () => {
    const existingFirebaseLink = {
      discordUserId: VALID_DISCORD_ID,
      firebaseUid: 'firebase_user_A',
      discordUsername: 'first_discord',
      discordGlobalName: 'First Discord',
      discordAvatar: null,
      linkedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const attemptSecondDiscord = validateDiscordLinkUniqueness({
      firebaseUid: 'firebase_user_A',
      discordProfile: { id: SECOND_DISCORD_ID, username: 'second_discord' },
      existingByDiscordId: null,
      existingByFirebaseUid: existingFirebaseLink,
    });
    assert.equal(attemptSecondDiscord.ok, false);
    if (!attemptSecondDiscord.ok) {
      assert.equal(attemptSecondDiscord.status, 409);
      assert.equal(attemptSecondDiscord.code, 'website_account_already_linked');
    }
  });

  it('8. Bot request with missing or invalid secret rejected; secret rotation supported', () => {
    const missingHeaders = new Headers({
      'x-discord-user-id': VALID_DISCORD_ID,
    });
    const missingRes = verifyBotRequestEnvelope({
      headers: missingHeaders,
      configuredSecrets: [PRIMARY_SECRET, PREVIOUS_SECRET],
    });
    assert.equal(missingRes.ok, false);
    if (!missingRes.ok) {
      assert.equal(missingRes.status, 401);
      assert.equal(missingRes.code, 'missing_bot_secret');
    }

    const wrongHeaders = new Headers({
      'x-bot-api-secret': 'wrong_secret_value_that_does_not_match_12345',
      'x-discord-user-id': VALID_DISCORD_ID,
    });
    const wrongRes = verifyBotRequestEnvelope({
      headers: wrongHeaders,
      configuredSecrets: [PRIMARY_SECRET, PREVIOUS_SECRET],
    });
    assert.equal(wrongRes.ok, false);
    if (!wrongRes.ok) {
      assert.equal(wrongRes.status, 401);
      assert.equal(wrongRes.code, 'invalid_bot_secret');
    }

    // Secret rotation: previous secret still accepted during rotation window
    assert.equal(
      timingSafeSecretMatch(PREVIOUS_SECRET, [PRIMARY_SECRET, PREVIOUS_SECRET]),
      true
    );
    assert.equal(
      timingSafeSecretMatch(PRIMARY_SECRET, [PRIMARY_SECRET, PREVIOUS_SECRET]),
      true
    );
  });

  it('9. Cross-user watchlist access and firebaseUid spoofing in bot requests rejected', () => {
    // Header spoofing attempt
    const spoofedHeaders = new Headers({
      'x-bot-api-secret': PRIMARY_SECRET,
      'x-discord-user-id': VALID_DISCORD_ID,
      'x-firebase-uid': 'victim_firebase_uid',
    });
    const envRes = verifyBotRequestEnvelope({
      headers: spoofedHeaders,
      configuredSecrets: [PRIMARY_SECRET],
    });
    assert.equal(envRes.ok, false);
    if (!envRes.ok) {
      assert.equal(envRes.status, 403);
      assert.equal(envRes.code, 'watchlist_identity_spoofing');
    }

    // Body spoofing attempt in POST
    const postSpoof = validateBotWatchlistPostBody({
      discordUserId: VALID_DISCORD_ID,
      firebaseUid: 'victim_firebase_uid',
      hoshikaId: 26178,
      status: 'watching',
    });
    assert.equal(postSpoof.ok, false);
    if (!postSpoof.ok) {
      assert.equal(postSpoof.status, 403);
      assert.equal(postSpoof.code, 'watchlist_identity_spoofing');
    }

    // Body spoofing attempt in PATCH
    const patchSpoof = validateBotWatchlistPatchBody({
      uid: 'victim_firebase_uid',
      status: 'completed',
    });
    assert.equal(patchSpoof.ok, false);
    if (!patchSpoof.ok) {
      assert.equal(patchSpoof.status, 403);
      assert.equal(patchSpoof.code, 'watchlist_identity_spoofing');
    }

    // Mismatched Discord user IDs across header and body rejected
    const mismatchHeaders = new Headers({
      'x-bot-api-secret': PRIMARY_SECRET,
      'x-discord-user-id': VALID_DISCORD_ID,
    });
    const mismatchRes = verifyBotRequestEnvelope({
      headers: mismatchHeaders,
      configuredSecrets: [PRIMARY_SECRET],
      bodyDiscordUserId: SECOND_DISCORD_ID,
    });
    assert.equal(mismatchRes.ok, false);
    if (!mismatchRes.ok) {
      assert.equal(mismatchRes.status, 403);
      assert.equal(mismatchRes.code, 'discord_user_id_mismatch');
    }
  });

  it('10. Rate limiting blocks abusive bot bursts with 429 retryAfterSeconds', () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);
    const headers = new Headers({
      'x-bot-api-secret': PRIMARY_SECRET,
      'x-discord-user-id': VALID_DISCORD_ID,
    });

    for (let i = 0; i < 3; i++) {
      const okRes = verifyBotRequestEnvelope({
        headers,
        configuredSecrets: [PRIMARY_SECRET],
        rateLimiter: limiter,
        clientIp: '203.0.113.10',
        nowMs: 10_000 + i * 100,
      });
      assert.equal(okRes.ok, true);
    }

    const blockedRes = verifyBotRequestEnvelope({
      headers,
      configuredSecrets: [PRIMARY_SECRET],
      rateLimiter: limiter,
      clientIp: '203.0.113.10',
      nowMs: 10_500,
    });
    assert.equal(blockedRes.ok, false);
    if (!blockedRes.ok) {
      assert.equal(blockedRes.status, 429);
      assert.equal(blockedRes.code, 'rate_limited');
      assert.ok((blockedRes.retryAfterSeconds || 0) >= 1);
    }
  });

  it('11. Invalid Hoshika ID and AniList ID rejected; Hoshika metadata strips streaming/AniSkip fields', () => {
    assert.equal(isValidHoshikaId(-5), false);
    assert.equal(isValidHoshikaId(0), false);
    assert.equal(isValidHoshikaId('abc'), false);
    assert.equal(isValidHoshikaId(26178), true);

    const anilistRejected = validateBotWatchlistPostBody({
      anilistId: 1535,
      status: 'watching',
    });
    assert.equal(anilistRejected.ok, false);
    if (!anilistRejected.ok) {
      assert.equal(anilistRejected.code, 'invalid_hoshika_id');
    }

    const rawHoshikaResponse: any = {
      shortId: 26178,
      title: { english: 'Death Note', romaji: 'Death Note' },
      cover: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1535.jpg',
      format: 'TV',
      score: 84,
      year: 2006,
      streamingLinks: ['https://crunchyroll.com/death-note'],
      aniskip: { op: [0, 90] },
    };

    const extracted = extractWatchlistMetadataFromHoshikaAnime(rawHoshikaResponse);
    assert.ok(extracted);
    assert.equal(extracted.hoshikaId, 26178);
    assert.equal(extracted.title, 'Death Note');
    assert.equal(extracted.format, 'TV');
    assert.equal(extracted.rating, 84);
    assert.equal(extracted.seasonYear, 2006);
    assert.equal('streamingLinks' in extracted, false);
    assert.equal('aniskip' in extracted, false);
  });

  it('12. Watchlist filtering, sorting, and pagination compute accurate status counts', () => {
    const sampleItems = [
      {
        hoshikaId: 101,
        title: 'Attack on Titan',
        coverImage: 'https://example.com/aot.jpg',
        format: 'TV',
        rating: 90,
        seasonYear: 2013,
        status: 'watching' as const,
        addedAt: 1000,
      },
      {
        hoshikaId: 102,
        title: 'Steins;Gate',
        coverImage: 'https://example.com/sg.jpg',
        format: 'TV',
        rating: 92,
        seasonYear: 2011,
        status: 'completed' as const,
        addedAt: 2000,
      },
      {
        hoshikaId: 103,
        title: 'Monster',
        coverImage: 'https://example.com/monster.jpg',
        format: 'TV',
        rating: 89,
        seasonYear: 2004,
        status: 'plan_to_watch' as const,
        addedAt: 3000,
      },
    ];

    const result = filterSortPaginateWatchlist(sampleItems, {
      status: 'completed',
      page: 1,
      limit: 10,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.hoshikaId, 102);
      assert.equal(result.counts.total, 3);
      assert.equal(result.counts.watching, 1);
      assert.equal(result.counts.completed, 1);
      assert.equal(result.counts.plan_to_watch, 1);
    }
  });
});
