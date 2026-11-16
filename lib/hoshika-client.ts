import { appCache } from './cache';
import {
  recordUpstreamMetric,
  UpstreamErrorCode,
} from './perf-monitor';
import { redactSensitiveText } from './admin/redaction';

export type HoshikaErrorCategory =
  | 'DNS_ERROR'
  | 'CONNECTION_ERROR'
  | 'TLS_ERROR'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'CLOUDFLARE_BLOCKED'
  | 'HTTP_ERROR'
  | 'INVALID_JSON'
  | 'INVALID_RESPONSE'
  | 'NOT_FOUND'
  | 'UPSTREAM_UNAVAILABLE';

export interface HoshikaErrorDetails {
  category: HoshikaErrorCategory;
  status: number | null;
  endpoint: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  durationMs: number;
  ipFamily?: 'auto' | 'ipv4';
  causeCode?: string;
}

export class HoshikaUpstreamError extends Error {
  readonly category: HoshikaErrorCategory;
  readonly status: number | null;
  readonly endpoint: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly durationMs: number;
  readonly ipFamily?: 'auto' | 'ipv4';
  readonly causeCode?: string;

  constructor(details: HoshikaErrorDetails) {
    super(details.message);
    this.name = 'HoshikaUpstreamError';
    this.category = details.category;
    this.status = details.status;
    this.endpoint = details.endpoint;
    this.retryable = details.retryable;
    this.retryAfterMs = details.retryAfterMs;
    this.durationMs = details.durationMs;
    this.ipFamily = details.ipFamily;
    this.causeCode = details.causeCode;
  }
}

export type HoshikaResult<T> =
  | {
      ok: true;
      data: T;
      fromCache: boolean;
      stale?: boolean;
      ipFamily?: 'auto' | 'ipv4';
    }
  | {
      ok: false;
      error: HoshikaErrorDetails;
      fromCache: false;
    };

export interface HoshikaRawResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  ipFamily: 'auto' | 'ipv4';
}

export interface HoshikaTransportHooks {
  fetchImpl?: typeof fetch;
  ipv4TransportImpl?: (params: {
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
  }) => Promise<HoshikaRawResponse>;
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface HoshikaRequestOptions<T> {
  endpoint: string;
  cacheKey?: string;
  cacheTtlSeconds?: number;
  staleWhileRevalidateSeconds?: number;
  forceRefresh?: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  shouldCache?: (value: T) => boolean;
  validator?: (raw: unknown) => string | null;
  mapper?: (raw: unknown) => T;
  transport?: HoshikaTransportHooks;
}

const DEFAULT_HOSHIKA_ORIGIN = 'https://hoshika.app';
const DEFAULT_TIMEOUT_MS = 6500;
const IPV4_PREFER_TTL_MS = 5 * 60 * 1000;

let preferIpv4UntilMs = 0;

export function resetHoshikaTransportState(): void {
  preferIpv4UntilMs = 0;
}

/**
 * Resolves and normalizes the configurable Hoshika API origin.
 * Strips accidental `/api/v1` suffixes or trailing slashes so all paths compose cleanly.
 */
export function resolveHoshikaOrigin(): string {
  const raw =
    (typeof process !== 'undefined' && process.env.HOSHIKA_API_ORIGIN) ||
    DEFAULT_HOSHIKA_ORIGIN;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_HOSHIKA_ORIGIN;
  return trimmed.replace(/\/api\/v1$/i, '');
}

export function resolveHoshikaApiBase(): string {
  return `${resolveHoshikaOrigin()}/api/v1`;
}

export function getHoshikaTimeoutMs(override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.min(30_000, Math.max(500, Math.floor(override)));
  }
  const envVal =
    typeof process !== 'undefined' ? Number(process.env.HOSHIKA_TIMEOUT_MS) : NaN;
  if (Number.isFinite(envVal) && envVal >= 500) {
    return Math.min(30_000, Math.floor(envVal));
  }
  return DEFAULT_TIMEOUT_MS;
}

export function shouldForceIpv4(): boolean {
  if (typeof process === 'undefined') return false;
  const flag = (process.env.HOSHIKA_FORCE_IPV4 || '').trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  return Date.now() < preferIpv4UntilMs;
}

