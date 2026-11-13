/**
 * Lightweight performance monitoring, request timing, cache telemetry,
 * and structured upstream error classification for AniScroll.
 *
 * Safe for both Node.js server runtime and browser client runtime.
 * Never logs secrets, tokens, or sensitive headers.
 */

export type UpstreamErrorCode =
  | 'timeout'
  | 'rate_limit'
  | 'server_error'
  | 'not_found'
  | 'bad_request'
  | 'invalid_json'
  | 'network_error'
  | 'unknown_error';

export interface StructuredUpstreamError {
  ok: false;
  provider: string;
  endpoint: string;
  code: UpstreamErrorCode;
  status: number | null;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  durationMs: number;
}

export interface UpstreamCallMetric {
  provider: string;
  endpoint: string;
  durationMs: number;
  status: number | null;
  fromCache: boolean;
  staleRevalidated?: boolean;
  deduplicated?: boolean;
  errorCode?: UpstreamErrorCode;
  timestamp: number;
}

export interface PerfSummaryStats {
  totalCalls: number;
  cacheHits: number;
  staleHits: number;
  deduplicatedCalls: number;
  externalNetworkCalls: number;
  errorsByCode: Record<string, number>;
  avgExternalDurationMs: number;
  byProvider: Record<
    string,
    {
      calls: number;
      cacheHits: number;
      networkCalls: number;
      errors: number;
      avgDurationMs: number;
    }
  >;
}

const MAX_RECENT_METRICS = 300;
const recentMetrics: UpstreamCallMetric[] = [];

const isDevLoggingEnabled =
  typeof process !== 'undefined' &&
  process.env.ANISCROLL_PERF_LOG === 'true';

/**
 * Classifies an HTTP status code or caught error into a structured upstream error.
 */
export function classifyUpstreamError(params: {
  provider: string;
  endpoint: string;
  status?: number | null;
  error?: unknown;
  durationMs?: number;
  retryAfterHeader?: string | null;
}): StructuredUpstreamError {
  const {
    provider,
    endpoint,
    status = null,
    error,
    durationMs = 0,
    retryAfterHeader,
  } = params;

  let retryAfterMs: number | undefined;
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader.trim());
    if (Number.isFinite(seconds) && seconds > 0) {
      retryAfterMs = Math.min(Math.round(seconds * 1000), 60_000);
    }
  }

  // Check for AbortError / Timeout
  if (error && typeof error === 'object') {
    const errObj = error as { name?: string; message?: string };
    if (
      errObj.name === 'AbortError' ||
      errObj.name === 'TimeoutError' ||
      (typeof errObj.message === 'string' &&
        /abort|timed?\s*out/i.test(errObj.message))
    ) {
      return {
        ok: false,
        provider,
        endpoint,
        code: 'timeout',
        status,
        message: `${provider} request timed out (${endpoint})`,
        retryable: true,
        durationMs,
      };
    }

    if (
      errObj.name === 'SyntaxError' ||
      (typeof errObj.message === 'string' && /json/i.test(errObj.message))
    ) {
      return {
        ok: false,
        provider,
        endpoint,
        code: 'invalid_json',
        status,
        message: `${provider} returned invalid JSON (${endpoint})`,
        retryable: false,
        durationMs,
      };
    }
  }

  if (status === 429) {
    return {
      ok: false,
      provider,
      endpoint,
      code: 'rate_limit',
      status: 429,
      message: `${provider} rate limit exceeded (${endpoint})`,
      retryable: true,
      retryAfterMs: retryAfterMs ?? 2000,
      durationMs,
    };
  }

  if (status === 404) {
    return {
      ok: false,
      provider,
      endpoint,
      code: 'not_found',
      status: 404,
      message: `${provider} resource not found (${endpoint})`,
      retryable: false,
      durationMs,
    };
  }

  if (status !== null && status >= 400 && status < 500) {
    return {
      ok: false,
      provider,
      endpoint,
      code: 'bad_request',
      status,
      message: `${provider} client error ${status} (${endpoint})`,
      retryable: false,
      durationMs,
    };
  }

  if (status !== null && status >= 500) {
    return {
      ok: false,
      provider,
      endpoint,
      code: 'server_error',
      status,
      message: `${provider} server error ${status} (${endpoint})`,
      retryable: true,
      durationMs,
    };
  }

  if (status === null || status === 0) {
    const rawMsg =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message)
        : 'Network request failed';
    return {
      ok: false,
      provider,
      endpoint,
      code: 'network_error',
      status: null,
      message: `${provider} network error: ${rawMsg} (${endpoint})`,
      retryable: true,
      durationMs,
    };
  }

  return {
    ok: false,
    provider,
    endpoint,
    code: 'unknown_error',
    status,
    message: `${provider} unexpected error (${endpoint})`,
    retryable: false,
    durationMs,
  };
}

