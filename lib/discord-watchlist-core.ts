import crypto from 'node:crypto';
import type { HoshikaAnimeItem } from '@/types/anime';
import type { WatchlistEntry, WatchlistStatus } from '@/types/streaming';

export const VALID_WATCHLIST_STATUSES: readonly WatchlistStatus[] = [
  'watching',
  'plan_to_watch',
  'completed',
  'on_hold',
  'dropped',
] as const;

export const WATCHLIST_STATUS_LABELS: Record<WatchlistStatus, string> = {
  watching: 'Watching',
  plan_to_watch: 'Plan to Watch',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
};

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const DISCORD_OAUTH_NONCE_COOKIE = 'aniscroll_discord_oauth_nonce';

export interface DiscordAccountLinkRecord {
  discordUserId: string;
  firebaseUid: string;
  discordUsername: string;
  discordGlobalName: string | null;
  discordAvatar: string | null;
  linkedAt: string;
  updatedAt: string;
}

export interface DiscordOAuthStateRecord {
  stateHash: string;
  firebaseUid: string;
  nonceHash: string;
  redirectUri: string;
  consumed: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface DiscordIdentityProfile {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface ApiErrorResult {
  ok: false;
  status: number;
  code: string;
  error: string;
  retryAfterSeconds?: number;
}

export function hashSha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashSha256Buffer(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Constant-time comparison of a provided bot secret against one or more configured secrets
 * (primary + optional rotation secret). Compares 32-byte SHA-256 digests via timingSafeEqual
 * so secret length is never leaked.
 */
export function timingSafeSecretMatch(
  providedSecret: string | null | undefined,
  configuredSecrets: Array<string | null | undefined>
): boolean {
  if (typeof providedSecret !== 'string') return false;
  const trimmedProvided = providedSecret.trim();
  if (trimmedProvided.length < 16) return false;

  const validConfigured = configuredSecrets
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length >= 16);

  if (validConfigured.length === 0) return false;

  const providedDigest = hashSha256Buffer(trimmedProvided);
  let matched = false;

  for (const secret of validConfigured) {
    const candidateDigest = hashSha256Buffer(secret);
    if (crypto.timingSafeEqual(providedDigest, candidateDigest)) {
      matched = true;
    }
  }

  return matched;
}

export function isValidDiscordSnowflake(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return /^[0-9]{17,22}$/.test(trimmed);
}

export function isValidFirebaseUid(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return (
    trimmed.length >= 1 &&
    trimmed.length <= 128 &&
    /^[a-zA-Z0-9_\-]+$/.test(trimmed)
  );
}

export function isValidHoshikaId(value: unknown): value is number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(num) && num > 0 && num <= 100_000_000;
}

export function isValidWatchlistStatus(
  value: unknown
): value is WatchlistStatus {
  return (
    typeof value === 'string' &&
    (VALID_WATCHLIST_STATUSES as readonly string[]).includes(value)
  );
}

export function buildDiscordAvatarUrl(
  discordUserId: string,
  avatarHash: string | null | undefined
): string | null {
  if (!isValidDiscordSnowflake(discordUserId)) return null;
  if (!avatarHash || typeof avatarHash !== 'string' || !avatarHash.trim()) {
    return null;
  }
  const cleanHash = avatarHash.trim();
  if (cleanHash.startsWith('https://cdn.discordapp.com/')) {
    return cleanHash.slice(0, 1024);
  }
  if (!/^[a-zA-Z0-9_]+$/.test(cleanHash)) {
    return null;
  }
  const ext = cleanHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${cleanHash}.${ext}?size=256`;
}

export function generateOAuthStateBundle(params: {
  firebaseUid: string;
  redirectUri: string;
  nowMs?: number;
  ttlMs?: number;
}): {
  state: string;
  nonce: string;
  record: DiscordOAuthStateRecord;
} {
  const now = params.nowMs ?? Date.now();
  const ttl = params.ttlMs ?? OAUTH_STATE_TTL_MS;
  const state = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomBytes(24).toString('hex');

  return {
    state,
    nonce,
    record: {
      stateHash: hashSha256Hex(state),
      firebaseUid: params.firebaseUid,
      nonceHash: hashSha256Hex(nonce),
      redirectUri: params.redirectUri,
      consumed: false,
      createdAt: now,
      expiresAt: now + ttl,
    },
  };
}

export function validateOAuthStateRecord(params: {
  state: string | null | undefined;
  record: DiscordOAuthStateRecord | null | undefined;
  cookieNonce?: string | null;
  requireCookieNonce?: boolean;
  nowMs?: number;
}):
  | { ok: true; record: DiscordOAuthStateRecord }
  | ApiErrorResult {
  const now = params.nowMs ?? Date.now();
  const rawState = typeof params.state === 'string' ? params.state.trim() : '';

  if (!rawState || !/^[a-f0-9]{64}$/i.test(rawState)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_oauth_state',
      error: 'Invalid or malformed Discord OAuth state parameter.',
    };
  }

  if (!params.record) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_oauth_state',
      error: 'OAuth state was not found or has already been invalidated.',
    };
  }

  const expectedHash = hashSha256Hex(rawState);
  if (params.record.stateHash !== expectedHash) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_oauth_state',
      error: 'OAuth state verification failed.',
    };
  }

  if (params.record.consumed) {
    return {
      ok: false,
      status: 400,
      code: 'reused_oauth_state',
      error: 'This Discord OAuth state has already been used.',
    };
  }

  if (now > params.record.expiresAt) {
    return {
      ok: false,
      status: 410,
      code: 'expired_oauth_state',
      error: 'Discord OAuth session expired. Please try connecting again.',
    };
  }

  if (params.cookieNonce) {
    const cookieNonceHash = hashSha256Hex(params.cookieNonce.trim());
    if (cookieNonceHash !== params.record.nonceHash) {
      return {
        ok: false,
        status: 400,
        code: 'csrf_validation_failed',
        error: 'OAuth CSRF nonce mismatch.',
      };
    }
  } else if (params.requireCookieNonce) {
    return {
      ok: false,
      status: 400,
      code: 'csrf_validation_failed',
      error: 'Missing OAuth CSRF verification cookie.',
    };
  }

  return { ok: true, record: params.record };
}

/**
 * Validates 1:1 account link uniqueness before creating/updating a link:
 * - One Discord account can never link to multiple Firebase users.
 * - One Firebase user can never link to multiple Discord accounts.
 */
export function validateDiscordLinkUniqueness(params: {
  firebaseUid: string;
  discordProfile: DiscordIdentityProfile;
  existingByDiscordId: DiscordAccountLinkRecord | null;
  existingByFirebaseUid: DiscordAccountLinkRecord | null;
  nowIso?: string;
}):
  | { ok: true; link: DiscordAccountLinkRecord }
  | ApiErrorResult {
  const { firebaseUid, discordProfile, existingByDiscordId, existingByFirebaseUid } =
    params;

  if (!isValidFirebaseUid(firebaseUid)) {
    return {
      ok: false,
      status: 401,
      code: 'invalid_firebase_uid',
      error: 'Invalid Firebase user identity.',
    };
  }

  if (!discordProfile || !isValidDiscordSnowflake(discordProfile.id)) {
    return {
      ok: false,
      status: 502,
      code: 'invalid_discord_identity',
      error: 'Discord returned an invalid user identity.',
    };
  }

  const discordUserId = discordProfile.id.trim();
  const discordUsername = String(discordProfile.username || '')
    .trim()
    .slice(0, 64);

  if (!discordUsername) {
    return {
      ok: false,
      status: 502,
      code: 'invalid_discord_identity',
      error: 'Discord identity is missing a username.',
    };
  }

  if (
    existingByDiscordId &&
    existingByDiscordId.firebaseUid !== firebaseUid
  ) {
    return {
      ok: false,
      status: 409,
      code: 'discord_account_already_linked',
      error:
        'This Discord account is already linked to another AniScroll account.',
    };
  }

  if (
    existingByFirebaseUid &&
    existingByFirebaseUid.discordUserId !== discordUserId
  ) {
    return {
      ok: false,
      status: 409,
      code: 'website_account_already_linked',
      error:
        'Your AniScroll account is already linked to another Discord account. Unlink it first before connecting a different account.',
    };
  }

  const nowIso = params.nowIso || new Date().toISOString();
  const globalName =
    typeof discordProfile.global_name === 'string' &&
    discordProfile.global_name.trim()
      ? discordProfile.global_name.trim().slice(0, 64)
      : null;

  return {
    ok: true,
    link: {
      discordUserId,
      firebaseUid,
      discordUsername,
      discordGlobalName: globalName,
      discordAvatar: buildDiscordAvatarUrl(discordUserId, discordProfile.avatar),
      linkedAt: existingByDiscordId?.linkedAt || nowIso,
      updatedAt: nowIso,
    },
  };
}

/**
 * Sliding-window in-memory rate limiter for bot API endpoints.
 */
export class SlidingWindowRateLimiter {
  private buckets = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(maxRequests = 90, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  public check(
    key: string,
    nowMs = Date.now()
  ): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const cutoff = nowMs - this.windowMs;
    const existing = this.buckets.get(key) || [];
    const active = existing.filter((t) => t > cutoff);

    if (active.length >= this.maxRequests) {
      const oldest = active[0] || nowMs;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + this.windowMs - nowMs) / 1000)
      );
      this.buckets.set(key, active);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    active.push(nowMs);
    this.buckets.set(key, active);

    // Periodic pruning to keep memory bounded
    if (this.buckets.size > 2000) {
      for (const [k, timestamps] of this.buckets.entries()) {
        if (timestamps.every((t) => t <= cutoff)) {
          this.buckets.delete(k);
        }
      }
    }

    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - active.length),
      retryAfterSeconds: 0,
    };
  }

  public reset(): void {
    this.buckets.clear();
  }
}

export function extractBotSecretFromHeaders(headers: Headers): string | null {
  const explicitHeader =
    headers.get('x-bot-api-secret') || headers.get('x-aniscroll-bot-secret');
  if (explicitHeader && explicitHeader.trim()) {
    return explicitHeader.trim();
  }

  const authHeader =
    headers.get('authorization') || headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }

  return null;
}

/**
 * Validates bot authentication, rate limits, rejects any attempt to spoof/supply firebaseUid,
 * and validates the target Discord user ID.
 */
export function verifyBotRequestEnvelope(params: {
  headers: Headers;
  configuredSecrets: Array<string | null | undefined>;
  queryDiscordUserId?: string | null;
  bodyDiscordUserId?: unknown;
  forbiddenFirebaseUidPresent?: boolean;
  rateLimiter?: SlidingWindowRateLimiter;
  clientIp?: string;
  nowMs?: number;
}):
  | { ok: true; discordUserId: string }
  | ApiErrorResult {
  const validConfigured = params.configuredSecrets
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length >= 16);

  if (validConfigured.length === 0) {
    return {
      ok: false,
      status: 503,
      code: 'bot_auth_not_configured',
      error:
        'Server bot authentication secret (ANISCROLL_BOT_API_SECRET) is not configured.',
    };
  }

  const providedSecret = extractBotSecretFromHeaders(params.headers);
  if (!providedSecret) {
    return {
      ok: false,
      status: 401,
      code: 'missing_bot_secret',
      error: 'Missing bot authentication secret.',
    };
  }

  if (!timingSafeSecretMatch(providedSecret, validConfigured)) {
    return {
      ok: false,
      status: 401,
      code: 'invalid_bot_secret',
      error: 'Invalid bot authentication secret.',
    };
  }

  // Reject any attempt to pass firebaseUid or uid in headers, query, or body
  const headerFirebaseUid =
    params.headers.get('x-firebase-uid') || params.headers.get('x-user-uid');
  if (params.forbiddenFirebaseUidPresent || headerFirebaseUid) {
    return {
      ok: false,
      status: 403,
      code: 'watchlist_identity_spoofing',
      error:
        'Bot requests must never supply firebaseUid or uid. User identity is resolved exclusively on the server from the linked Discord user ID.',
    };
  }

  const headerDiscordId = params.headers.get('x-discord-user-id')?.trim() || '';
  const queryDiscordId =
    typeof params.queryDiscordUserId === 'string'
      ? params.queryDiscordUserId.trim()
      : '';
  const bodyDiscordId =
    typeof params.bodyDiscordUserId === 'string'
      ? params.bodyDiscordUserId.trim()
      : '';

  const providedIds = [headerDiscordId, queryDiscordId, bodyDiscordId].filter(
    Boolean
  );
  if (providedIds.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_discord_user_id',
      error:
        'Missing Discord user ID. Provide x-discord-user-id header or discordUserId.',
    };
  }

  // If multiple sources provide discordUserId, they MUST match identically
  const uniqueIds = Array.from(new Set(providedIds));
  if (uniqueIds.length > 1) {
    return {
      ok: false,
      status: 403,
      code: 'discord_user_id_mismatch',
      error:
        'Conflicting Discord user IDs supplied across request headers, query, or body.',
    };
  }

  const discordUserId = uniqueIds[0]!;
  if (!isValidDiscordSnowflake(discordUserId)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_discord_user_id',
      error:
        'Invalid Discord user ID format. Expected a 17-22 digit Discord snowflake.',
    };
  }

  if (params.rateLimiter) {
    const rateKey = `${params.clientIp || 'bot'}:${discordUserId}`;
    const check = params.rateLimiter.check(rateKey, params.nowMs);
    if (!check.allowed) {
      return {
        ok: false,
        status: 429,
        code: 'rate_limited',
        error: 'Too many bot watchlist requests. Please slow down.',
        retryAfterSeconds: check.retryAfterSeconds,
      };
    }
  }

  return { ok: true, discordUserId };
}

/**
 * Extracts strictly safe watchlist metadata from an authoritative Hoshika anime object.
 * Never extracts official streaming links or AniSkip data, and never fabricates metadata.
 */
export function extractWatchlistMetadataFromHoshikaAnime(
  anime: HoshikaAnimeItem | Record<string, any>
): {
  hoshikaId: number;
  title: string;
  coverImage: string | null;
  format: string | null;
  rating: number | null;
  seasonYear: number | null;
} | null {
  if (!anime || typeof anime !== 'object') return null;
  const raw = anime as Record<string, any>;
  const hoshikaId = Number(raw.shortId);
  if (!isValidHoshikaId(hoshikaId)) return null;

  let resolvedTitle = '';
  if (typeof raw.titleEnglish === 'string' && raw.titleEnglish.trim()) {
    resolvedTitle = raw.titleEnglish.trim();
  } else if (typeof raw.titleLocalized === 'string' && raw.titleLocalized.trim()) {
    resolvedTitle = raw.titleLocalized.trim();
  } else if (typeof raw.titleRomaji === 'string' && raw.titleRomaji.trim()) {
    resolvedTitle = raw.titleRomaji.trim();
  } else if (typeof raw.title === 'string' && raw.title.trim()) {
    resolvedTitle = raw.title.trim();
  } else if (raw.title && typeof raw.title === 'object') {
    resolvedTitle = String(
      raw.title.english ||
        raw.title.userPreferred ||
        raw.title.romaji ||
        raw.title.native ||
        ''
    ).trim();
  } else if (typeof raw.originalTitle === 'string' && raw.originalTitle.trim()) {
    resolvedTitle = raw.originalTitle.trim();
  }
  if (!resolvedTitle) return null;

  let resolvedCover: string | null = null;
  const rawCover =
    (typeof raw.coverImage === 'string' && raw.coverImage) ||
    (typeof raw.cover === 'string' && raw.cover) ||
    (typeof raw.poster === 'string' && raw.poster) ||
    (typeof raw.image === 'string' && raw.image) ||
    (raw.coverImage && typeof raw.coverImage === 'object'
      ? raw.coverImage.extraLarge ||
        raw.coverImage.large ||
        raw.coverImage.medium ||
        null
      : null);

  if (
    typeof rawCover === 'string' &&
    (rawCover.startsWith('https://') || rawCover.startsWith('http://'))
  ) {
    resolvedCover = rawCover.trim().slice(0, 1024);
  }

  const resolvedFormat =
    typeof raw.format === 'string' && raw.format.trim()
      ? raw.format.trim().slice(0, 40)
      : null;

  const rawRating =
    typeof raw.averageScore === 'number'
      ? raw.averageScore
      : typeof raw.canonScore === 'number'
      ? raw.canonScore
      : typeof raw.score === 'number'
      ? raw.score
      : typeof raw.rating === 'number'
      ? raw.rating
      : null;
  const resolvedRating =
    typeof rawRating === 'number' && Number.isFinite(rawRating)
      ? rawRating
      : null;

  const rawYear =
    typeof raw.seasonYear === 'number'
      ? raw.seasonYear
      : typeof raw.year === 'number'
      ? raw.year
      : null;
  const resolvedYear =
    typeof rawYear === 'number' && Number.isInteger(rawYear) && rawYear > 1900
      ? rawYear
      : null;

  return {
    hoshikaId,
    title: resolvedTitle.slice(0, 300),
    coverImage: resolvedCover,
    format: resolvedFormat,
    rating: resolvedRating,
    seasonYear: resolvedYear,
  };
}

export function validateBotWatchlistPostBody(
  body: Record<string, any>
):
  | {
      ok: true;
      hoshikaId?: number;
      query?: string;
      status: WatchlistStatus;
      episodeProgress?: number;
    }
  | ApiErrorResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_payload',
      error: 'Request body must be a valid JSON object.',
    };
  }

  if ('firebaseUid' in body || 'uid' in body) {
    return {
      ok: false,
      status: 403,
      code: 'watchlist_identity_spoofing',
      error: 'Supplying firebaseUid or uid in bot requests is forbidden.',
    };
  }

  if ('anilistId' in body && !('hoshikaId' in body)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_hoshika_id',
      error:
        'AniList IDs are not permitted as watchlist IDs. Provide a valid Hoshika shortId (hoshikaId).',
    };
  }

  const allowedKeys = new Set([
    'discordUserId',
    'hoshikaId',
    'shortId',
    'query',
    'status',
    'episodeProgress',
    'title',
    'coverImage',
    'format',
    'rating',
    'seasonYear',
  ]);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_payload',
        error: `Unsupported field "${key}" in watchlist request.`,
      };
    }
  }

  const rawId = body.hoshikaId ?? body.shortId;
  const rawQuery = typeof body.query === 'string' ? body.query.trim() : '';

  let parsedId: number | undefined;
  if (rawId !== undefined && rawId !== null && rawId !== '') {
    if (!isValidHoshikaId(rawId)) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_hoshika_id',
        error: 'hoshikaId must be a positive integer Hoshika shortId.',
      };
    }
    parsedId = Number(rawId);
  } else if (!rawQuery) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_hoshika_id',
      error: 'Either hoshikaId (positive integer) or query (search string) is required.',
    };
  }

  const rawStatus = body.status !== undefined ? body.status : 'plan_to_watch';
  if (!isValidWatchlistStatus(rawStatus)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_payload',
      error: `Invalid watchlist status "${String(
        rawStatus
      )}". Allowed values: ${VALID_WATCHLIST_STATUSES.join(', ')}.`,
    };
  }

  let episodeProgress: number | undefined;
  if (body.episodeProgress !== undefined && body.episodeProgress !== null) {
    const ep = Number(body.episodeProgress);
    if (!Number.isInteger(ep) || ep < 0 || ep > 10000) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_payload',
        error: 'episodeProgress must be an integer between 0 and 10000.',
      };
    }
    episodeProgress = ep;
  }

  return {
    ok: true,
    hoshikaId: parsedId,
    query: rawQuery || undefined,
    status: rawStatus,
    episodeProgress,
  };
}