/**
 * Verified live Hoshika v1 API routes.
 */
export const HOSHIKA_ENDPOINTS = {
  animeDetail: (shortId: string | number, locale: string = 'en') =>
    `/anime/${encodeURIComponent(String(shortId).trim())}?locale=${encodeURIComponent(locale)}`,
  animeEpisodes: (
    shortId: string | number,
    options: { locale?: string; limit?: number; after?: number } = {}
  ) => {
    const locale = options.locale || 'en';
    const limit = Math.min(50, Math.max(1, Math.floor(Number(options.limit) || 50)));
    const params = new URLSearchParams({ locale, limit: String(limit) });
    if (options.after !== undefined && options.after > 0) {
      params.append('after', String(Math.floor(options.after)));
    }
    return `/anime/${encodeURIComponent(String(shortId).trim())}/episodes?${params.toString()}`;
  },
  home: (locale: string = 'en') => `/home?locale=${encodeURIComponent(locale)}`,
  browse: (params: {
    sort?: 'trending' | 'top' | 'recent';
    type?: string;
    locale?: string;
  }) => {
    const qs = new URLSearchParams({
      type: params.type || 'anime',
      sort: params.sort || 'trending',
    });
    if (params.locale) qs.append('locale', params.locale);
    return `/browse?${qs.toString()}`;
  },
  catalog: (params: URLSearchParams) => `/catalog?${params.toString()}`,
  search: (params: URLSearchParams) => `/search?${params.toString()}`,
  genres: () => '/genres',
  genreTitles: (slug: string, locale: string = 'en') =>
    `/genre/${encodeURIComponent(slug)}?type=anime&locale=${encodeURIComponent(locale)}`,
  schedule: (locale: string = 'en') => `/schedule?locale=${encodeURIComponent(locale)}`,
} as const;

export function isHoshikaUpstreamError(err: unknown): err is HoshikaUpstreamError {
  return (
    err instanceof HoshikaUpstreamError ||
    (Boolean(err) &&
      typeof err === 'object' &&
      (err as any).name === 'HoshikaUpstreamError' &&
      typeof (err as any).category === 'string')
  );
}

export function isHoshikaNotFoundError(err: unknown): boolean {
  if (isHoshikaUpstreamError(err)) {
    return err.category === 'NOT_FOUND';
  }
  return false;
}

export function hoshikaErrorToHttpStatus(
  category: HoshikaErrorCategory,
  upstreamStatus?: number | null
): number {
  switch (category) {
    case 'NOT_FOUND':
      return 404;
    case 'RATE_LIMITED':
      return 429;
    case 'TIMEOUT':
      return 504;
    case 'CLOUDFLARE_BLOCKED':
    case 'UPSTREAM_UNAVAILABLE':
      return 503;
    case 'DNS_ERROR':
    case 'CONNECTION_ERROR':
    case 'TLS_ERROR':
    case 'INVALID_JSON':
    case 'INVALID_RESPONSE':
      return 502;
    case 'HTTP_ERROR':
      if (upstreamStatus === 400) return 400;
      if (upstreamStatus && upstreamStatus >= 500) return 502;
      return 502;
    default:
      return 502;
  }
}

export function toPerfUpstreamErrorCode(
  category: HoshikaErrorCategory
): UpstreamErrorCode {
  switch (category) {
    case 'TIMEOUT':
      return 'timeout';
    case 'RATE_LIMITED':
      return 'rate_limit';
    case 'NOT_FOUND':
      return 'not_found';
    case 'INVALID_JSON':
      return 'invalid_json';
    case 'INVALID_RESPONSE':
      return 'parse_error';
    case 'DNS_ERROR':
    case 'CONNECTION_ERROR':
    case 'TLS_ERROR':
      return 'network_error';
    case 'CLOUDFLARE_BLOCKED':
    case 'UPSTREAM_UNAVAILABLE':
      return 'server_error';
    case 'HTTP_ERROR':
      return 'bad_request';
    default:
      return 'unknown_error';
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headersToLowerMap(headers: Headers | Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof (headers as Headers).forEach === 'function') {
    (headers as Headers).forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      out[key.toLowerCase()] = value.join(', ');
    } else if (typeof value === 'string') {
      out[key.toLowerCase()] = value;
    }
  }
  return out;
}

