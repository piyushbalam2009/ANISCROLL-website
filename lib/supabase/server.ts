import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Prevent accidental execution in browser bundles
if (typeof window !== 'undefined') {
  throw new Error(
    'SECURITY VIOLATION: lib/supabase/server.ts is a server-only module and must never be imported in client code.'
  );
}

export const MAX_CUSTOM_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB
export const DEFAULT_SUPABASE_BUCKET = 'aniscroll-artwork';
export const ALLOWED_LOGO_MIME_TYPES = new Set(['image/png', 'image/webp']);

let cachedSupabaseClient: SupabaseClient | null = null;
let cachedConfigKey = '';

export interface SupabaseStorageConfig {
  url: string;
  secretKey: string;
  bucket: string;
}

/**
 * Reads and validates server-side Supabase Storage configuration from environment variables.
 * Never logs or exposes secret keys in error messages.
 */
export function getSupabaseStorageConfig(): SupabaseStorageConfig {
  const url = (process.env.SUPABASE_URL || '').trim();
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
  const bucket =
    (process.env.SUPABASE_BUCKET || DEFAULT_SUPABASE_BUCKET).trim() ||
    DEFAULT_SUPABASE_BUCKET;

  const missing: string[] = [];
  if (
    !url ||
    url === 'your-project-url' ||
    !url.startsWith('https://')
  ) {
    missing.push('SUPABASE_URL');
  }
  if (
    !secretKey ||
    secretKey === 'your-secret-key' ||
    secretKey.length < 12
  ) {
    missing.push('SUPABASE_SECRET_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Supabase Storage is not configured on the server. Missing or placeholder environment variable(s): ${missing.join(
        ', '
      )}`
    );
  }

  return { url, secretKey, bucket };
}

export function isSupabaseStorageConfigured(): boolean {
  try {
    getSupabaseStorageConfig();
    return true;
  } catch {
    return false;
  }
}

export function getSupabaseBucketName(): string {
  return (
    (process.env.SUPABASE_BUCKET || DEFAULT_SUPABASE_BUCKET).trim() ||
    DEFAULT_SUPABASE_BUCKET
  );
}

/**
 * Returns a reusable server-only Supabase client authenticated with SUPABASE_SECRET_KEY.
 */
export function getSupabaseServerClient(): SupabaseClient {
  const { url, secretKey } = getSupabaseStorageConfig();
  const configKey = `${url}::${secretKey.slice(0, 6)}::${secretKey.length}`;

  if (cachedSupabaseClient && cachedConfigKey === configKey) {
    return cachedSupabaseClient;
  }

  cachedSupabaseClient = createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  cachedConfigKey = configKey;
  return cachedSupabaseClient;
}

export interface ValidatedLogoImageInfo {
  valid: boolean;
  error?: string;
  detectedMimeType?: 'image/png' | 'image/webp';
  extension?: 'png' | 'webp';
  width?: number;
  height?: number;
  fileSize?: number;
  safeFileName?: string;
}

/**
 * Validates binary image signature (magic bytes), MIME type, file size (<= 5 MB),
 * and extracts image dimensions without trusting browser MIME types or extensions.
 */
export function validateLogoUploadBuffer(params: {
  buffer: Buffer | Uint8Array;
  declaredMimeType?: string | null;
  fileName?: string | null;
  maxBytes?: number;
}): ValidatedLogoImageInfo {
  const maxBytes = params.maxBytes ?? MAX_CUSTOM_LOGO_BYTES;
  const bytes =
    params.buffer instanceof Buffer
      ? params.buffer
      : Buffer.from(params.buffer);

  if (!bytes || bytes.byteLength === 0) {
    return { valid: false, error: 'Uploaded file is empty (0 bytes).' };
  }

  if (bytes.byteLength > maxBytes) {
    return {
      valid: false,
      error: `File size (${(bytes.byteLength / (1024 * 1024)).toFixed(
        2
      )} MB) exceeds the 5 MB maximum limit.`,
    };
  }

  if (bytes.byteLength < 24) {
    return {
      valid: false,
      error: 'Invalid or corrupted image file (header too short).',
    };
  }

  // Check first 512 bytes for disguised SVG / HTML / XML / script payloads
  const headText = bytes
    .subarray(0, Math.min(512, bytes.byteLength))
    .toString('utf8')
    .toLowerCase();
  if (
    headText.includes('<svg') ||
    headText.includes('<!doctype html') ||
    headText.includes('<html') ||
    headText.includes('<script') ||
    headText.includes('<?xml')
  ) {
    return {
      valid: false,
      error: 'Executable, SVG, XML, or HTML content is strictly forbidden.',
    };
  }

  // 1. Check PNG magic signature: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  // 2. Check WebP magic signature: "RIFF" (0..3) + "WEBP" (8..11)
  const isWebp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;

  if (!isPng && !isWebp) {
    return {
      valid: false,
      error:
        'Unsupported file format. Only genuine transparent PNG and WebP images are allowed.',
    };
  }

  const detectedMimeType: 'image/png' | 'image/webp' = isPng
    ? 'image/png'
    : 'image/webp';
  const extension: 'png' | 'webp' = isPng ? 'png' : 'webp';

  // If caller declared a MIME type, ensure it is not a mismatched or disallowed type
  if (params.declaredMimeType) {
    const cleanMime = params.declaredMimeType.trim().toLowerCase();
    if (cleanMime && !ALLOWED_LOGO_MIME_TYPES.has(cleanMime)) {
      return {
        valid: false,
        error: `Unsupported MIME type "${cleanMime}". Allowed formats: image/png, image/webp.`,
      };
    }
  }

  // Extract dimensions from binary header
  let width = 0;
  let height = 0;

  if (isPng && bytes.byteLength >= 24) {
    // PNG IHDR chunk stores width at bytes 16..19 and height at bytes 20..23 (big-endian)
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (isWebp && bytes.byteLength >= 30) {
    const chunkHeader = bytes.subarray(12, 16).toString('ascii');
    if (chunkHeader === 'VP8X' && bytes.byteLength >= 30) {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    } else if (chunkHeader === 'VP8L' && bytes.byteLength >= 25) {
      const b0 = bytes[21]!;
      const b1 = bytes[22]!;
      const b2 = bytes[23]!;
      const b3 = bytes[24]!;
      width = 1 + (((b1 & 0x3f) << 8) | b0);
      height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    } else if (chunkHeader === 'VP8 ' && bytes.byteLength >= 30) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    }
  }

  const rawName = (params.fileName || `custom-logo.${extension}`)
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);

  const safeFileName = `${rawName || 'custom-logo'}.${extension}`;

  return {
    valid: true,
    detectedMimeType,
    extension,
    width: width > 0 ? width : 800,
    height: height > 0 ? height : 300,
    fileSize: bytes.byteLength,
    safeFileName,
  };
}

/**
 * Generates a unique, non-overwriting storage path following:
 * anime-logos/{anilistId}/{unique-file-id}.{extension}
 */
export function buildSupabaseLogoStoragePath(params: {
  anilistId?: number | null;
  hoshikaId?: number | null;
  extension: 'png' | 'webp';
  uniqueId?: string;
}): string {
  const folderId =
    params.anilistId && Number.isFinite(params.anilistId) && params.anilistId > 0
      ? Math.trunc(params.anilistId)
      : params.hoshikaId && Number.isFinite(params.hoshikaId) && params.hoshikaId > 0
      ? Math.trunc(params.hoshikaId)
      : 0;

  if (folderId <= 0) {
    throw new Error('A valid AniList ID or anime ID is required to build storage path.');
  }

  const rawUuid = params.uniqueId || crypto.randomUUID();
  const safeUuid = rawUuid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  const ext = params.extension === 'webp' ? 'webp' : 'png';

  return `anime-logos/${folderId}/${safeUuid}.${ext}`;
}

/**
 * Validates that a requested storagePath belongs to the expected anime and has no traversal segments.
 */
export function validateLogoStoragePathForAnime(params: {
  storagePath: string;
  anilistId?: number | null;
  hoshikaId?: number | null;
  allowedPaths?: string[];
}): { valid: boolean; error?: string } {
  const { storagePath, anilistId, hoshikaId, allowedPaths } = params;
  if (!storagePath || typeof storagePath !== 'string') {
    return { valid: false, error: 'Storage path is required.' };
  }

  const trimmed = storagePath.trim();
  if (trimmed.includes('..') || trimmed.startsWith('/') || trimmed.includes('\\')) {
    return { valid: false, error: 'Invalid storage path format.' };
  }

  const pattern = /^anime-logos\/(\d+)\/[a-zA-Z0-9._-]+\.(png|webp)$/;
  const match = trimmed.match(pattern);
  if (!match) {
    return {
      valid: false,
      error:
        'Storage path must match anime-logos/{id}/{file}.{png|webp}.',
    };
  }

  const pathId = Number(match[1]);
  const matchesAnilist =
    typeof anilistId === 'number' && anilistId > 0 && pathId === anilistId;
  const matchesHoshika =
    typeof hoshikaId === 'number' && hoshikaId > 0 && pathId === hoshikaId;
  const matchesAllowedList =
    Array.isArray(allowedPaths) && allowedPaths.includes(trimmed);

  if (!matchesAnilist && !matchesHoshika && !matchesAllowedList) {
    return {
      valid: false,
      error: 'Storage path does not belong to the specified anime record.',
    };
  }

  return { valid: true };
}

export interface SupabaseUploadResult {
  storageProvider: 'supabase';
  storageBucket: string;
  storagePath: string;
  publicUrl: string;
}

/**
 * Uploads a validated PNG/WebP buffer to Supabase Storage and returns the public URL and metadata.
 */
export async function uploadCustomLogoToSupabase(params: {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/webp';
  storagePath: string;
}): Promise<SupabaseUploadResult> {
  const { bucket } = getSupabaseStorageConfig();
  const supabase = getSupabaseServerClient();

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(params.storagePath, params.buffer, {
      contentType: params.mimeType,
      upsert: false,
      cacheControl: '31536000',
    });

  if (uploadError) {
    throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(params.storagePath);

  if (!publicUrlData?.publicUrl) {
    // Rollback if public URL could not be generated
    await supabase.storage.from(bucket).remove([params.storagePath]).catch(() => {});
    throw new Error('Failed to retrieve public URL from Supabase Storage.');
  }

  return {
    storageProvider: 'supabase',
    storageBucket: bucket,
    storagePath: params.storagePath,
    publicUrl: publicUrlData.publicUrl,
  };
}

/**
 * Deletes an object from the configured Supabase Storage bucket.
 */
export async function deleteCustomLogoFromSupabase(
  storagePath: string
): Promise<void> {
  const { bucket } = getSupabaseStorageConfig();
  const supabase = getSupabaseServerClient();

  const { error } = await supabase.storage.from(bucket).remove([storagePath]);
  if (error) {
    throw new Error(`Supabase Storage delete failed: ${error.message}`);
  }
}
