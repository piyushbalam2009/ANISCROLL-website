import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import firebaseAppletConfig from '../firebase-applet-config.json';
import {
  fetchFirestoreDocumentRest,
  getFirebaseAdminFirestore,
  listFirestoreCollectionRest,
  toFirestoreRestFields,
} from './firebase-admin';
import {
  ApiErrorResult,
  DiscordAccountLinkRecord,
  DiscordIdentityProfile,
  DiscordOAuthStateRecord,
  SlidingWindowRateLimiter,
  buildDiscordAvatarUrl,
  extractWatchlistMetadataFromHoshikaAnime,
  generateOAuthStateBundle,
  hashSha256Hex,
  isValidDiscordSnowflake,
  isValidHoshikaId,
  validateDiscordLinkUniqueness,
  validateOAuthStateRecord,
} from './discord-watchlist-core';
import { getHoshikaAnime, searchHoshika } from './hoshika';
import type { WatchlistEntry, WatchlistStatus } from '@/types/streaming';

const PROJECT_ID = (
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  firebaseAppletConfig.projectId ||
  ''
).trim();
const API_KEY = (
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
  firebaseAppletConfig.apiKey ||
  ''
).trim();
const DATABASE_ID = (
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ||
  firebaseAppletConfig.firestoreDatabaseId ||
  '(default)'
).trim();

const SERVER_STORE_DIR = path.join(process.cwd(), '.aistudio', 'server-data');
const SERVER_STORE_FILE = path.join(SERVER_STORE_DIR, 'discord-integration-store.json');

interface InternalUserTokenGrant {
  firebaseUid: string;
  idToken: string;
  refreshToken?: string;
  updatedAt: number;
}

interface PersistedServerStore {
  linksByDiscordId: Record<string, DiscordAccountLinkRecord>;
  oauthStatesByHash: Record<string, DiscordOAuthStateRecord>;
  userTokensByUid: Record<string, InternalUserTokenGrant>;
}

const memoryStore: PersistedServerStore = {
  linksByDiscordId: {},
  oauthStatesByHash: {},
  userTokensByUid: {},
};

let diskLoaded = false;

function loadStoreFromDisk(): void {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    if (fs.existsSync(SERVER_STORE_FILE)) {
      const raw = fs.readFileSync(SERVER_STORE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedServerStore>;
      if (parsed && typeof parsed === 'object') {
        if (parsed.linksByDiscordId) {
          Object.assign(memoryStore.linksByDiscordId, parsed.linksByDiscordId);
        }
        if (parsed.oauthStatesByHash) {
          Object.assign(memoryStore.oauthStatesByHash, parsed.oauthStatesByHash);
        }
        if (parsed.userTokensByUid) {
          Object.assign(memoryStore.userTokensByUid, parsed.userTokensByUid);
        }
      }
    }
  } catch {
    // Non-fatal in read-only or ephemeral environments
  }
}

function saveStoreToDisk(): void {
  try {
    fs.mkdirSync(SERVER_STORE_DIR, { recursive: true });
    fs.writeFileSync(
      SERVER_STORE_FILE,
      JSON.stringify(memoryStore, null, 2),
      { encoding: 'utf8', mode: 0o600 }
    );
  } catch {
    // Non-fatal in ephemeral serverless filesystems
  }
}

export const botRateLimiter = new SlidingWindowRateLimiter(90, 60_000);

export function getConfiguredBotSecrets(): string[] {
  const primary = process.env.ANISCROLL_BOT_API_SECRET?.trim() || '';
  const previous = process.env.ANISCROLL_BOT_API_SECRET_PREVIOUS?.trim() || '';
  const secrets = [primary, previous].filter((s) => s.length >= 16);

  if (secrets.length === 0 && process.env.NODE_ENV !== 'production') {
    return ['aniscroll_dev_bot_secret_key_2026_secure'];
  }
  return secrets;
}

export function resolveDiscordRedirectUri(originHint?: string): string {
  const configured = process.env.DISCORD_REDIRECT_URI?.trim();
  if (configured) return configured;

  const cleanOrigin =
    originHint && /^https?:\/\//i.test(originHint.trim())
      ? originHint.trim()
      : '';

  const appUrl = (
    cleanOrigin ||
    process.env.APP_URL ||
    'https://aniscroll.in'
  )
    .trim()
    .replace(/\/+$/, '');

  return `${appUrl}/api/auth/discord/callback`;
}

export function recordVerifiedUserGrant(params: {
  firebaseUid: string;
  idToken: string;
  refreshToken?: string;
}): void {
  loadStoreFromDisk();
  if (!params.firebaseUid || !params.idToken) return;
  const existing = memoryStore.userTokensByUid[params.firebaseUid];
  memoryStore.userTokensByUid[params.firebaseUid] = {
    firebaseUid: params.firebaseUid,
    idToken: params.idToken,
    refreshToken: params.refreshToken || existing?.refreshToken,
    updatedAt: Date.now(),
  };
  saveStoreToDisk();
}

