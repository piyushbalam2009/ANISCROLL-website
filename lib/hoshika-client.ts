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
  cooldownUntil?: string;
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
  readonly cooldownUntil?: string;
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
    this.cooldownUntil = details.cooldownUntil;
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
      deduped?: boolean;
      ipFamily?: 'auto' | 'ipv4';
    }
  | {
      ok: false;
      error: HoshikaErrorDetails;
      fromCache: false;
      deduped?: boolean;
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

export type HoshikaRequestPriority = 'foreground' | 'background';

export interface HoshikaRequestOptions<T> {
  endpoint: string;
  cacheKey?: string;
  cacheTtlSeconds?: number;
  staleWhileRevalidateSeconds?: number;
  forceRefresh?: boolean;
  priority?: HoshikaRequestPriority;
  timeoutMs?: number;
  maxAttempts?: number;
  shouldCache?: (value: T) => boolean;
  validator?: (raw: unknown) => string | null;
  mapper?: (raw: unknown) => T;
  transport?: HoshikaTransportHooks;
}

export interface HoshikaRateLimitConfig {
  maxConcurrent: number;
  maxBackgroundConcurrent: number;
  maxQueueLength: number;
  queueTimeoutMs: number;
  baseCooldownMs: number;
  maxFallbackCooldownMs: number;
  maxRetryAfterMs: number;
  jitterRatio: number;
  logThrottleMs: number;
}

export interface HoshikaCooldownState {
  active: boolean;
  cooldownUntilMs: number;
  cooldownUntil: string | null;
  remainingMs: number;
  consecutiveRateLimits: number;
  lastRetryAfterMs: number | null;
  lastRateLimitAt: string | null;
  lastRateLimitReason: string | null;
}

export interface HoshikaClientStatus {
  cooldown: HoshikaCooldownState;
  concurrency: {
    activeRequests: number;
    activeBackgroundRequests: number;
    maxConcurrent: number;
    maxBackgroundConcurrent: number;
    queuedRequests: number;
    maxQueueLength: number;
    inFlightDedupedUrls: number;
  };
  metrics: {
    totalRequestsAttempted: number;
    total429Responses: number;
    shortCircitedByCooldown: number;
    dedupedInFlightCount: number;
    suppressedBackgroundCount: number;
    rejectedQueueCount: number;
    lastSuccessfulRequestAt: string | null;
  };
  preferIpv4: boolean;
}

const DEFAULT_HOSHIKA_ORIGIN = 'https://hoshika.app';
const DEFAULT_TIMEOUT_MS = 6500;
const IPV4_PREFER_TTL_MS = 5 * 60 * 1000;

const DEFAULT_RATE_LIMIT_CONFIG: HoshikaRateLimitConfig = {
  maxConcurrent: 3,
  maxBackgroundConcurrent: 1,
  maxQueueLength: 40,
  queueTimeoutMs: 5000,
  baseCooldownMs: 15_000,
  maxFallbackCooldownMs: 300_000,
  maxRetryAfterMs: 900_000,
  jitterRatio: 0.2,
  logThrottleMs: 10_000,
};

let rateLimitConfig: HoshikaRateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG };
let preferIpv4UntilMs = 0;

// Shared process-wide rate-limit & cooldown state
let cooldownUntilMs = 0;
let consecutiveRateLimits = 0;
let lastRetryAfterMs: number | null = null;
let lastRateLimitAtMs: number | null = null;
let lastRateLimitReason: string | null = null;
let lastSuccessfulRequestAtMs: number | null = null;

// Telemetry counters
let totalRequestsAttempted = 0;
let total429Responses = 0;
let shortCircitedByCooldown = 0;
let dedupedInFlightCount = 0;
let suppressedBackgroundCount = 0;
let rejectedQueueCount = 0;

// Throttled log aggregation state
let lastRateLimitLogAtMs = 0;
let suppressedRateLimitLogs = 0;

// Concurrency limiter + bounded priority queue + URL deduplication
let activeRequests = 0;
let activeBackgroundRequests = 0;

interface QueueWaiter {
  priority: HoshikaRequestPriority;
  endpoint: string;
  resolve: (granted: boolean, error?: HoshikaErrorDetails) => void;
  timer: ReturnType<typeof setTimeout>;
}

const requestQueue: QueueWaiter[] = [];
const inFlightByUrl = new Map<string, Promise<HoshikaResult<any>>>();
const transportIds = new WeakMap<object, number>();
let nextTransportId = 1;

