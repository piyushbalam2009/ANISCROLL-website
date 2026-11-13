import { NextRequest, NextResponse } from 'next/server';
import { listFirestoreCollectionRest, verifyAdminRequest, writeFirestoreDocumentServer } from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';
import { getDetailedProviderTelemetry } from '@/lib/perf-monitor';
import { getAniScrollStream } from '@/lib/aniscroll';
import { selectStreamingProvider } from '@/lib/stream-provider-core';
import { redactSensitiveText, sanitizeDiagnosticUrl } from '@/lib/admin/redaction';
import { logAdminActionServer, logErrorEventServer } from '@/lib/admin/server-audit';

interface ProviderProbeResult {
  provider: 'aniscroll' | 'hoshika' | 'anilist' | 'aniskip' | 'fanart' | 'megaplay' | 'zokoanime';
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
      errorMessage: error instanceof Error ? redactSensitiveText(error.message, 256) : 'Connection timeout',
      checkedAt,
    };
  }
}

async function runStreamingProbes(): Promise<ProviderProbeResult[]> {
  return Promise.all([
    probeEndpoint({
      provider: 'megaplay',
      name: 'MegaPlay (Anime Series)',
      description: 'Primary TV / OVA / ONA / Special series streaming gateway (Sub & Dub)',
      endpointLabel: 'GET https://api.aniscroll.in/api/watch/megaplay/{anilist_id}/{episode}/{sub|dub}',
      url: 'https://api.aniscroll.in/api/watch/megaplay/21/1/sub',
      init: { method: 'GET', headers: { Accept: 'application/json' } },
    }),
    probeEndpoint({
      provider: 'zokoanime',
      name: 'ZokoAnime (Anime Movies)',
      description: 'Dedicated movie streaming gateway preserving movie playback routing',
      endpointLabel: 'GET https://api.aniscroll.in/api/watch/zokoanime/{anilist_id}/{episode}/{sub|dub}',
      url: 'https://api.aniscroll.in/api/watch/zokoanime/16498/1/sub',
      init: { method: 'GET', headers: { Accept: 'application/json' } },
    }),
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
}

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'viewAnalytics')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [probes, logsDocs] = await Promise.all([
    runStreamingProbes(),
    listFirestoreCollectionRest('streamingLogs', 50, verified.idToken),
  ]);

  const fanartKey = (
    process.env.FANART_API_KEY ||
    process.env.FANART_TV_API_KEY ||
    ''
  ).trim();

  const providerTelemetry = getDetailedProviderTelemetry([
    'megaplay',
    'zokoanime',
    'hoshika',
    'anilist',
    'aniskip',
    'fanart',
  ]);

  const historyLogs = logsDocs
    .map((d) => d.data)
    .sort((a: any, b: any) => String(b.checkedAt || '').localeCompare(String(a.checkedAt || '')));

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    fanartApiKeyConfigured: Boolean(
      fanartKey && fanartKey !== 'MY_FANART_API_KEY' && fanartKey.length > 5
    ),
    probes,
    providerTelemetry,
    historyLogs,
  });
}

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'viewAnalytics')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || '');

  if (action === 'test_stream') {
    const anilistId = Math.max(1, Math.floor(Number(body?.anilistId) || 0));
    const episode = Math.max(1, Math.floor(Number(body?.episode) || 1));
    const audioType = body?.audioType === 'dub' ? 'dub' : 'sub';
    const format = String(body?.format || 'TV');

    if (!anilistId) {
      return NextResponse.json({ error: 'Valid AniList ID required' }, { status: 400 });
    }

    const provider = selectStreamingProvider({ format });
    const start = Date.now();
    const stream = await getAniScrollStream(anilistId, episode, audioType, {
      provider,
      format,
    });
    const latencyMs = Math.max(1, Date.now() - start);

    const primaryUrl =
      stream?.m3u8 ||
      stream?.hlsProxyUrl ||
      stream?.qualities?.[0]?.hlsProxyUrl ||
      stream?.embedUrl ||
      '';
    const sanitizedUrl = primaryUrl ? sanitizeDiagnosticUrl(primaryUrl) : '';
    const tracksCount = Array.isArray(stream?.qualities) && stream.qualities.length > 0
      ? stream.qualities.length
      : primaryUrl
      ? 1
      : 0;
    const subtitlesCount = Array.isArray(stream?.subtitles) ? stream.subtitles.length : 0;

    if (!stream || !primaryUrl) {
      await logErrorEventServer(verified.idToken, {
        severity: 'warning',
        category: 'stream',
        provider,
        endpoint: `/api/watch/${provider}/${anilistId}/${episode}/${audioType}`,
        message: `Admin stream test found no playable ${audioType} stream for AniList #${anilistId} Ep ${episode}`,
      });
    }

    await logAdminActionServer(verified, {
      category: 'monitoring',
      action: `Tested ${provider} stream endpoint`,
      targetId: `${anilistId}-${episode}`,
      targetName: `AniList #${anilistId} Ep ${episode} (${audioType.toUpperCase()})`,
      details: stream
        ? `Resolved ${provider} (${format}) in ${latencyMs}ms with ${tracksCount} source(s)`
        : `No stream returned from ${provider} (${format}) in ${latencyMs}ms`,
    });

    return NextResponse.json({
      ok: true,
      provider,
      format,
      anilistId,
      episode,
      audioType,
      playable: Boolean(stream && primaryUrl),
      url: sanitizedUrl,
      tracksCount,
      subtitlesCount,
      latencyMs,
    });
  }

  if (action === 'log_probes') {
    const probes = await runStreamingProbes();
    const savedCount = await Promise.all(
      probes.map(async (p) => {
        const id = `smon_${Date.now()}_${p.provider}_${Math.random().toString(36).slice(2, 6)}`;
        await writeFirestoreDocumentServer({
          collectionPath: 'streamingLogs',
          docId: id,
          data: {
            id,
            provider: p.provider,
            endpoint: redactSensitiveText(p.endpoint, 512),
            status: p.status,
            responseTimeMs: Math.round(p.responseTimeMs),
            statusCode: Math.round(p.statusCode),
            errorMessage: redactSensitiveText(p.errorMessage || '', 1024),
            checkedAt: p.checkedAt,
          },
          idToken: verified.idToken,
          includeUpdatedAt: false,
        }).catch(() => false);
        return true;
      })
    );

    return NextResponse.json({
      ok: true,
      probes,
      savedCount: savedCount.length,
    });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