async function resolveUsableFirebaseIdToken(
  firebaseUid: string
): Promise<string | null> {
  loadStoreFromDisk();
  const grant = memoryStore.userTokensByUid[firebaseUid];
  if (!grant) return null;

  // Refresh token if older than 45 minutes and refreshToken is available
  const ageMs = Date.now() - grant.updatedAt;
  if (grant.refreshToken && API_KEY && ageMs > 45 * 60 * 1000) {
    try {
      const res = await fetch(
        `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(
          API_KEY
        )}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: grant.refreshToken,
          }).toString(),
          cache: 'no-store',
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.id_token) {
          grant.idToken = data.id_token;
          if (data.refresh_token) {
            grant.refreshToken = data.refresh_token;
          }
          grant.updatedAt = Date.now();
          saveStoreToDisk();
          return grant.idToken;
        }
      }
    } catch {
      // Fall back to existing idToken
    }
  }

  return grant.idToken || null;
}

function normalizeTimestampToIso(val: unknown): string {
  if (typeof val === 'string' && val.trim()) return val;
  if (val && typeof (val as any).toDate === 'function') {
    return (val as any).toDate().toISOString();
  }
  if (val && typeof (val as any).seconds === 'number') {
    return new Date((val as any).seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function normalizeLinkDoc(
  data: Record<string, any> | undefined | null
): DiscordAccountLinkRecord | null {
  if (!data || typeof data !== 'object') return null;
  if (!data.discordUserId || !data.firebaseUid || !data.discordUsername) {
    return null;
  }
  return {
    discordUserId: String(data.discordUserId),
    firebaseUid: String(data.firebaseUid),
    discordUsername: String(data.discordUsername),
    discordGlobalName:
      typeof data.discordGlobalName === 'string' && data.discordGlobalName
        ? data.discordGlobalName
        : null,
    discordAvatar:
      typeof data.discordAvatar === 'string' && data.discordAvatar
        ? data.discordAvatar
        : null,
    linkedAt: normalizeTimestampToIso(data.linkedAt),
    updatedAt: normalizeTimestampToIso(data.updatedAt),
  };
}

/**
 * Looks up a Discord Account Link by Discord User ID from `/discordAccountLinks/{discordUserId}`.
 */
export async function getDiscordLinkByDiscordId(
  discordUserId: string
): Promise<DiscordAccountLinkRecord | null> {
  loadStoreFromDisk();
  if (!isValidDiscordSnowflake(discordUserId)) return null;

  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      const snap = await adminFs.db
        .collection('discordAccountLinks')
        .doc(discordUserId)
        .get();
      if (!snap.exists) return null;
      const record = normalizeLinkDoc(snap.data());
      if (record) {
        memoryStore.linksByDiscordId[discordUserId] = record;
      }
      return record;
    } catch (err) {
      console.error('[DiscordStore] Admin SDK getDiscordLinkByDiscordId failed:', err);
    }
  }

  return memoryStore.linksByDiscordId[discordUserId] || null;
}

/**
 * Looks up a Discord Account Link by Firebase UID.
 */
export async function getDiscordLinkByFirebaseUid(
  firebaseUid: string
): Promise<DiscordAccountLinkRecord | null> {
  loadStoreFromDisk();
  if (!firebaseUid) return null;

  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      const snap = await adminFs.db
        .collection('discordAccountLinks')
        .where('firebaseUid', '==', firebaseUid)
        .limit(1)
        .get();
      if (!snap.empty) {
        const docSnap = snap.docs[0]!;
        const record = normalizeLinkDoc(docSnap.data());
        if (record) {
          memoryStore.linksByDiscordId[record.discordUserId] = record;
          return record;
        }
      }
      return null;
    } catch (err) {
      console.error('[DiscordStore] Admin SDK getDiscordLinkByFirebaseUid failed:', err);
    }
  }

  for (const record of Object.values(memoryStore.linksByDiscordId)) {
    if (record.firebaseUid === firebaseUid) {
      return record;
    }
  }
  return null;
}

/**
 * Creates a single-use OAuth state tied to the authenticated Firebase UID.
 */
export async function createDiscordOAuthStateServer(params: {
  firebaseUid: string;
  redirectUri: string;
}): Promise<
  | {
      ok: true;
      state: string;
      nonce: string;
      expiresAt: number;
      authorizeUrl: string;
    }
  | ApiErrorResult
> {
  loadStoreFromDisk();

  const existingLink = await getDiscordLinkByFirebaseUid(params.firebaseUid);
  if (existingLink) {
    return {
      ok: false,
      status: 409,
      code: 'website_account_already_linked',
      error: `Your AniScroll account is already linked to Discord (@${existingLink.discordUsername}). Disconnect it first if you wish to link a different Discord account.`,
    };
  }

  const bundle = generateOAuthStateBundle({
    firebaseUid: params.firebaseUid,
    redirectUri: params.redirectUri,
  });

  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      await adminFs.db
        .collection('discordOAuthStates')
        .doc(bundle.record.stateHash)
        .set(bundle.record);
    } catch (err) {
      console.error('[DiscordStore] Failed to persist OAuth state via Admin SDK:', err);
    }
  }

  memoryStore.oauthStatesByHash[bundle.record.stateHash] = bundle.record;
  saveStoreToDisk();

  const authorizeUrlResult = buildDiscordAuthorizeUrl({
    state: bundle.state,
    redirectUri: params.redirectUri,
  });

  if (!authorizeUrlResult.ok) {
    return authorizeUrlResult;
  }

  return {
    ok: true,
    state: bundle.state,
    nonce: bundle.nonce,
    expiresAt: bundle.record.expiresAt,
    authorizeUrl: authorizeUrlResult.url,
  };
}

export function buildDiscordAuthorizeUrl(params: {
  state: string;
  redirectUri: string;
}): { ok: true; url: string } | ApiErrorResult {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim() || '';

  if (clientId) {
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: 'identify',
      state: params.state,
      prompt: 'consent',
    });
    return {
      ok: true,
      url: `https://discord.com/oauth2/authorize?${query.toString()}`,
    };
  }

  if (process.env.NODE_ENV !== 'production') {
    const baseOrigin = params.redirectUri.replace(/\/api\/(auth\/)?discord\/callback.*$/, '');
    const devQuery = new URLSearchParams({
      state: params.state,
      redirect_uri: params.redirectUri,
      scope: 'identify',
    });
    return {
      ok: true,
      url: `${baseOrigin}/api/auth/discord/dev-authorize?${devQuery.toString()}`,
    };
  }

  return {
    ok: false,
    status: 503,
    code: 'discord_oauth_not_configured',
    error: 'Discord OAuth client credentials (DISCORD_CLIENT_ID) are not configured on the server.',
  };
}

const DEV_CODE_HMAC_KEY = 'aniscroll_dev_discord_oauth_code_hmac_2026';

export function createDevDiscordAuthCode(profile: DiscordIdentityProfile): string {
  const payloadB64 = Buffer.from(JSON.stringify(profile), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', DEV_CODE_HMAC_KEY)
    .update(payloadB64)
    .digest('base64url');
  return `dev_discord_code.${payloadB64}.${sig}`;
}

export function verifyDevDiscordAuthCode(code: string): DiscordIdentityProfile | null {
  if (!code.startsWith('dev_discord_code.')) return null;
  const parts = code.split('.');
  if (parts.length !== 3) return null;
  const [, payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', DEV_CODE_HMAC_KEY)
    .update(payloadB64)
    .digest('base64url');

  if (sig !== expectedSig) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as DiscordIdentityProfile;
    if (!parsed || !isValidDiscordSnowflake(parsed.id) || !parsed.username) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Atomically validates and consumes a single-use OAuth state record.
 */
export async function consumeDiscordOAuthStateServer(params: {
  state: string | null | undefined;
  cookieNonce?: string | null;
}): Promise<
  | { ok: true; record: DiscordOAuthStateRecord }
  | ApiErrorResult
> {
  loadStoreFromDisk();
  const rawState = typeof params.state === 'string' ? params.state.trim() : '';
  if (!rawState || !/^[a-f0-9]{64}$/i.test(rawState)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_oauth_state',
      error: 'Invalid or missing Discord OAuth state parameter.',
    };
  }

  const stateHash = hashSha256Hex(rawState);
  let stateRecord: DiscordOAuthStateRecord | null =
    memoryStore.oauthStatesByHash[stateHash] || null;

  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      const docRef = adminFs.db.collection('discordOAuthStates').doc(stateHash);
      const snap = await docRef.get();
      if (snap.exists) {
        stateRecord = snap.data() as DiscordOAuthStateRecord;
      }
    } catch (err) {
      console.error('[DiscordStore] Error reading OAuth state from Admin SDK:', err);
    }
  }

  const validation = validateOAuthStateRecord({
    state: rawState,
    record: stateRecord,
    cookieNonce: params.cookieNonce,
  });

  if (!validation.ok) {
    return validation;
  }

  // Mark consumed immediately so replay attempts fail with reused_oauth_state
  const consumedRecord: DiscordOAuthStateRecord = {
    ...validation.record,
    consumed: true,
  };
  memoryStore.oauthStatesByHash[stateHash] = consumedRecord;
  saveStoreToDisk();

  if (adminFs) {
    try {
      await adminFs.db
        .collection('discordOAuthStates')
        .doc(stateHash)
        .set(consumedRecord);
    } catch (err) {
      console.error('[DiscordStore] Failed to mark OAuth state consumed in Admin SDK:', err);
    }
  }

  return { ok: true, record: consumedRecord };
}

/**
 * Exchanges a Discord OAuth2 authorization code for the authenticated Discord user identity.
 * Never persists or exposes the Discord access_token or refresh_token.
 */
export async function exchangeDiscordCodeForIdentity(params: {
  code: string;
  redirectUri: string;
}): Promise<
  | { ok: true; identity: DiscordIdentityProfile }
  | ApiErrorResult
> {
  const cleanCode = typeof params.code === 'string' ? params.code.trim() : '';
  if (!cleanCode) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_authorization_code',
      error: 'Missing Discord authorization code.',
    };
  }

  // Support local dev loopback signed code ONLY outside production
  if (
    process.env.NODE_ENV !== 'production' &&
    cleanCode.startsWith('dev_discord_code.')
  ) {
    const devIdentity = verifyDevDiscordAuthCode(cleanCode);
    if (!devIdentity) {
      return {
        ok: false,
        status: 400,
        code: 'discord_token_exchange_failed',
        error: 'Invalid or tampered development Discord authorization code.',
      };
    }
    return { ok: true, identity: devIdentity };
  }

  const clientId = process.env.DISCORD_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim() || '';

  if (!clientId || !clientSecret) {
    return {
      ok: false,
      status: 503,
      code: 'discord_oauth_not_configured',
      error:
        'Discord OAuth credentials (DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET) are not configured on the server.',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: cleanCode,
        redirect_uri: params.redirectUri,
      }).toString(),
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!tokenRes.ok) {
      return {
        ok: false,
        status: 400,
        code: 'discord_token_exchange_failed',
        error: 'Failed to exchange Discord authorization code for an access token.',
      };
    }

    const tokenData = await tokenRes.json().catch(() => null);
    const accessToken =
      typeof tokenData?.access_token === 'string'
        ? tokenData.access_token.trim()
        : '';

    if (!accessToken) {
      return {
        ok: false,
        status: 502,
        code: 'discord_token_exchange_failed',
        error: 'Discord did not return a valid access token.',
      };
    }

    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!userRes.ok) {
      return {
        ok: false,
        status: 502,
        code: 'discord_identity_fetch_failed',
        error: 'Failed to retrieve Discord user identity from /users/@me.',
      };
    }

    const userData = await userRes.json().catch(() => null);
    if (!userData || !isValidDiscordSnowflake(userData.id) || !userData.username) {
      return {
        ok: false,
        status: 502,
        code: 'invalid_discord_identity',
        error: 'Discord returned an incomplete user identity payload.',
      };
    }

    return {
      ok: true,
      identity: {
        id: String(userData.id),
        username: String(userData.username),
        global_name:
          typeof userData.global_name === 'string' ? userData.global_name : null,
        avatar: typeof userData.avatar === 'string' ? userData.avatar : null,
      },
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return {
        ok: false,
        status: 504,
        code: 'api_timeout',
        error: 'Discord OAuth request timed out.',
      };
    }
    return {
      ok: false,
      status: 502,
      code: 'discord_token_exchange_failed',
      error: 'Network error while communicating with Discord OAuth API.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Atomically links a verified Discord identity to a Firebase UID in `/discordAccountLinks/{discordUserId}`.
 */
export async function saveDiscordAccountLinkServer(params: {
  firebaseUid: string;
  discordProfile: DiscordIdentityProfile;
}): Promise<
  | { ok: true; link: DiscordAccountLinkRecord }
  | ApiErrorResult
> {
  loadStoreFromDisk();

  const [existingByDiscordId, existingByFirebaseUid] = await Promise.all([
    getDiscordLinkByDiscordId(params.discordProfile.id),
    getDiscordLinkByFirebaseUid(params.firebaseUid),
  ]);

  const check = validateDiscordLinkUniqueness({
    firebaseUid: params.firebaseUid,
    discordProfile: params.discordProfile,
    existingByDiscordId,
    existingByFirebaseUid,
  });

  if (!check.ok) {
    return check;
  }

  const record = check.link;
  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      await adminFs.db.runTransaction(async (tx) => {
        const docRef = adminFs.db
          .collection('discordAccountLinks')
          .doc(record.discordUserId);
        const snap = await tx.get(docRef);
        if (snap.exists && snap.data()?.firebaseUid !== record.firebaseUid) {
          throw new Error('DISCORD_ALREADY_LINKED');
        }
        tx.set(docRef, {
          ...record,
          linkedAt: snap.exists
            ? snap.data()?.linkedAt || adminFs.FieldValue.serverTimestamp()
            : adminFs.FieldValue.serverTimestamp(),
          updatedAt: adminFs.FieldValue.serverTimestamp(),
        });
      });
    } catch (err: any) {
      if (err?.message === 'DISCORD_ALREADY_LINKED') {
        return {
          ok: false,
          status: 409,
          code: 'discord_account_already_linked',
          error:
            'This Discord account is already linked to another AniScroll account.',
        };
      }
      console.error('[DiscordStore] Admin SDK transaction failed:', err);
      return {
        ok: false,
        status: 503,
        code: 'firestore_unavailable',
        error: 'Unable to persist Discord account link to Firestore.',
      };
    }
  }

  memoryStore.linksByDiscordId[record.discordUserId] = record;
  saveStoreToDisk();

  return { ok: true, link: record };
}