export function validateBotWatchlistPatchBody(
  body: Record<string, any>
):
  | {
      ok: true;
      patch: {
        status?: WatchlistStatus;
        episodeProgress?: number;
        title?: string;
        coverImage?: string | null;
        format?: string | null;
        rating?: number | null;
        seasonYear?: number | null;
      };
    }
  | ApiErrorResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_payload',
      error: 'Request body must be a valid JSON object.',
    };
  }

  if ('firebaseUid' in body || 'uid' in body) {
    return {
      ok: false,
      status: 403,
      code: 'watchlist_identity_spoofing',
      error: 'Supplying firebaseUid or uid in bot requests is forbidden.',
    };
  }

  if ('createdAt' in body || 'addedAt' in body || 'hoshikaId' in body) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_payload',
      error: 'Immutable fields (hoshikaId, addedAt, createdAt) cannot be modified via PATCH.',
    };
  }

  const allowedKeys = new Set([
    'discordUserId',
    'status',
    'episodeProgress',
    'title',
    'coverImage',
    'format',
    'rating',
    'seasonYear',
  ]);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_payload',
        error: `Unsupported field "${key}" in PATCH payload.`,
      };
    }
  }

  const patch: {
    status?: WatchlistStatus;
    episodeProgress?: number;
    title?: string;
    coverImage?: string | null;
    format?: string | null;
    rating?: number | null;
    seasonYear?: number | null;
  } = {};

  if (body.status !== undefined) {
    if (!isValidWatchlistStatus(body.status)) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_payload',
        error: `Invalid watchlist status "${String(
          body.status
        )}". Allowed values: ${VALID_WATCHLIST_STATUSES.join(', ')}.`,
      };
    }
    patch.status = body.status;
  }

  if (body.episodeProgress !== undefined) {
    const ep = Number(body.episodeProgress);
    if (!Number.isInteger(ep) || ep < 0 || ep > 10000) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_payload',
        error: 'episodeProgress must be an integer between 0 and 10000.',
      };
    }
    patch.episodeProgress = ep;
  }

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_payload',
        error: 'title must be a non-empty string.',
      };
    }
    patch.title = body.title.trim().slice(0, 300);
  }

  if (body.coverImage !== undefined) {
    if (body.coverImage === null || body.coverImage === '') {
      patch.coverImage = null;
    } else if (
      typeof body.coverImage === 'string' &&
      (body.coverImage.startsWith('https://') ||
        body.coverImage.startsWith('http://'))
    ) {
      patch.coverImage = body.coverImage.trim().slice(0, 1024);
    } else {
      return {
        ok: false,
        status: 400,
        code: 'invalid_payload',
        error: 'coverImage must be a valid HTTP(S) URL or null.',
      };
    }
  }

  if (body.format !== undefined) {
    if (body.format === null || body.format === '') {
      patch.format = null;
    } else if (typeof body.format === 'string') {
      patch.format = body.format.trim().slice(0, 40);
    } else {
      return {
        ok: false,
        status: 400,
        code: 'invalid_payload',
        error: 'format must be a string or null.',
      };
    }
  }

  if (body.rating !== undefined) {
    if (body.rating === null) {
      patch.rating = null;
    } else if (typeof body.rating === 'number' && Number.isFinite(body.rating)) {
      patch.rating = body.rating;
    } else {
      return {
        ok: false,
        status: 400,
        code: 'invalid_payload',
        error: 'rating must be a number or null.',
      };
    }
  }

  if (body.seasonYear !== undefined) {
    if (body.seasonYear === null) {
      patch.seasonYear = null;
    } else if (
      typeof body.seasonYear === 'number' &&
      Number.isInteger(body.seasonYear)
    ) {
      patch.seasonYear = body.seasonYear;
    } else {
      return {
        ok: false,
        status: 400,
        code: 'invalid_payload',
        error: 'seasonYear must be an integer or null.',
      };
    }
  }

  if (Object.keys(patch).length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_payload',
      error: 'PATCH payload must include at least one modifiable field (e.g. status, episodeProgress).',
    };
  }

  return { ok: true, patch };
}

