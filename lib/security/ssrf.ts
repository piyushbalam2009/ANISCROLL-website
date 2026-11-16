import dns from 'node:dns/promises';
import net from 'node:net';

export interface SafeExternalFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedProtocols?: ReadonlySet<string>;
  allowedHosts?: ReadonlySet<string>;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  lookupImpl?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

export class UnsafeExternalUrlError extends Error {
  readonly code:
    | 'INVALID_URL'
    | 'UNSUPPORTED_PROTOCOL'
    | 'CREDENTIALS_FORBIDDEN'
    | 'HOST_NOT_ALLOWED'
    | 'PRIVATE_IP_BLOCKED'
    | 'DNS_RESOLUTION_FAILED'
    | 'TOO_MANY_REDIRECTS'
    | 'RESPONSE_TOO_LARGE'
    | 'UPSTREAM_TIMEOUT';
  readonly httpStatus: number;

  constructor(
    code: UnsafeExternalUrlError['code'],
    message: string,
    httpStatus: number = 403
  ) {
    super(message);
    this.name = 'UnsafeExternalUrlError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
  'instance-data',
  '0.0.0.0',
  '::',
  '::1',
  '[::1]',
  '[::]',
]);

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = ((result << 8) | n) >>> 0;
  }
  return result >>> 0;
}

function inIpv4Cidr(ipUint: number, baseIp: string, prefixBits: number): boolean {
  const baseUint = ipv4ToUint32(baseIp);
  if (baseUint === null) return false;
  const mask = prefixBits === 0 ? 0 : (~0 << (32 - prefixBits)) >>> 0;
  return (ipUint & mask) >>> 0 === (baseUint & mask) >>> 0;
}

/**
 * Checks whether an IPv4 or IPv6 address belongs to any loopback, private,
 * link-local, cloud metadata, carrier-grade NAT, multicast, or reserved range.
 */
export function isPrivateOrReservedIp(rawIp: string): boolean {
  if (!rawIp) return true;
  const cleaned = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0]!.toLowerCase();
  if (!cleaned) return true;

  // Handle IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1 or ::ffff:7f00:1
  if (cleaned.startsWith('::ffff:')) {
    const tail = cleaned.slice('::ffff:'.length);
    if (net.isIPv4(tail)) {
      return isPrivateOrReservedIp(tail);
    }
    const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1]!, 16);
      const lo = parseInt(hexMatch[2]!, 16);
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateOrReservedIp(ipv4);
    }
    return true;
  }

  const family = net.isIP(cleaned);
  if (family === 4) {
    const ipUint = ipv4ToUint32(cleaned);
    if (ipUint === null) return true;

    return (
      inIpv4Cidr(ipUint, '0.0.0.0', 8) || // Current network
      inIpv4Cidr(ipUint, '10.0.0.0', 8) || // RFC1918 private
      inIpv4Cidr(ipUint, '100.64.0.0', 10) || // Carrier-grade NAT
      inIpv4Cidr(ipUint, '127.0.0.0', 8) || // Loopback
      inIpv4Cidr(ipUint, '169.254.0.0', 16) || // Link-local & cloud metadata (169.254.169.254)
      inIpv4Cidr(ipUint, '172.16.0.0', 12) || // RFC1918 private
      inIpv4Cidr(ipUint, '192.0.0.0', 24) || // IETF protocol assignments
      inIpv4Cidr(ipUint, '192.0.2.0', 24) || // TEST-NET-1
      inIpv4Cidr(ipUint, '192.168.0.0', 16) || // RFC1918 private
      inIpv4Cidr(ipUint, '198.18.0.0', 15) || // Benchmarking
      inIpv4Cidr(ipUint, '198.51.100.0', 24) || // TEST-NET-2
      inIpv4Cidr(ipUint, '203.0.113.0', 24) || // TEST-NET-3
      inIpv4Cidr(ipUint, '224.0.0.0', 4) || // Multicast
      inIpv4Cidr(ipUint, '240.0.0.0', 4) // Reserved / broadcast
    );
  }

  if (family === 6) {
    if (cleaned === '::' || cleaned === '::1') return true;
    // fc00::/7 Unique local addresses (fc.. or fd..)
    if (/^f[cd][0-9a-f]{2}:/i.test(cleaned)) return true;
    // fe80::/10 Link-local addresses (fe8.. - feb..)
    if (/^fe[89ab][0-9a-f]:/i.test(cleaned)) return true;
    // ff00::/8 Multicast
    if (cleaned.startsWith('ff')) return true;
    // 2001:db8::/32 Documentation
    if (cleaned.startsWith('2001:db8:') || cleaned.startsWith('2001:0db8:')) return true;
    return false;
  }

  return true;
}

async function defaultDnsLookup(
  hostname: string
): Promise<Array<{ address: string; family: number }>> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return Array.isArray(records) ? records : [records];
}

/**
 * Validates an external URL against SSRF, private IPs, localhost, cloud metadata,
 * embedded credentials, non-HTTP(S) protocols, and DNS-rebinding to private IPs.
 */
