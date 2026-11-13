import type { App } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import firebaseAppletConfig from '../firebase-applet-config.json';
import { verifyFirebaseIdTokenWithJose } from './firebase-jwt';
import {
  AdminRecord,
  DEFAULT_ROLE_PERMISSIONS,
  buildOwnerAdminRecord,
  isBootstrappedOwnerIdentity,
} from './admin/admin-permissions';

/**
 * Server-side Firebase token verification, Firestore REST persistence, and optional lazy Admin SDK.
 *
 * IMPORTANT: Never statically import `firebase-admin/*` at module top level.
 * `firebase-admin/auth` depends on `jwks-rsa` which calls CommonJS `require('jose')`,
 * crashing Node 20 runtimes even on routes that never use service-account credentials.
 * Token verification uses pure ESM `jose` (`verifyFirebaseIdTokenWithJose`) plus Google
 * Identity Toolkit REST verification, and `firebase-admin/*` is loaded lazily only when
 * service account credentials are configured.
 */

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

let cachedAdminApp: App | null = null;
let adminLoadDisabled = false;

export function hasFirebaseServiceAccountCredentials(): boolean {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  return Boolean(clientEmail && privateKey && PROJECT_ID);
}

/**
 * Returns cached Admin App if already initialized, or null without triggering synchronous CJS require.
 */
export function getFirebaseAdminApp(): App | null {
  return cachedAdminApp;
}

export async function getFirebaseAdminAppAsync(): Promise<App | null> {
  if (cachedAdminApp) return cachedAdminApp;
  if (adminLoadDisabled || !hasFirebaseServiceAccountCredentials()) {
    return null;
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL!.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n');

  try {
    const appMod = await import('firebase-admin/app');
    const apps = appMod.getApps();
    if (apps.length > 0) {
      cachedAdminApp = apps[0]!;
      return cachedAdminApp;
    }

    cachedAdminApp = appMod.initializeApp({
      credential: appMod.cert({
        projectId: PROJECT_ID,
        clientEmail,
        privateKey,
      }),
      projectId: PROJECT_ID,
    });
    return cachedAdminApp;
  } catch (error) {
    adminLoadDisabled = true;
    console.warn('Lazy firebase-admin initialization unavailable; continuing with ESM/REST:', error);
    return null;
  }
}

export async function getFirebaseAdminAuth(): Promise<Auth | null> {
  const app = await getFirebaseAdminAppAsync();
  if (!app) return null;
  try {
    const authMod = await import('firebase-admin/auth');
    return authMod.getAuth(app);
  } catch (error) {
    adminLoadDisabled = true;
    console.warn('Lazy firebase-admin/auth unavailable; continuing with ESM/REST:', error);
    return null;
  }
}

export async function getFirebaseAdminFirestore(): Promise<{
  db: Firestore;
  FieldValue: typeof import('firebase-admin/firestore').FieldValue;
} | null> {
  const app = await getFirebaseAdminAppAsync();
  if (!app) return null;
  try {
    const fsMod = await import('firebase-admin/firestore');
    return {
      db: fsMod.getFirestore(app, DATABASE_ID),
      FieldValue: fsMod.FieldValue,
    };
  } catch (error) {
    console.warn('Lazy firebase-admin/firestore unavailable; falling back to REST:', error);
    return null;
  }
}

export interface VerifiedServerUser {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  idToken: string;
}

/**
 * Verifies the Firebase ID token from the Authorization: Bearer <token> header
 * using pure ESM `jose` RS256 JWK signature verification, optional Identity Toolkit
 * lookup (for disabled-user / revocation enforcement), and optional lazy Admin SDK.
 */
export async function verifyServerAuthToken(
  req: NextRequest | Request
): Promise<VerifiedServerUser | null> {
  const authHeader =
    req.headers.get('authorization') || req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    return null;
  }

  // 1. Optional lazy firebase-admin check if service account credentials are present
  const adminAuth = await getFirebaseAdminAuth();
  if (adminAuth) {
    try {
      const decoded = await adminAuth.verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        email: (decoded.email || '').toLowerCase(),
        displayName: decoded.name || decoded.email?.split('@')[0] || 'Admin',
        emailVerified: Boolean(decoded.email_verified),
        idToken,
      };
    } catch (err) {
      console.warn(
        'firebase-admin verifyIdToken fallback to ESM jose + Identity Toolkit:',
        err
      );
    }
  }

  // 2. Cryptographic RS256 verification via pure ESM `jose` (zero CommonJS require('jose'))
  const joseClaims = PROJECT_ID
    ? await verifyFirebaseIdTokenWithJose(idToken, PROJECT_ID)
    : null;

  // 3. Cross-check against Google Identity Toolkit accounts:lookup (catches disabled/deleted accounts)
  if (API_KEY) {
    try {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
          API_KEY
        )}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
          cache: 'no-store',
        }
      );

      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
          return null;
        }
        // Transient Identity Toolkit 5xx: trust valid cryptographic jose verification if present
        if (joseClaims) {
          return {
            uid: joseClaims.uid,
            email: joseClaims.email,
            displayName: joseClaims.displayName,
            emailVerified: joseClaims.emailVerified,
            idToken,
          };
        }
        return null;
      }

      const data = await res.json();
      const user = data?.users?.[0];
      if (!user || !user.localId || user.disabled) {
        return null;
      }

      return {
        uid: joseClaims?.uid || user.localId,
        email: (user.email || joseClaims?.email || '').toLowerCase(),
        displayName:
          user.displayName ||
          joseClaims?.displayName ||
          user.email?.split('@')[0] ||
          'User',
        emailVerified: Boolean(user.emailVerified ?? joseClaims?.emailVerified),
        idToken,
      };
    } catch (error) {
      console.error('Identity Toolkit token check failed:', error);
      if (joseClaims) {
        return {
          uid: joseClaims.uid,
          email: joseClaims.email,
          displayName: joseClaims.displayName,
          emailVerified: joseClaims.emailVerified,
          idToken,
        };
      }
      return null;
    }
  }

  if (joseClaims) {
    return {
      uid: joseClaims.uid,
      email: joseClaims.email,
      displayName: joseClaims.displayName,
      emailVerified: joseClaims.emailVerified,
      idToken,
    };
  }

  return null;
}

