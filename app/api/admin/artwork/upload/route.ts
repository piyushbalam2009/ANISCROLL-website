import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';
import {
  verifyAdminRequest,
  fetchFirestoreDocumentServer,
  writeFirestoreDocumentServer,
} from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-auth';
import {
  validateLogoUploadBuffer,
  buildSupabaseLogoStoragePath,
  uploadCustomLogoToSupabase,
  deleteCustomLogoFromSupabase,
  getSupabaseBucketName,
} from '@/lib/supabase/server';
import {
  invalidateCachedArtwork,
  setCachedArtworkOverride,
} from '@/lib/artwork/artwork-cache';
import { resolveAnimeLogoSelection } from '@/lib/artwork/logo-selector';
import { getHoshikaAnime } from '@/lib/hoshika';
import { resolveAnimeIds } from '@/lib/id-mapper';
import {
  CustomLogoItem,
  DEFAULT_LOGO_DISPLAY_SETTINGS,
  FanartLogoItem,
} from '@/types/artwork';

export async function POST(req: NextRequest) {
  // 1. Authenticate Firebase ID token
  const verified = await verifyAdminRequest(req);
  if (!verified) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized: Valid administrator token required' },
      { status: 401 }
    );
  }

  // 2. Verify admin role & uploadLogos permission in Firestore
  if (
    !hasAdminPermission(verified.admin, 'uploadLogos') &&
    !hasAdminPermission(verified.admin, 'manageArtwork')
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Forbidden: Administrator lacks permission to upload custom logos',
      },
      { status: 403 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid multipart/form-data payload' },
      { status: 400 }
    );
  }

  const fileEntry = formData.get('file');
  const hoshikaIdRaw = formData.get('hoshikaId');
  const anilistIdRaw = formData.get('anilistId');
  const fileNameRaw = formData.get('fileName');
  const mimeTypeRaw = formData.get('mimeType');
  const widthRaw = formData.get('width');
  const heightRaw = formData.get('height');
  const selectImmediately =
    formData.get('selectImmediately') !== 'false';

  const hoshikaId = Number(hoshikaIdRaw);
  if (!Number.isFinite(hoshikaId) || hoshikaId <= 0) {
    return NextResponse.json(
      { ok: false, error: 'Valid hoshikaId is required' },
      { status: 400 }
    );
  }

  if (!fileEntry || typeof (fileEntry as Blob).arrayBuffer !== 'function') {
    return NextResponse.json(
      { ok: false, error: 'Logo image file is required' },
      { status: 400 }
    );
  }

  const blob = fileEntry as Blob;
  const declaredName =
    typeof fileNameRaw === 'string' && fileNameRaw.trim()
      ? fileNameRaw.trim()
      : (fileEntry as File).name || 'custom-logo.png';
  const declaredMime =
    typeof mimeTypeRaw === 'string' && mimeTypeRaw.trim()
      ? mimeTypeRaw.trim()
      : blob.type || 'image/png';

  // 3. Server-side binary validation (magic bytes, MIME type, size <= 5MB, SVG/HTML/JS rejection)
  const arrayBuf = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const validation = validateLogoUploadBuffer({
    buffer,
    declaredMimeType: declaredMime,
    fileName: declaredName,
  });

  if (
    !validation.valid ||
    !validation.detectedMimeType ||
    !validation.extension
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: validation.error || 'Invalid logo image file',
      },
      { status: 400 }
    );
  }

  // 4. Resolve anime metadata and in-memory AniList ID for Supabase Storage folder path
  let folderAnimeId = Number(anilistIdRaw);
  const anime = await getHoshikaAnime(hoshikaId).catch(() => null);

  if (!Number.isFinite(folderAnimeId) || folderAnimeId <= 0) {
    if (anime?.anilistId && anime.anilistId > 0) {
      folderAnimeId = anime.anilistId;
    } else {
      const idRes = await resolveAnimeIds(hoshikaId, anime).catch(() => null);
      folderAnimeId =
        idRes?.aniListId && idRes.aniListId > 0 ? idRes.aniListId : hoshikaId;
    }
  }

  const fileId = crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g, '');
  const storagePath = buildSupabaseLogoStoragePath({
    anilistId: folderAnimeId,
    hoshikaId,
    extension: validation.extension,
    uniqueId: fileId,
  });

  // 5. Upload binary buffer to Supabase Storage bucket "aniscroll-artwork"
  let uploadResult: {
    publicUrl: string;
    storageBucket: string;
    storagePath: string;
  };
  try {
    uploadResult = await uploadCustomLogoToSupabase({
      buffer,
      storagePath,
      mimeType: validation.detectedMimeType,
    });
  } catch (err) {
    console.error('[Admin Upload API] Supabase upload error:', err);
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to upload custom logo to Supabase Storage',
      },
      { status: 502 }
    );
  }

  const nowMs = Date.now();
  const safeFileName =
    validation.safeFileName ||
    declaredName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const width =
    validation.width ||
    (Number.isFinite(Number(widthRaw)) && Number(widthRaw) > 0
      ? Number(widthRaw)
      : 500);
  const height =
    validation.height ||
    (Number.isFinite(Number(heightRaw)) && Number(heightRaw) > 0
      ? Number(heightRaw)
      : 200);

  const customLogoItem: CustomLogoItem = {
    id: `custom_${fileId}`,
    url: uploadResult.publicUrl,
    proxyUrl: uploadResult.publicUrl,
    storageProvider: 'supabase',
    storageBucket: uploadResult.storageBucket || getSupabaseBucketName(),
    storagePath: uploadResult.storagePath,
    fileName: safeFileName,
    mimeType: validation.detectedMimeType,
    width,
    height,
    fileSize: buffer.byteLength,
    lang: 'en',
    selected: selectImmediately,
    uploadedBy: verified.uid,
    uploadedByEmail: verified.email,
    uploadedAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
  };

  // 6. Save metadata in Firestore (/animeArtwork/{hoshikaId}) with automatic rollback on failure
  try {
    const existingDoc = await fetchFirestoreDocumentServer(
      'animeArtwork',
      String(hoshikaId),
      verified.idToken
    );

    const prevCustomLogos: CustomLogoItem[] = Array.isArray(
      existingDoc?.customLogos
    )
      ? existingDoc.customLogos.map((c: CustomLogoItem) => ({
          ...c,
          selected: selectImmediately ? false : Boolean(c.selected),
        }))
      : [];

    const nextCustomLogos: CustomLogoItem[] = [
      customLogoItem,
      ...prevCustomLogos.filter((c) => c.id !== customLogoItem.id),
    ];

    const availableLogos: FanartLogoItem[] = Array.isArray(
      existingDoc?.availableLogos
    )
      ? existingDoc.availableLogos
      : [];
    const hiddenLogoIds: string[] = Array.isArray(existingDoc?.hiddenLogoIds)
      ? existingDoc.hiddenLogoIds
      : [];
    const logoDisplay =
      existingDoc?.logoDisplay || DEFAULT_LOGO_DISPLAY_SETTINGS;

    const nextMode: 'auto' | 'manual' = selectImmediately
      ? 'manual'
      : existingDoc?.selectionMode || 'auto';
    const nextLogoUrl = selectImmediately
      ? customLogoItem.url
      : existingDoc?.selectedLogoUrl || customLogoItem.url;
    const nextLogoSource = selectImmediately
      ? 'custom_upload'
      : existingDoc?.selectedLogoSource || 'custom_upload';
    const nextLogoLang = selectImmediately
      ? 'en'
      : existingDoc?.selectedLogoLanguage || 'en';

    const resolved = resolveAnimeLogoSelection({
      availableLogos,
      customLogos: nextCustomLogos,
      hiddenLogoIds,
      selectionMode: nextMode,
      manualLogoUrl: nextLogoUrl,
      manualLogoSource: nextLogoSource,
      manualLogoLanguage: nextLogoLang,
      logoDisplay,
      preferEnglish: true,
    });

    const title =
      existingDoc?.title ||
      anime?.titleEnglish ||
      anime?.titleRomaji ||
      `Anime #${hoshikaId}`;

    // Strictly never store anilistId in Firestore
    const firestoreData: Record<string, any> = {
      hoshikaId,
      tvdbId: existingDoc?.tvdbId || Number(anime?.thetvdbId) || 0,
      tmdbId: existingDoc?.tmdbId || Number(anime?.themoviedbId) || 0,
      title,
      selectedLogoUrl: resolved.logoUrl || customLogoItem.url,
      selectedLogoSource: resolved.selectedLogoSource,
      selectedLogoLanguage: resolved.selectedLogoLanguage,
      selectionMode: resolved.selectionMode,
      availableLogos,
      customLogos: nextCustomLogos,
      hiddenLogoIds,
      logoDisplay,
      logoStatus: resolved.logoStatus,
      backgroundUrl: existingDoc?.backgroundUrl || anime?.bannerImage || '',
      posterUrl: existingDoc?.posterUrl || anime?.coverImage || '',
      previousLogoUrl: existingDoc?.selectedLogoUrl || '',
      previousLogoSource:
        existingDoc?.selectedLogoSource || 'typography_fallback',
      hasEnglishLogo: resolved.hasEnglishLogo,
      hasJapaneseLogo: resolved.hasJapaneseLogo,
      reviewed: true,
      updatedBy: verified.uid,
      updatedByEmail: verified.email,
    };

    const saved = await writeFirestoreDocumentServer({
      collectionName: 'animeArtwork',
      documentId: String(hoshikaId),
      data: firestoreData,
      idToken: verified.idToken,
      includeCreatedAt: !existingDoc,
    });

    if (!saved) {
      throw new Error('Failed to persist custom logo metadata in Cloud Firestore');
    }

    // Update server-side cache and revalidate Next.js route
    setCachedArtworkOverride(hoshikaId, {
      ...firestoreData,
      updatedAt: nowMs,
    } as any);
    invalidateCachedArtwork(hoshikaId);
    try {
      revalidatePath(`/anime/${hoshikaId}`);
      revalidatePath(`/admin/artwork/${hoshikaId}`);
    } catch {
      // Ignore revalidate errors outside request context
    }

    return NextResponse.json({
      ok: true,
      logo: customLogoItem,
      customLogo: customLogoItem,
      selectedLogo: resolved.selectedLogo,
      customLogos: nextCustomLogos,
    });
  } catch (firestoreError) {
    // Roll back orphaned file from Supabase Storage
    await deleteCustomLogoFromSupabase(uploadResult.storagePath).catch(
      (rollbackErr) => {
        console.error(
          '[Admin Upload API] Failed to roll back Supabase file:',
          rollbackErr
        );
      }
    );

    console.error(
      '[Admin Upload API] Firestore persistence failed, rolled back Supabase upload:',
      firestoreError
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          firestoreError instanceof Error
            ? firestoreError.message
            : 'Failed to save logo metadata in Firestore; upload rolled back',
      },
      { status: 500 }
    );
  }
}