function getTransportTag(transport?: HoshikaTransportHooks): string {
  if (!transport?.fetchImpl && !transport?.ipv4TransportImpl) {
    return 'default';
  }
  const fnObj = (transport.fetchImpl || transport.ipv4TransportImpl) as unknown as object;
  let id = transportIds.get(fnObj);
  if (!id) {
    id = nextTransportId++;
    transportIds.set(fnObj, id);
  }
  return `custom:${id}`;
}

export function setHoshikaRateLimitConfigForTests(
  overrides: Partial<HoshikaRateLimitConfig>
): void {
  rateLimitConfig = {
    ...DEFAULT_RATE_LIMIT_CONFIG,
    ...overrides,
  };
}

export function resetHoshikaTransportState(): void {
  preferIpv4UntilMs = 0;
}

export function resetHoshikaClientState(): void {
  preferIpv4UntilMs = 0;
  cooldownUntilMs = 0;
  consecutiveRateLimits = 0;
  lastRetryAfterMs = null;
  lastRateLimitAtMs = null;
  lastRateLimitReason = null;
  lastSuccessfulRequestAtMs = null;

  totalRequestsAttempted = 0;
  total429Responses = 0;
  shortCircitedByCooldown = 0;
  dedupedInFlightCount = 0;
  suppressedBackgroundCount = 0;
  rejectedQueueCount = 0;

  lastRateLimitLogAtMs = 0;
  suppressedRateLimitLogs = 0;

  activeRequests = 0;
  activeBackgroundRequests = 0;
  while (requestQueue.length > 0) {
    const waiter = requestQueue.shift()!;
    clearTimeout(waiter.timer);
    waiter.resolve(false);
  }
  inFlightByUrl.clear();
  rateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG };
}

/**
 * Normalizes an endpoint into relative v1 suffix (e.g. `/anime/88291?locale=en`)
 * without double `/api/v1/api/v1` prefixes.
 */
export function normalizeHoshikaEndpoint(rawEndpoint: string): string {
  const withSlash = rawEndpoint.startsWith('/') ? rawEndpoint : `/${rawEndpoint}`;
  const stripped = withSlash.replace(/^\/api\/v1(?=\/|$)/i, '');
  return stripped || '/';
}

/**
 * Converts any Hoshika endpoint into its canonical v1 API path (`/api/v1/...`).
 */
export function toCanonicalHoshikaApiPath(rawEndpoint: string): string {
  const rel = normalizeHoshikaEndpoint(rawEndpoint);
  return `/api/v1${rel === '/' ? '' : rel}`;
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

export function isHoshikaCooldownActive(nowMs: number = Date.now()): boolean {
  return nowMs < cooldownUntilMs;
}

export function getHoshikaCooldownRemainingMs(nowMs: number = Date.now()): number {
  return Math.max(0, cooldownUntilMs - nowMs);
}

export function getHoshikaCooldownState(nowMs: number = Date.now()): HoshikaCooldownState {
  const remainingMs = Math.max(0, cooldownUntilMs - nowMs);
  return {
    active: remainingMs > 0,
    cooldownUntilMs: remainingMs > 0 ? cooldownUntilMs : 0,
    cooldownUntil: remainingMs > 0 ? new Date(cooldownUntilMs).toISOString() : null,
    remainingMs,
    consecutiveRateLimits,
    lastRetryAfterMs,
    lastRateLimitAt: lastRateLimitAtMs ? new Date(lastRateLimitAtMs).toISOString() : null,
    lastRateLimitReason,
  };
}

export function getHoshikaClientStatus(): HoshikaClientStatus {
  return {
    cooldown: getHoshikaCooldownState(),
    concurrency: {
      activeRequests,
      activeBackgroundRequests,
      maxConcurrent: rateLimitConfig.maxConcurrent,
      maxBackgroundConcurrent: rateLimitConfig.maxBackgroundConcurrent,
      queuedRequests: requestQueue.length,
      maxQueueLength: rateLimitConfig.maxQueueLength,
      inFlightDedupedUrls: inFlightByUrl.size,
    },
    metrics: {
      totalRequestsAttempted,
      total429Responses,
      shortCircitedByCooldown,
      dedupedInFlightCount,
      suppressedBackgroundCount,
      rejectedQueueCount,
      lastSuccessfulRequestAt: lastSuccessfulRequestAtMs
        ? new Date(lastSuccessfulRequestAtMs).toISOString()
        : null,
    },
    preferIpv4: shouldForceIpv4(),
  };
}

export function canScheduleBackgroundHoshikaRequest(nowMs: number = Date.now()): boolean {
  if (isHoshikaCooldownActive(nowMs)) return false;
  if (activeBackgroundRequests >= rateLimitConfig.maxBackgroundConcurrent) return false;
  if (activeRequests >= rateLimitConfig.maxConcurrent) return false;
  if (requestQueue.length >= Math.max(1, Math.floor(rateLimitConfig.maxQueueLength * 0.5))) {
    return false;
  }
  const hasForegroundWaiter = requestQueue.some((w) => w.priority === 'foreground');
  if (hasForegroundWaiter) return false;
  return true;
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

/**
 * Parses HTTP `Retry-After` headers supporting both numeric delay seconds
 * and HTTP-date strings, capped safely at `rateLimitConfig.maxRetryAfterMs`.
 */
export function parseRetryAfterMs(
  retryAfterHeader?: string,
  nowMs: number = Date.now()
): number | undefined {
  if (!retryAfterHeader) return undefined;
  const trimmed = retryAfterHeader.trim();
  if (!trimmed) return undefined;

  const capMs = Math.max(1000, rateLimitConfig.maxRetryAfterMs);
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const numericSeconds = Number(trimmed);
    if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
      return Math.min(capMs, Math.max(1000, Math.round(numericSeconds * 1000)));
    }
  }

  const targetDateMs = Date.parse(trimmed);
  if (Number.isFinite(targetDateMs)) {
    const diff = targetDateMs - nowMs;
    if (diff > 0) {
      return Math.min(capMs, Math.max(1000, Math.round(diff)));
    }
  }
  return undefined;
}

