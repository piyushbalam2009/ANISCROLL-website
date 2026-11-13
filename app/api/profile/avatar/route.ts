import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyServerAuthToken } from '@/lib/firebase-admin';
import {
  buildSupabaseAvatarStoragePath,
  isSupabaseStorageConfigured,
  uploadUserAvatarToSupabase,
  validateAvatarUploadBuffer,
} from '@/lib/supabase/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: isSupabaseStorageConfigured(),
    maxSizeBytes: 2 * 1024 * 1024,
    acceptedTypes: ['image/png', 'image/webp', 'image/jpeg'],
  });
}

export async function POST(req: NextRequest) {
  const user = await verifyServerAuthToken(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Authentication required to upload a profile picture.' },
      { status: 401 }
    );
  }

  if (!isSupabaseStorageConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        error:
          'Custom avatar upload storage is not configured on this server. Choose any character portrait from the Anime Avatar Gallery.',
      },
      { status: 503 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid multipart/form-data payload.' },
      { status: 400 }
    );
  }

  const fileEntry = formData.get('file');
  if (!fileEntry || typeof (fileEntry as Blob).arrayBuffer !== 'function') {
    return NextResponse.json(
      { ok: false, error: 'Image file is required.' },
      { status: 400 }
    );
  }

  const blob = fileEntry as Blob;
  const buffer = Buffer.from(await blob.arrayBuffer());
  const validation = validateAvatarUploadBuffer({
    buffer,
    declaredMimeType: blob.type || null,
  });

  if (
    !validation.valid ||
    !validation.detectedMimeType ||
    !validation.extension
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: validation.error || 'Invalid avatar image file.',
      },
      { status: 400 }
    );
  }

  const storagePath = buildSupabaseAvatarStoragePath({
    uid: user.uid,
    extension: validation.extension,
    uniqueId: crypto.randomUUID(),
  });

  try {
    const uploaded = await uploadUserAvatarToSupabase({
      buffer,
      mimeType: validation.detectedMimeType,
      storagePath,
    });

    return NextResponse.json({
      ok: true,
      url: uploaded.publicUrl,
      storagePath: uploaded.storagePath,
    });
  } catch (err) {
    console.error('[API /profile/avatar] Upload failed:', err);
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to upload custom avatar.',
      },
      { status: 502 }
    );
  }
}
