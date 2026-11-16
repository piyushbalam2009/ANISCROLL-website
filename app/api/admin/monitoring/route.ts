import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';
import {
  getDetailedProviderTelemetry,
  getPerfSummaryStats,
  getTelemetryTimeSeries,
} from '@/lib/perf-monitor';
import { appCache } from '@/lib/cache';
import { getArtworkCacheStats } from '@/lib/artwork/artwork-cache';
import { logAdminActionServer, logErrorEventServer } from '@/lib/admin/server-audit';
import { getHoshikaClientStatus, resolveHoshikaApiBase } from '@/lib/hoshika-client';
import { probeHoshikaHealth } from '@/lib/hoshika';

export interface ServiceHealthProbe {
  id: string;
  name: string;
  category: 'metadata' | 'streaming' | 'artwork' | 'storage' | 'database';
  endpoint: string;
  status: 'operational' | 'degraded' | 'outage';
  responseTimeMs: number;
  statusCode: number;
  errorMessage: string;
  checkedAt: string;
}

async function runHttpProbe(params: {
  id: string;
  name: string;
  category: ServiceHealthProbe['category'];
  endpoint: string;
  url: string;
  init?: RequestInit;
  allow404?: boolean;
}): Promise<ServiceHealthProbe> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);

  try {
    const res = await fetch(params.url, {
      ...params.init,
      signal: controller.signal,
      cache: 'no-store',
    });
    const responseTimeMs = Math.max(1, Date.now() - start);
    const ok =
      (res.status >= 200 && res.status < 400) ||
      (Boolean(params.allow404) && res.status === 404);

    let status: ServiceHealthProbe['status'] = 'operational';
    if (!ok) {
      status = res.status >= 500 ? 'outage' : 'degraded';
    } else if (responseTimeMs > 2500) {
      status = 'degraded';
    }

    return {
      id: params.id,
      name: params.name,
      category: params.category,
      endpoint: params.endpoint,
      status,
      responseTimeMs,
      statusCode: res.status,
      errorMessage: ok ? '' : `HTTP ${res.status} upstream response`,
      checkedAt,
    };
  } catch (err) {
    const responseTimeMs = Math.max(1, Date.now() - start);
    return {
      id: params.id,
      name: params.name,
      category: params.category,
      endpoint: params.endpoint,
      status: 'outage',
      responseTimeMs,
      statusCode: 0,
      errorMessage: err instanceof Error ? err.message : 'Connection timeout',
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runHoshikaProbe(hoshikaApiBase: string): Promise<ServiceHealthProbe> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();
  const res = await probeHoshikaHealth();
  const responseTimeMs = Math.max(1, Date.now() - start);

  if (res.ok) {
    return {
      id: 'hoshika',
      name: 'Hoshika Anime Metadata',
      category: 'metadata',
      endpoint: `GET ${hoshikaApiBase}/home`,
      status: responseTimeMs > 2500 ? 'degraded' : 'operational',
      responseTimeMs,
      statusCode: 200,
      errorMessage: '',
      checkedAt,
    };
  }

  const statusCode = res.error.status || 0;
  const status: ServiceHealthProbe['status'] =
    res.error.category === 'RATE_LIMITED'
      ? 'degraded'
      : statusCode >= 500 || statusCode === 0
      ? 'outage'
      : 'degraded';

  return {
    id: 'hoshika',
    name: 'Hoshika Anime Metadata',
    category: 'metadata',
    endpoint: `GET ${hoshikaApiBase}/home`,
    status,
    responseTimeMs,
    statusCode,
    errorMessage: res.error.message,
    checkedAt,
  };
}

async function runAllHealthProbes(): Promise<ServiceHealthProbe[]> {
  const hoshikaApiBase = resolveHoshikaApiBase();
  const projectId = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  const firestoreProbeUrl = projectId
    ? `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        projectId
      )}/databases/(default)/documents/siteConfig/global`
    : 'https://firestore.googleapis.com';

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();

  const probes = await Promise.all([
    runHoshikaProbe(hoshikaApiBase),
    runHttpProbe({
      id: 'anilist',
      name: 'AniList GraphQL API',
      category: 'metadata',
      endpoint: 'POST https://graphql.anilist.co',
      url: 'https://graphql.anilist.co',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: '{ Media(id: 1, type: ANIME) { id } }' }),
      },
    }),
    runHttpProbe({
      id: 'megaplay',
      name: 'MegaPlay Series Streamer',
      category: 'streaming',
      endpoint: 'GET https://api.aniscroll.in/api/watch/megaplay/21/1/sub',
      url: 'https://api.aniscroll.in/api/watch/megaplay/21/1/sub',
      init: { headers: { Accept: 'application/json' } },
    }),
    runHttpProbe({
      id: 'zokoanime',
      name: 'ZokoAnime Movie Streamer',
      category: 'streaming',
      endpoint: 'GET https://api.aniscroll.in/api/watch/zokoanime/16498/1/sub',
      url: 'https://api.aniscroll.in/api/watch/zokoanime/16498/1/sub',
      init: { headers: { Accept: 'application/json' } },
    }),
    runHttpProbe({
      id: 'aniskip',
      name: 'AniSkip Timestamp API',
      category: 'streaming',
      endpoint: 'GET https://api.aniskip.com/v2/skip-times/21/1',
      url: 'https://api.aniskip.com/v2/skip-times/21/1?types=op&episodeLength=1420',
      allow404: true,
    }),
    runHttpProbe({
      id: 'fanart',
      name: 'Fanart.tv Artwork CDN',
      category: 'artwork',
      endpoint: 'HEAD https://assets.fanart.tv/fanart/*',
      url: 'https://assets.fanart.tv/fanart/demon-slayer-kimetsu-no-yaiba-5ce04655066e4.png',
      init: { method: 'HEAD' },
    }),
    runHttpProbe({
      id: 'firestore',
      name: 'Firebase Firestore REST',
      category: 'database',
      endpoint: 'GET firestore.googleapis.com/v1',
      url: firestoreProbeUrl,
      allow404: true,
    }),
  ]);

  const supabaseProbe: ServiceHealthProbe = supabaseUrl
    ? await runHttpProbe({
        id: 'supabase',
        name: 'Supabase Artwork Storage',
        category: 'storage',
        endpoint: `HEAD ${supabaseUrl.replace(/\/+$/, '')}/storage/v1`,
        url: `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/bucket`,
        init: { method: 'HEAD' },
        allow404: true,
      })
    : {
        id: 'supabase',
        name: 'Supabase Artwork Storage',
        category: 'storage',
        endpoint: 'ENV NEXT_PUBLIC_SUPABASE_URL',
        status: 'degraded',
        responseTimeMs: 0,
        statusCode: 0,
        errorMessage: 'Supabase environment variables not configured',
        checkedAt: new Date().toISOString(),
      };

  return [...probes, supabaseProbe];
}

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'viewAnalytics')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const runLive = searchParams.get('probe') !== 'false';

  const probes = runLive ? await runAllHealthProbes() : [];
  const perfSummary = getPerfSummaryStats();
  const providerTelemetry = getDetailedProviderTelemetry([
    'hoshika',
    'anilist',
    'megaplay',
    'zokoanime',
    'aniskip',
    'fanart',
  ]);
  const telemetrySeries = getTelemetryTimeSeries(5, 12);
  const cacheStats = appCache.getStats();
  const artworkCacheStats = getArtworkCacheStats();

  const fanartKey = (
    process.env.FANART_API_KEY ||
    process.env.FANART_TV_API_KEY ||
    ''
  ).trim();

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    probes,
    perfSummary,
    providerTelemetry,
    telemetrySeries,
    cacheStats,
    artworkCacheStats,
    hoshikaStatus: getHoshikaClientStatus(),
    environment: {
      fanartConfigured: Boolean(fanartKey && fanartKey !== 'MY_FANART_API_KEY' && fanartKey.length > 5),
      supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      firebaseAdminConfigured: Boolean(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY),
    },
  });
}

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'viewAnalytics')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const probes = await runAllHealthProbes();
  const failing = probes.filter((p) => p.status !== 'operational');

  for (const probe of failing) {
    await logErrorEventServer(verified.idToken, {
      severity: probe.status === 'outage' ? 'critical' : 'warning',
      category: probe.category === 'streaming' ? 'stream' : probe.category === 'artwork' ? 'artwork' : 'api',
      provider: probe.id,
      endpoint: probe.endpoint,
      statusCode: probe.statusCode,
      message: probe.errorMessage || `${probe.name} reported ${probe.status}`,
    });
  }

  await logAdminActionServer(verified, {
    category: 'monitoring',
    action: 'Executed live API health probe suite',
    targetId: 'system_probes',
    targetName: 'API & Infrastructure Health',
    details: `${probes.length - failing.length}/${probes.length} services operational`,
  });

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    probes,
  });
}
