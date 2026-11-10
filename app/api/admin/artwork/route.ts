import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';
import {
  getArtworkCacheStats,
  invalidateAnimeArtworkCache,
} from '@/lib/artwork/artwork-cache';
import { resolveAnimeArtwork } from '@/lib/artwork-mapper';
import { getHoshikaHome, getHoshikaBrowse, getHoshikaAnime } from '@/lib/hoshika';

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'viewAnalytics')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const searchParams = req.nextUrl.searchParams;
  const hoshikaIdParam = searchParams.get('hoshikaId');

  if (hoshikaIdParam) {
    const hoshikaId = parseInt(hoshikaIdParam, 10);
    if (!Number.isFinite(hoshikaId) || hoshikaId <= 0) {
      return NextResponse.json({ error: 'Invalid hoshikaId' }, { status: 400 });
    }

    const anime = await getHoshikaAnime(hoshikaId, 'en');
    const title =
      anime?.titleEnglish ||
      anime?.titleRomaji ||
      anime?.titleLocalized ||
      searchParams.get('title') ||
      `Anime #${hoshikaId}`;

    const artwork = await resolveAnimeArtwork({
      hoshikaId,
      anilistId: anime?.anilistId || null,
      malId: anime?.malId || null,
      tvdbId: anime?.thetvdbId ? Number(anime.thetvdbId) : null,
      tmdbId: anime?.themoviedbId ? Number(anime.themoviedbId) : null,
      title,
      format: anime?.format || null,
      hoshikaBanner: anime?.bannerImage || null,
      hoshikaCover: anime?.coverImage || null,
      bypassCache: searchParams.get('refresh') === 'true',
    });

    return NextResponse.json({
      anime: anime
        ? {
            hoshikaId: anime.shortId,
            title,
            format: anime.format || 'TV',
            status: anime.status,
            seasonYear: anime.seasonYear,
            averageScore: anime.averageScore,
            coverImage: anime.coverImage || '',
            bannerImage: anime.bannerImage || '',
            anilistId: anime.anilistId || artwork.anilistId || 0,
            malId: anime.malId || artwork.malId || 0,
          }
        : {
            hoshikaId,
            title,
            format: 'TV',
            coverImage: artwork.posterUrl || '',
            bannerImage: artwork.backgroundUrl || '',
            anilistId: artwork.anilistId || 0,
            malId: artwork.malId || 0,
          },
      artwork,
    });
  }

  return NextResponse.json({
    cacheStats: getArtworkCacheStats(),
  });
}

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === 'invalidate_cache') {
    if (
      !hasAdminPermission(verified.admin, 'manageArtwork') &&
      !hasAdminPermission(verified.admin, 'manageSettings')
    ) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }
    const hoshikaId = body.hoshikaId ? Number(body.hoshikaId) : undefined;
    invalidateAnimeArtworkCache(hoshikaId, body.override);
    return NextResponse.json({
      ok: true,
      invalidated: hoshikaId ?? 'all',
      cacheStats: getArtworkCacheStats(),
    });
  }

  if (action === 'scan_catalogue') {
    if (!hasAdminPermission(verified.admin, 'manageArtwork')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const maxItems = Math.min(40, Math.max(5, Number(body.limit) || 20));
    const [homeRes, popularRes] = await Promise.all([
      getHoshikaHome('en').catch(() => null),
      getHoshikaBrowse('top', 'anime').catch(() => []),
    ]);

    const rawCatalogue = [
      ...(homeRes?.trending || []),
      ...(homeRes?.seasonal || []),
      ...(homeRes?.recentlyAdded || []),
      ...(popularRes || []),
    ];

    const uniqueAnimeMap = new Map<number, (typeof rawCatalogue)[number]>();
    for (const item of rawCatalogue) {
      if (item && item.shortId && item.format !== 'MOVIE') {
        if (!uniqueAnimeMap.has(item.shortId)) {
          uniqueAnimeMap.set(item.shortId, item);
        }
      }
      if (uniqueAnimeMap.size >= maxItems) break;
    }

    const candidates = Array.from(uniqueAnimeMap.values());
    const results = [];

    for (const item of candidates) {
      const title =
        item.titleEnglish ||
        item.titleRomaji ||
        item.titleLocalized ||
        `Anime #${item.shortId}`;
      const artwork = await resolveAnimeArtwork({
        hoshikaId: item.shortId,
        anilistId: item.anilistId || null,
        malId: item.malId || null,
        tvdbId: item.thetvdbId ? Number(item.thetvdbId) : null,
        tmdbId: item.themoviedbId ? Number(item.themoviedbId) : null,
        title,
        format: item.format || 'TV',
        hoshikaBanner: item.bannerImage || null,
        hoshikaCover: item.coverImage || null,
      });

      results.push({
        hoshikaId: item.shortId,
        anilistId: artwork.anilistId || item.anilistId || 0,
        tvdbId: artwork.tvdbId || 0,
        tmdbId: artwork.tmdbId || 0,
        title,
        selectedLogoUrl: artwork.logoUrl || '',
        selectedLogoSource: artwork.selectedLogoSource || 'typography_fallback',
        selectedLogoLanguage: artwork.selectedLogoLanguage || 'en',
        selectionMode: artwork.selectionMode || 'auto',
        availableLogos: artwork.availableLogos || [],
        customLogos: artwork.customLogos || [],
        hiddenLogoIds: artwork.hiddenLogoIds || [],
        logoDisplay: artwork.logoDisplay,
        logoStatus: artwork.logoStatus || (artwork.logoUrl ? 'valid' : 'missing'),
        backgroundUrl: artwork.backgroundUrl || item.bannerImage || '',
        posterUrl: artwork.posterUrl || item.coverImage || '',
        hasEnglishLogo: Boolean(artwork.hasEnglishLogo),
        hasJapaneseLogo: Boolean(artwork.hasJapaneseLogo),
        reviewed: Boolean(artwork.reviewed),
        lastChecked: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      scannedCount: results.length,
      results,
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