/**
 * Unlinks the Discord account belonging to the authenticated Firebase UID.
 * Preserves all watchlist and website account data.
 */
export async function unlinkDiscordAccountServer(params: {
  firebaseUid: string;
}): Promise<
  | { ok: true; unlinkedDiscordUserId: string }
  | ApiErrorResult
> {
  loadStoreFromDisk();

  const existing = await getDiscordLinkByFirebaseUid(params.firebaseUid);
  if (!existing) {
    return {
      ok: false,
      status: 404,
      code: 'unlinked_discord_account',
      error: 'No Discord account is currently linked to this AniScroll account.',
    };
  }

  if (existing.firebaseUid !== params.firebaseUid) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      error: 'You are not authorized to unlink this Discord account.',
    };
  }

  const discordUserId = existing.discordUserId;
  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      await adminFs.db
        .collection('discordAccountLinks')
        .doc(discordUserId)
        .delete();
    } catch (err) {
      console.error('[DiscordStore] Failed to delete Discord link via Admin SDK:', err);
      return {
        ok: false,
        status: 503,
        code: 'firestore_unavailable',
        error: 'Failed to unlink Discord account from Firestore.',
      };
    }
  }

  delete memoryStore.linksByDiscordId[discordUserId];
  saveStoreToDisk();

  return { ok: true, unlinkedDiscordUserId: discordUserId };
}