function computeCooldownDelayMs(retryAfterHeader?: string): {
  cooldownMs: number;
  source: 'retry-after' | 'exponential-backoff';
} {
  const parsed = parseRetryAfterMs(retryAfterHeader);
  if (parsed !== undefined) {
    return { cooldownMs: parsed, source: 'retry-after' };
  }

  const step = Math.max(0, consecutiveRateLimits - 1);
  const expMs = Math.min(
    rateLimitConfig.maxFallbackCooldownMs,
    Math.round(rateLimitConfig.baseCooldownMs * Math.pow(2, step))
  );
  // Positive jitter [0 .. jitterRatio] guarantees cooldown never undercuts the exponential floor
  const jitterMs = Math.floor(Math.random() * rateLimitConfig.jitterRatio * expMs);
  return {
    cooldownMs: Math.min(rateLimitConfig.maxFallbackCooldownMs, expMs + jitterMs),
    source: 'exponential-backoff',
  };
}

function logRateLimitedSummary(params: {
  endpoint: string;
  retryAfterMs: number;
  cooldownUntilIso: string;
  source: 'retry-after' | 'exponential-backoff' | 'active-cooldown';
  reason: string;
}): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
    return;
  }

  const now = Date.now();
  if (now - lastRateLimitLogAtMs < rateLimitConfig.logThrottleMs) {
    suppressedRateLimitLogs++;
    return;
  }

  const suppressed = suppressedRateLimitLogs;
  suppressedRateLimitLogs = 0;
  lastRateLimitLogAtMs = now;

  console.warn(
    `[AniScroll][Hoshika][RATE_LIMITED] endpoint="${params.endpoint}" status=429 retryAfterMs=${Math.round(
      params.retryAfterMs
    )} source="${params.source}" cooldownUntil="${params.cooldownUntilIso}" consecutive=${consecutiveRateLimits} active=${activeRequests} queued=${requestQueue.length} deduped=${dedupedInFlightCount} suppressedLogs=${suppressed} reason="${redactSensitiveText(
      params.reason,
      140
    )}"`
  );
}

function drainQueueOnCooldown(cooldownError: HoshikaErrorDetails): void {
  while (requestQueue.length > 0) {
    const waiter = requestQueue.shift()!;
    clearTimeout(waiter.timer);
    rejectedQueueCount++;
    waiter.resolve(false, {
      ...cooldownError,
      endpoint: waiter.endpoint,
      durationMs: 0,
      message: `Hoshika request cancelled because global 429 cooldown became active`,
    });
  }
}