/**
 * Reads a Firestore document using the Firestore REST API with an optional Bearer token.
 */
export async function fetchFirestoreDocumentRest(
  collectionPath: string,
  docId: string,
  idToken?: string
): Promise<Record<string, any> | null> {
  if (!PROJECT_ID) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      PROJECT_ID
    )}/databases/${encodeURIComponent(
      DATABASE_ID
    )}/documents/${collectionPath}/${encodeURIComponent(docId)}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }

    const res = await fetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!res.ok) {
      return null;
    }

    const rawDoc = await res.json();
    return parseFirestoreRestFields(rawDoc.fields || {});
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export const fetchFirestoreDocumentServer = fetchFirestoreDocumentRest;

/**
 * Lists documents in a Firestore collection using the Admin SDK if available or REST API fallback.
 */
export async function listFirestoreCollectionRest(
  collectionPath: string,
  pageSize = 100,
  idToken?: string
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      const snap = await adminFs.db.collection(collectionPath).limit(pageSize).get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
    } catch {
      // Fallback to REST below
    }
  }

  if (!PROJECT_ID) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      PROJECT_ID
    )}/databases/${encodeURIComponent(
      DATABASE_ID
    )}/documents/${collectionPath}?pageSize=${Math.min(300, Math.max(1, pageSize))}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }

    const res = await fetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!res.ok) return [];
    const payload = await res.json();
    const docs = Array.isArray(payload?.documents) ? payload.documents : [];
    return docs.map((rawDoc: any) => {
      const nameParts = String(rawDoc.name || '').split('/');
      const id = nameParts[nameParts.length - 1] || '';
      return {
        id,
        data: parseFirestoreRestFields(rawDoc.fields || {}),
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Queries /publicProfiles satisfying Firestore security rule constraints
 * (privacy.profileVisibility == 'public' | 'members').
 */
export async function queryPublicProfilesRest(
  visibilities: Array<'public' | 'members'>,
  pageSize = 120,
  idToken?: string
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const uniqueVis = Array.from(new Set(visibilities));
  if (uniqueVis.length === 0) return [];

  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      const snap = await adminFs.db
        .collection('publicProfiles')
        .where('privacy.profileVisibility', 'in', uniqueVis)
        .limit(pageSize)
        .get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
    } catch {
      // Fallback to REST below
    }
  }

  if (!PROJECT_ID) return [];

  const runSingleVisibility = async (
    visibility: 'public' | 'members'
  ): Promise<Array<{ id: string; data: Record<string, any> }>> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        PROJECT_ID
      )}/databases/${encodeURIComponent(DATABASE_ID)}/documents:runQuery`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'publicProfiles' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'privacy.profileVisibility' },
                op: 'EQUAL',
                value: { stringValue: visibility },
              },
            },
            limit: Math.min(300, Math.max(1, pageSize)),
          },
        }),
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!res.ok) return [];
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      const out: Array<{ id: string; data: Record<string, any> }> = [];
      for (const row of rows) {
        if (!row?.document?.name) continue;
        const nameParts = String(row.document.name).split('/');
        const id = nameParts[nameParts.length - 1] || '';
        out.push({
          id,
          data: parseFirestoreRestFields(row.document.fields || {}),
        });
      }
      return out;
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  };

  const results = await Promise.all(uniqueVis.map(runSingleVisibility));
  const merged = new Map<string, { id: string; data: Record<string, any> }>();
  for (const list of results) {
    for (const item of list) {
      if (item.id && !merged.has(item.id)) {
        merged.set(item.id, item);
      }
    }
  }
  return Array.from(merged.values());
}

/**
 * Runs a collectionGroup query via Admin SDK or Firestore REST API.
 */
export async function runCollectionGroupQueryRest(
  collectionId: string,
  pageSize = 200,
  idToken?: string
): Promise<Array<{ id: string; path: string; data: Record<string, any> }>> {
  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      const snap = await adminFs.db
        .collectionGroup(collectionId)
        .limit(pageSize)
        .get();
      return snap.docs.map((d) => ({
        id: d.id,
        path: d.ref.path,
        data: d.data() || {},
      }));
    } catch {
      // Fallback to REST below
    }
  }

  if (!PROJECT_ID) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      PROJECT_ID
    )}/databases/${encodeURIComponent(DATABASE_ID)}/documents:runQuery`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId, allDescendants: true }],
          limit: Math.min(300, Math.max(1, pageSize)),
        },
      }),
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!res.ok) return [];
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    const out: Array<{ id: string; path: string; data: Record<string, any> }> = [];
    for (const row of rows) {
      if (!row?.document?.name) continue;
      const fullPath = String(row.document.name);
      const nameParts = fullPath.split('/');
      const id = nameParts[nameParts.length - 1] || '';
      out.push({
        id,
        path: fullPath,
        data: parseFirestoreRestFields(row.document.fields || {}),
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Deletes a Firestore document via Admin SDK or REST API fallback.
 */
export async function deleteFirestoreDocumentServer(params: {
  collectionPath: string;
  docId: string;
  idToken?: string;
}): Promise<boolean> {
  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    try {
      await adminFs.db.collection(params.collectionPath).doc(params.docId).delete();
      return true;
    } catch {
      // Fall through to REST
    }
  }

  if (!PROJECT_ID || !params.idToken) return false;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      PROJECT_ID
    )}/databases/${encodeURIComponent(
      DATABASE_ID
    )}/documents/${params.collectionPath}/${encodeURIComponent(params.docId)}`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${params.idToken}`,
      },
      cache: 'no-store',
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export function parseFirestoreRestValue(valObj: Record<string, any>): any {
  if (!valObj || typeof valObj !== 'object') return null;
  if ('stringValue' in valObj) return valObj.stringValue;
  if ('integerValue' in valObj) return Number(valObj.integerValue);
  if ('doubleValue' in valObj) return Number(valObj.doubleValue);
  if ('booleanValue' in valObj) return Boolean(valObj.booleanValue);
  if ('nullValue' in valObj) return null;
  if ('timestampValue' in valObj) return valObj.timestampValue;
  if ('mapValue' in valObj) {
    return parseFirestoreRestFields(valObj.mapValue?.fields || {});
  }
  if ('arrayValue' in valObj) {
    const values = valObj.arrayValue?.values || [];
    return values.map((v: Record<string, any>) => parseFirestoreRestValue(v));
  }
  return null;
}