function docDataToWatchlistEntry(
  d: Record<string, any> | null | undefined
): WatchlistEntry | null {
  if (!d || typeof d !== 'object') return null;
  const hoshikaId = Number(d.hoshikaId);
  if (!isValidHoshikaId(hoshikaId)) return null;

  return {
    hoshikaId,
    title: String(d.title || 'Anime'),
    coverImage: typeof d.coverImage === 'string' && d.coverImage ? d.coverImage : undefined,
    format: typeof d.format === 'string' && d.format ? d.format : undefined,
    rating: typeof d.rating === 'number' ? d.rating : undefined,
    seasonYear: typeof d.seasonYear === 'number' ? d.seasonYear : undefined,
    status: (d.status as WatchlistStatus) || 'watching',
    episodeProgress:
      typeof d.episodeProgress === 'number' && d.episodeProgress >= 0
        ? d.episodeProgress
        : undefined,
    addedAt: Number(d.addedAt || Date.now()),
  };
}

/**
 * Lists all watchlist entries for the given Firebase UID from `/users/{firebaseUid}/watchlist`.
 */
export async function listUserWatchlistServer(
  firebaseUid: string
): Promise<{ ok: true; items: WatchlistEntry[] } | ApiErrorResult> {
  const collectionPath = `users/${firebaseUid}/watchlist`;

  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      const snap = await adminFs.db.collection(collectionPath).get();
      const items: WatchlistEntry[] = [];
      for (const docSnap of snap.docs) {
        const entry = docDataToWatchlistEntry(docSnap.data());
        if (entry) items.push(entry);
      }
      items.sort((a, b) => b.addedAt - a.addedAt);
      return { ok: true, items };
    } catch (err) {
      console.error('[DiscordStore] Admin SDK listUserWatchlistServer failed:', err);
      return {
        ok: false,
        status: 503,
        code: 'firestore_unavailable',
        error: 'Failed to read watchlist from Firestore.',
      };
    }
  }

  const idToken = await resolveUsableFirebaseIdToken(firebaseUid);
  if (!idToken) {
    return {
      ok: false,
      status: 503,
      code: 'firestore_unavailable',
      error:
        'Firebase Admin SDK credentials (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) or active user session are required to read Firestore on the server.',
    };
  }

  const docs = await listFirestoreCollectionRest(collectionPath, 300, idToken);
  const items: WatchlistEntry[] = [];
  for (const docItem of docs) {
    const entry = docDataToWatchlistEntry(docItem.data);
    if (entry) items.push(entry);
  }
  items.sort((a, b) => b.addedAt - a.addedAt);
  return { ok: true, items };
}

