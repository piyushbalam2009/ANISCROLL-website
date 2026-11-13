import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  verifyAdminRequest,
  fetchFirestoreDocumentServer,
  writeFirestoreDocumentServer,
} from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-auth';
import {
  deleteCustomLogoFromSupabase,
  validateLogoStoragePathForAnime,
} from '@/lib/supabase/server';
import {
  invalidateCachedArtwork,
  setCachedArtworkOverride,
} from '@/lib/artwork/artwork-cache';
import { resolveAnimeLogoSelection } from '@/lib/artwork/logo-selector';
import { getHoshikaAnime, invalidateHoshikaCacheForAnime } from '@/lib/hoshika';
import { resolveAnimeIds } from '@/lib/id-mapper';
import {
  CustomLogoItem,
  DEFAULT_LOGO_DISPLAY_SETTINGS,
  FanartLogoItem,
} from '@/types/artwork';

async function handleDeleteCustomLogo(req: NextRequest) {
  // 1. Authenticate Firebase ID token
  const verified = await verifyAdminRequest(req);
  if (!verified) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized: Valid administrator token required' },
      { status: 401 }
    );
  }

  // 2. Verify admin role & deleteLogos permission in Firestore
  if (
    !hasAdminPermission(verified.admin, 'deleteLogos') &&
    !hasAdminPermission(verified.admin, 'manageArtwork')
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Forbidden: Administrator lacks permission to delete custom logos',
      },
      { status: 403 }
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    const { searchParams } = new URL(req.url);
    body = {
      hoshikaId: searchParams.get('hoshikaId'),
      storagePath: searchParams.get('storagePath'),
      logoId: searchParams.get('logoId'),
    };
  }

  const storagePath =
    typeof body?.storagePath === 'string' ? body.storagePath.trim() : '';
  const logoId = typeof body?.logoId === 'string' ? body.logoId.trim() : '';
  const hoshikaId = Number(body?.hoshikaId);

  if (!storagePath && !logoId) {
    return NextResponse.json(
      { ok: false, error: 'storagePath or logoId is required' },
      { status: 400 }
    );
  }

  // If hoshikaId is provided, load the anime's Firestore document and verify ownership
  if (Number.isFinite(hoshikaId) && hoshikaId > 0) {
    const existingDoc = await fetchFirestoreDocumentServer(
      'animeArtwork',
      String(hoshikaId),
      verified.idToken
    );

    const existingCustomLogos: CustomLogoItem[] = Array.isArray(
      existingDoc?.customLogos
    )
      ? existingDoc.customLogos
      : [];

    const matchedLogo = existingCustomLogos.find(
      (c) =>
        (storagePath && c.storagePath === storagePath) ||
        (logoId && c.id === logoId)
    );

    const targetStoragePath = matchedLogo?.storagePath || storagePath;

    // Validate path ownership against hoshikaId, resolved anilistId, or explicit entry in existingCustomLogos
    if (targetStoragePath) {
      const anime = await getHoshikaAnime(hoshikaId).catch(() => null);
      const idRes = await resolveAnimeIds(hoshikaId, anime).catch(() => null);
      const resolvedAnilistId = idRes?.aniListId || anime?.anilistId || null;
      const allowedPaths = existingCustomLogos
        .map((c) => c.storagePath)
        .filter((p): p is string => Boolean(p));

      const pathValidation = validateLogoStoragePathForAnime({
        storagePath: targetStoragePath,
        anilistId: resolvedAnilistId,
        hoshikaId,
        allowedPaths,
      });

      if (!matchedLogo && !pathValidation.valid) {
        return NextResponse.json(
          {
            ok: false,
            error:
              pathValidation.error ||
              'Invalid storagePath: file does not belong to the specified anime',
          },
          { status: 403 }
        );
      }
    }

    // Step 1: Safely transition active logo selection in Firestore before/alongside deleting storage file
    const remainingCustomLogos = existingCustomLogos.filter(
      (c) =>
        c.id !== (matchedLogo?.id || logoId) &&
        c.storagePath !== targetStoragePath
    );

    const wasActive =
      Boolean(matchedLogo) &&
      (existingDoc?.selectedLogoUrl === matchedLogo?.url ||
        existingDoc?.selectedLogoUrl === matchedLogo?.proxyUrl ||
        matchedLogo?.selected);

    if (existingDoc) {
      const availableLogos: FanartLogoItem[] = Array.isArray(
        existingDoc.availableLogos
      )
        ? existingDoc.availableLogos
        : [];
      const hiddenLogoIds: string[] = Array.isArray(existingDoc.hiddenLogoIds)
        ? existingDoc.hiddenLogoIds
        : [];
      const logoDisplay =
        existingDoc.logoDisplay || DEFAULT_LOGO_DISPLAY_SETTINGS;

      const nextMode: 'auto' | 'manual' = wasActive
        ? 'auto'
        : existingDoc.selectionMode || 'auto';
      const nextManualUrl = wasActive
        ? null
        : existingDoc.selectedLogoUrl || null;
      const nextManualSource = wasActive
        ? undefined
        : existingDoc.selectedLogoSource;
      const nextManualLang = wasActive
        ? undefined
        : existingDoc.selectedLogoLanguage;

      const resolved = resolveAnimeLogoSelection({
        availableLogos,
        customLogos: remainingCustomLogos,
        hiddenLogoIds,
        selectionMode: nextMode,
        manualLogoUrl: nextManualUrl,
        manualLogoSource: nextManualSource,
        manualLogoLanguage: nextManualLang,
        logoDisplay,
        preferEnglish: true,
      });

      const updatedData: Record<string, any> = {
        ...existingDoc,
        hoshikaId,
        selectedLogoUrl: resolved.logoUrl || '',
        selectedLogoSource: resolved.selectedLogoSource,
        selectedLogoLanguage: resolved.selectedLogoLanguage,
        selectionMode: resolved.selectionMode,
        customLogos: remainingCustomLogos,
        logoStatus: resolved.logoStatus,
        hasEnglishLogo: resolved.hasEnglishLogo,
        hasJapaneseLogo: resolved.hasJapaneseLogo,
        previousLogoUrl: existingDoc.selectedLogoUrl || '',
        previousLogoSource:
          existingDoc.selectedLogoSource || 'typography_fallback',
        updatedBy: verified.uid,
        updatedByEmail: verified.email,
      };
      delete updatedData.id;
      delete updatedData.anilistId;

      await writeFirestoreDocumentServer({
        collectionName: 'animeArtwork',
        documentId: String(hoshikaId),
        data: updatedData,
        idToken: verified.idToken,
        includeCreatedAt: false,
      });

      setCachedArtworkOverride(hoshikaId, {
        ...updatedData,
        updatedAt: Date.now(),
      } as any);
    }

    // Step 2: Delete file from Supabase Storage
    if (targetStoragePath) {
      await deleteCustomLogoFromSupabase(targetStoragePath);
    }

    invalidateCachedArtwork(hoshikaId);
    invalidateHoshikaCacheForAnime(hoshikaId, true);
    try {
      revalidatePath('/');
      revalidatePath('/explore');
      revalidatePath(`/anime/${hoshikaId}`);
      revalidatePath(`/admin/artwork/${hoshikaId}`);
    } catch {
      // Ignore outside request context
    }

    return NextResponse.json({
      ok: true,
      deletedStoragePath: targetStoragePath,
      wasActive,
      customLogos: remainingCustomLogos,
    });
  }

  // Fallback for direct rollback deletion when only storagePath is provided
  if (
    !storagePath.startsWith('anime-logos/') ||
    storagePath.includes('..')
  ) {
    return NextResponse.json(
      { ok: false, error: 'Invalid storagePath format' },
      { status: 400 }
    );
  }

  await deleteCustomLogoFromSupabase(storagePath);

  return NextResponse.json({
    ok: true,
    deletedStoragePath: storagePath,
  });
}

export async function POST(req: NextRequest) {
  try {
    return await handleDeleteCustomLogo(req);
  } catch (error) {
    console.error('[Admin Delete Logo API] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to delete custom logo from Supabase Storage',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    return await handleDeleteCustomLogo(req);
  } catch (error) {
    console.error('[Admin Delete Logo API] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to delete custom logo from Supabase Storage',
      },
      { status: 500 }
    );
  }
}
