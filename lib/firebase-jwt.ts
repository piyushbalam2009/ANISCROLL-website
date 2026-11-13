import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/**
 * Pure ESM Firebase ID Token verification powered by `jose`.
 *
 * Avoids CommonJS `require('jose')` inside `firebase-admin` -> `jwks-rsa`
 * so cryptographic token verification works seamlessly across all Node/Vercel runtimes.
 */

const FIREBASE_SECURETOKEN_JWKS_URL = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
);

let cachedRemoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getFirebaseRemoteJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!cachedRemoteJwks) {
    cachedRemoteJwks = createRemoteJWKSet(FIREBASE_SECURETOKEN_JWKS_URL, {
      cacheMaxAge: 6 * 60 * 60 * 1000, // 6 hours
      cooldownDuration: 30 * 1000,
    });
  }
  return cachedRemoteJwks;
}

export interface VerifiedFirebaseJwtClaims {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  authTime: number;
  payload: JWTPayload;
}

export type JoseKeyResolver = Parameters<typeof jwtVerify>[1];

export function validateFirebaseTokenClaims(
  payload: JWTPayload,
  projectId: string,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000)
): VerifiedFirebaseJwtClaims | null {
  const cleanProjectId = projectId.trim();
  if (!cleanProjectId) return null;

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub || sub.length > 128) return null;

  if (payload.aud !== cleanProjectId) return null;
  if (payload.iss !== `https://securetoken.google.com/${cleanProjectId}`) {
    return null;
  }

  const authTime =
    typeof payload.auth_time === 'number' ? payload.auth_time : Number.NaN;
  if (!Number.isFinite(authTime) || authTime <= 0 || authTime > nowEpochSeconds + 300) {
    return null;
  }

  const email =
    typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const name =
    typeof payload.name === 'string' ? payload.name.trim() : '';
  const emailVerified = Boolean(payload.email_verified);

  return {
    uid: sub,
    email,
    displayName: name || (email ? email.split('@')[0] : 'User'),
    emailVerified,
    authTime,
    payload,
  };
}

/**
 * Cryptographically verifies a Firebase ID token (RS256 JWT) using pure ESM `jose`.
 */
export async function verifyFirebaseIdTokenWithJose(
  idToken: string,
  projectId: string,
  options?: {
    keyResolver?: JoseKeyResolver;
    nowEpochSeconds?: number;
  }
): Promise<VerifiedFirebaseJwtClaims | null> {
  const token = idToken.trim();
  const cleanProjectId = projectId.trim();
  if (!token || !cleanProjectId) {
    return null;
  }

  // Quick structural sanity check for compact 3-part JWS
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((s) => s.length === 0)) {
    return null;
  }

  try {
    const keyResolver = options?.keyResolver ?? getFirebaseRemoteJwks();
    const { payload } = await jwtVerify(token, keyResolver, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${cleanProjectId}`,
      audience: cleanProjectId,
      clockTolerance: 5,
      currentDate:
        options?.nowEpochSeconds !== undefined
          ? new Date(options.nowEpochSeconds * 1000)
          : undefined,
    });

    return validateFirebaseTokenClaims(
      payload,
      cleanProjectId,
      options?.nowEpochSeconds
    );
  } catch {
    return null;
  }
}
