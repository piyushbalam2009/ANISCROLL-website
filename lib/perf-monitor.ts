import { redactSensitiveText } from './admin/redaction';

/**
 * Lightweight performance monitoring, request timing, cache telemetry,
 * percentile calculation, time-bucketed metrics, and structured upstream error classification.
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

export interface RecordedErrorEvent {
  id: string;
  provider: string;
  endpoint: string;
  code: UpstreamErrorCode;
  status: number | null;
  message: string;
  durationMs: number;
  timestamp: number;
}

export interface ProviderTelemetrySummary {
  provider: string;
  calls: number;
  cacheHits: number;
  networkCalls: number;
  errors: number;
  timeouts: number;
  cacheHitRatePct: number;
  errorRatePct: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  lastStatus: number | null;
  lastErrorCode: UpstreamErrorCode | null;
  lastCheckedAt: string | null;
  healthState: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
}

export interface TelemetryTimeBucket {
  bucketStartMs: number;
  label: string;
  calls: number;
  cacheHits: number;
  networkCalls: number;
  errors: number;
  avgDurationMs: number;
}

export interface PerfSummaryStats {
  totalCalls: number;
  cacheHits: number;
  staleHits: number;
  deduplicatedCalls: number;
  externalNetworkCalls: number;
  errorsByCode: Record<string, number>;
  avgExternalDurationMs: number;
  p50ExternalDurationMs: number;
  p95ExternalDurationMs: number;
  byProvider: Record<
    string,
    {
      calls: number;
      cacheHits: number;
      networkCalls: number;
      errors: number;
      avgDurationMs: number;
      p50DurationMs: number;
      p95DurationMs: number;
    }
  >;
}

const MAX_RECENT_METRICS = 1000;
const MAX_RECENT_ERRORS = 200;
const recentMetrics: UpstreamCallMetric[] = [];
const recentErrors: RecordedErrorEvent[] = [];

const isDevLoggingEnabled =
  typeof process !== 'undefined' &&
  process.env.ANISCROLL_PERF_LOG === 'true';

/**
 * Computes an exact nearest-rank percentile (0..100) for a numeric array.
 */
export function computePercentile(values: number[], percentile: number): number {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const clean = values
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const p = Math.min(100, Math.max(0, percentile));
  if (p === 0) return Math.round(clean[0]!);
  const rank = Math.ceil((p / 100) * clean.length);
  const idx = Math.min(clean.length - 1, Math.max(0, rank - 1));
  return Math.round(clean[idx]!);
}

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

  const safeEndpoint = redactSensitiveText(endpoint, 240);
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
        endpoint: safeEndpoint,
        code: 'timeout',
        status,
        message: `${provider} request timed out (${safeEndpoint})`,
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
        endpoint: safeEndpoint,
        code: 'invalid_json',
        status,
        message: `${provider} returned invalid JSON (${safeEndpoint})`,
        retryable: false,
        durationMs,
      };
    }
  }

  if (status === 429) {
    return {
      ok: false,
      provider,
      endpoint: safeEndpoint,
      code: 'rate_limit',
      status: 429,
      message: `${provider} rate limit exceeded (${safeEndpoint})`,
      retryable: true,
      retryAfterMs: retryAfterMs ?? 2000,
      durationMs,
    };
  }

  if (status === 404) {
    return {
      ok: false,
      provider,
      endpoint: safeEndpoint,
      code: 'not_found',
      status: 404,
      message: `${provider} resource not found (${safeEndpoint})`,
      retryable: false,
      durationMs,
    };
  }

  if (status !== null && status >= 400 && status < 500) {
    return {
      ok: false,
      provider,
      endpoint: safeEndpoint,
      code: 'bad_request',
      status,
      message: `${provider} client error ${status} (${safeEndpoint})`,
      retryable: false,
      durationMs,
    };
  }

  if (status !== null && status >= 500) {
    return {
      ok: false,
      provider,
      endpoint: safeEndpoint,
      code: 'server_error',
      status,
      message: `${provider} server error ${status} (${safeEndpoint})`,
      retryable: true,
      durationMs,
    };
  }

  if (status === null || status === 0) {
    const rawMsg =
      error && typeof error === 'object' && 'message' in error
        ? redactSensitiveText(String((error as { message?: unknown }).message), 200)
        : 'Network request failed';
    return {
      ok: false,
      provider,
      endpoint: safeEndpoint,
      code: 'network_error',
      status: null,
      message: `${provider} network error: ${rawMsg} (${safeEndpoint})`,
      retryable: true,
      durationMs,
    };
  }

  return {
    ok: false,
    provider,
    endpoint: safeEndpoint,
    code: 'unknown_error',
    status,
    message: `${provider} unexpected error (${safeEndpoint})`,
    retryable: false,
    durationMs,
  };
}