function parseRetryAfterMs(retryAfterHeader?: string): number | undefined {
  if (!retryAfterHeader) return undefined;
  const trimmed = retryAfterHeader.trim();
  if (!trimmed) return undefined;
  const numericSeconds = Number(trimmed);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.min(60_000, Math.round(numericSeconds * 1000));
  }
  const targetDateMs = Date.parse(trimmed);
  if (Number.isFinite(targetDateMs)) {
    const diff = targetDateMs - Date.now();
    if (diff > 0) return Math.min(60_000, diff);
  }
  return undefined;
}

function extractNodeErrorCode(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const obj = err as Record<string, any>;
  if (typeof obj.code === 'string' && obj.code) return obj.code;
  if (obj.cause && typeof obj.cause === 'object' && typeof obj.cause.code === 'string') {
    return obj.cause.code;
  }
  return '';
}

function extractErrorMessage(err: unknown): string {
  if (!err) return 'Unknown network error';
  if (err instanceof Error) {
    const causeMsg =
      (err as any).cause && typeof (err as any).cause.message === 'string'
        ? ` (${(err as any).cause.message})`
        : '';
    return redactSensitiveText(`${err.message}${causeMsg}`, 220);
  }
  return redactSensitiveText(String(err), 220);
}

/**
 * Classifies thrown network/TLS/DNS/timeout errors cleanly without ever
 * leaking secrets or collapsing transport failures into 404.
 */
export function classifyThrownHoshikaError(
  err: unknown,
  endpoint: string,
  durationMs: number,
  ipFamily: 'auto' | 'ipv4'
): HoshikaErrorDetails {
  const safeEndpoint = redactSensitiveText(endpoint, 240);
  if (isHoshikaUpstreamError(err)) {
    return {
      category: err.category,
      status: err.status,
      endpoint: safeEndpoint,
      message: err.message,
      retryable: err.retryable,
      retryAfterMs: err.retryAfterMs,
      durationMs,
      ipFamily: err.ipFamily || ipFamily,
      causeCode: err.causeCode,
    };
  }

  const code = extractNodeErrorCode(err).toUpperCase();
  const msg = extractErrorMessage(err);
  const name = err && typeof err === 'object' ? String((err as any).name || '') : '';

  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    /abort|timed?\s*out/i.test(msg)
  ) {
    return {
      category: 'TIMEOUT',
      status: null,
      endpoint: safeEndpoint,
      message: `Hoshika request timed out after ${durationMs}ms (${code || 'TIMEOUT'})`,
      retryable: true,
      durationMs,
      ipFamily,
      causeCode: code || 'TIMEOUT',
    };
  }

  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ENODATA' ||
    code === 'ERR_DNS_FAILURE' ||
    /getaddrinfo|dns|resolve/i.test(msg)
  ) {
    return {
      category: 'DNS_ERROR',
      status: null,
      endpoint: safeEndpoint,
      message: `Hoshika DNS resolution failed (${code || msg})`,
      retryable: code === 'EAI_AGAIN',
      durationMs,
      ipFamily,
      causeCode: code || 'DNS_ERROR',
    };
  }

  if (
    code.startsWith('ERR_TLS') ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
    code === 'ALPN_NEGOTIATION_FAILED' ||
    /certificate|tls|ssl|handshake|cert/i.test(msg)
  ) {
    return {
      category: 'TLS_ERROR',
      status: null,
      endpoint: safeEndpoint,
      message: `Hoshika TLS verification/handshake failed (${code || msg})`,
      retryable: false,
      durationMs,
      ipFamily,
      causeCode: code || 'TLS_ERROR',
    };
  }

  return {
    category: 'CONNECTION_ERROR',
    status: null,
    endpoint: safeEndpoint,
    message: `Hoshika network connection error (${code || msg})`,
    retryable: true,
    durationMs,
    ipFamily,
    causeCode: code || 'CONNECTION_ERROR',
  };
}