/**
 * Gets a single watchlist entry `/users/{firebaseUid}/watchlist/{hoshikaId}`.
 */
export async function getUserWatchlistItemServer(
  firebaseUid: string,
  hoshikaId: number
): Promise<{ ok: true; item: WatchlistEntry } | ApiErrorResult> {
  if (!isValidHoshikaId(hoshikaId)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_hoshika_id',
      error: 'hoshikaId must be a positive integer Hoshika shortId.',
    };
  }

  const docId = String(hoshikaId);
  const collectionPath = `users/${firebaseUid}/watchlist`;

  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      const snap = await adminFs.db.collection(collectionPath).doc(docId).get();
      if (!snap.exists) {
        return {
          ok: false,
          status: 404,
          code: 'watchlist_entry_not_found',
          error: `Anime #${hoshikaId} is not in the user's watchlist.`,
        };
      }
      const entry = docDataToWatchlistEntry(snap.data());
      if (!entry) {
        return {
          ok: false,
          status: 404,
          code: 'watchlist_entry_not_found',
          error: `Anime #${hoshikaId} is not in the user's watchlist.`,
        };
      }
      return { ok: true, item: entry };
    } catch (err) {
      console.error('[DiscordStore] Admin SDK getUserWatchlistItemServer failed:', err);
      return {
        ok: false,
        status: 503,
        code: 'firestore_unavailable',
        error: 'Failed to read watchlist entry from Firestore.',
      };
    }
  }

  const idToken = await resolveUsableFirebaseIdToken(firebaseUid);
  if (!idToken) {
    return {
      ok: false,
      status: 503,
      code: 'firestore_unavailable',
      error: 'Server Firestore access is unavailable.',
    };
  }

  const raw = await fetchFirestoreDocumentRest(collectionPath, docId, idToken);
  const entry = docDataToWatchlistEntry(raw);
  if (!entry) {
    return {
      ok: false,
      status: 404,
      code: 'watchlist_entry_not_found',
      error: `Anime #${hoshikaId} is not in the user's watchlist.`,
    };
  }
  return { ok: true, item: entry };
}