function recordHoshika429(params: {
  retryAfterHeader?: string;
  canonicalEndpoint: string;
  durationMs: number;
  reason?: string;
  ipFamily?: 'auto' | 'ipv4';
}): HoshikaErrorDetails {
  const now = Date.now();
  total429Responses++;
  consecutiveRateLimits++;
  lastRateLimitAtMs = now;

  const { cooldownMs, source } = computeCooldownDelayMs(params.retryAfterHeader);
  lastRetryAfterMs = cooldownMs;
  const targetCooldownUntil = now + cooldownMs;
  if (targetCooldownUntil > cooldownUntilMs) {
    cooldownUntilMs = targetCooldownUntil;
  }

  const effectiveRemainingMs = Math.max(cooldownMs, cooldownUntilMs - now);
  const cooldownUntilIso = new Date(cooldownUntilMs).toISOString();
  const reason = params.reason || 'Upstream HTTP 429 rate_limited';
  lastRateLimitReason = reason;

  const errDetails: HoshikaErrorDetails = {
    category: 'RATE_LIMITED',
    status: 429,
    endpoint: params.canonicalEndpoint,
    message: `Hoshika rate limited request (HTTP 429); cooldown ${Math.ceil(
      effectiveRemainingMs / 1000
    )}s`,
    retryable: true,
    retryAfterMs: effectiveRemainingMs,
    cooldownUntil: cooldownUntilIso,
    durationMs: params.durationMs,
    ipFamily: params.ipFamily,
  };

  logRateLimitedSummary({
    endpoint: params.canonicalEndpoint,
    retryAfterMs: effectiveRemainingMs,
    cooldownUntilIso,
    source,
    reason,
  });

  drainQueueOnCooldown(errDetails);
  return errDetails;
}

function recordHoshikaSuccess(): void {
  const wasInRecovery = consecutiveRateLimits > 0 || cooldownUntilMs > 0;
  lastSuccessfulRequestAtMs = Date.now();
  consecutiveRateLimits = 0;
  cooldownUntilMs = 0;
  lastRateLimitReason = null;

  if (
    wasInRecovery &&
    typeof process !== 'undefined' &&
    process.env.NODE_ENV !== 'test'
  ) {
    console.info('[AniScroll][Hoshika][RECOVERED] Upstream requests succeeded; rate-limit cooldown cleared');
  }
}

function acquireConcurrencySlot(
  priority: HoshikaRequestPriority,
  canonicalEndpoint: string
): Promise<{ granted: true } | { granted: false; error: HoshikaErrorDetails }> {
  const now = Date.now();
  if (isHoshikaCooldownActive(now)) {
    const remainingMs = getHoshikaCooldownRemainingMs(now);
    shortCircitedByCooldown++;
    return Promise.resolve({
      granted: false,
      error: {
        category: 'RATE_LIMITED',
        status: 429,
        endpoint: canonicalEndpoint,
        message: `Hoshika global rate-limit cooldown active (${Math.ceil(
          remainingMs / 1000
        )}s remaining)`,
        retryable: true,
        retryAfterMs: remainingMs,
        cooldownUntil: new Date(cooldownUntilMs).toISOString(),
        durationMs: 0,
        ipFamily: 'auto',
      },
    });
  }

  if (priority === 'background') {
    if (!canScheduleBackgroundHoshikaRequest(now)) {
      suppressedBackgroundCount++;
      return Promise.resolve({
        granted: false,
        error: {
          category: 'RATE_LIMITED',
          status: 429,
          endpoint: canonicalEndpoint,
          message: 'Background Hoshika request suppressed to protect foreground capacity',
          retryable: true,
          retryAfterMs: Math.max(2000, getHoshikaCooldownRemainingMs(now)),
          durationMs: 0,
          ipFamily: 'auto',
        },
      });
    }
    activeRequests++;
    activeBackgroundRequests++;
    return Promise.resolve({ granted: true });
  }

  if (activeRequests < rateLimitConfig.maxConcurrent) {
    activeRequests++;
    return Promise.resolve({ granted: true });
  }

  if (requestQueue.length >= rateLimitConfig.maxQueueLength) {
    rejectedQueueCount++;
    return Promise.resolve({
      granted: false,
      error: {
        category: 'RATE_LIMITED',
        status: 429,
        endpoint: canonicalEndpoint,
        message: `Hoshika request queue saturated (${requestQueue.length}/${rateLimitConfig.maxQueueLength})`,
        retryable: true,
        retryAfterMs: 2500,
        durationMs: 0,
        ipFamily: 'auto',
      },
    });
  }

  return new Promise((resolve) => {
    const waiter: QueueWaiter = {
      priority,
      endpoint: canonicalEndpoint,
      resolve: (granted, error) => {
        if (granted) {
          resolve({ granted: true });
        } else {
          resolve({
            granted: false,
            error: error || {
              category: 'RATE_LIMITED',
              status: 429,
              endpoint: canonicalEndpoint,
              message: 'Hoshika request cancelled while queued',
              retryable: true,
              retryAfterMs: Math.max(1500, getHoshikaCooldownRemainingMs()),
              durationMs: 0,
              ipFamily: 'auto',
            },
          });
        }
      },
      timer: setTimeout(() => {
        const idx = requestQueue.indexOf(waiter);
        if (idx !== -1) {
          requestQueue.splice(idx, 1);
        }
        rejectedQueueCount++;
        resolve({
          granted: false,
          error: {
            category: 'TIMEOUT',
            status: 504,
            endpoint: canonicalEndpoint,
            message: `Hoshika request timed out waiting in queue after ${rateLimitConfig.queueTimeoutMs}ms`,
            retryable: true,
            durationMs: rateLimitConfig.queueTimeoutMs,
            ipFamily: 'auto',
          },
        });
      }, rateLimitConfig.queueTimeoutMs),
    };

    // Foreground waiters sit ahead of any background waiters
    if (priority === 'foreground') {
      const firstBgIdx = requestQueue.findIndex((w) => w.priority === 'background');
      if (firstBgIdx === -1) {
        requestQueue.push(waiter);
      } else {
        requestQueue.splice(firstBgIdx, 0, waiter);
      }
    } else {
      requestQueue.push(waiter);
    }
  });
}