function isCloudflareOrHtmlBlock(
  status: number,
  headers: Record<string, string>,
  bodyText: string
): { isCloudflare: boolean; isHtml: boolean } {
  const cfMitigated = (headers['cf-mitigated'] || '').toLowerCase();
  const contentType = (headers['content-type'] || '').toLowerCase();
  const lowerBody = bodyText.slice(0, 4096).toLowerCase();

  const looksLikeHtml =
    contentType.includes('text/html') ||
    /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(bodyText);

  const hasCloudflareMarkers =
    cfMitigated.includes('challenge') ||
    lowerBody.includes('just a moment...') ||
    lowerBody.includes('cf-browser-verification') ||
    lowerBody.includes('attention required! | cloudflare') ||
    lowerBody.includes('enable javascript and cookies to continue') ||
    lowerBody.includes('/cdn-cgi/challenge-platform');

  const isCloudflare =
    hasCloudflareMarkers ||
    ((status === 403 || status === 503 || status === 429) &&
      looksLikeHtml &&
      Boolean(headers['cf-ray'] || (headers['server'] || '').toLowerCase().includes('cloudflare')));

  return {
    isCloudflare,
    isHtml: looksLikeHtml,
  };
}

function isAllowedApiRedirect(locationHeader: string, baseOrigin: string): string | null {
  try {
    const targetUrl = new URL(locationHeader, baseOrigin);
    if (targetUrl.origin !== new URL(baseOrigin).origin) {
      return null;
    }
    if (!targetUrl.pathname.startsWith('/api/v1/')) {
      return null;
    }
    return targetUrl.toString();
  } catch {
    return null;
  }
}

/**
 * Safe IPv4-only HTTPS fallback transport using `node:https` with `family: 4`.
 * Strictly enforces standard TLS certificate verification (`rejectUnauthorized: true`).
 */
export async function executeNodeHttpsIpv4(params: {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}): Promise<HoshikaRawResponse> {
  if (typeof window !== 'undefined') {
    throw new Error('IPv4 Node transport is only available in server runtimes');
  }

  const httpsMod = await import(/* webpackIgnore: true */ 'node:https');
  const https = ((httpsMod as any).default || httpsMod) as typeof httpsMod;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finishReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const finishResolve = (res: HoshikaRawResponse) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };

    const req = https.request(
      params.url,
      {
        method: 'GET',
        family: 4,
        rejectUnauthorized: true,
        headers: params.headers,
        timeout: params.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on('end', () => {
          finishResolve({
            status: res.statusCode ?? 0,
            headers: headersToLowerMap(res.headers as any),
            bodyText: Buffer.concat(chunks).toString('utf8'),
            ipFamily: 'ipv4',
          });
        });
        res.on('error', finishReject);
      }
    );

    req.on('timeout', () => {
      const timeoutErr = new Error(`IPv4 request timed out after ${params.timeoutMs}ms`);
      timeoutErr.name = 'TimeoutError';
      req.destroy(timeoutErr);
    });
    req.on('error', finishReject);
    req.end();
  });
}