/**
 * Records an upstream call or cache lookup metric (with automatic secret redaction).
 */
export function recordUpstreamMetric(
  metric: Omit<UpstreamCallMetric, 'timestamp'> & { timestamp?: number }
): void {
  const ts = typeof metric.timestamp === 'number' ? metric.timestamp : Date.now();
  const safeEndpoint = redactSensitiveText(metric.endpoint, 240);
  const entry: UpstreamCallMetric = {
    ...metric,
    endpoint: safeEndpoint,
    timestamp: ts,
  };

  recentMetrics.push(entry);
  if (recentMetrics.length > MAX_RECENT_METRICS) {
    recentMetrics.shift();
  }

  if (entry.errorCode && !entry.fromCache) {
    recentErrors.push({
      id: `err_${ts}_${Math.random().toString(36).slice(2, 7)}`,
      provider: entry.provider,
      endpoint: safeEndpoint,
      code: entry.errorCode,
      status: entry.status,
      message: `${entry.provider} ${entry.errorCode}${
        entry.status ? ` (HTTP ${entry.status})` : ''
      } on ${safeEndpoint}`,
      durationMs: Math.round(entry.durationMs),
      timestamp: ts,
    });
    if (recentErrors.length > MAX_RECENT_ERRORS) {
      recentErrors.shift();
    }
  }

  if (
    typeof process !== 'undefined' &&
    process.env.NODE_ENV !== 'test' &&
    !entry.fromCache
  ) {
    if (entry.errorCode) {
      console.warn(
        `[AniScroll][Upstream API failure] provider="${entry.provider}" endpoint="${safeEndpoint}" code="${entry.errorCode}" status=${entry.status ?? 'none'} duration=${Math.round(
          entry.durationMs
        )}ms`
      );
    } else if (isDevLoggingEnabled && entry.durationMs > 1200) {
      console.info(
        `[PerfMonitor][SLOW] ${entry.provider} ${safeEndpoint} - ${Math.round(
          entry.durationMs
        )}ms (status=${entry.status ?? 'none'})`
      );
    }
  }
}

/**
 * Returns aggregated performance and cache telemetry across recorded calls.
 */
export function getPerfSummaryStats(windowMs?: number): PerfSummaryStats {
  const cutoff = windowMs ? Date.now() - windowMs : 0;
  const scoped = cutoff
    ? recentMetrics.filter((m) => m.timestamp >= cutoff)
    : recentMetrics;

  let cacheHits = 0;
  let staleHits = 0;
  let deduplicatedCalls = 0;
  let externalNetworkCalls = 0;
  let totalExternalDuration = 0;
  const externalDurations: number[] = [];
  const errorsByCode: Record<string, number> = {};
  const durationsByProvider: Record<string, number[]> = {};
  const byProvider: PerfSummaryStats['byProvider'] = {};

  for (const m of scoped) {
    if (!byProvider[m.provider]) {
      byProvider[m.provider] = {
        calls: 0,
        cacheHits: 0,
        networkCalls: 0,
        errors: 0,
        avgDurationMs: 0,
        p50DurationMs: 0,
        p95DurationMs: 0,
      };
      durationsByProvider[m.provider] = [];
    }
    const prov = byProvider[m.provider]!;
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
      externalDurations.push(m.durationMs);
      durationsByProvider[m.provider]!.push(m.durationMs);
    }

    if (m.errorCode) {
      errorsByCode[m.errorCode] = (errorsByCode[m.errorCode] || 0) + 1;
      prov.errors++;
    }
  }

  for (const [provider, prov] of Object.entries(byProvider)) {
    const durs = durationsByProvider[provider] || [];
    if (durs.length > 0) {
      const sum = durs.reduce((acc, v) => acc + v, 0);
      prov.avgDurationMs = Math.round(sum / durs.length);
      prov.p50DurationMs = computePercentile(durs, 50);
      prov.p95DurationMs = computePercentile(durs, 95);
    }
  }

  return {
    totalCalls: scoped.length,
    cacheHits,
    staleHits,
    deduplicatedCalls,
    externalNetworkCalls,
    errorsByCode,
    avgExternalDurationMs:
      externalNetworkCalls > 0
        ? Math.round(totalExternalDuration / externalNetworkCalls)
        : 0,
    p50ExternalDurationMs: computePercentile(externalDurations, 50),
    p95ExternalDurationMs: computePercentile(externalDurations, 95),
    byProvider,
  };
}

/**
 * Returns rich per-provider telemetry summaries with real health classification.
 */