export type WatchlistSortOption =
  | 'addedAt_desc'
  | 'addedAt_asc'
  | 'title_asc'
  | 'title_desc'
  | 'rating_desc'
  | 'year_desc';

export function filterSortPaginateWatchlist(
  allItems: WatchlistEntry[],
  options?: {
    status?: string | null;
    sort?: string | null;
    page?: number | string | null;
    limit?: number | string | null;
  }
):
  | {
      ok: true;
      items: WatchlistEntry[];
      pagination: {
        page: number;
        limit: number;
        totalItems: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
      };
      counts: {
        total: number;
        watching: number;
        plan_to_watch: number;
        completed: number;
        on_hold: number;
        dropped: number;
      };
    }
  | ApiErrorResult {
  const counts = {
    total: allItems.length,
    watching: 0,
    plan_to_watch: 0,
    completed: 0,
    on_hold: 0,
    dropped: 0,
  };

  for (const item of allItems) {
    const st = item.status || 'watching';
    if (st in counts) {
      counts[st as WatchlistStatus]++;
    }
  }

  const rawStatus = options?.status ? String(options.status).trim() : '';
  if (rawStatus && rawStatus !== 'all' && !isValidWatchlistStatus(rawStatus)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_status_filter',
      error: `Invalid status filter "${rawStatus}". Allowed values: ${VALID_WATCHLIST_STATUSES.join(
        ', '
      )}.`,
    };
  }

  const filtered =
    rawStatus && rawStatus !== 'all'
      ? allItems.filter((item) => (item.status || 'watching') === rawStatus)
      : [...allItems];

  const sortKey = (options?.sort || 'addedAt_desc').trim();
  filtered.sort((a, b) => {
    switch (sortKey) {
      case 'addedAt_asc':
        return (a.addedAt || 0) - (b.addedAt || 0);
      case 'title_asc':
        return a.title.localeCompare(b.title);
      case 'title_desc':
        return b.title.localeCompare(a.title);
      case 'rating_desc':
        return (b.rating ?? -1) - (a.rating ?? -1);
      case 'year_desc':
        return (b.seasonYear ?? 0) - (a.seasonYear ?? 0);
      case 'addedAt_desc':
      default:
        return (b.addedAt || 0) - (a.addedAt || 0);
    }
  });

  const rawPage = Number(options?.page ?? 1);
  const rawLimit = Number(options?.limit ?? 20);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(100, Math.floor(rawLimit))
      : 20;

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const start = (page - 1) * limit;
  const pagedItems = filtered.slice(start, start + limit);

  return {
    ok: true,
    items: pagedItems,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
    counts,
  };
}