function releaseConcurrencySlot(priority: HoshikaRequestPriority): void {
  activeRequests = Math.max(0, activeRequests - 1);
  if (priority === 'background') {
    activeBackgroundRequests = Math.max(0, activeBackgroundRequests - 1);
  }

  if (requestQueue.length === 0) return;

  // If cooldown became active, drain waiters instead of letting them proceed upstream
  if (isHoshikaCooldownActive()) {
    const remainingMs = getHoshikaCooldownRemainingMs();
    drainQueueOnCooldown({
      category: 'RATE_LIMITED',
      status: 429,
      endpoint: '/api/v1',
      message: `Hoshika global rate-limit cooldown active (${Math.ceil(
        remainingMs / 1000
      )}s remaining)`,
      retryable: true,
      retryAfterMs: remainingMs,
      cooldownUntil: new Date(cooldownUntilMs).toISOString(),
      durationMs: 0,
      ipFamily: 'auto',
    });
    return;
  }

  while (requestQueue.length > 0 && activeRequests < rateLimitConfig.maxConcurrent) {
    const nextIdx = requestQueue.findIndex((w) =>
      w.priority === 'foreground'
        ? true
        : activeBackgroundRequests < rateLimitConfig.maxBackgroundConcurrent
    );
    if (nextIdx === -1) break;

    const [waiter] = requestQueue.splice(nextIdx, 1);
    clearTimeout(waiter.timer);
    activeRequests++;
    if (waiter.priority === 'background') {
      activeBackgroundRequests++;
    }
    waiter.resolve(true);
  }
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
      cooldownUntil: err.cooldownUntil,
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
 * Executes a strict, validated Hoshika v1 JSON request with:
 * - Shared global 429 cooldown (NEVER retries HTTP 429 inline)
 * - Priority-aware bounded concurrency & queue
 * - Normalized URL in-flight deduplication
 * - Cloudflare/HTML detection, IPv4 fallback, and structured error classification
 */
export async function executeHoshikaRequest<T = any>(
  options: HoshikaRequestOptions<T>
): Promise<HoshikaResult<T>> {
  const normalizedEndpoint = normalizeHoshikaEndpoint(options.endpoint);
  const canonicalEndpoint = redactSensitiveText(
    toCanonicalHoshikaApiPath(normalizedEndpoint),
    240
  );
  const origin = resolveHoshikaOrigin();
  const fullUrl = `${origin}${toCanonicalHoshikaApiPath(normalizedEndpoint)}`;
  const priority: HoshikaRequestPriority = options.priority || 'foreground';

  // 1. Short-circuit immediately during an active global 429 cooldown
  if (isHoshikaCooldownActive()) {
    const remainingMs = getHoshikaCooldownRemainingMs();
    shortCircitedByCooldown++;
    const cooldownErr: HoshikaErrorDetails = {
      category: 'RATE_LIMITED',
      status: 429,
      endpoint: canonicalEndpoint,
      message: `Hoshika global rate-limit cooldown active (${Math.ceil(
        remainingMs / 1000
      )}s remaining)`,
      retryable: true,
      retryAfterMs: remainingMs,
      cooldownUntil: new Date(cooldownUntilMs).toISOString(),
      durationMs: 0,
      ipFamily: 'auto',
    };
    return { ok: false, error: cooldownErr, fromCache: false };
  }

  // 2. Deduplicate identical concurrent requests by canonical URL + transport identity
  const dedupeKey = `${fullUrl}#${getTransportTag(options.transport)}`;
  const existingInFlight = inFlightByUrl.get(dedupeKey);
  if (existingInFlight) {
    dedupedInFlightCount++;
    recordUpstreamMetric({
      provider: 'hoshika',
      endpoint: canonicalEndpoint,
      durationMs: 0,
      status: null,
      fromCache: false,
      deduplicated: true,
    });
    const shared = await (existingInFlight as Promise<HoshikaResult<T>>);
    return { ...shared, deduped: true };
  }

  // 3. Immediately suppress background work under load/cooldown without touching queue
  if (priority === 'background' && !canScheduleBackgroundHoshikaRequest()) {
    suppressedBackgroundCount++;
    return {
      ok: false,
      fromCache: false,
      error: {
        category: 'RATE_LIMITED',
        status: 429,
        endpoint: canonicalEndpoint,
        message: 'Background Hoshika request suppressed to preserve foreground capacity',
        retryable: true,
        retryAfterMs: Math.max(2000, getHoshikaCooldownRemainingMs()),
        durationMs: 0,
        ipFamily: 'auto',
      },
    };
  }

  const runRequestPromise = (async (): Promise<HoshikaResult<T>> => {
    const slot = await acquireConcurrencySlot(priority, canonicalEndpoint);
    if (!slot.granted) {
      return { ok: false, error: slot.error, fromCache: false };
    }

    totalRequestsAttempted++;
    const timeoutMs = getHoshikaTimeoutMs(options.timeoutMs);
    const maxAttempts = Math.max(1, Math.min(3, options.maxAttempts ?? 3));
    const sleep = options.transport?.sleepImpl || defaultSleep;

    let lastError: HoshikaErrorDetails = {
      category: 'UPSTREAM_UNAVAILABLE',
      status: null,
      endpoint: canonicalEndpoint,
      message: 'Hoshika request failed',
      retryable: true,
      durationMs: 0,
      ipFamily: 'auto',
    };

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Abort remaining retry attempts if another concurrent response activated cooldown
        if (isHoshikaCooldownActive()) {
          const remainingMs = getHoshikaCooldownRemainingMs();
          shortCircitedByCooldown++;
          return {
            ok: false,
            fromCache: false,
            error: {
              category: 'RATE_LIMITED',
              status: 429,
              endpoint: canonicalEndpoint,
              message: `Hoshika global rate-limit cooldown active (${Math.ceil(
                remainingMs / 1000
              )}s remaining)`,
              retryable: true,
              retryAfterMs: remainingMs,
              cooldownUntil: new Date(cooldownUntilMs).toISOString(),
              durationMs: 0,
              ipFamily: 'auto',
            },
          };
        }

        const startTime = Date.now();
        try {
          const raw = await performSingleAttempt({
            url: fullUrl,
            endpoint: canonicalEndpoint,
            origin,
            timeoutMs,
            forceIpv4Now: shouldForceIpv4(),
            hooks: options.transport,
          });

          const durationMs = Date.now() - startTime;
          const cfOrHtml = isCloudflareOrHtmlBlock(raw.status, raw.headers, raw.bodyText);

          // HTTP 429: NEVER retry inline! Enter shared global cooldown immediately.
          // Exception: detect plain Cloudflare challenge HTML vs API 429 JSON.
          if (raw.status === 429 && !cfOrHtml.isCloudflare) {
            let apiReason = 'upstream HTTP 429';
            try {
              const errBody = JSON.parse(raw.bodyText);
              if (errBody && typeof errBody === 'object') {
                apiReason = String(
                  errBody.code || errBody.error || errBody.message || apiReason
                );
              }
            } catch {
              // ignore non-JSON 429 body
            }

            lastError = recordHoshika429({
              retryAfterHeader: raw.headers['retry-after'],
              canonicalEndpoint,
              durationMs,
              reason: apiReason,
              ipFamily: raw.ipFamily,
            });
            recordUpstreamMetric({
              provider: 'hoshika',
              endpoint: canonicalEndpoint,
              durationMs,
              status: 429,
              fromCache: false,
              errorCode: 'rate_limit',
            });
            return { ok: false, error: lastError, fromCache: false };
          }

          if (cfOrHtml.isCloudflare) {
            if (raw.status === 429) {
              // Cloudflare 429 challenge must also activate cooldown so we stop hitting it!
              recordHoshika429({
                retryAfterHeader: raw.headers['retry-after'] || '60',
                canonicalEndpoint,
                durationMs,
                reason: 'Cloudflare HTTP 429 challenge',
                ipFamily: raw.ipFamily,
              });
            }
            lastError = {
              category: 'CLOUDFLARE_BLOCKED',
              status: raw.status || 403,
              endpoint: canonicalEndpoint,
              message: `Hoshika request blocked by Cloudflare challenge (HTTP ${raw.status})`,
              retryable: false,
              retryAfterMs: raw.status === 429 ? getHoshikaCooldownRemainingMs() : undefined,
              durationMs,
              ipFamily: raw.ipFamily,
            };
            recordUpstreamMetric({
              provider: 'hoshika',
              endpoint: canonicalEndpoint,
              durationMs,
              status: raw.status,
              fromCache: false,
              errorCode: toPerfUpstreamErrorCode(lastError.category),
            });
            logDiagnosticEvent(lastError);
            return { ok: false, error: lastError, fromCache: false };
          }

          if (raw.status === 404) {
            lastError = {
              category: 'NOT_FOUND',
              status: 404,
              endpoint: canonicalEndpoint,
              message: `Hoshika resource not found (HTTP 404)`,
              retryable: false,
              durationMs,
              ipFamily: raw.ipFamily,
            };
            recordUpstreamMetric({
              provider: 'hoshika',
              endpoint: canonicalEndpoint,
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
              endpoint: canonicalEndpoint,
              message: `Hoshika upstream server error (HTTP ${raw.status})`,
              retryable: true,
              durationMs,
              ipFamily: raw.ipFamily,
            };
            recordUpstreamMetric({
              provider: 'hoshika',
              endpoint: canonicalEndpoint,
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
              endpoint: canonicalEndpoint,
              message: `Hoshika rejected request with HTTP ${raw.status}`,
              retryable: false,
              durationMs,
              ipFamily: raw.ipFamily,
            };
            recordUpstreamMetric({
              provider: 'hoshika',
              endpoint: canonicalEndpoint,
              durationMs,
              status: raw.status,
              fromCache: false,
              errorCode: 'bad_request',
            });
            logDiagnosticEvent(lastError);
            return { ok: false, error: lastError, fromCache: false };
          }

          const contentType = (raw.headers['content-type'] || '').toLowerCase();
          if (
            cfOrHtml.isHtml ||
            (contentType !== '' &&
              !contentType.includes('application/json') &&
              !contentType.includes('+json'))
          ) {
            lastError = {
              category: 'INVALID_RESPONSE',
              status: raw.status,
              endpoint: canonicalEndpoint,
              message: `Hoshika returned non-JSON content-type (${contentType || 'html'})`,
              retryable: false,
              durationMs,
              ipFamily: raw.ipFamily,
            };
            recordUpstreamMetric({
              provider: 'hoshika',
              endpoint: canonicalEndpoint,
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
              endpoint: canonicalEndpoint,
              message: 'Hoshika returned malformed JSON body',
              retryable: false,
              durationMs,
              ipFamily: raw.ipFamily,
            };
            recordUpstreamMetric({
              provider: 'hoshika',
              endpoint: canonicalEndpoint,
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
              endpoint: canonicalEndpoint,
              message: 'Hoshika response JSON is not an object',
              retryable: false,
              durationMs,
              ipFamily: raw.ipFamily,
            };
            recordUpstreamMetric({
              provider: 'hoshika',
              endpoint: canonicalEndpoint,
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
            if (apiCode === 'rate_limited') {
              lastError = recordHoshika429({
                retryAfterHeader: raw.headers['retry-after'],
                canonicalEndpoint,
                durationMs,
                reason: 'JSON body code=rate_limited',
                ipFamily: raw.ipFamily,
              });
              recordUpstreamMetric({
                provider: 'hoshika',
                endpoint: canonicalEndpoint,
                durationMs,
                status: 429,
                fromCache: false,
                errorCode: 'rate_limit',
              });
              return { ok: false, error: lastError, fromCache: false };
            }

            const isNotFound = apiCode === 'not_found';
            lastError = {
              category: isNotFound ? 'NOT_FOUND' : 'INVALID_RESPONSE',
              status: raw.status,
              endpoint: canonicalEndpoint,
              message: `Hoshika API returned ok=false (${apiCode || 'unknown'})`,
              retryable: false,
              durationMs,
              ipFamily: raw.ipFamily,
            };
            recordUpstreamMetric({
              provider: 'hoshika',
              endpoint: canonicalEndpoint,
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
                endpoint: canonicalEndpoint,
                message: validationFailure,
                retryable: false,
                durationMs,
                ipFamily: raw.ipFamily,
              };
              recordUpstreamMetric({
                provider: 'hoshika',
                endpoint: canonicalEndpoint,
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
          recordHoshikaSuccess();
          recordUpstreamMetric({
            provider: 'hoshika',
            endpoint: canonicalEndpoint,
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
            canonicalEndpoint,
            durationMs,
            'auto'
          );

          recordUpstreamMetric({
            provider: 'hoshika',
            endpoint: canonicalEndpoint,
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
    } finally {
      releaseConcurrencySlot(priority);
    }
  })();

  inFlightByUrl.set(dedupeKey, runRequestPromise);
  try {
    return await runRequestPromise;
  } finally {
    inFlightByUrl.delete(dedupeKey);
  }
}

/**
 * Cache-aware wrapper over `executeHoshikaRequest`:
 * - Deduplicates concurrent in-flight requests via `appCache.getOrSet` + URL-level `inFlightByUrl`
 * - Uses Stale-While-Revalidate and suppresses background refreshes during 429 cooldown
 * - NEVER caches error payloads, Cloudflare blocks, HTML, HTTP 429, or empty episode lists
 * - Returns stale cached data on transient upstream error / 429 cooldown if available
 */
export async function fetchHoshikaCached<T>(
  options: HoshikaRequestOptions<T>
): Promise<HoshikaResult<T>> {
  const endpoint = normalizeHoshikaEndpoint(options.endpoint);
  const canonicalEndpoint = toCanonicalHoshikaApiPath(endpoint);
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
        endpoint: canonicalEndpoint,
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
        endpoint: canonicalEndpoint,
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
        const res = await executeHoshikaRequest<T>(options);
        if (!res.ok) {
          throw new HoshikaUpstreamError(res.error);
        }
        fetchedFromNetwork = true;
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
        backgroundFetcher: async () => {
          const res = await executeHoshikaRequest<T>({
            ...options,
            priority: 'background',
          });
          if (!res.ok) {
            throw new HoshikaUpstreamError(res.error);
          }
          return res.data;
        },
        shouldSuppressBackgroundRefresh: () => {
          if (isHoshikaCooldownActive() || !canScheduleBackgroundHoshikaRequest()) {
            suppressedBackgroundCount++;
            return true;
          }
          return false;
        },
        negativeRefreshCooldownMs: 15_000,
        getRefreshCooldownMs: (err) => {
          if (isHoshikaUpstreamError(err)) {
            if (err.category === 'RATE_LIMITED') {
              return {
                cooldownMs: Math.max(
                  15_000,
                  getHoshikaCooldownRemainingMs(),
                  err.retryAfterMs ?? 0
                ),
                errorCode: 'RATE_LIMITED',
              };
            }
            return {
              cooldownMs: 15_000,
              errorCode: err.category,
            };
          }
          return { cooldownMs: 15_000, errorCode: 'UNKNOWN' };
        },
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
          cooldownUntil: err.cooldownUntil,
          durationMs: err.durationMs,
          ipFamily: err.ipFamily,
          causeCode: err.causeCode,
        },
      };
    }

    return {
      ok: false,
      fromCache: false,
      error: classifyThrownHoshikaError(err, canonicalEndpoint, 0, 'auto'),
    };
  }
}