export async function validateSafeExternalUrl(
  rawUrl: string,
  options?: {
    allowedProtocols?: ReadonlySet<string>;
    allowedHosts?: ReadonlySet<string>;
    lookupImpl?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  }
): Promise<URL> {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim().length === 0 || rawUrl.length > 4096) {
    throw new UnsafeExternalUrlError('INVALID_URL', 'Missing or invalid URL', 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new UnsafeExternalUrlError('INVALID_URL', 'Malformed URL', 400);
  }

  const allowedProtocols = options?.allowedProtocols ?? new Set(['http:', 'https:']);
  if (!allowedProtocols.has(parsed.protocol)) {
    throw new UnsafeExternalUrlError(
      'UNSUPPORTED_PROTOCOL',
      `Unsupported URL protocol: ${parsed.protocol}`,
      400
    );
  }

  if (parsed.username || parsed.password) {
    throw new UnsafeExternalUrlError(
      'CREDENTIALS_FORBIDDEN',
      'URLs with embedded credentials are not allowed',
      400
    );
  }

  const hostname = parsed.hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new UnsafeExternalUrlError(
      'PRIVATE_IP_BLOCKED',
      'Access to local or internal hostnames is forbidden',
      403
    );
  }

  // Reject numeric/octal/hex IP encodings like http://2130706433 or http://0x7f.0.0.1
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(hostname)) {
    throw new UnsafeExternalUrlError(
      'PRIVATE_IP_BLOCKED',
      'Ambiguous numeric host encoding is forbidden',
      403
    );
  }

  if (options?.allowedHosts && !options.allowedHosts.has(hostname)) {
    throw new UnsafeExternalUrlError(
      'HOST_NOT_ALLOWED',
      `Host "${hostname}" is not in the allowed proxy list`,
      403
    );
  }

  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new UnsafeExternalUrlError(
        'PRIVATE_IP_BLOCKED',
        'Access to private, loopback, or reserved IP addresses is forbidden',
        403
      );
    }
    return parsed;
  }

  const lookupFn = options?.lookupImpl ?? defaultDnsLookup;
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookupFn(hostname);
  } catch {
    throw new UnsafeExternalUrlError(
      'DNS_RESOLUTION_FAILED',
      `Unable to resolve host: ${hostname}`,
      502
    );
  }

  if (!records || records.length === 0) {
    throw new UnsafeExternalUrlError(
      'DNS_RESOLUTION_FAILED',
      `No DNS records found for host: ${hostname}`,
      502
    );
  }

  for (const record of records) {
    if (!record?.address || isPrivateOrReservedIp(record.address)) {
      throw new UnsafeExternalUrlError(
        'PRIVATE_IP_BLOCKED',
        'Resolved IP address belongs to a private or reserved range',
        403
      );
    }
  }

  return parsed;
}

/**
 * Safely fetches an external resource with redirect validation at every hop,
 * strict timeout, and bounded response body byte limit.
 */
export async function fetchSafeExternalText(
  rawUrl: string,
  options: SafeExternalFetchOptions = {}
): Promise<{ status: number; text: string; contentType: string }> {
  const timeoutMs = options.timeoutMs ?? 6000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024; // 5 MB max for subtitle files
  const maxRedirects = options.maxRedirects ?? 3;
  const fetchFn = options.fetchImpl ?? fetch;

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validatedUrl = await validateSafeExternalUrl(currentUrl, {
      allowedProtocols: options.allowedProtocols,
      allowedHosts: options.allowedHosts,
      lookupImpl: options.lookupImpl,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchFn(validatedUrl.toString(), {
        method: 'GET',
        headers: options.headers,
        redirect: 'manual',
        signal: controller.signal,
        cache: 'no-store',
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          throw new UnsafeExternalUrlError(
            'INVALID_URL',
            `Upstream redirect (${res.status}) missing Location header`,
            502
          );
        }
        if (hop === maxRedirects) {
          throw new UnsafeExternalUrlError(
            'TOO_MANY_REDIRECTS',
            'Exceeded maximum allowed redirects',
            502
          );
        }
        currentUrl = new URL(location, validatedUrl).toString();
        continue;
      }

      const contentLengthHeader = res.headers.get('content-length');
      if (contentLengthHeader) {
        const declaredBytes = Number(contentLengthHeader);
        if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
          throw new UnsafeExternalUrlError(
            'RESPONSE_TOO_LARGE',
            `Remote resource exceeds maximum size of ${maxBytes} bytes`,
            413
          );
        }
      }

      if (!res.ok) {
        return {
          status: res.status,
          text: '',
          contentType: res.headers.get('content-type') || 'text/plain',
        };
      }

      if (!res.body) {
        const text = await res.text();
        if (Buffer.byteLength(text, 'utf8') > maxBytes) {
          throw new UnsafeExternalUrlError(
            'RESPONSE_TOO_LARGE',
            `Remote resource exceeds maximum size of ${maxBytes} bytes`,
            413
          );
        }
        return {
          status: res.status,
          text,
          contentType: res.headers.get('content-type') || 'text/vtt; charset=utf-8',
        };
      }

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new UnsafeExternalUrlError(
              'RESPONSE_TOO_LARGE',
              `Remote resource exceeds maximum size of ${maxBytes} bytes`,
              413
            );
          }
          chunks.push(value);
        }
      }

      const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      return {
        status: res.status,
        text: buffer.toString('utf8'),
        contentType: res.headers.get('content-type') || 'text/vtt; charset=utf-8',
      };
    } catch (err: any) {
      if (err instanceof UnsafeExternalUrlError) {
        throw err;
      }
      if (
        err?.name === 'AbortError' ||
        err?.name === 'TimeoutError' ||
        /abort|timed?\s*out/i.test(String(err?.message || ''))
      ) {
        throw new UnsafeExternalUrlError(
          'UPSTREAM_TIMEOUT',
          `Remote subtitle fetch timed out after ${timeoutMs}ms`,
          504
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new UnsafeExternalUrlError(
    'TOO_MANY_REDIRECTS',
    'Exceeded maximum allowed redirects',
    502
  );
}
