import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import firebaseAppletConfig from '../firebase-applet-config.json';
import {
  AdminRecord,
  DEFAULT_ROLE_PERMISSIONS,
  buildOwnerAdminRecord,
  isBootstrappedOwnerIdentity,
} from './admin/admin-permissions';

/**
 * Server-side Firebase Admin initialization, token verification, and Firestore REST persistence.
 * Uses firebase-admin when service account credentials are provided in environment variables,
 * and falls back cleanly to Google Identity Toolkit REST token verification + Firestore REST API
 * with the user's verified Bearer token when running without a service account private key.
 */

const PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || firebaseAppletConfig.projectId;
const API_KEY =
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY || firebaseAppletConfig.apiKey;
const DATABASE_ID =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID ||
  firebaseAppletConfig.firestoreDatabaseId ||
  '(default)';

export function getFirebaseAdminApp(): App | null {
  const apps = getApps();
  if (apps.length > 0) {
    return apps[0]!;
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (clientEmail && privateKey && PROJECT_ID) {
    try {
      return initializeApp({
        credential: cert({
          projectId: PROJECT_ID,
          clientEmail,
          privateKey,
        }),
        projectId: PROJECT_ID,
      });
    } catch (error) {
      console.error('Failed to initialize firebase-admin with cert:', error);
    }
  }

  return null;
}

export interface VerifiedServerUser {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  idToken: string;
}

/**
 * Verifies the Firebase ID token from the Authorization: Bearer <token> header.
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

  // 1. Try firebase-admin SDK if service account is configured
  const adminApp = getFirebaseAdminApp();
  if (adminApp) {
    try {
      const decoded = await getAuth(adminApp).verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        email: (decoded.email || '').toLowerCase(),
        displayName: decoded.name || decoded.email?.split('@')[0] || 'Admin',
        emailVerified: Boolean(decoded.email_verified),
        idToken,
      };
    } catch (err) {
      console.warn(
        'firebase-admin verifyIdToken fallback to Identity Toolkit:',
        err
      );
    }
  }

  // 2. Verify token cryptographically via Google Identity Toolkit accounts:lookup
  if (!API_KEY) {
    return null;
  }

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
      return null;
    }

    const data = await res.json();
    const user = data?.users?.[0];
    if (!user || !user.localId) {
      return null;
    }

    return {
      uid: user.localId,
      email: (user.email || '').toLowerCase(),
      displayName: user.displayName || user.email?.split('@')[0] || 'User',
      emailVerified: Boolean(user.emailVerified),
      idToken,
    };
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
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

  const adminApp = getFirebaseAdminApp();
  if (adminApp) {
    const adminDb = getFirestore(adminApp, DATABASE_ID);
    const docRef = adminDb.collection(collectionPath).doc(docId);
    const snap = await docRef.get();
    const payload: Record<string, any> = {
      ...data,
      createdAt: snap.exists
        ? snap.data()?.createdAt || FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
    };
    if (includeUpdatedAt) {
      payload.updatedAt = FieldValue.serverTimestamp();
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
      if (rawExisting?.fields?.createdAt) {
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