async function performSingleAttempt(params: {
  url: string;
  endpoint: string;
  origin: string;
  timeoutMs: number;
  forceIpv4Now: boolean;
  hooks?: HoshikaTransportHooks;
}): Promise<HoshikaRawResponse> {
  const fetchFn = params.hooks?.fetchImpl || fetch;
  const ipv4Fn = params.hooks?.ipv4TransportImpl || executeNodeHttpsIpv4;
  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'AniScroll/1.0',
  };

  let currentUrl = params.url;
  const maxRedirects = 2;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const start = Date.now();
    let raw: HoshikaRawResponse;

    if (params.forceIpv4Now) {
      raw = await ipv4Fn({
        url: currentUrl,
        headers: requestHeaders,
        timeoutMs: params.timeoutMs,
      });
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), params.timeoutMs);
      try {
        const res = await fetchFn(currentUrl, {
          method: 'GET',
          headers: requestHeaders,
          signal: controller.signal,
          redirect: 'manual',
          cache: 'no-store',
        });
        const headers = headersToLowerMap(res.headers);
        const isRedirect = res.status >= 300 && res.status < 400;
        const bodyText = isRedirect ? '' : await res.text();
        raw = {
          status: res.status,
          headers,
          bodyText,
          ipFamily: 'auto',
        };
      } catch (primaryErr) {
        clearTimeout(timer);
        const classified = classifyThrownHoshikaError(
          primaryErr,
          params.endpoint,
          Date.now() - start,
          'auto'
        );

        // Safe automatic IPv4 fallback when VPS IPv6/network path fails or times out
        if (
          classified.category === 'CONNECTION_ERROR' ||
          classified.category === 'TIMEOUT'
        ) {
          try {
            const ipv4Res = await ipv4Fn({
              url: currentUrl,
              headers: requestHeaders,
              timeoutMs: params.timeoutMs,
            });
            // Sticky IPv4 preference for 5m on this node instance if IPv4 succeeds after IPv6/auto failure
            if (!params.hooks?.ipv4TransportImpl) {
              preferIpv4UntilMs = Date.now() + IPV4_PREFER_TTL_MS;
            }
            raw = ipv4Res;
          } catch (ipv4Err) {
            throw ipv4Err;
          }
        } else {
          throw primaryErr;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    if (raw.status >= 300 && raw.status < 400) {
      const location = raw.headers['location'] || '';
      const nextApiUrl = location
        ? isAllowedApiRedirect(location, params.origin)
        : null;
      if (!nextApiUrl) {
        throw new HoshikaUpstreamError({
          category: 'INVALID_RESPONSE',
          status: raw.status,
          endpoint: params.endpoint,
          message: `Hoshika returned HTTP ${raw.status} redirect to non-API location`,
          retryable: false,
          durationMs: Date.now() - start,
          ipFamily: raw.ipFamily,
        });
      }
      if (hop === maxRedirects) {
        throw new HoshikaUpstreamError({
          category: 'INVALID_RESPONSE',
          status: raw.status,
          endpoint: params.endpoint,
          message: `Hoshika exceeded maximum API redirects`,
          retryable: false,
          durationMs: Date.now() - start,
          ipFamily: raw.ipFamily,
        });
      }
      currentUrl = nextApiUrl;
      continue;
    }

    return raw;
  }

  throw new HoshikaUpstreamError({
    category: 'INVALID_RESPONSE',
    status: null,
    endpoint: params.endpoint,
    message: 'Unreachable redirect state',
    retryable: false,
    durationMs: 0,
    ipFamily: 'auto',
  });
}

function logDiagnosticEvent(error: HoshikaErrorDetails): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    return;
  }
  console.warn(
    `[AniScroll][Hoshika][${error.category}] endpoint="${error.endpoint}" status=${
      error.status ?? 'none'
    } ip=${error.ipFamily || 'auto'} retryable=${error.retryable} duration=${Math.round(
      error.durationMs
    )}ms message="${redactSensitiveText(error.message, 220)}"`
  );
}

/**
 * Executes a strict, validated Hoshika v1 JSON request with retry/backoff,
 * Cloudflare/HTML detection, IPv4 fallback, and structured error classification.
 */
