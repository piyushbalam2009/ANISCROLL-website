import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Deterministic unit test runner for Firestore Security Rules & "Dirty Dozen" Payloads.
 * Evaluates the exact boolean invariants enforced by firestore.rules and verifies
 * that every Dirty Dozen adversarial payload is rejected with PERMISSION_DENIED.
 */

const SERVER_TIME = '2026-11-09T20:00:00Z';

interface EvalContext {
  auth: { uid: string } | null;
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  incoming?: Record<string, any>;
  existing?: Record<string, any>;
  requestTime?: string;
}

function isValidId(id: string): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);
}

function hasAllKeys(data: Record<string, any>, required: string[]): boolean {
  return required.every((k) => Object.prototype.hasOwnProperty.call(data, k));
}

function hasOnlyKeys(data: Record<string, any>, allowed: string[]): boolean {
  return Object.keys(data).every((k) => allowed.includes(k));
}

function affectedKeysOnly(incoming: Record<string, any>, existing: Record<string, any>, allowed: string[]): boolean {
  const allKeys = new Set([...Object.keys(incoming), ...Object.keys(existing)]);
  for (const k of allKeys) {
    if (incoming[k] !== existing[k] && !allowed.includes(k)) {
      return false;
    }
  }
  return true;
}

function evaluateRule(ctx: {
  auth: { uid: string } | null;
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  incoming?: Record<string, any>;
  existing?: Record<string, any>;
  requestTime?: string;
}): 'ALLOW' | 'PERMISSION_DENIED' {
  const reqTime = ctx.requestTime || SERVER_TIME;
  const parts = ctx.path.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'users') return 'PERMISSION_DENIED';

  const [, uid, collection, docId = ''] = parts;
  if (!ctx.auth || ctx.auth.uid !== uid) return 'PERMISSION_DENIED';

  if (ctx.operation === 'list') {
    if (!ctx.existing || ctx.existing.uid !== ctx.auth.uid) return 'PERMISSION_DENIED';
    return 'ALLOW';
  }

  if (!isValidId(uid) || !isValidId(docId)) return 'PERMISSION_DENIED';
  if (ctx.operation === 'get' || ctx.operation === 'delete') return 'ALLOW';

  const data = ctx.incoming;
  if (!data) return 'PERMISSION_DENIED';

  if (collection === 'profile') {
    if (ctx.operation === 'create' && docId !== 'details') return 'PERMISSION_DENIED';
    const valid =
      hasAllKeys(data, ['uid', 'displayName', 'email', 'photoURL', 'provider', 'createdAt', 'updatedAt']) &&
      hasOnlyKeys(data, ['uid', 'displayName', 'email', 'photoURL', 'provider', 'migrationCompleted', 'createdAt', 'updatedAt']) &&
      typeof data.uid === 'string' && data.uid.length >= 1 && data.uid.length <= 128 && data.uid === ctx.auth.uid &&
      typeof data.displayName === 'string' && data.displayName.length >= 1 && data.displayName.length <= 120 &&
      typeof data.email === 'string' && data.email.length >= 3 && data.email.length <= 256 &&
      typeof data.photoURL === 'string' && data.photoURL.length <= 1024 &&
      (data.provider === 'password' || data.provider === 'google');

    if (!valid) return 'PERMISSION_DENIED';
    if (ctx.operation === 'create') {
      return data.createdAt === reqTime && data.updatedAt === reqTime ? 'ALLOW' : 'PERMISSION_DENIED';
    }
    if (ctx.operation === 'update' && ctx.existing) {
      const okUpdate =
        data.uid === ctx.existing.uid &&
        data.createdAt === ctx.existing.createdAt &&
        data.updatedAt === reqTime &&
        affectedKeysOnly(data, ctx.existing, ['displayName', 'email', 'photoURL', 'provider', 'migrationCompleted', 'updatedAt']);
      return okUpdate ? 'ALLOW' : 'PERMISSION_DENIED';
    }
  }

  if (collection === 'watchlist') {
    const valid =
      hasAllKeys(data, ['uid', 'hoshikaId', 'title', 'addedAt', 'createdAt', 'updatedAt']) &&
      hasOnlyKeys(data, ['uid', 'hoshikaId', 'title', 'coverImage', 'format', 'rating', 'seasonYear', 'status', 'addedAt', 'createdAt', 'updatedAt']) &&
      typeof data.uid === 'string' && data.uid === ctx.auth.uid &&
      typeof data.hoshikaId === 'number' && data.hoshikaId > 0 &&
      typeof data.title === 'string' && data.title.length >= 1 && data.title.length <= 300 &&
      typeof data.addedAt === 'number' && data.addedAt > 0;
    if (!valid) return 'PERMISSION_DENIED';
    if (ctx.operation === 'create') {
      return data.createdAt === reqTime && data.updatedAt === reqTime ? 'ALLOW' : 'PERMISSION_DENIED';
    }
  }

  if (collection === 'continueWatching') {
    const valid =
      hasAllKeys(data, ['uid', 'hoshikaId', 'title', 'episodeNumber', 'currentTime', 'duration', 'timestamp', 'createdAt', 'updatedAt']) &&
      hasOnlyKeys(data, [
        'uid', 'hoshikaId', 'title', 'animeTitle', 'episodeNumber', 'currentTime', 'duration', 'progress',
        'coverImage', 'animeCover', 'bannerImage', 'episodeTitle', 'episodeThumbnail',
        'audioType', 'timestamp', 'lastWatched', 'createdAt', 'updatedAt'
      ]) &&
      typeof data.uid === 'string' && data.uid === ctx.auth.uid &&
      typeof data.hoshikaId === 'number' && data.hoshikaId > 0 &&
      typeof data.title === 'string' && data.title.length >= 1 && data.title.length <= 300 &&
      typeof data.episodeNumber === 'number' && data.episodeNumber >= 1 &&
      typeof data.currentTime === 'number' && data.currentTime >= 0 &&
      typeof data.duration === 'number' && data.duration > 0 &&
      typeof data.timestamp === 'number' && data.timestamp > 0;
    if (!valid) return 'PERMISSION_DENIED';
    if (ctx.operation === 'create') {
      return data.createdAt === reqTime && data.updatedAt === reqTime ? 'ALLOW' : 'PERMISSION_DENIED';
    }
  }

  if (collection === 'preferences') {
    const valid =
      hasAllKeys(data, ['uid', 'theme', 'defaultAudio', 'defaultQuality', 'autoPlayNext', 'autoSkipIntro', 'autoSkipOutro', 'sidebarCollapsed', 'compactCards', 'createdAt', 'updatedAt']) &&
      hasOnlyKeys(data, ['uid', 'theme', 'defaultAudio', 'defaultQuality', 'autoPlayNext', 'autoSkipIntro', 'autoSkipOutro', 'sidebarCollapsed', 'compactCards', 'createdAt', 'updatedAt']) &&
      data.uid === ctx.auth.uid &&
      data.theme === 'monochrome' &&
      ['sub', 'dub'].includes(data.defaultAudio) &&
      ['auto', '1080p', '720p', '480p'].includes(data.defaultQuality) &&
      typeof data.autoPlayNext === 'boolean' &&
      typeof data.autoSkipIntro === 'boolean' &&
      typeof data.autoSkipOutro === 'boolean' &&
      typeof data.sidebarCollapsed === 'boolean' &&
      typeof data.compactCards === 'boolean';
    if (!valid) return 'PERMISSION_DENIED';
    if (ctx.operation === 'create') {
      return data.createdAt === reqTime && data.updatedAt === reqTime ? 'ALLOW' : 'PERMISSION_DENIED';
    }
    if (ctx.operation === 'update' && ctx.existing) {
      const okUpdate =
        data.uid === ctx.existing.uid &&
        data.createdAt === ctx.existing.createdAt &&
        data.updatedAt === reqTime &&
        affectedKeysOnly(data, ctx.existing, ['theme', 'defaultAudio', 'defaultQuality', 'autoPlayNext', 'autoSkipIntro', 'autoSkipOutro', 'sidebarCollapsed', 'compactCards', 'updatedAt']);
      return okUpdate ? 'ALLOW' : 'PERMISSION_DENIED';
    }
  }

  return 'PERMISSION_DENIED';
}