export function parseFirestoreRestFields(
  fields: Record<string, Record<string, any>>
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, valObj] of Object.entries(fields)) {
    result[key] = parseFirestoreRestValue(valObj);
  }
  return result;
}

export function toFirestoreRestValue(value: any): Record<string, any> {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => toFirestoreRestValue(item)),
      },
    };
  }
  if (typeof value === 'object') {
    const fields: Record<string, Record<string, any>> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        fields[k] = toFirestoreRestValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

export function toFirestoreRestFields(
  obj: Record<string, any>
): Record<string, Record<string, any>> {
  const fields: Record<string, Record<string, any>> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = toFirestoreRestValue(v);
    }
  }
  return fields;
}

/**
 * Writes a Firestore document from a server-side API route using either firebase-admin
 * (when configured) or the Firestore REST `documents:commit` endpoint with `REQUEST_TIME`
 * server timestamp transforms so strict `request.time` security rules are satisfied.
 */
export async function writeFirestoreDocumentServer(params: {
  collectionPath?: string;
  collectionName?: string;
  docId?: string;
  documentId?: string;
  data: Record<string, any>;
  idToken: string;
  includeUpdatedAt?: boolean;
  includeCreatedAt?: boolean;
}): Promise<boolean> {
  const collectionPath = params.collectionPath || params.collectionName || '';
  const docId = params.docId || params.documentId || '';
  const {
    data,
    idToken,
    includeUpdatedAt = true,
  } = params;

  if (!collectionPath || !docId) {
    throw new Error('collectionPath and docId are required for writeFirestoreDocumentServer');
  }

  const adminFs = await getFirebaseAdminFirestore();
  if (adminFs) {
    const docRef = adminFs.db.collection(collectionPath).doc(docId);
    const snap = await docRef.get();
    const payload: Record<string, any> = {
      ...data,
      createdAt: snap.exists
        ? snap.data()?.createdAt || adminFs.FieldValue.serverTimestamp()
        : adminFs.FieldValue.serverTimestamp(),
    };
    if (includeUpdatedAt) {
      payload.updatedAt = adminFs.FieldValue.serverTimestamp();
    }
    await docRef.set(payload);
    return true;
  }

  // Fallback to Firestore REST API commit with REQUEST_TIME fieldTransforms
  const docResourceName = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${collectionPath}/${docId}`;
  const getUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID
  )}/databases/${encodeURIComponent(
    DATABASE_ID
  )}/documents/${collectionPath}/${encodeURIComponent(docId)}`;

  let existingCreatedAtRaw: Record<string, any> | null = null;
  try {
    const existingRes = await fetch(getUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      cache: 'no-store',
    });
    if (existingRes.ok) {
      const rawExisting = await existingRes.json();
      if (rawExisting?.fields?.createdAt?.timestampValue) {
        existingCreatedAtRaw = rawExisting.fields.createdAt;
      }
    }
  } catch {
    // Proceed as create
  }

  const cleanData = { ...data };
  delete cleanData.createdAt;
  delete cleanData.updatedAt;

  const fields = toFirestoreRestFields(cleanData);
  const fieldTransforms: Array<Record<string, any>> = [];

  if (existingCreatedAtRaw) {
    fields.createdAt = existingCreatedAtRaw;
  } else {
    fieldTransforms.push({
      fieldPath: 'createdAt',
      setToServerValue: 'REQUEST_TIME',
    });
  }

  if (includeUpdatedAt) {
    fieldTransforms.push({
      fieldPath: 'updatedAt',
      setToServerValue: 'REQUEST_TIME',
    });
  }

  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    PROJECT_ID
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents:commit`;

  const commitBody = {
    writes: [
      {
        update: {
          name: docResourceName,
          fields,
        },
        updateTransforms: fieldTransforms,
      },
    ],
  };

  const commitRes = await fetch(commitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(commitBody),
    cache: 'no-store',
  });

  if (!commitRes.ok) {
    const errText = await commitRes.text().catch(() => 'Unknown Firestore error');
    throw new Error(
      `Firestore server write failed (${commitRes.status}): ${errText.slice(0, 300)}`
    );
  }
  return true;
}

export interface VerifiedAdminContext extends VerifiedServerUser {
  user: VerifiedServerUser;
  admin: AdminRecord;
}

/**
 * Verifies that the incoming request is from an active administrator or bootstrapped owner.
 */
export async function verifyAdminRequest(
  req: NextRequest | Request
): Promise<VerifiedAdminContext | null> {
  const user = await verifyServerAuthToken(req);
  if (!user) return null;

  if (isBootstrappedOwnerIdentity({ uid: user.uid, email: user.email })) {
    const ownerAdmin = buildOwnerAdminRecord(
      user.uid,
      user.email,
      user.displayName
    );
    return {
      ...user,
      user,
      admin: ownerAdmin,
    };
  }

  const docData = await fetchFirestoreDocumentRest(
    'admins',
    user.uid,
    user.idToken
  );
  if (!docData || docData.status !== 'active') {
    return null;
  }

  const role = (docData.role as AdminRecord['role']) || 'analyst';
  const adminRecord: AdminRecord = {
    uid: docData.uid || user.uid,
    email: docData.email || user.email,
    displayName: docData.displayName || user.displayName,
    role,
    permissions:
      docData.permissions ||
      DEFAULT_ROLE_PERMISSIONS[role] ||
      DEFAULT_ROLE_PERMISSIONS.analyst,
    status: 'active',
    addedBy: docData.addedBy || 'owner',
    addedAt: docData.addedAt || new Date().toISOString(),
    lastLogin: docData.lastLogin || new Date().toISOString(),
  };

  return {
    ...user,
    user,
    admin: adminRecord,
  };
}
