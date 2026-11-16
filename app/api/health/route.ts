import { NextResponse } from 'next/server';
import { appCache } from '@/lib/cache';
import { getHoshikaClientStatus } from '@/lib/hoshika-client';
import { getPerfSummaryStats } from '@/lib/perf-monitor';

export const dynamic = 'force-dynamic';

export async function GET() {
  const hoshika = getHoshikaClientStatus();
  const cache = appCache.getStats();
  const perf = getPerfSummaryStats(60 * 60_000);

  return NextResponse.json(
    {
      ok: true,
      status: hoshika.cooldown.active ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      hoshika: {
        cooldownActive: hoshika.cooldown.active,
        cooldownRemainingMs: hoshika.cooldown.remainingMs,
        cooldownMode: hoshika.cooldownMode,
        inFlightRequests: hoshika.concurrency.activeRequests,
      },
      cache: {
        entries: cache.size,
        maxEntries: cache.maxEntries,
        inFlightDedupes: cache.inFlightDedupes,
        activeBackgroundRefreshes: cache.activeBackgroundRefreshes,
      },
      telemetry: {
        totalCalls: perf.totalCalls,
        cacheHits: perf.cacheHits,
        cacheHitRatePct: perf.cacheHitRatePct,
        staleHits: perf.staleHits,
        anilistFallbackCount: perf.anilistFallbackCount,
        episodeFailureCount: perf.episodeFailureCount,
        streamFailureCount: perf.streamFailureCount,
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
}