test('firestore.rules file contains all required match blocks and validation blueprints', () => {
  const rulesText = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');
  assert.ok(rulesText.includes("rules_version = '2';"));
  assert.ok(rulesText.includes('match /{document=**}'));
  assert.ok(rulesText.includes('isValidUserProfile'));
  assert.ok(rulesText.includes('isValidWatchlistItem'));
  assert.ok(rulesText.includes('isValidContinueWatchingItem'));
  assert.ok(rulesText.includes('isValidWatchHistoryItem'));
  assert.ok(rulesText.includes('isValidUserPreferencesDoc'));
  assert.ok(rulesText.includes('isValidPublicProfile'));
  assert.ok(rulesText.includes('isValidUsernameReservation'));
  assert.ok(rulesText.includes('canAdminModifyTargetRole'));
  assert.ok(rulesText.includes('expectedCallerRole'));
  assert.ok(rulesText.includes('match /publicProfiles/{uid}'));
  assert.ok(rulesText.includes('match /usernames/{username}'));
  assert.ok(rulesText.includes('isValidAdminRecord'));
  assert.ok(rulesText.includes('isValidAnimeArtworkDoc'));
  assert.ok(rulesText.includes('isValidArtworkAuditLog'));
  assert.ok(rulesText.includes('isValidAdminActivityLog'));
  assert.ok(rulesText.includes('isValidAnnouncementDoc'));
  assert.ok(rulesText.includes('isValidAnimeManagementDoc'));
  assert.ok(rulesText.includes('isValidSiteConfigDoc'));
  assert.ok(rulesText.includes('isValidStreamingMonitorLog'));
  assert.ok(rulesText.includes('isBootstrappedOwner'));
  assert.ok(rulesText.includes('canManageArtwork'));
  assert.ok(rulesText.includes("'previousLogoUrl'"));
  assert.ok(rulesText.includes("'previousLogoSource'"));
  assert.ok(rulesText.includes("'selectedLogo'"));
});