/**
 * Adds a new anime to `/users/{firebaseUid}/watchlist/{hoshikaId}` atomically after verifying
 * its metadata with Hoshika (`/api/v1/anime/{shortId}?locale=en` or `/api/v1/search`).
 */
export async function addUserWatchlistItemServer(params: {
  firebaseUid: string;
  hoshikaId?: number;
  query?: string;
  status: WatchlistStatus;
  episodeProgress?: number;
}): Promise<{ ok: true; item: WatchlistEntry } | ApiErrorResult> {
  let targetShortId = params.hoshikaId;

  if (!targetShortId && params.query) {
    const searchResults = await searchHoshika(params.query, 10);
    const firstMatch = searchResults.find((a) => isValidHoshikaId(a?.shortId));
    if (!firstMatch) {
      return {
        ok: false,
        status: 404,
        code: 'anime_not_found',
        error: `No anime found on Hoshika matching "${params.query}".`,
      };
    }
    targetShortId = Number(firstMatch.shortId);
  }

  if (!targetShortId || !isValidHoshikaId(targetShortId)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_hoshika_id',
      error: 'A valid positive integer Hoshika shortId is required.',
    };
  }

  const hoshikaAnime = await getHoshikaAnime(targetShortId, 'en');
  const metadata = hoshikaAnime
    ? extractWatchlistMetadataFromHoshikaAnime(hoshikaAnime)
    : null;

  if (!metadata) {
    return {
      ok: false,
      status: 404,
      code: 'invalid_hoshika_id',
      error: `No anime exists on Hoshika with shortId ${targetShortId}.`,
    };
  }

  const docId = String(metadata.hoshikaId);
  const collectionPath = `users/${params.firebaseUid}/watchlist`;
  const addedAt = Date.now();

  const docPayload: Record<string, any> = {
    uid: params.firebaseUid,
    hoshikaId: metadata.hoshikaId,
    title: metadata.title,
    coverImage: metadata.coverImage,
    format: metadata.format,
    rating: metadata.rating,
    seasonYear: metadata.seasonYear,
    status: params.status,
    addedAt,
  };

  if (params.episodeProgress !== undefined) {
    docPayload.episodeProgress = params.episodeProgress;
  }

  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      const docRef = adminFs.db.collection(collectionPath).doc(docId);
      await docRef.create({
        ...docPayload,
        createdAt: adminFs.FieldValue.serverTimestamp(),
        updatedAt: adminFs.FieldValue.serverTimestamp(),
      });
      const entry = docDataToWatchlistEntry(docPayload)!;
      return { ok: true, item: entry };
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (err?.code === 6 || msg.includes('ALREADY_EXISTS')) {
        return {
          ok: false,
          status: 409,
          code: 'duplicate_watchlist_entry',
          error: `"${metadata.title}" (#${metadata.hoshikaId}) is already in the watchlist.`,
        };
      }
      console.error('[DiscordStore] Admin SDK addUserWatchlistItemServer failed:', err);
      return {
        ok: false,
        status: 503,
        code: 'firestore_unavailable',
        error: 'Failed to write watchlist entry to Firestore.',
      };
    }
  }

  const idToken = await resolveUsableFirebaseIdToken(params.firebaseUid);
  if (!idToken) {
    return {
      ok: false,
      status: 503,
      code: 'firestore_unavailable',
      error: 'Server Firestore access is unavailable.',
    };
  }

  // Check duplicate first and commit with currentDocument: { exists: false } precondition
  const existing = await fetchFirestoreDocumentRest(collectionPath, docId, idToken);
  if (existing && existing.hoshikaId) {
    return {
      ok: false,
      status: 409,
      code: 'duplicate_watchlist_entry',
      error: `"${metadata.title}" (#${metadata.hoshikaId}) is already in the watchlist.`,
    };
  }

  const docResourceName = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${collectionPath}/${docId}`;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents:commit`;

  const commitBody = {
    writes: [
      {
        update: {
          name: docResourceName,
          fields: toFirestoreRestFields(docPayload),
        },
        currentDocument: {
          exists: false,
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      },
    ],
  };

  try {
    const res = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(commitBody),
      cache: 'no-store',
    });

    if (!res.ok) {
      if (res.status === 400 || res.status === 409) {
        const text = await res.text().catch(() => '');
        if (text.includes('FAILED_PRECONDITION') || text.includes('ALREADY_EXISTS')) {
          return {
            ok: false,
            status: 409,
            code: 'duplicate_watchlist_entry',
            error: `"${metadata.title}" (#${metadata.hoshikaId}) is already in the watchlist.`,
          };
        }
      }
      if (res.status === 403) {
        return {
          ok: false,
          status: 403,
          code: 'firestore_permission_denied',
          error: 'Firestore security rules rejected the watchlist write.',
        };
      }
      return {
        ok: false,
        status: 503,
        code: 'firestore_unavailable',
        error: `Firestore commit failed with status ${res.status}.`,
      };
    }

    const entry = docDataToWatchlistEntry(docPayload)!;
    return { ok: true, item: entry };
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'firestore_unavailable',
      error: 'Network error while writing to Firestore.',
    };
  }
}

