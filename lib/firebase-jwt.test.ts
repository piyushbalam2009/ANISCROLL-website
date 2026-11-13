import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import {
  validateFirebaseTokenClaims,
  verifyFirebaseIdTokenWithJose,
} from './firebase-jwt';

test('ESM jose verifier validates a properly signed Firebase ID token', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'firebase-test-key-1';
  publicJwk.use = 'sig';
  publicJwk.alg = 'RS256';

  const localJwks = createLocalJWKSet({ keys: [publicJwk] });
  const nowSec = Math.floor(Date.now() / 1000);
  const projectId = 'aniscroll-test-project';

  const jwt = await new SignJWT({
    email: 'owner@aniscroll.app',
    email_verified: true,
    name: 'Test Owner',
    auth_time: nowSec - 30,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'firebase-test-key-1' })
    .setIssuer(`https://securetoken.google.com/${projectId}`)
    .setAudience(projectId)
    .setSubject('uid_owner_123')
    .setIssuedAt(nowSec - 10)
    .setExpirationTime(nowSec + 3600)
    .sign(privateKey);

  const verified = await verifyFirebaseIdTokenWithJose(jwt, projectId, {
    keyResolver: localJwks,
    nowEpochSeconds: nowSec,
  });

  assert.ok(verified);
  assert.equal(verified.uid, 'uid_owner_123');
  assert.equal(verified.email, 'owner@aniscroll.app');
  assert.equal(verified.displayName, 'Test Owner');
  assert.equal(verified.emailVerified, true);
});

test('ESM jose verifier rejects wrong audience, issuer, tampered signatures, and future auth_time', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const otherKeys = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'firebase-test-key-1';
  publicJwk.use = 'sig';
  publicJwk.alg = 'RS256';

  const localJwks = createLocalJWKSet({ keys: [publicJwk] });
  const nowSec = Math.floor(Date.now() / 1000);
  const projectId = 'aniscroll-test-project';

  // Wrong audience
  const badAud = await new SignJWT({ auth_time: nowSec - 10 })
    .setProtectedHeader({ alg: 'RS256', kid: 'firebase-test-key-1' })
    .setIssuer(`https://securetoken.google.com/${projectId}`)
    .setAudience('wrong-project')
    .setSubject('uid_1')
    .setIssuedAt(nowSec - 10)
    .setExpirationTime(nowSec + 600)
    .sign(privateKey);

  assert.equal(
    await verifyFirebaseIdTokenWithJose(badAud, projectId, {
      keyResolver: localJwks,
      nowEpochSeconds: nowSec,
    }),
    null
  );

  // Wrong signing key
  const forged = await new SignJWT({ auth_time: nowSec - 10 })
    .setProtectedHeader({ alg: 'RS256', kid: 'firebase-test-key-1' })
    .setIssuer(`https://securetoken.google.com/${projectId}`)
    .setAudience(projectId)
    .setSubject('uid_1')
    .setIssuedAt(nowSec - 10)
    .setExpirationTime(nowSec + 600)
    .sign(otherKeys.privateKey);

  assert.equal(
    await verifyFirebaseIdTokenWithJose(forged, projectId, {
      keyResolver: localJwks,
      nowEpochSeconds: nowSec,
    }),
    null
  );

  // Future auth_time claim validation
  assert.equal(
    validateFirebaseTokenClaims(
      {
        sub: 'uid_1',
        aud: projectId,
        iss: `https://securetoken.google.com/${projectId}`,
        auth_time: nowSec + 1000,
      },
      projectId,
      nowSec
    ),
    null
  );

  // Malformed token
  assert.equal(
    await verifyFirebaseIdTokenWithJose('not-a-jwt', projectId, {
      keyResolver: localJwks,
    }),
    null
  );
});

test('Server modules contain zero static firebase-admin imports or require("jose") calls', () => {
  const filesToCheck = [
    'lib/firebase-jwt.ts',
    'lib/firebase-admin.ts',
    'app/api/admin/users/route.ts',
    'app/api/admin/users/[uid]/route.ts',
    'app/api/admin/moderation/route.ts',
  ];

  for (const relPath of filesToCheck) {
    const raw = fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    // Static runtime imports like `import { ... } from 'firebase-admin/...'` are forbidden
    // (`import type` is erased at compile time and safe)
    const staticFirebaseAdminImport = /^\s*import\s+(?!type\b)[^;]*['"]firebase-admin\//m;
    assert.equal(
      staticFirebaseAdminImport.test(codeOnly),
      false,
      `${relPath} must not statically import runtime modules from firebase-admin/*`
    );
    assert.equal(
      /\brequire\s*\(\s*['"]jose['"]\s*\)/.test(codeOnly),
      false,
      `${relPath} must not call CommonJS require('jose')`
    );
  }
});