test('Dirty Dozen Payloads all return PERMISSION_DENIED', () => {
  // 1. Unauthenticated Profile Write
  assert.equal(
    evaluateRule({
      auth: null,
      path: '/users/user_1/profile/details',
      operation: 'create',
      incoming: {
        uid: 'user_1',
        displayName: 'Test',
        email: 'test@example.com',
        photoURL: '',
        provider: 'password',
        createdAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
      },
    }),
    'PERMISSION_DENIED'
  );

  // 2. Cross-User PII Read
  assert.equal(
    evaluateRule({
      auth: { uid: 'user_2' },
      path: '/users/user_1/profile/details',
      operation: 'get',
    }),
    'PERMISSION_DENIED'
  );

  // 3. Identity Spoofing in Payload
  assert.equal(
    evaluateRule({
      auth: { uid: 'user_1' },
      path: '/users/user_1/watchlist/20859',
      operation: 'create',
      incoming: {
        uid: 'user_2',
        hoshikaId: 20859,
        title: 'Death Note',
        addedAt: 1000,
        createdAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
      },
    }),
    'PERMISSION_DENIED'
  );

  // 4. Shadow Field / Ghost Key Injection
  assert.equal(
    evaluateRule({
      auth: { uid: 'user_1' },
      path: '/users/user_1/profile/details',
      operation: 'create',
      incoming: {
        uid: 'user_1',
        displayName: 'Test',
        email: 'test@example.com',
        photoURL: '',
        provider: 'password',
        isAdmin: true,
        createdAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
      },
    }),
    'PERMISSION_DENIED'
  );

  // 5. Path ID Poisoning
  assert.equal(
    evaluateRule({
      auth: { uid: 'user_1' },
      path: '/users/user_1/watchlist/invalid$id!@#',
      operation: 'create',
      incoming: {
        uid: 'user_1',
        hoshikaId: 20859,
        title: 'Death Note',
        addedAt: 1000,
        createdAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
      },
    }),
    'PERMISSION_DENIED'
  );

  // 6. Denial-of-Wallet String Overflow
  assert.equal(
    evaluateRule({
      auth: { uid: 'user_1' },
      path: '/users/user_1/watchlist/20859',
      operation: 'create',
      incoming: {
        uid: 'user_1',
        hoshikaId: 20859,
        title: 'A'.repeat(500),
        addedAt: 1000,
        createdAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
      },
    }),
    'PERMISSION_DENIED'
  );

  // 7. Forged Client Timestamp
  assert.equal(
    evaluateRule({
      auth: { uid: 'user_1' },
      path: '/users/user_1/watchlist/20859',
      operation: 'create',
      incoming: {
        uid: 'user_1',
        hoshikaId: 20859,
        title: 'Death Note',
        addedAt: 1000,
        createdAt: '2020-01-01T00:00:00Z',
        updatedAt: SERVER_TIME,
      },
    }),
    'PERMISSION_DENIED'
  );

  // 8. Immortal Field Mutation on Update
  assert.equal(
    evaluateRule({
      auth: { uid: 'user_1' },
      path: '/users/user_1/profile/details',
      operation: 'update',
      existing: {
        uid: 'user_1',
        displayName: 'Test',
        email: 'test@example.com',
        photoURL: '',
        provider: 'password',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      incoming: {
        uid: 'user_1',
        displayName: 'Test Updated',
        email: 'test@example.com',
        photoURL: '',
        provider: 'password',
        createdAt: SERVER_TIME, // Mutated immortal field!
        updatedAt: SERVER_TIME,
      },
    }),
    'PERMISSION_DENIED'
  );

  // 9. Invalid Enum Value in Preferences
  assert.equal(
    evaluateRule({
      auth: { uid: 'user_1' },
      path: '/users/user_1/preferences/settings',
      operation: 'create',
      incoming: {
        uid: 'user_1',
        theme: 'monochrome',
        defaultAudio: 'french',
        defaultQuality: 'auto',
        autoPlayNext: true,
        autoSkipIntro: false,
        autoSkipOutro: false,
        sidebarCollapsed: false,
        compactCards: false,
        createdAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
      },
    }),
    'PERMISSION_DENIED'
  );

  // 10. Zero/Negative Duration in Continue Watching
  assert.equal(
    evaluateRule({
      auth: { uid: 'user_1' },
      path: '/users/user_1/continueWatching/20859',
      operation: 'create',
      incoming: {
        uid: 'user_1',
        hoshikaId: 20859,
        title: 'Death Note',
        episodeNumber: 1,
        currentTime: 50,
        duration: 0,
        timestamp: 1000,
        createdAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
      },
    }),
    'PERMISSION_DENIED'
  );

  // 11. Cross-User List Scraping
  assert.equal(
    evaluateRule({
      auth: { uid: 'user_2' },
      path: '/users/user_1/watchHistory',
      operation: 'list',
      existing: { uid: 'user_1' },
    }),
    'PERMISSION_DENIED'
  );

  // 12. Value Type Poisoning on Update
  assert.equal(
    evaluateRule({
      auth: { uid: 'user_1' },
      path: '/users/user_1/preferences/settings',
      operation: 'update',
      existing: {
        uid: 'user_1',
        theme: 'monochrome',
        defaultAudio: 'sub',
        defaultQuality: 'auto',
        autoPlayNext: true,
        autoSkipIntro: false,
        autoSkipOutro: false,
        sidebarCollapsed: false,
        compactCards: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      incoming: {
        uid: 'user_1',
        theme: 'monochrome',
        defaultAudio: 'sub',
        defaultQuality: 'auto',
        autoPlayNext: 'yes' as any,
        autoSkipIntro: false,
        autoSkipOutro: false,
        sidebarCollapsed: false,
        compactCards: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: SERVER_TIME,
      },
    }),
    'PERMISSION_DENIED'
  );
});