/**
 * Updates an existing watchlist entry `/users/{firebaseUid}/watchlist/{hoshikaId}` while preserving
 * `uid`, `hoshikaId`, `addedAt`, and `createdAt`.
 */
export async function updateUserWatchlistItemServer(params: {
  firebaseUid: string;
  hoshikaId: number;
  patch: {
    status?: WatchlistStatus;
    episodeProgress?: number;
    title?: string;
    coverImage?: string | null;
    format?: string | null;
    rating?: number | null;
    seasonYear?: number | null;
  };
}): Promise<{ ok: true; item: WatchlistEntry } | ApiErrorResult> {
  if (!isValidHoshikaId(params.hoshikaId)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_hoshika_id',
      error: 'hoshikaId must be a positive integer Hoshika shortId.',
    };
  }

  const docId = String(params.hoshikaId);
  const collectionPath = `users/${params.firebaseUid}/watchlist`;

  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      const docRef = adminFs.db.collection(collectionPath).doc(docId);
      const snap = await docRef.get();
      if (!snap.exists) {
        return {
          ok: false,
          status: 404,
          code: 'watchlist_entry_not_found',
          error: `Anime #${params.hoshikaId} was not found in the user's watchlist.`,
        };
      }

      const existingData = snap.data() || {};
      const updateFields: Record<string, any> = {
        updatedAt: adminFs.FieldValue.serverTimestamp(),
      };
      if (params.patch.status !== undefined) updateFields.status = params.patch.status;
      if (params.patch.episodeProgress !== undefined) {
        updateFields.episodeProgress = params.patch.episodeProgress;
      }
      if (params.patch.title !== undefined) updateFields.title = params.patch.title;
      if (params.patch.coverImage !== undefined) {
        updateFields.coverImage = params.patch.coverImage;
      }
      if (params.patch.format !== undefined) updateFields.format = params.patch.format;
      if (params.patch.rating !== undefined) updateFields.rating = params.patch.rating;
      if (params.patch.seasonYear !== undefined) {
        updateFields.seasonYear = params.patch.seasonYear;
      }

      await docRef.update(updateFields);
      const merged = {
        ...existingData,
        ...params.patch,
        uid: existingData.uid || params.firebaseUid,
        hoshikaId: Number(existingData.hoshikaId || params.hoshikaId),
        addedAt: Number(existingData.addedAt || Date.now()),
      };
      return { ok: true, item: docDataToWatchlistEntry(merged)! };
    } catch (err) {
      console.error('[DiscordStore] Admin SDK updateUserWatchlistItemServer failed:', err);
      return {
        ok: false,
        status: 503,
        code: 'firestore_unavailable',
        error: 'Failed to update watchlist entry in Firestore.',
      };
    }
  }

  const idToken = await resolveUsableFirebaseIdToken(params.firebaseUid);
  if (!idToken) {
    return {
      ok: false,
      status: 503,
      code: 'firestore_unavailable',
      error: 'Server Firestore access is unavailable.',
    };
  }

  const getUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID
  )}/databases/${encodeURIComponent(
    DATABASE_ID
  )}/documents/${collectionPath}/${encodeURIComponent(docId)}`;

  try {
    const existingRes = await fetch(getUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      cache: 'no-store',
    });

    if (!existingRes.ok) {
      return {
        ok: false,
        status: 404,
        code: 'watchlist_entry_not_found',
        error: `Anime #${params.hoshikaId} was not found in the user's watchlist.`,
      };
    }

    const rawDoc = await existingRes.json();
    const existingCreatedAtField = rawDoc?.fields?.createdAt;
    const existingParsed = await fetchFirestoreDocumentRest(
      collectionPath,
      docId,
      idToken
    );

    if (!existingParsed || !existingParsed.hoshikaId) {
      return {
        ok: false,
        status: 404,
        code: 'watchlist_entry_not_found',
        error: `Anime #${params.hoshikaId} was not found in the user's watchlist.`,
      };
    }

    const mergedData: Record<string, any> = {
      uid: params.firebaseUid,
      hoshikaId: Number(existingParsed.hoshikaId),
      title:
        params.patch.title !== undefined
          ? params.patch.title
          : String(existingParsed.title || 'Anime'),
      coverImage:
        params.patch.coverImage !== undefined
          ? params.patch.coverImage
          : existingParsed.coverImage ?? null,
      format:
        params.patch.format !== undefined
          ? params.patch.format
          : existingParsed.format ?? null,
      rating:
        params.patch.rating !== undefined
          ? params.patch.rating
          : existingParsed.rating ?? null,
      seasonYear:
        params.patch.seasonYear !== undefined
          ? params.patch.seasonYear
          : existingParsed.seasonYear ?? null,
      status:
        params.patch.status !== undefined
          ? params.patch.status
          : existingParsed.status || 'watching',
      addedAt: Number(existingParsed.addedAt || Date.now()),
    };

    const nextProgress =
      params.patch.episodeProgress !== undefined
        ? params.patch.episodeProgress
        : existingParsed.episodeProgress;
    if (typeof nextProgress === 'number' && nextProgress >= 0) {
      mergedData.episodeProgress = nextProgress;
    }

    const fields = toFirestoreRestFields(mergedData);
    if (existingCreatedAtField) {
      fields.createdAt = existingCreatedAtField;
    }

    const docResourceName = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${collectionPath}/${docId}`;
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      PROJECT_ID
    )}/databases/${encodeURIComponent(DATABASE_ID)}/documents:commit`;

    const commitRes = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: docResourceName,
              fields,
            },
            currentDocument: {
              exists: true,
            },
            updateTransforms: [
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
        ],
      }),
      cache: 'no-store',
    });

    if (!commitRes.ok) {
      return {
        ok: false,
        status: commitRes.status === 403 ? 403 : 503,
        code:
          commitRes.status === 403
            ? 'firestore_permission_denied'
            : 'firestore_unavailable',
        error: `Failed to update watchlist entry in Firestore (${commitRes.status}).`,
      };
    }

    return { ok: true, item: docDataToWatchlistEntry(mergedData)! };
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'firestore_unavailable',
      error: 'Network error while updating watchlist entry in Firestore.',
    };
  }
}