/**
 * Records an upstream call or cache lookup metric.
 */
export function recordUpstreamMetric(metric: Omit<UpstreamCallMetric, 'timestamp'>): void {
  const entry: UpstreamCallMetric = {
    ...metric,
    timestamp: Date.now(),
  };

  recentMetrics.push(entry);
  if (recentMetrics.length > MAX_RECENT_METRICS) {
    recentMetrics.shift();
  }

  // Log upstream API failures or slow external requests (>1200ms) in server/dev mode
  if (
    typeof process !== 'undefined' &&
    process.env.NODE_ENV !== 'test' &&
    !entry.fromCache
  ) {
    if (entry.errorCode) {
      console.warn(
        `[AniScroll][Upstream API failure] provider="${entry.provider}" endpoint="${entry.endpoint}" code="${entry.errorCode}" status=${entry.status ?? 'none'} duration=${Math.round(
          entry.durationMs
        )}ms`
      );
    } else if (isDevLoggingEnabled && entry.durationMs > 1200) {
      console.info(
        `[PerfMonitor][SLOW] ${entry.provider} ${entry.endpoint} - ${Math.round(
          entry.durationMs
        )}ms (status=${entry.status ?? 'none'})`
      );
    }
  }
}

/**
 * Returns aggregated performance and cache telemetry across recorded calls.
 */
export function getPerfSummaryStats(): PerfSummaryStats {
  let cacheHits = 0;
  let staleHits = 0;
  let deduplicatedCalls = 0;
  let externalNetworkCalls = 0;
  let totalExternalDuration = 0;
  const errorsByCode: Record<string, number> = {};
  const byProvider: PerfSummaryStats['byProvider'] = {};

  for (const m of recentMetrics) {
    if (!byProvider[m.provider]) {
      byProvider[m.provider] = {
        calls: 0,
        cacheHits: 0,
        networkCalls: 0,
        errors: 0,
        avgDurationMs: 0,
      };
    }
    const prov = byProvider[m.provider];
    prov.calls++;

    if (m.fromCache) {
      cacheHits++;
      prov.cacheHits++;
      if (m.staleRevalidated) {
        staleHits++;
      }
    } else if (m.deduplicated) {
      deduplicatedCalls++;
    } else {
      externalNetworkCalls++;
      prov.networkCalls++;
      totalExternalDuration += m.durationMs;
      prov.avgDurationMs += m.durationMs;
    }

    if (m.errorCode) {
      errorsByCode[m.errorCode] = (errorsByCode[m.errorCode] || 0) + 1;
      prov.errors++;
    }
  }

  for (const prov of Object.values(byProvider)) {
    if (prov.networkCalls > 0) {
      prov.avgDurationMs = Math.round(prov.avgDurationMs / prov.networkCalls);
    }
  }

  return {
    totalCalls: recentMetrics.length,
    cacheHits,
    staleHits,
    deduplicatedCalls,
    externalNetworkCalls,
    errorsByCode,
    avgExternalDurationMs:
      externalNetworkCalls > 0
        ? Math.round(totalExternalDuration / externalNetworkCalls)
        : 0,
    byProvider,
  };
}

/**
 * Resets recorded metrics (useful for unit tests and benchmarks).
 */
export function resetPerfMetrics(): void {
  recentMetrics.length = 0;
}
