import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateOrReservedIp,
  validateSafeExternalUrl,
  fetchSafeExternalText,
  UnsafeExternalUrlError,
} from './security/ssrf';
import {
  redactSensitiveText,
  sanitizeDiagnosticPayload,
} from './admin/redaction';

describe('SSRF & External Proxy URL Hardening', () => {
  it('identifies private, loopback, link-local, metadata, and reserved IPv4/IPv6 addresses', () => {
    // Private & loopback IPv4
    assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
    assert.equal(isPrivateOrReservedIp('127.255.255.255'), true);
    assert.equal(isPrivateOrReservedIp('10.0.0.1'), true);
    assert.equal(isPrivateOrReservedIp('10.255.255.254'), true);
    assert.equal(isPrivateOrReservedIp('172.16.0.1'), true);
    assert.equal(isPrivateOrReservedIp('172.31.255.1'), true);
    assert.equal(isPrivateOrReservedIp('192.168.1.100'), true);
    assert.equal(isPrivateOrReservedIp('169.254.169.254'), true); // Cloud metadata
    assert.equal(isPrivateOrReservedIp('100.64.0.1'), true); // CGNAT
    assert.equal(isPrivateOrReservedIp('0.0.0.0'), true);

    // Private & loopback IPv6
    assert.equal(isPrivateOrReservedIp('::1'), true);
    assert.equal(isPrivateOrReservedIp('::'), true);
    assert.equal(isPrivateOrReservedIp('fc00::1'), true);
    assert.equal(isPrivateOrReservedIp('fd12:3456:789a::1'), true);
    assert.equal(isPrivateOrReservedIp('fe80::1'), true);
    assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateOrReservedIp('::ffff:169.254.169.254'), true);

    // Public IPv4/IPv6 should be allowed
    assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
    assert.equal(isPrivateOrReservedIp('1.1.1.1'), false);
    assert.equal(isPrivateOrReservedIp('172.32.0.1'), false);
    assert.equal(isPrivateOrReservedIp('2606:4700:4700::1111'), false);
  });

  it('rejects non-HTTP(S) protocols, embedded credentials, localhost, and private IP literals', async () => {
    const blockedUrls = [
      'file:///etc/passwd',
      'ftp://example.com/sub.vtt',
      'javascript:alert(1)',
      'http://localhost:3000/api/health',
      'http://sub.localhost/test.vtt',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://127.0.0.1:8080/sub.vtt',
      'http://169.254.169.254/latest/meta-data/',
      'https://admin:secret@cdn.example.com/sub.vtt',
      'http://[::1]/sub.vtt',
    ];

    for (const raw of blockedUrls) {
      await assert.rejects(
        () => validateSafeExternalUrl(raw),
        (err: unknown) => err instanceof UnsafeExternalUrlError,
        `Expected ${raw} to be rejected as UnsafeExternalUrlError`
      );
    }
  });

  it('rejects hostnames that resolve via DNS to private or loopback IPs', async () => {
    await assert.rejects(
      () =>
        validateSafeExternalUrl('https://evil-rebind.example.com/sub.vtt', {
          lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
        }),
      (err: unknown) =>
        err instanceof UnsafeExternalUrlError && err.code === 'PRIVATE_IP_BLOCKED'
    );
  });

  it('accepts valid public HTTPS URLs when DNS resolves to public IPs', async () => {
    const validated = await validateSafeExternalUrl(
      'https://subs.cdn-example.com/anime/ep1.vtt',
      {
        lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
      }
    );
    assert.equal(validated.hostname, 'subs.cdn-example.com');
    assert.equal(validated.protocol, 'https:');
  });

  it('blocks redirect hops that point to internal/private addresses', async () => {
    const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
    const mockFetch: typeof fetch = async () =>
      new Response(null, {
        status: 302,
        headers: {
          location: 'http://169.254.169.254/latest/meta-data/iam',
        },
      });

    await assert.rejects(
      () =>
        fetchSafeExternalText('https://subs.cdn-example.com/redirect.vtt', {
          lookupImpl: publicLookup,
          fetchImpl: mockFetch,
        }),
      (err: unknown) => err instanceof UnsafeExternalUrlError
    );
  });

  it('enforces max response size limit on subtitle fetches', async () => {
    const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
    const hugeText = 'WEBVTT\n\n' + 'A'.repeat(2048);
    const mockFetch: typeof fetch = async () =>
      new Response(hugeText, {
        status: 200,
        headers: { 'content-type': 'text/vtt' },
      });

    await assert.rejects(
      () =>
        fetchSafeExternalText('https://subs.cdn-example.com/large.vtt', {
          lookupImpl: publicLookup,
          fetchImpl: mockFetch,
          maxBytes: 512,
        }),
      /exceeds maximum size/i
    );
  });

  it('redacts sensitive tokens, Bearer headers, and API keys from logs and diagnostics', () => {
    const raw =
      'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.secret.payload secret=my_discord_secret';
    const redacted = redactSensitiveText(raw);
    assert.equal(redacted.includes('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9'), false);
    assert.equal(redacted.includes('my_discord_secret'), false);

    const payload = sanitizeDiagnosticPayload({
      token: 'MTIzNDU2Nzg5.abcdef.ghijkl',
      nested: {
        authorization: 'Bearer super-secret-jwt-token-value',
        safeField: 'megaplay',
      },
    }) as Record<string, any>;
    assert.equal(payload.token, '[REDACTED]');
    assert.equal(payload.nested.authorization, '[REDACTED]');
    assert.equal(payload.nested.safeField, 'megaplay');
  });
});
