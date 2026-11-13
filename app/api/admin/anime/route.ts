import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  fetchFirestoreDocumentRest,
  listFirestoreCollectionRest,
  verifyAdminRequest,
} from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';
import {
  getHoshikaAnime,
  getHoshikaCatalog,
  getHoshikaEpisodes,
  invalidateHoshikaCacheForAnime,
} from '@/lib/hoshika';
import { resolveAnimeIds } from '@/lib/id-mapper';
import { invalidateCachedArtwork } from '@/lib/artwork/artwork-cache';
import { selectStreamingProvider } from '@/lib/stream-provider-core';
import { logAdminActionServer } from '@/lib/admin/server-audit';

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageAnime')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const hoshikaIdParam = searchParams.get('hoshikaId');
  const refresh = searchParams.get('refresh') === 'true';

  if (hoshikaIdParam) {
    const id = parseInt(hoshikaIdParam, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid hoshikaId' }, { status: 400 });
    }

    const [anime, episodesData, artworkOverride] = await Promise.all([
      getHoshikaAnime(id, 'en', refresh),
      getHoshikaEpisodes(id, 'en', undefined, 25, refresh).catch(() => ({
        items: [],
        total: 0,
        nextAfter: null,
      })),
      fetchFirestoreDocumentRest('animeArtwork', String(id), verified.idToken),
    ]);

    if (!anime) {
      return NextResponse.json(
        { error: 'Anime not found in Hoshika catalogue' },
        { status: 404 }
      );
    }

    const idMap = await resolveAnimeIds(id, anime).catch(() => null);
    const provider = selectStreamingProvider({ format: anime.format });

    return NextResponse.json({
      ok: true,
      anime,
      idMap,
      provider,
      episodesTotal: episodesData.total,
      episodesSample: episodesData.items.slice(0, 12),
      artworkOverride,
    });
  }

  const q = searchParams.get('q')?.trim() || undefined;
  const format = searchParams.get('format')?.trim() || undefined;
  const status = searchParams.get('status')?.trim() || undefined;
  const year = searchParams.get('year')?.trim() || undefined;
  const season = searchParams.get('season')?.trim() || undefined;
  const sort = searchParams.get('sort')?.trim() || 'popularity';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);

  const [catalog, artworkOverrides] = await Promise.all([
    getHoshikaCatalog(
      {
        q,
        format,
        status,
        year,
        season,
        sort,
        page,
        perPage: 30,
      },
      refresh
    ),
    listFirestoreCollectionRest('animeArtwork', 300, verified.idToken),
  ]);

  const artworkMap = new Map<number, Record<string, any>>();
  for (const doc of artworkOverrides) {
    const hid = Number(doc.data?.hoshikaId || doc.id);
    if (Number.isFinite(hid) && hid > 0) {
      artworkMap.set(hid, doc.data);
    }
  }

  const items = catalog.results.map((item) => {
    const ov = artworkMap.get(item.shortId);
    return {
      ...item,
      streamProvider: selectStreamingProvider({ format: item.format }),
      artworkStatus: ov
        ? {
            logoStatus: ov.logoStatus || 'valid',
            selectionMode: ov.selectionMode || 'auto',
            selectedLogoUrl: ov.selectedLogoUrl || '',
            reviewed: Boolean(ov.reviewed),
          }
        : null,
    };
  });

  return NextResponse.json({
    ok: true,
    items,
    currentPage: catalog.currentPage,
    totalPages: catalog.totalPages,
    totalItems: catalog.total,
    hasNextPage: catalog.hasNextPage,
    hasPreviousPage: catalog.hasPreviousPage,
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

  if (action === 'refresh_anime') {
    if (!Number.isFinite(hoshikaId) || hoshikaId <= 0) {
      return NextResponse.json({ error: 'Valid hoshikaId required' }, { status: 400 });
    }

    invalidateHoshikaCacheForAnime(hoshikaId, true);
    invalidateCachedArtwork(hoshikaId);
    const freshAnime = await getHoshikaAnime(hoshikaId, 'en', true);

    try {
      revalidatePath('/');
      revalidatePath('/explore');
      revalidatePath(`/anime/${hoshikaId}`);
    } catch {
      // Ignore outside request context
    }

    await logAdminActionServer(verified, {
      category: 'anime',
      action: 'Force-refreshed anime metadata & cache',
      targetId: hoshikaId,
      targetName:
        freshAnime?.titleEnglish ||
        freshAnime?.titleRomaji ||
        `Anime #${hoshikaId}`,
      details: `Invalidated Hoshika + artwork cache and re-fetched metadata for #${hoshikaId}`,
    });

    return NextResponse.json({
      ok: true,
      anime: freshAnime,
    });
  }

  return NextResponse.json(
    { error: `Unknown action: ${action}` },
    { status: 400 }
  );
}