/**
 * Removes an anime entry from `/users/{firebaseUid}/watchlist/{hoshikaId}`.
 */
export async function deleteUserWatchlistItemServer(params: {
  firebaseUid: string;
  hoshikaId: number;
}): Promise<{ ok: true; deleted: true; hoshikaId: number } | ApiErrorResult> {
  if (!isValidHoshikaId(params.hoshikaId)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_hoshika_id',
      error: 'hoshikaId must be a positive integer Hoshika shortId.',
    };
  }

  const docId = String(params.hoshikaId);
  const collectionPath = `users/${params.firebaseUid}/watchlist`;

  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      const docRef = adminFs.db.collection(collectionPath).doc(docId);
      const snap = await docRef.get();
      if (!snap.exists) {
        return {
          ok: false,
          status: 404,
          code: 'watchlist_entry_not_found',
          error: `Anime #${params.hoshikaId} was not found in the user's watchlist.`,
        };
      }
      await docRef.delete();
      return { ok: true, deleted: true, hoshikaId: params.hoshikaId };
    } catch (err) {
      console.error('[DiscordStore] Admin SDK deleteUserWatchlistItemServer failed:', err);
      return {
        ok: false,
        status: 503,
        code: 'firestore_unavailable',
        error: 'Failed to delete watchlist entry from Firestore.',
      };
    }
  }

  const idToken = await resolveUsableFirebaseIdToken(params.firebaseUid);
  if (!idToken) {
    return {
      ok: false,
      status: 503,
      code: 'firestore_unavailable',
      error: 'Server Firestore access is unavailable.',
    };
  }

  const existing = await fetchFirestoreDocumentRest(collectionPath, docId, idToken);
  if (!existing || !existing.hoshikaId) {
    return {
      ok: false,
      status: 404,
      code: 'watchlist_entry_not_found',
      error: `Anime #${params.hoshikaId} was not found in the user's watchlist.`,
    };
  }

  const deleteUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID
  )}/databases/${encodeURIComponent(
    DATABASE_ID
  )}/documents/${collectionPath}/${encodeURIComponent(docId)}`;

  try {
    const res = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return {
        ok: false,
        status: res.status === 403 ? 403 : 503,
        code:
          res.status === 403
            ? 'firestore_permission_denied'
            : 'firestore_unavailable',
        error: `Failed to delete watchlist entry from Firestore (${res.status}).`,
      };
    }

    return { ok: true, deleted: true, hoshikaId: params.hoshikaId };
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'firestore_unavailable',
      error: 'Network error while deleting watchlist entry from Firestore.',
    };
  }
}
