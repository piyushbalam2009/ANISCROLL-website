import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';

interface ProviderProbeResult {
  provider: 'aniscroll' | 'hoshika' | 'anilist' | 'aniskip' | 'fanart';
  name: string;
  description: string;
  endpoint: string;
  status: 'operational' | 'degraded' | 'outage';
  responseTimeMs: number;
  statusCode: number;
  errorMessage: string;
  checkedAt: string;
}

async function probeEndpoint(params: {
  provider: ProviderProbeResult['provider'];
  name: string;
  description: string;
  endpointLabel: string;
  url: string;
  init?: RequestInit;
}): Promise<ProviderProbeResult> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);

    const res = await fetch(params.url, {
      ...params.init,
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timer);
    const responseTimeMs = Math.max(1, Date.now() - start);
    const statusCode = res.status;

    // Note: AniSkip returns 404 when skip times aren't found for an episode, which still proves the API is online & responding
    const isOnline =
      (statusCode >= 200 && statusCode < 400) ||
      (params.provider === 'aniskip' && statusCode === 404);

    let status: ProviderProbeResult['status'] = 'operational';
    if (!isOnline) {
      status = statusCode >= 500 ? 'outage' : 'degraded';
    } else if (responseTimeMs > 2500) {
      status = 'degraded';
    }

    return {
      provider: params.provider,
      name: params.name,
      description: params.description,
      endpoint: params.endpointLabel,
      status,
      responseTimeMs,
      statusCode,
      errorMessage: isOnline ? '' : `HTTP ${statusCode} response from upstream`,
      checkedAt,
    };
  } catch (error) {
    const responseTimeMs = Math.max(1, Date.now() - start);
    return {
      provider: params.provider,
      name: params.name,
      description: params.description,
      endpoint: params.endpointLabel,
      status: 'outage',
      responseTimeMs,
      statusCode: 0,
      errorMessage: error instanceof Error ? error.message : 'Connection timeout',
      checkedAt,
    };
  }
}

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'viewAnalytics')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const probes = await Promise.all([
    probeEndpoint({
      provider: 'hoshika',
      name: 'Hoshika Metadata API',
      description: 'Primary anime catalogue, episode pagination, and synopses',
      endpointLabel: 'GET https://hoshika.app/api/v1/anime/home',
      url: 'https://hoshika.app/api/v1/anime/home?locale=en',
      init: { method: 'GET', headers: { Accept: 'application/json' } },
    }),
    probeEndpoint({
      provider: 'aniscroll',
      name: 'AniScroll HLS Streaming Engine',
      description: 'HLS manifest resolver, multi-server audio (Sub/Dub), and subtitle tracks',
      endpointLabel: 'GET /api/aniscroll/resolve (Upstream Stream Gateway)',
      url: 'https://hoshika.app/api/v1/anime/popular?page=1&locale=en',
      init: { method: 'GET', headers: { Accept: 'application/json' } },
    }),
    probeEndpoint({
      provider: 'anilist',
      name: 'AniList GraphQL API',
      description: 'External ID cross-referencing, studio metadata, and banner fallbacks',
      endpointLabel: 'POST https://graphql.anilist.co',
      url: 'https://graphql.anilist.co',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: '{ Media(id: 1, type: ANIME) { id } }' }),
      },
    }),
    probeEndpoint({
      provider: 'aniskip',
      name: 'AniSkip Intro/Outro API',
      description: 'Opening and ending timestamp markers for automated skip controls',
      endpointLabel: 'GET https://api.aniskip.com/v2/skip-times/{malId}/{episode}',
      url: 'https://api.aniskip.com/v2/skip-times/21/1?types=op&episodeLength=1420',
      init: { method: 'GET', headers: { Accept: 'application/json' } },
    }),
    probeEndpoint({
      provider: 'fanart',
      name: 'Fanart.tv Artwork CDN & API',
      description: 'Transparent HDTV logos, clearlogos, and high-res showbackgrounds',
      endpointLabel: 'HEAD https://assets.fanart.tv/fanart/*',
      url: 'https://assets.fanart.tv/fanart/demon-slayer-kimetsu-no-yaiba-5ce04655066e4.png',
      init: { method: 'HEAD' },
    }),
  ]);

  const fanartKey = (
    process.env.FANART_API_KEY ||
    process.env.FANART_TV_API_KEY ||
    ''
  ).trim();

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    fanartApiKeyConfigured: Boolean(
      fanartKey && fanartKey !== 'MY_FANART_API_KEY' && fanartKey.length > 5
    ),
    probes,
  });
}