export async function executeHoshikaRequest<T = any>(
  options: HoshikaRequestOptions<T>
): Promise<HoshikaResult<T>> {
  const endpoint = options.endpoint.startsWith('/')
    ? options.endpoint
    : `/${options.endpoint}`;
  const safeEndpoint = redactSensitiveText(endpoint, 240);
  const origin = resolveHoshikaOrigin();
  const fullUrl = `${origin}/api/v1${endpoint}`;
  const timeoutMs = getHoshikaTimeoutMs(options.timeoutMs);
  const maxAttempts = Math.max(1, Math.min(3, options.maxAttempts ?? 3));
  const sleep = options.transport?.sleepImpl || defaultSleep;

  let lastError: HoshikaErrorDetails = {
    category: 'UPSTREAM_UNAVAILABLE',
    status: null,
    endpoint: safeEndpoint,
    message: 'Hoshika request failed',
    retryable: true,
    durationMs: 0,
    ipFamily: 'auto',
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startTime = Date.now();
    try {
      const raw = await performSingleAttempt({
        url: fullUrl,
        endpoint: safeEndpoint,
        origin,
        timeoutMs,
        forceIpv4Now: shouldForceIpv4(),
        hooks: options.transport,
      });

      const durationMs = Date.now() - startTime;
      const cfOrHtml = isCloudflareOrHtmlBlock(raw.status, raw.headers, raw.bodyText);

      if (cfOrHtml.isCloudflare) {
        lastError = {
          category: 'CLOUDFLARE_BLOCKED',
          status: raw.status || 403,
          endpoint: safeEndpoint,
          message: `Hoshika request blocked by Cloudflare challenge (HTTP ${raw.status})`,
          retryable: false,
          durationMs,
          ipFamily: raw.ipFamily,
        };
        recordUpstreamMetric({
          provider: 'hoshika',
          endpoint: safeEndpoint,
          durationMs,
          status: raw.status,
          fromCache: false,
          errorCode: toPerfUpstreamErrorCode(lastError.category),
        });
        logDiagnosticEvent(lastError);
        return { ok: false, error: lastError, fromCache: false };
      }

      if (raw.status === 429) {
        const retryAfterMs = parseRetryAfterMs(raw.headers['retry-after']) ?? 1500;
        lastError = {
          category: 'RATE_LIMITED',
          status: 429,
          endpoint: safeEndpoint,
          message: `Hoshika rate limited request (HTTP 429)`,
          retryable: true,
          retryAfterMs,
          durationMs,
          ipFamily: raw.ipFamily,
        };
        recordUpstreamMetric({
          provider: 'hoshika',
          endpoint: safeEndpoint,
          durationMs,
          status: 429,
          fromCache: false,
          errorCode: 'rate_limit',
        });
        logDiagnosticEvent(lastError);

        if (attempt < maxAttempts) {
          const boundedWait = Math.min(2500, Math.max(250, retryAfterMs));
          await sleep(boundedWait);
          continue;
        }
        return { ok: false, error: lastError, fromCache: false };
      }

      if (raw.status === 404) {
        lastError = {
          category: 'NOT_FOUND',
          status: 404,
          endpoint: safeEndpoint,
          message: `Hoshika resource not found (HTTP 404)`,
          retryable: false,
          durationMs,
          ipFamily: raw.ipFamily,
        };
        recordUpstreamMetric({
          provider: 'hoshika',
          endpoint: safeEndpoint,
          durationMs,
          status: 404,
          fromCache: false,
          errorCode: 'not_found',
        });
        return { ok: false, error: lastError, fromCache: false };
      }

      if (raw.status >= 500) {
        const isGatewayOrUnavailable =
          raw.status === 502 || raw.status === 503 || raw.status === 504;
        lastError = {
          category: isGatewayOrUnavailable ? 'UPSTREAM_UNAVAILABLE' : 'HTTP_ERROR',
          status: raw.status,
          endpoint: safeEndpoint,
          message: `Hoshika upstream server error (HTTP ${raw.status})`,
          retryable: true,
          durationMs,
          ipFamily: raw.ipFamily,
        };
        recordUpstreamMetric({
          provider: 'hoshika',
          endpoint: safeEndpoint,
          durationMs,
          status: raw.status,
          fromCache: false,
          errorCode: 'server_error',
        });
        logDiagnosticEvent(lastError);

        if (attempt < maxAttempts) {
          const backoff = attempt === 1 ? 250 : 650;
          const jitter = Math.floor(Math.random() * 150);
          await sleep(backoff + jitter);
          continue;
        }
        return { ok: false, error: lastError, fromCache: false };
      }

      if (raw.status < 200 || raw.status >= 400) {
        lastError = {
          category: 'HTTP_ERROR',
          status: raw.status,
          endpoint: safeEndpoint,
          message: `Hoshika rejected request with HTTP ${raw.status}`,
          retryable: false,
          durationMs,
          ipFamily: raw.ipFamily,
        };
        recordUpstreamMetric({
          provider: 'hoshika',
          endpoint: safeEndpoint,
          durationMs,
          status: raw.status,
          fromCache: false,
          errorCode: 'bad_request',
        });
        logDiagnosticEvent(lastError);
        return { ok: false, error: lastError, fromCache: false };
      }

      // Guard against HTTP 200 HTML error/landing pages or non-JSON content types
      const contentType = (raw.headers['content-type'] || '').toLowerCase();
      if (
        cfOrHtml.isHtml ||
        (contentType !== '' && !contentType.includes('application/json') && !contentType.includes('+json'))
      ) {
        lastError = {
          category: 'INVALID_RESPONSE',
          status: raw.status,
          endpoint: safeEndpoint,
          message: `Hoshika returned non-JSON content-type (${contentType || 'html'})`,
          retryable: false,
          durationMs,
          ipFamily: raw.ipFamily,
        };
        recordUpstreamMetric({
          provider: 'hoshika',
          endpoint: safeEndpoint,
          durationMs,
          status: raw.status,
          fromCache: false,
          errorCode: 'invalid_json',
        });
        logDiagnosticEvent(lastError);
        return { ok: false, error: lastError, fromCache: false };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.bodyText);
      } catch {
        lastError = {
          category: 'INVALID_JSON',
          status: raw.status,
          endpoint: safeEndpoint,
          message: 'Hoshika returned malformed JSON body',
          retryable: false,
          durationMs,
          ipFamily: raw.ipFamily,
        };
        recordUpstreamMetric({
          provider: 'hoshika',
          endpoint: safeEndpoint,
          durationMs,
          status: raw.status,
          fromCache: false,
          errorCode: 'invalid_json',
        });
        logDiagnosticEvent(lastError);
        return { ok: false, error: lastError, fromCache: false };
      }

      if (!parsed || typeof parsed !== 'object') {
        lastError = {
          category: 'INVALID_RESPONSE',
          status: raw.status,
          endpoint: safeEndpoint,
          message: 'Hoshika response JSON is not an object',
          retryable: false,
          durationMs,
          ipFamily: raw.ipFamily,
        };
        recordUpstreamMetric({
          provider: 'hoshika',
          endpoint: safeEndpoint,
          durationMs,
          status: raw.status,
          fromCache: false,
          errorCode: 'parse_error',
        });
        logDiagnosticEvent(lastError);
        return { ok: false, error: lastError, fromCache: false };
      }

      if ((parsed as any).ok === false) {
        const apiCode = String((parsed as any).code || '').toLowerCase();
        const isNotFound = apiCode === 'not_found';
        lastError = {
          category: isNotFound ? 'NOT_FOUND' : 'INVALID_RESPONSE',
          status: raw.status,
          endpoint: safeEndpoint,
          message: `Hoshika API returned ok=false (${apiCode || 'unknown'})`,
          retryable: false,
          durationMs,
          ipFamily: raw.ipFamily,
        };
        recordUpstreamMetric({
          provider: 'hoshika',
          endpoint: safeEndpoint,
          durationMs,
          status: raw.status,
          fromCache: false,
          errorCode: isNotFound ? 'not_found' : 'bad_request',
        });
        if (!isNotFound) logDiagnosticEvent(lastError);
        return { ok: false, error: lastError, fromCache: false };
      }

      if (options.validator) {
        const validationFailure = options.validator(parsed);
        if (validationFailure) {
          lastError = {
            category: 'INVALID_RESPONSE',
            status: raw.status,
            endpoint: safeEndpoint,
            message: validationFailure,
            retryable: false,
            durationMs,
            ipFamily: raw.ipFamily,
          };
          recordUpstreamMetric({
            provider: 'hoshika',
            endpoint: safeEndpoint,
            durationMs,
            status: raw.status,
            fromCache: false,
            errorCode: 'parse_error',
          });
          logDiagnosticEvent(lastError);
          return { ok: false, error: lastError, fromCache: false };
        }
      }

      const mapped = options.mapper ? options.mapper(parsed) : (parsed as T);
      recordUpstreamMetric({
        provider: 'hoshika',
        endpoint: safeEndpoint,
        durationMs,
        status: raw.status,
        fromCache: false,
      });

      return {
        ok: true,
        data: mapped,
        fromCache: false,
        ipFamily: raw.ipFamily,
      };
    } catch (caught) {
      const durationMs = Date.now() - startTime;
      lastError = classifyThrownHoshikaError(
        caught,
        safeEndpoint,
        durationMs,
        'auto'
      );

      recordUpstreamMetric({
        provider: 'hoshika',
        endpoint: safeEndpoint,
        durationMs,
        status: lastError.status,
        fromCache: false,
        errorCode: toPerfUpstreamErrorCode(lastError.category),
      });
      logDiagnosticEvent(lastError);

      if (lastError.retryable && attempt < maxAttempts) {
        const backoff = attempt === 1 ? 250 : 650;
        const jitter = Math.floor(Math.random() * 150);
        await sleep(backoff + jitter);
        continue;
      }

      return { ok: false, error: lastError, fromCache: false };
    }
  }

  return { ok: false, error: lastError, fromCache: false };
}