export function getDetailedProviderTelemetry(
  providerList: string[] = [
    'hoshika',
    'anilist',
    'megaplay',
    'zokoanime',
    'aniskip',
    'fanart',
  ],
  windowMs?: number
): ProviderTelemetrySummary[] {
  const cutoff = windowMs ? Date.now() - windowMs : 0;
  const scoped = cutoff
    ? recentMetrics.filter((m) => m.timestamp >= cutoff)
    : recentMetrics;

  const allProviders = Array.from(
    new Set([...providerList, ...scoped.map((m) => m.provider)])
  );

  return allProviders.map((provider) => {
    const rows = scoped.filter((m) => m.provider === provider);
    const networkRows = rows.filter((m) => !m.fromCache && !m.deduplicated);
    const cacheHits = rows.filter((m) => m.fromCache).length;
    const errors = rows.filter((m) => Boolean(m.errorCode)).length;
    const timeouts = rows.filter((m) => m.errorCode === 'timeout').length;
    const durations = networkRows.map((m) => m.durationMs);
    const avgDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
    const p50DurationMs = computePercentile(durations, 50);
    const p95DurationMs = computePercentile(durations, 95);
    const errorRatePct =
      networkRows.length > 0
        ? Math.round((errors / networkRows.length) * 100)
        : 0;
    const cacheHitRatePct =
      rows.length > 0 ? Math.round((cacheHits / rows.length) * 100) : 0;

    const lastNetwork =
      networkRows.length > 0 ? networkRows[networkRows.length - 1]! : null;

    let healthState: ProviderTelemetrySummary['healthState'] = 'unknown';
    if (networkRows.length > 0) {
      if (lastNetwork?.errorCode && errorRatePct >= 50) {
        healthState = 'unavailable';
      } else if (errorRatePct >= 20 || avgDurationMs > 2500) {
        healthState = 'degraded';
      } else {
        healthState = 'healthy';
      }
    } else if (rows.length > 0) {
      healthState = 'healthy';
    }

    return {
      provider,
      calls: rows.length,
      cacheHits,
      networkCalls: networkRows.length,
      errors,
      timeouts,
      cacheHitRatePct,
      errorRatePct,
      avgDurationMs,
      p50DurationMs,
      p95DurationMs,
      lastStatus: lastNetwork?.status ?? null,
      lastErrorCode: lastNetwork?.errorCode ?? null,
      lastCheckedAt: lastNetwork
        ? new Date(lastNetwork.timestamp).toISOString()
        : null,
      healthState,
    };
  });
}

/**
 * Aggregates real recorded metrics into chronological time buckets.
 * Never invents data for periods with zero recorded calls.
 */
export function getTelemetryTimeSeries(
  bucketMinutes = 5,
  maxBuckets = 12,
  windowMs?: number
): TelemetryTimeBucket[] {
  const cutoff = windowMs ? Date.now() - windowMs : 0;
  const scoped = cutoff
    ? recentMetrics.filter((m) => m.timestamp >= cutoff)
    : recentMetrics;

  if (scoped.length === 0) return [];

  const bucketSizeMs = Math.max(1, bucketMinutes) * 60_000;
  const buckets = new Map<
    number,
    {
      calls: number;
      cacheHits: number;
      networkCalls: number;
      errors: number;
      durSum: number;
      durCount: number;
    }
  >();

  for (const m of scoped) {
    const bucketKey = Math.floor(m.timestamp / bucketSizeMs) * bucketSizeMs;
    let b = buckets.get(bucketKey);
    if (!b) {
      b = {
        calls: 0,
        cacheHits: 0,
        networkCalls: 0,
        errors: 0,
        durSum: 0,
        durCount: 0,
      };
      buckets.set(bucketKey, b);
    }
    b.calls++;
    if (m.fromCache) {
      b.cacheHits++;
    } else if (!m.deduplicated) {
      b.networkCalls++;
      b.durSum += m.durationMs;
      b.durCount++;
    }
    if (m.errorCode) {
      b.errors++;
    }
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(-Math.max(1, maxBuckets))
    .map(([bucketStartMs, b]) => {
      const d = new Date(bucketStartMs);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return {
        bucketStartMs,
        label: `${hh}:${mm}`,
        calls: b.calls,
        cacheHits: b.cacheHits,
        networkCalls: b.networkCalls,
        errors: b.errors,
        avgDurationMs:
          b.durCount > 0 ? Math.round(b.durSum / b.durCount) : 0,
      };
    });
}

export function getRecentErrorEvents(limit = 50): RecordedErrorEvent[] {
  return recentErrors.slice(-Math.max(1, limit)).reverse();
}

/**
 * Resets recorded metrics (useful for unit tests and benchmarks).
 */
export function resetPerfMetrics(): void {
  recentMetrics.length = 0;
  recentErrors.length = 0;
}
