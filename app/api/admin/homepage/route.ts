import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  fetchFirestoreDocumentServer,
  verifyAdminRequest,
  writeFirestoreDocumentServer,
} from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';
import {
  AnimeManagementFirestoreDoc,
  DEFAULT_ANIME_MANAGEMENT_CONFIG,
} from '@/lib/admin/admin-firestore';
import { logAdminActionServer } from '@/lib/admin/server-audit';

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageAnime')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const raw = (await fetchFirestoreDocumentServer(
    'animeManagement',
    'homepage',
    verified.idToken
  )) as Partial<AnimeManagementFirestoreDoc> | null;

  const config: Omit<AnimeManagementFirestoreDoc, 'createdAt' | 'updatedAt'> = {
    ...DEFAULT_ANIME_MANAGEMENT_CONFIG,
    ...(raw || {}),
    promoBanner: {
      ...DEFAULT_ANIME_MANAGEMENT_CONFIG.promoBanner,
      ...(raw?.promoBanner || {}),
    },
    sectionOrder:
      Array.isArray(raw?.sectionOrder) && raw.sectionOrder.length > 0
        ? raw.sectionOrder
        : DEFAULT_ANIME_MANAGEMENT_CONFIG.sectionOrder,
    enabledSections: {
      ...DEFAULT_ANIME_MANAGEMENT_CONFIG.enabledSections,
      ...(raw?.enabledSections || {}),
    },
  };

  return NextResponse.json({ ok: true, config });
}

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageAnime')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const featuredAnime = Array.isArray(body?.featuredAnime)
    ? body.featuredAnime.slice(0, 30)
    : [];
  const pinnedSeasonal = Array.isArray(body?.pinnedSeasonal)
    ? body.pinnedSeasonal.slice(0, 30)
    : [];
  const collections = Array.isArray(body?.collections)
    ? body.collections.slice(0, 30)
    : [];

  const featuredAnimeIds = Array.isArray(body?.featuredAnimeIds)
    ? body.featuredAnimeIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0).slice(0, 30)
    : featuredAnime.map((a: any) => Number(a.hoshikaId)).filter((n: number) => Number.isFinite(n) && n > 0);

  const pinnedSeasonalIds = Array.isArray(body?.pinnedSeasonalIds)
    ? body.pinnedSeasonalIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0).slice(0, 30)
    : pinnedSeasonal.map((a: any) => Number(a.hoshikaId)).filter((n: number) => Number.isFinite(n) && n > 0);

  const promoBanner = {
    ...DEFAULT_ANIME_MANAGEMENT_CONFIG.promoBanner,
    ...(body?.promoBanner && typeof body.promoBanner === 'object' ? body.promoBanner : {}),
    enabled: Boolean(body?.promoBanner?.enabled),
    hoshikaId: Number(body?.promoBanner?.hoshikaId) || 0,
  };

  const sectionOrder =
    Array.isArray(body?.sectionOrder) && body.sectionOrder.length > 0
      ? body.sectionOrder.map(String).slice(0, 20)
      : DEFAULT_ANIME_MANAGEMENT_CONFIG.sectionOrder;

  const enabledSections =
    body?.enabledSections && typeof body.enabledSections === 'object'
      ? body.enabledSections
      : DEFAULT_ANIME_MANAGEMENT_CONFIG.enabledSections;

  const payload: Omit<AnimeManagementFirestoreDoc, 'createdAt' | 'updatedAt'> = {
    configId: 'homepage',
    featuredAnimeIds,
    featuredAnime,
    pinnedSeasonalIds,
    pinnedSeasonal,
    collections,
    promoBanner,
    sectionOrder,
    enabledSections,
    updatedByUid: verified.uid,
    updatedByEmail: (verified.email || 'admin@aniscroll.app').slice(0, 256),
  };

  await writeFirestoreDocumentServer({
    collectionPath: 'animeManagement',
    docId: 'homepage',
    data: payload,
    idToken: verified.idToken,
  });

  try {
    revalidatePath('/');
  } catch {
    // Ignore outside request context
  }

  await logAdminActionServer(verified, {
    category: 'homepage',
    action: 'Updated homepage layout & curation',
    targetId: 'homepage',
    targetName: 'Homepage Curation & Sections',
    details: `${featuredAnimeIds.length} featured, ${pinnedSeasonalIds.length} pinned seasonal, ${collections.length} collections`,
  });

  return NextResponse.json({ ok: true, config: payload });
}