/**
 * Cache-aware wrapper over `executeHoshikaRequest`:
 * - Deduplicates concurrent in-flight requests via `appCache.getOrSet`
 * - Uses Stale-While-Revalidate for fast perceived performance
 * - NEVER caches error payloads, Cloudflare blocks, HTML, or empty episode lists
 * - Returns stale cached data on transient upstream error if available; otherwise returns structured `{ ok: false, error }`
 */
export async function fetchHoshikaCached<T>(
  options: HoshikaRequestOptions<T>
): Promise<HoshikaResult<T>> {
  const endpoint = options.endpoint.startsWith('/')
    ? options.endpoint
    : `/${options.endpoint}`;
  const cacheKey = options.cacheKey || `hoshika:${endpoint}`;
  const ttlSeconds = options.cacheTtlSeconds ?? 300;
  const swrSeconds =
    options.staleWhileRevalidateSeconds ?? Math.min(ttlSeconds * 2, 1800);
  const forceRefresh = Boolean(options.forceRefresh);

  if (!forceRefresh) {
    const preState = appCache.getEntryState<T>(cacheKey);
    if (preState.status === 'fresh' && preState.value !== null) {
      recordUpstreamMetric({
        provider: 'hoshika',
        endpoint,
        durationMs: 0,
        status: 200,
        fromCache: true,
      });
      return {
        ok: true,
        data: preState.value,
        fromCache: true,
        stale: false,
      };
    }

    if (preState.status === 'stale' && preState.value !== null) {
      recordUpstreamMetric({
        provider: 'hoshika',
        endpoint,
        durationMs: 0,
        status: 200,
        fromCache: true,
        staleRevalidated: true,
      });
    }
  }

  let fetchedFromNetwork = false;
  try {
    const value = await appCache.getOrSet<T>(
      cacheKey,
      async () => {
        fetchedFromNetwork = true;
        const res = await executeHoshikaRequest<T>(options);
        if (!res.ok) {
          throw new HoshikaUpstreamError(res.error);
        }
        return res.data;
      },
      {
        ttlSeconds,
        staleWhileRevalidateSeconds: swrSeconds,
        shouldCache: (val) => {
          if (val === null || val === undefined) return false;
          return options.shouldCache ? options.shouldCache(val) : true;
        },
        serveStaleOnError: true,
        forceRefresh,
      }
    );

    const postState = appCache.getEntryState<T>(cacheKey);
    return {
      ok: true,
      data: value,
      fromCache: !fetchedFromNetwork,
      stale: !fetchedFromNetwork && postState.status === 'stale',
    };
  } catch (err) {
    if (isHoshikaUpstreamError(err)) {
      return {
        ok: false,
        fromCache: false,
        error: {
          category: err.category,
          status: err.status,
          endpoint: err.endpoint,
          message: err.message,
          retryable: err.retryable,
          retryAfterMs: err.retryAfterMs,
          durationMs: err.durationMs,
          ipFamily: err.ipFamily,
          causeCode: err.causeCode,
        },
      };
    }

    return {
      ok: false,
      fromCache: false,
      error: classifyThrownHoshikaError(err, endpoint, 0, 'auto'),
    };
  }
}
