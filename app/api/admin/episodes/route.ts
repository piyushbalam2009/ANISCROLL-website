import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { verifyAdminRequest } from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';
import {
  getAllHoshikaEpisodes,
  getHoshikaAnime,
  invalidateHoshikaCacheForAnime,
} from '@/lib/hoshika';
import { resolveAnimeIds } from '@/lib/id-mapper';
import { resolveServerAudioAvailability } from '@/lib/aniscroll';
import { selectStreamingProvider, buildProviderWatchUrl } from '@/lib/stream-provider-core';
import { sanitizeDiagnosticPayload } from '@/lib/admin/redaction';
import { logAdminActionServer } from '@/lib/admin/server-audit';

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageAnime')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get('hoshikaId');
  const refresh = searchParams.get('refresh') === 'true';
  const checkAudio = searchParams.get('checkAudio') === 'true';

  if (!idParam) {
    return NextResponse.json({ error: 'hoshikaId is required' }, { status: 400 });
  }

  const hoshikaId = parseInt(idParam, 10);
  if (!Number.isFinite(hoshikaId) || hoshikaId <= 0) {
    return NextResponse.json({ error: 'Invalid hoshikaId' }, { status: 400 });
  }

  if (refresh) {
    invalidateHoshikaCacheForAnime(hoshikaId, false);
  }

  const [anime, episodesData] = await Promise.all([
    getHoshikaAnime(hoshikaId, 'en', refresh),
    getAllHoshikaEpisodes(hoshikaId, 'en', 10, refresh),
  ]);

  if (!anime) {
    return NextResponse.json({ error: 'Anime not found' }, { status: 404 });
  }

  const idMap = await resolveAnimeIds(hoshikaId, anime).catch(() => null);
  const anilistId = idMap?.aniListId || idMap?.anilistId || anime.anilistId || null;
  const isStandaloneMovie = Boolean(anime.isStandaloneMovie || anime.standaloneMovie);
  const provider = selectStreamingProvider({
    format: anime.format,
    isStandaloneMovie,
  });

  const audioAvailability =
    checkAudio && anilistId
      ? await resolveServerAudioAvailability({
          hoshikaId,
          anilistId,
          episodeCount: episodesData.total || episodesData.items.length,
          prefetchedAnime: anime,
          format: anime.format,
          isStandaloneMovie,
        }).catch(() => null)
      : null;

  const missingThumbnailCount = episodesData.items.filter(
    (ep) => !ep.thumbnail || !ep.thumbnail.trim()
  ).length;
  const fillerCount = episodesData.items.filter((ep) => Boolean(ep.filler)).length;
  const recapCount = episodesData.items.filter((ep) => Boolean(ep.recap)).length;

  return NextResponse.json({
    ok: true,
    anime: {
      shortId: anime.shortId,
      title: anime.titleEnglish || anime.titleRomaji || `Anime #${hoshikaId}`,
      format: anime.format || 'UNKNOWN',
      status: anime.status || 'UNKNOWN',
      coverImage: anime.coverImage || '',
      anilistId,
      malId: idMap?.malId || anime.malId || null,
      provider,
      sampleStreamEndpoint: anilistId
        ? buildProviderWatchUrl(provider, anilistId, 1, 'sub')
        : null,
    },
    stats: {
      totalReported: episodesData.total,
      loadedCount: episodesData.items.length,
      missingThumbnailCount,
      fillerCount,
      recapCount,
    },
    audioAvailability,
    episodes: episodesData.items,
    sanitizedPayloadPreview: sanitizeDiagnosticPayload({
      idMap,
      firstEpisode: episodesData.items[0] || null,
      audioAvailability,
    }),
  });
}

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageAnime')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || '');
  const hoshikaId = Number(body?.hoshikaId);

  if (action === 'refresh_episodes') {
    if (!Number.isFinite(hoshikaId) || hoshikaId <= 0) {
      return NextResponse.json({ error: 'Valid hoshikaId required' }, { status: 400 });
    }

    invalidateHoshikaCacheForAnime(hoshikaId, false);
    const episodesData = await getAllHoshikaEpisodes(hoshikaId, 'en', 10, true);

    try {
      revalidatePath(`/anime/${hoshikaId}`);
      revalidatePath(`/watch/${hoshikaId}`);
    } catch {
      // Ignore outside request context
    }

    await logAdminActionServer(verified, {
      category: 'episodes',
      action: 'Refreshed episode list cache',
      targetId: hoshikaId,
      targetName: `Anime #${hoshikaId}`,
      details: `Cleared episode cache and re-indexed ${episodesData.items.length} episodes`,
    });

    return NextResponse.json({
      ok: true,
      loadedCount: episodesData.items.length,
      total: episodesData.total,
    });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
