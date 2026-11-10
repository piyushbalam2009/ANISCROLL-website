import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/firebase-admin';
import {
  invalidateCachedArtwork,
  setCachedArtworkOverride,
} from '@/lib/artwork/artwork-cache';
import {
  resolveAnimeArtwork,
  resolveExternalIdsFromAnilist,
} from '@/lib/artwork-mapper';
import {
  getHoshikaAnime,
  getHoshikaHome,
  getHoshikaBrowse,
  getHoshikaCatalog,
} from '@/lib/hoshika';
import {
  resolveAnimeIds,
  searchAndScoreAniListCandidates,
} from '@/lib/id-mapper';
import { HoshikaAnimeItem } from '@/types/anime';

let isScanningCatalogue = false;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  // 1. Admin AniList ID Lookup & Verification Tool (in-memory only, zero Firebase persistence)
  if (action === 'search_anilist') {
    const verified = await verifyAdminRequest(req);
    if (!verified) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: Valid administrator token required' },
        { status: 401 }
      );
    }

    const q = searchParams.get('q')?.trim() || '';
    if (!q) {
      return NextResponse.json(
        { ok: false, error: 'Search query (q) is required' },
        { status: 400 }
      );
    }

    const yearParam = searchParams.get('year');
    const year = yearParam ? parseInt(yearParam, 10) : null;
    const format = searchParams.get('format') || null;

    try {
      const { collectedTitles, candidates } = await searchAndScoreAniListCandidates(
        q,
        {
          year: Number.isFinite(year) ? year : null,
          format,
        }
      );

      return NextResponse.json({
        ok: true,
        query: q,
        collectedTitles: collectedTitles.allUniqueTitles,
        candidates,
      });
    } catch (error) {
      console.error('[Admin Artwork API] AniList lookup failed:', error);
      return NextResponse.json(
        { ok: false, error: 'Failed to search AniList candidates' },
        { status: 502 }
      );
    }
  }

  // 2. Single Anime Artwork + In-Memory AniList Resolution Diagnostics
  const idStr = searchParams.get('hoshikaId');
  const refresh = searchParams.get('refresh') === 'true';

  if (!idStr) {
    return NextResponse.json(
      { ok: false, error: 'hoshikaId is required' },
      { status: 400 }
    );
  }

  const hoshikaId = parseInt(idStr, 10);
  if (!Number.isFinite(hoshikaId) || hoshikaId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'Invalid hoshikaId' },
      { status: 400 }
    );
  }

  try {
    if (refresh) {
      invalidateCachedArtwork(hoshikaId);
    }

    const anime = await getHoshikaAnime(hoshikaId);
    if (!anime) {
      return NextResponse.json(
        { ok: false, error: 'Anime not found in Hoshika catalogue' },
        { status: 404 }
      );
    }

    const [artwork, idResolution] = await Promise.all([
      resolveAnimeArtwork(
        {
          hoshikaId,
          anilistId: anime.anilistId || null,
          malId: anime.malId || null,
          tvdbId: anime.thetvdbId ? Number(anime.thetvdbId) : null,
          tmdbId: anime.themoviedbId ? Number(anime.themoviedbId) : null,
          title: anime.titleEnglish || anime.titleRomaji || `Anime #${hoshikaId}`,
          titleRomaji: anime.titleRomaji || null,
          format: anime.format || null,
          hoshikaBanner: anime.bannerImage || null,
          hoshikaCover: anime.coverImage || null,
          bypassCache: refresh,
        },
        anime
      ),
      resolveAnimeIds(hoshikaId, anime).catch(() => null),
    ]);

    return NextResponse.json({
      ok: true,
      anime,
      artwork,
      idResolution,
    });
  } catch (error) {
    console.error('[Admin Artwork API] GET failed:', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to resolve anime artwork' },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);

  if (!verified) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized: Valid administrator token required' },
      { status: 401 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON request body' },
      { status: 400 }
    );
  }

  const action = body?.action;

  try {
    if (action === 'invalidate_cache') {
      const hoshikaId = Number(body?.hoshikaId);
      if (Number.isFinite(hoshikaId) && hoshikaId > 0) {
        invalidateCachedArtwork(hoshikaId);
        if (body?.override) {
          setCachedArtworkOverride(hoshikaId, body.override);
        }
      } else {
        invalidateCachedArtwork();
      }
      return NextResponse.json({
        ok: true,
        message: 'Artwork cache invalidated',
      });
    }

    // Session-only preview of an AniList candidate (resolves TVDB/TMDB via ani.zip + Fanart logos in memory)
    if (action === 'preview_anilist_candidate') {
      const hoshikaId = Number(body?.hoshikaId);
      const candidateAnilistId = Number(body?.anilistId);
      if (!Number.isFinite(hoshikaId) || hoshikaId <= 0 || !Number.isFinite(candidateAnilistId) || candidateAnilistId <= 0) {
        return NextResponse.json(
          { ok: false, error: 'Valid hoshikaId and anilistId are required' },
          { status: 400 }
        );
      }

      const anime = await getHoshikaAnime(hoshikaId);
      const extIds = await resolveExternalIdsFromAnilist(candidateAnilistId);
      invalidateCachedArtwork(hoshikaId);

      const artwork = await resolveAnimeArtwork({
        hoshikaId,
        anilistId: candidateAnilistId,
        malId: extIds.malId || anime?.malId || null,
        tvdbId: extIds.tvdbId || (anime?.thetvdbId ? Number(anime.thetvdbId) : null),
        tmdbId: extIds.tmdbId || (anime?.themoviedbId ? Number(anime.themoviedbId) : null),
        title: anime?.titleEnglish || anime?.titleRomaji || body?.title || `Anime #${hoshikaId}`,
        titleRomaji: anime?.titleRomaji || null,
        format: anime?.format || body?.format || null,
        hoshikaBanner: anime?.bannerImage || null,
        hoshikaCover: anime?.coverImage || null,
        bypassCache: true,
      });

      return NextResponse.json({
        ok: true,
        sessionOnly: true,
        externalIds: extIds,
        artwork,
      });
    }

    if (action === 'scan_catalogue') {
      if (isScanningCatalogue) {
        return NextResponse.json(
          { ok: false, error: 'A catalogue artwork scan is already in progress' },
          { status: 409 }
        );
      }

      isScanningCatalogue = true;
      try {
        const requestedLimit = Math.min(120, Math.max(10, Number(body?.limit) || 60));
        const catalogPage = Math.max(1, Number(body?.page) || 1);

        // Collect anime from multiple Hoshika sources (including MOVIE format)
        const [homeData, trendingList, topList, recentList, catalogData] =
          await Promise.all([
            getHoshikaHome().catch(() => null),
            getHoshikaBrowse('trending').catch(() => []),
            getHoshikaBrowse('top').catch(() => []),
            getHoshikaBrowse('recent').catch(() => []),
            getHoshikaCatalog({ page: catalogPage }).catch(() => ({ items: [] })),
          ]);

        const combined: HoshikaAnimeItem[] = [
          ...(homeData?.trending || []),
          ...(homeData?.seasonal || []),
          ...(homeData?.recentlyAdded || []),
          ...(trendingList || []),
          ...(topList || []),
          ...(recentList || []),
          ...(catalogData?.items || []),
        ];

        const uniqueMap = new Map<number, HoshikaAnimeItem>();
        for (const item of combined) {
          // Include all valid anime formats (TV, MOVIE, ONA, OVA, SPECIAL)
          if (item?.shortId && !uniqueMap.has(item.shortId)) {
            uniqueMap.set(item.shortId, item);
          }
        }

        const itemsToScan = Array.from(uniqueMap.values()).slice(0, requestedLimit);
        const results: Array<{
          hoshikaId: number;
          tvdbId: number;
          tmdbId: number;
          title: string;
          format: string;
          posterUrl: string;
          backgroundUrl: string;
          selectedLogoUrl: string;
          selectedLogoSource: string;
          selectedLogoLanguage: string;
          availableLogosCount: number;
          hasEnglishLogo: boolean;
          hasJapaneseLogo: boolean;
          logoStatus: string;
          upstreamError?: boolean;
        }> = [];

        let upstreamErrors = 0;
        const BATCH_SIZE = 5;

        for (let i = 0; i < itemsToScan.length; i += BATCH_SIZE) {
          const batch = itemsToScan.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(async (item) => {
              try {
                const artwork = await resolveAnimeArtwork(
                  {
                    hoshikaId: item.shortId,
                    anilistId: item.anilistId || null,
                    malId: item.malId || null,
                    tvdbId: item.thetvdbId ? Number(item.thetvdbId) : null,
                    tmdbId: item.themoviedbId ? Number(item.themoviedbId) : null,
                    title: item.titleEnglish || item.titleRomaji || 'Unknown',
                    titleRomaji: item.titleRomaji || null,
                    format: item.format || null,
                    hoshikaBanner: item.bannerImage || null,
                    hoshikaCover: item.coverImage || null,
                  },
                  item
                );

                return {
                  hoshikaId: item.shortId,
                  tvdbId: artwork.tvdbId || 0,
                  tmdbId: artwork.tmdbId || 0,
                  title:
                    item.titleEnglish ||
                    item.titleRomaji ||
                    artwork.title ||
                    `Anime #${item.shortId}`,
                  format: item.format || 'TV',
                  posterUrl: artwork.posterUrl || item.coverImage || '',
                  backgroundUrl: artwork.backgroundUrl || item.bannerImage || '',
                  selectedLogoUrl: artwork.logoUrl || '',
                  selectedLogoSource:
                    artwork.selectedLogoSource || 'typography_fallback',
                  selectedLogoLanguage: artwork.selectedLogoLanguage || 'en',
                  availableLogosCount: artwork.availableLogos?.length || 0,
                  hasEnglishLogo: Boolean(artwork.hasEnglishLogo),
                  hasJapaneseLogo: Boolean(artwork.hasJapaneseLogo),
                  logoStatus: artwork.logoStatus || 'missing',
                  upstreamError: false,
                };
              } catch {
                upstreamErrors++;
                return {
                  hoshikaId: item.shortId,
                  tvdbId: 0,
                  tmdbId: 0,
                  title:
                    item.titleEnglish ||
                    item.titleRomaji ||
                    `Anime #${item.shortId}`,
                  format: item.format || 'TV',
                  posterUrl: item.coverImage || '',
                  backgroundUrl: item.bannerImage || '',
                  selectedLogoUrl: '',
                  selectedLogoSource: 'typography_fallback',
                  selectedLogoLanguage: 'en',
                  availableLogosCount: 0,
                  hasEnglishLogo: false,
                  hasJapaneseLogo: false,
                  logoStatus: 'upstream_error',
                  upstreamError: true,
                };
              }
            })
          );
          results.push(...batchResults);
        }

        const validResults = results.filter((r) => !r.upstreamError);
        return NextResponse.json({
          ok: true,
          scannedCount: results.length,
          missingCount: validResults.filter(
            (r) => !r.selectedLogoUrl || r.logoStatus === 'missing'
          ).length,
          japaneseOnlyCount: validResults.filter(
            (r) => r.logoStatus === 'japanese_only'
          ).length,
          upstreamErrorCount: upstreamErrors,
          results,
        });
      } finally {
        isScanningCatalogue = false;
      }
    }

    return NextResponse.json(
      { ok: false, error: `Unknown action: ${String(action)}` },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Admin Artwork API] POST error:', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to execute artwork admin action' },
      { status: 500 }
    );
  }
}
